import "server-only";

import {
  hostedAccessCookieName,
  isHostedMode,
  verifyHostedAccessCookie,
} from "@/lib/hosted-access";
import { getDatabase } from "@/lib/db";

const DEFAULT_DAILY_BUDGET_USD = 5;
const DEFAULT_INPUT_USD_PER_MILLION = 5;
const DEFAULT_OUTPUT_USD_PER_MILLION = 30;
const DEFAULT_REQUESTS_PER_HOUR = 20;
const MAX_CONCURRENT_REQUESTS = 2;
const HOUR_MS = 60 * 60 * 1_000;

type SessionWindow = { count: number; startedAt: number };
type SpendProtectionGlobal = typeof globalThis & {
  hostedAiInFlight?: number;
  hostedAiSessionWindows?: Map<string, SessionWindow>;
};
const spendGlobal = globalThis as SpendProtectionGlobal;
const sessionWindows = (spendGlobal.hostedAiSessionWindows ??= new Map());

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requestLimit() {
  const parsed = Number(
    process.env.OPENAI_REQUESTS_PER_SESSION_HOUR ?? DEFAULT_REQUESTS_PER_HOUR,
  );
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000
    ? parsed
    : DEFAULT_REQUESTS_PER_HOUR;
}

export function getDailyAiSpendEstimate() {
  const inputRate = positiveNumber(
    process.env.OPENAI_INPUT_USD_PER_MILLION,
    DEFAULT_INPUT_USD_PER_MILLION,
  );
  const outputRate = positiveNumber(
    process.env.OPENAI_OUTPUT_USD_PER_MILLION,
    DEFAULT_OUTPUT_USD_PER_MILLION,
  );
  const database = getDatabase();
  const row = database
    .prepare(
      [
        "SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,",
        "COALESCE(SUM(output_tokens), 0) AS output_tokens FROM (",
        "SELECT input_tokens, output_tokens FROM ai_runs",
        "WHERE status = 'SUCCEEDED' AND date(created_at) = date('now')",
        "UNION ALL",
        "SELECT input_tokens, output_tokens FROM assignment_source_extractions",
        "WHERE cache_hit = 0 AND date(created_at) = date('now')",
        "UNION ALL",
        "SELECT input_tokens, output_tokens FROM follow_up_evaluations",
        "WHERE date(created_at) = date('now')",
        "UNION ALL",
        "SELECT input_tokens, output_tokens FROM exam_grade_proposals",
        "WHERE date(created_at) = date('now')",
        ")",
      ].join(" "),
    )
    .get() as { input_tokens: number; output_tokens: number };
  const estimatedUsd =
    (row.input_tokens * inputRate + row.output_tokens * outputRate) / 1_000_000;
  const now = new Date();
  const resetsAt = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    ),
  ).toISOString();
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedUsd,
    inputUsdPerMillion: inputRate,
    outputUsdPerMillion: outputRate,
    resetsAt,
  };
}
export function getAiAvailability() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return {
      available: false,
      code: "OPENAI_NOT_CONFIGURED" as const,
      message:
        "Add OPENAI_API_KEY to .env.local and restart the app to enable live correction.",
      spend: null,
      dailyBudgetUsd: null,
    };
  }
  if (!isHostedMode()) {
    return {
      available: true,
      code: null,
      message: null,
      spend: null,
      dailyBudgetUsd: null,
    };
  }

  const dailyBudgetUsd = positiveNumber(
    process.env.OPENAI_DAILY_BUDGET_USD,
    DEFAULT_DAILY_BUDGET_USD,
  );
  try {
    const spend = getDailyAiSpendEstimate();
    const available = spend.estimatedUsd < dailyBudgetUsd;
    return {
      available,
      code: available ? null : ("DAILY_DEMO_BUDGET_REACHED" as const),
      message: available
        ? null
        : "Daily demo budget reached — resets at midnight UTC; clone the repo to run unlimited.",
      spend,
      dailyBudgetUsd,
    };
  } catch {
    return {
      available: true,
      code: null,
      message: null,
      spend: null,
      dailyBudgetUsd,
    };
  }
}

function deniedResponse(code: string, message: string, status = 429) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export async function beginAiRequest(request: Request): Promise<
  | { allowed: false; response: Response }
  | { allowed: true; release: () => void }
> {
  const availability = getAiAvailability();
  if (!availability.available) {
    return {
      allowed: false,
      response: deniedResponse(
        availability.code ?? "OPENAI_UNAVAILABLE",
        availability.message ?? "Live AI is unavailable.",
        availability.code === "OPENAI_NOT_CONFIGURED" ? 503 : 429,
      ),
    };
  }

  if (!isHostedMode()) return { allowed: true, release: () => undefined };

  const session = await verifyHostedAccessCookie(
    cookieValue(request, hostedAccessCookieName()),
  );
  if (!session) {
    return {
      allowed: false,
      response: deniedResponse(
        "ACCESS_CODE_REQUIRED",
        "Enter the shared judge access code to continue.",
        401,
      ),
    };
  }

  const now = Date.now();
  const currentWindow = sessionWindows.get(session.id);
  const window =
    !currentWindow || now - currentWindow.startedAt >= HOUR_MS
      ? { count: 0, startedAt: now }
      : currentWindow;
  sessionWindows.set(session.id, window);
  if (window.count >= requestLimit()) {
    const retryAfter = Math.max(
      1,
      Math.ceil((window.startedAt + HOUR_MS - now) / 1_000),
    );
    const response = deniedResponse(
      "SESSION_AI_RATE_LIMITED",
      "This demo session has reached its hourly live-AI limit. Seeded results remain available.",
    );
    response.headers.set("retry-after", String(retryAfter));
    return { allowed: false, response };
  }

  const inFlight = spendGlobal.hostedAiInFlight ?? 0;
  if (inFlight >= MAX_CONCURRENT_REQUESTS) {
    const response = deniedResponse(
      "AI_CONCURRENCY_LIMIT",
      "Two live corrections are already running. Try again shortly.",
    );
    response.headers.set("retry-after", "5");
    return { allowed: false, response };
  }

  window.count += 1;
  spendGlobal.hostedAiInFlight = inFlight + 1;
  let released = false;
  return {
    allowed: true,
    release: () => {
      if (released) return;
      released = true;
      spendGlobal.hostedAiInFlight = Math.max(
        0,
        (spendGlobal.hostedAiInFlight ?? 1) - 1,
      );
    },
  };
}
