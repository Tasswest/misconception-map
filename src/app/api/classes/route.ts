import {
  createClass,
  createClassInputSchema,
  listWorkspaceOverview,
} from "@/server/repositories/workspace";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";

import { apiErrorResponse, readJsonBody } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createClassRequestSchema = createClassInputSchema.omit({ isDemo: true });

export function GET(request: Request) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    return Response.json({ data: listWorkspaceOverview() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    const input = createClassRequestSchema.parse(await readJsonBody(request));
    const classRecord = createClass({ ...input, isDemo: false });

    return Response.json({ data: classRecord }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
