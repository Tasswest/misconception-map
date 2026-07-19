import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { guardLocalApiRequest } from "@/server/http/local-request-guard";
import {
  GradebookRepositoryError,
  setExamGrade,
} from "@/server/repositories/gradebook";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  const { assignmentId } = await context.params;

  try {
    const payload = await request.json();
    const grade = setExamGrade(assignmentId, payload);
    revalidatePath(`/analytics/${assignmentId}`);
    revalidatePath(`/assignments/${assignmentId}/dashboard`);
    return Response.json({ grade }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: {
            code: "INVALID_GRADE",
            message: "Enter a score between 0 and the paper's maximum.",
          },
        },
        { status: 400 },
      );
    }
    if (error instanceof GradebookRepositoryError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return Response.json(
      {
        error: {
          code: "GRADE_FAILED",
          message: "The grade could not be saved.",
        },
      },
      { status: 500 },
    );
  }
}
