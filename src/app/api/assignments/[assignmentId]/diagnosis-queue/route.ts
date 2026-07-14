import { NextResponse } from "next/server";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";

import {
  DiagnosisRepositoryError,
  listAssignmentDiagnosisQueue,
} from "@/server/repositories/diagnosis";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  const { assignmentId } = await context.params;

  try {
    const items = listAssignmentDiagnosisQueue(assignmentId);
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof DiagnosisRepositoryError) {
      const status =
        error.code === "ASSIGNMENT_NOT_FOUND"
          ? 404
          : error.code === "ASSIGNMENT_NOT_READY" ||
              error.code === "ASSIGNMENT_CONTEXT_MISSING"
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
          code: "DIAGNOSIS_QUEUE_FAILED",
          message: "The saved diagnosis queue could not be loaded.",
        },
      },
      { status: 500 },
    );
  }
}
