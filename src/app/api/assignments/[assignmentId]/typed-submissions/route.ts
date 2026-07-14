import { NextResponse } from "next/server";
import { z } from "zod";
import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";

import {
  createTypedSubmissions,
  DiagnosisRepositoryError,
  typedSubmissionItemSchema,
} from "@/server/repositories/diagnosis";

export const runtime = "nodejs";

const MAX_TYPED_REQUEST_BYTES = 1_100_000;

const requestSchema = z
  .object({
    deidentified: z.literal(true, {
      error: "Confirm that student names were removed from the response content.",
    }),
    items: z.array(typedSubmissionItemSchema).min(1).max(20),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  const { assignmentId } = await context.params;

  try {
    requireDeclaredBodyWithinLimit(request, MAX_TYPED_REQUEST_BYTES);
    let decodedBody: unknown;
    try {
      decodedBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_TYPED_RESPONSES",
            message: "The typed-response request could not be read.",
          },
        },
        { status: 400 },
      );
    }
    const body = requestSchema.parse(decodedBody);
    const result = createTypedSubmissions({ assignmentId, items: body.items });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
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
            code: "INVALID_TYPED_RESPONSES",
            message:
              error.issues[0]?.message ?? "Check each typed response.",
          },
        },
        { status: 400 },
      );
    }

    if (error instanceof DiagnosisRepositoryError) {
      const status =
        error.code === "ASSIGNMENT_NOT_FOUND"
          ? 404
          : error.code === "IDEMPOTENCY_CONFLICT" ||
              error.code === "ASSIGNMENT_NOT_READY"
            ? 409
            : 400;
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "TYPED_SUBMISSION_FAILED",
          message: "The typed responses could not be saved.",
        },
      },
      { status: 500 },
    );
  }
}
