import { NextResponse } from "next/server";
import { z } from "zod";

import { misconceptionIdSchema } from "@/domain/misconception-taxonomy.mjs";
import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";
import { InstructionalGenerationError } from "@/server/openai/generate-instructional-support";
import { beginAiRequest } from "@/server/openai/spend-protection";
import { InstructionalRepositoryError } from "@/server/repositories/instructional-support";
import { preparePredictionStudentModel } from "@/server/services/prediction-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    assignmentId: z.string().uuid(),
    membershipId: z.string().uuid(),
    misconceptionId: misconceptionIdSchema,
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
          code: "INVALID_STUDENT_MODEL_REQUEST",
          message: error.issues[0]?.message ?? "Check the Student Model request.",
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof InstructionalRepositoryError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === "DIAGNOSIS_NOT_FOUND" ? 404 : 409 },
    );
  }
  if (error instanceof InstructionalGenerationError) {
    const status =
      error.code === "OPENAI_RATE_LIMITED"
        ? 429
        : error.code === "OPENAI_NOT_CONFIGURED" ||
            error.code === "OPENAI_AUTH_FAILED" ||
            error.code === "OPENAI_UNAVAILABLE"
          ? 503
          : 502;
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "STUDENT_MODEL_FAILED",
        message: "The Student Model could not be prepared.",
      },
    },
    { status: 500 },
  );
}

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
    const protectedRequest = await beginAiRequest(request);
    if (!protectedRequest.allowed) return protectedRequest.response;
    const model = await (async () => {
      try {
        return await preparePredictionStudentModel({ classId, ...input });
      } finally {
        protectedRequest.release();
      }
    })();
    return NextResponse.json({ data: model }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
