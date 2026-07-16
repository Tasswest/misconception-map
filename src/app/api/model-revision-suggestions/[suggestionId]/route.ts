import { NextResponse } from "next/server";
import { z } from "zod";

import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";
import {
  decideRevisionSuggestion,
  PredictionRepositoryError,
} from "@/server/repositories/prediction-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    action: z.enum(["CONFIRM", "DISMISS"]),
    note: z.string().trim().max(1_000).nullable(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ suggestionId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    requireDeclaredBodyWithinLimit(request, 5_000);
    const input = requestSchema.parse(await request.json());
    const { suggestionId } = await context.params;
    const result = decideRevisionSuggestion({ suggestionId, ...input });
    return NextResponse.json({ data: result });
  } catch (error) {
    if (error instanceof LocalRequestBodyError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_REVISION_DECISION",
            message: error.issues[0]?.message ?? "Check the revision decision.",
          },
        },
        { status: 400 },
      );
    }
    if (error instanceof PredictionRepositoryError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === "REVISION_NOT_FOUND" ? 404 : 409 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "REVISION_DECISION_FAILED",
          message: "The revision decision could not be saved.",
        },
      },
      { status: 500 },
    );
  }
}
