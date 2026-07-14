import { NextResponse } from "next/server";
import { z } from "zod";

import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";
import { InstructionalGenerationError } from "@/server/openai/generate-instructional-support";
import { InstructionalRepositoryError } from "@/server/repositories/instructional-support";
import { generateBriefForLargestCluster } from "@/server/services/instructional-support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({}).strict();

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
          code: "INVALID_TEACHING_BRIEF_REQUEST",
          message: "The teaching brief request must use an empty JSON object.",
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
          error.code === "ASSIGNMENT_NOT_FOUND" || error.code === "NO_CLUSTER"
            ? 404
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
        code: "TEACHING_BRIEF_FAILED",
        message: "The teaching brief could not be generated. Try again.",
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
    requireDeclaredBodyWithinLimit(request, 1_000);
    requestSchema.parse(await request.json());
    const { assignmentId } = await context.params;
    const brief = await generateBriefForLargestCluster(assignmentId);
    return NextResponse.json({ data: brief }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
