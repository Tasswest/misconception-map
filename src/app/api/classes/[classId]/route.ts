import {
  archiveClass,
  classMutationInputSchema,
  renameClass,
} from "@/server/repositories/management";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";

import { apiErrorResponse, readJsonBody } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ classId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    const { classId } = await params;
    const input = classMutationInputSchema.parse(await readJsonBody(request));
    const result =
      "action" in input
        ? archiveClass(classId)
        : renameClass(classId, input.name);
    return Response.json({ data: result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
