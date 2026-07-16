import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { guardLocalApiRequest } from "@/server/http/local-request-guard";
import {
  markTriageItemReviewed,
  TriageRepositoryError,
} from "@/server/repositories/triage";

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
    const result = markTriageItemReviewed(assignmentId, payload);
    revalidatePath(`/assignments/${assignmentId}/results`);
    return Response.json({ review: result }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: { code: "INVALID_REVIEW", message: "Check the review note and try again." } },
        { status: 400 },
      );
    }
    if (error instanceof TriageRepositoryError) {
      const status = error.code === "ASSIGNMENT_NOT_FOUND" || error.code === "TRIAGE_ITEM_NOT_FOUND" ? 404 : 409;
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status },
      );
    }
    return Response.json(
      { error: { code: "REVIEW_FAILED", message: "The review could not be saved." } },
      { status: 500 },
    );
  }
}
