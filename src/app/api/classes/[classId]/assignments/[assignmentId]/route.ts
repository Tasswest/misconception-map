import {
  entityIdSchema,
  getDiagnosticAssignment,
} from "@/server/repositories/workspace";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";

import {
  ApiRequestError,
  apiErrorResponse,
} from "@/app/api/classes/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    const parameters = await context.params;
    const classId = entityIdSchema.parse(parameters.classId);
    const assignmentId = entityIdSchema.parse(parameters.assignmentId);
    const assignment = getDiagnosticAssignment(assignmentId);

    if (assignment === null || assignment.classId !== classId) {
      throw new ApiRequestError(
        "ASSIGNMENT_NOT_FOUND",
        "The selected assignment is unavailable.",
        404,
      );
    }

    return Response.json({ data: assignment });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
