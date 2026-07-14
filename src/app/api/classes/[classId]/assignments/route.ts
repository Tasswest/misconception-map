import {
  createDiagnosticAssignment,
  createDiagnosticAssignmentInputSchema,
  entityIdSchema,
} from "@/server/repositories/workspace";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";

import { apiErrorResponse, readJsonBody } from "@/app/api/classes/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ classId: string }>;
};

const createAssignmentRequestSchema =
  createDiagnosticAssignmentInputSchema.omit({ classId: true });

export async function POST(request: Request, context: RouteContext) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    const { classId: rawClassId } = await context.params;
    const classId = entityIdSchema.parse(rawClassId);
    const input = createAssignmentRequestSchema.parse(
      await readJsonBody(request),
    );
    const assignment = createDiagnosticAssignment({ ...input, classId });

    return Response.json({ data: assignment }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
