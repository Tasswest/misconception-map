import {
  archiveAssignment,
  assignmentMutationInputSchema,
  renameAssignment,
} from "@/server/repositories/management";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";
import {
  apiErrorResponse,
  readJsonBody,
} from "@/app/api/classes/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    const { assignmentId } = await params;
    const input = assignmentMutationInputSchema.parse(
      await readJsonBody(request),
    );
    const result =
      "action" in input
        ? archiveAssignment(assignmentId)
        : renameAssignment(assignmentId, input.name);
    return Response.json({ data: result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
