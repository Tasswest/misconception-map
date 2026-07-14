import { NextResponse } from "next/server";
import { z } from "zod";

import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";
import { PredictionRepositoryError } from "@/server/repositories/prediction-lab";
import { createHeldOutPredictionProbe } from "@/server/services/prediction-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    modelVersionId: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    problemPrompt: z.string().trim().min(1).max(4_000),
    correctAnswer: z.string().trim().min(1).max(1_000),
    answerFormat: z.enum([
      "EXPRESSION",
      "NUMBER",
      "FRACTION",
      "MULTIPLE_CHOICE",
      "SHORT_TEXT",
    ]),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ classId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    requireDeclaredBodyWithinLimit(request, 20_000);
    const { classId } = await context.params;
    const input = requestSchema.parse(await request.json());
    const assignment = createHeldOutPredictionProbe({ classId, ...input });
    return NextResponse.json({ data: assignment }, { status: 201 });
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
            code: "INVALID_PREDICTION_PROBE",
            message: error.issues[0]?.message ?? "Check the held-out probe.",
          },
        },
        { status: 400 },
      );
    }
    if (error instanceof PredictionRepositoryError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === "MODEL_NOT_FOUND" ? 404 : 409 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "PREDICTION_PROBE_FAILED",
          message: "The held-out probe could not be created.",
        },
      },
      { status: 500 },
    );
  }
}
