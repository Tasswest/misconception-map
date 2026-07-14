import { NextResponse } from "next/server";
import { z } from "zod";

import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";
import { InstructionalGenerationError } from "@/server/openai/generate-instructional-support";
import { PredictionRepositoryError } from "@/server/repositories/prediction-lab";
import { lockStudentPrediction } from "@/server/services/prediction-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    modelVersionId: z.string().uuid(),
    targetAssignmentItemId: z.string().uuid(),
  })
  .strict();

function errorResponse(error: unknown) {
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
          code: "INVALID_PREDICTION_REQUEST",
          message: error.issues[0]?.message ?? "Check the prediction request.",
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof PredictionRepositoryError) {
    const status =
      error.code === "TARGET_NOT_FOUND" || error.code === "MODEL_NOT_FOUND"
        ? 404
        : error.code === "PERSISTENCE_ERROR"
          ? 500
          : 409;
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status },
    );
  }
  if (error instanceof InstructionalGenerationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status:
          error.code === "OPENAI_RATE_LIMITED"
            ? 429
            : error.code === "OPENAI_NOT_CONFIGURED"
              ? 503
              : 502,
      },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "PREDICTION_FAILED",
        message: "The prediction could not be generated and locked.",
      },
    },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    requireDeclaredBodyWithinLimit(request, 20_000);
    const input = requestSchema.parse(await request.json());
    const prediction = await lockStudentPrediction(input);
    return NextResponse.json({ data: prediction }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
