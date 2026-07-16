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
import { generatePracticeForStudent } from "@/server/services/instructional-support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
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
          code: "INVALID_PRACTICE_REQUEST",
          message: error.issues[0]?.message ?? "Check the practice request.",
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof InstructionalRepositoryError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status:
          error.code === "ASSIGNMENT_NOT_FOUND" ||
          error.code === "DIAGNOSIS_NOT_FOUND"
            ? 404
            : error.code === "MODEL_UNAVAILABLE"
              ? 409
              : 500,
      },
    );
  }
  if (error instanceof InstructionalGenerationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status:
          error.code === "OPENAI_NOT_CONFIGURED" ||
          error.code === "OPENAI_AUTH_FAILED"
            ? 503
            : error.code === "OPENAI_RATE_LIMITED"
              ? 429
              : 502,
      },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "PRACTICE_FAILED",
        message: "The targeted worksheet could not be generated. Try again.",
      },
    },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    requireDeclaredBodyWithinLimit(request, 20_000);
    const { assignmentId } = await context.params;
    const input = requestSchema.parse(await request.json());
    const protectedRequest = await beginAiRequest(request);
    if (!protectedRequest.allowed) return protectedRequest.response;
    const worksheet = await (async () => {
      try {
        return await generatePracticeForStudent({ assignmentId, ...input });
      } finally {
        protectedRequest.release();
      }
    })();
    return NextResponse.json({ data: worksheet }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
