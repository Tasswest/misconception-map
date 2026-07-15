import { apiErrorResponse } from "@/app/api/classes/_shared";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";
import { loadDemoClassroom } from "@/server/repositories/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    return Response.json({ data: loadDemoClassroom() }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
