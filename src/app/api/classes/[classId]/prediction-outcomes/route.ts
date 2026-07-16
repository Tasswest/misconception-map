import { NextResponse } from "next/server";
import { z } from "zod";

import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";
import { PredictionRepositoryError } from "@/server/repositories/prediction-lab";
import { beginAiRequest } from "@/server/openai/spend-protection";
import { synchronizePredictionOutcomes } from "@/server/services/prediction-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ classId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    requireDeclaredBodyWithinLimit(request, 1_000);
    requestSchema.parse(await request.json());
    const { classId } = await context.params;
    const protectedRequest = await beginAiRequest(request);
    if (!protectedRequest.allowed) return protectedRequest.response;
    const result = await (async () => {
      try {
        return await synchronizePredictionOutcomes(classId);
      } finally {
        protectedRequest.release();
      }
    })();
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
            code: "INVALID_OUTCOME_SYNC_REQUEST",
            message: "Outcome reconciliation expects an empty JSON object.",
          },
        },
        { status: 400 },
      );
    }
    if (error instanceof PredictionRepositoryError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === "CLASS_NOT_FOUND" ? 404 : 500 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "OUTCOME_SYNC_FAILED",
          message: "Prediction outcomes could not be reconciled.",
        },
      },
      { status: 500 },
    );
  }
}
