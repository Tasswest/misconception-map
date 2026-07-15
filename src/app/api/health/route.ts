import { guardLocalApiRequest } from "@/server/http/local-request-guard";
import { getSystemStatus } from "@/server/repositories/system-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  const status = getSystemStatus();
  if (status.healthy) {
    return Response.json({
      status: "ok",
      database: status.databaseReady ? "ready" : "unknown",
      schema: {
        latestMigration: status.latestMigration,
        taxonomyVersion: status.taxonomyVersion,
        misconceptionCount: status.misconceptionCount,
        codeMisconceptionCount: status.codeMisconceptionCount,
      },
      liveAi: status.liveAiReady ? "ready" : "not_configured",
      model: status.model,
    });
  }
  return Response.json(
    {
      status: "error",
      database: "unavailable",
      liveAi: status.liveAiReady ? "ready" : "not_configured",
    },
    { status: 503 },
  );
}
