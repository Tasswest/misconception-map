import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createHostedAccessCookie,
  hostedAccessCookieName,
  hostedAccessSessionLifetimeSeconds,
  isHostedMode,
} from "@/lib/hosted-access";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ accessCode: z.string().min(1).max(512) }).strict();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
type AttemptState = { failures: number; windowStartedAt: number };
type AccessGlobal = typeof globalThis & { judgeAccessAttempts?: Map<string, AttemptState> };
const accessGlobal = globalThis as AccessGlobal;
const attempts = (accessGlobal.judgeAccessAttempts ??= new Map());

function attemptLimit() {
  const parsed = Number(process.env.JUDGE_ACCESS_ATTEMPTS_PER_15_MIN ?? "5");
  return Number.isSafeInteger(parsed) && parsed >= 2 && parsed <= 100 ? parsed : 5;
}

function clientKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function stateFor(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || now - current.windowStartedAt >= ATTEMPT_WINDOW_MS) {
    const fresh = { failures: 0, windowStartedAt: now };
    attempts.set(key, fresh);
    return fresh;
  }
  return current;
}

function accessCodesMatch(supplied: string, expected: string) {
  const left = createHash("sha256").update(supplied).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (!isHostedMode()) {
    return NextResponse.json(
      { error: { code: "HOSTED_MODE_DISABLED", message: "The access gate is used only in hosted mode." } },
      { status: 404 },
    );
  }
  const requestGuard = guardLocalApiRequest(request);
  if (requestGuard) return requestGuard;

  const expected = process.env.JUDGE_ACCESS_CODE?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: { code: "ACCESS_GATE_MISCONFIGURED", message: "The shared demo access code is not configured." } },
      { status: 503 },
    );
  }

  const key = clientKey(request);
  const state = stateFor(key);
  if (state.failures >= attemptLimit()) {
    const retryAfter = Math.max(
      1,
      Math.ceil((state.windowStartedAt + ATTEMPT_WINDOW_MS - Date.now()) / 1_000),
    );
    return NextResponse.json(
      { error: { code: "ACCESS_RATE_LIMITED", message: "Too many failed attempts. Try again later." } },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  try {
    const input = requestSchema.parse(await request.json());
    if (!accessCodesMatch(input.accessCode, expected)) {
      state.failures += 1;
      return NextResponse.json(
        { error: { code: "INVALID_ACCESS_CODE", message: "That access code was not accepted." } },
        { status: 401 },
      );
    }

    attempts.delete(key);
    const response = NextResponse.json({ data: { authenticated: true } });
    response.cookies.set({
      name: hostedAccessCookieName(),
      value: await createHostedAccessCookie(randomUUID()),
      httpOnly: true,
      maxAge: hostedAccessSessionLifetimeSeconds(),
      path: "/",
      sameSite: "strict",
      secure: true,
    });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: "INVALID_ACCESS_REQUEST", message: "Enter the shared judge access code." } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: "ACCESS_GATE_FAILED", message: "The access gate could not complete this request." } },
      { status: 500 },
    );
  }
}
