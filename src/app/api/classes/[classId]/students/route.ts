import {
  createStudentMembership,
  createStudentMembershipInputSchema,
  entityIdSchema,
} from "@/server/repositories/workspace";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";

import { apiErrorResponse, readJsonBody } from "@/app/api/classes/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ classId: string }>;
};

const createStudentRequestSchema = createStudentMembershipInputSchema.omit({
  classId: true,
  isDemo: true,
});

export async function POST(request: Request, context: RouteContext) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    const { classId: rawClassId } = await context.params;
    const classId = entityIdSchema.parse(rawClassId);
    const input = createStudentRequestSchema.parse(await readJsonBody(request));
    const membership = createStudentMembership({
      ...input,
      classId,
      isDemo: false,
    });

    return Response.json({ data: membership }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
