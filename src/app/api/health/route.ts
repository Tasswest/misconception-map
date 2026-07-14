import {
  MISCONCEPTIONS,
  TAXONOMY_VERSION,
} from "@/domain/misconception-taxonomy.mjs";
import { isOpenAIConfigured, OPENAI_MODEL } from "@/lib/config";
import { getDatabase } from "@/lib/db";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  try {
    const database = getDatabase();
    const application = database
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get("application") as { value: string } | undefined;
    const migration = database
      .prepare(
        "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1",
      )
      .get() as { name: string } | undefined;
    const taxonomy = database
      .prepare(
        "SELECT count(*) AS count FROM taxonomy_terms WHERE taxonomy_version = ?",
      )
      .get(TAXONOMY_VERSION) as { count: number };

    return Response.json({
      status: "ok",
      database: application?.value === "misconception-map" ? "ready" : "unknown",
      schema: {
        latestMigration: migration?.name ?? null,
        taxonomyVersion: TAXONOMY_VERSION,
        misconceptionCount: taxonomy.count,
        codeMisconceptionCount: MISCONCEPTIONS.length,
      },
      liveAi: isOpenAIConfigured() ? "ready" : "not_configured",
      model: OPENAI_MODEL,
    });
  } catch {
    return Response.json(
      {
        status: "error",
        database: "unavailable",
        liveAi: isOpenAIConfigured() ? "ready" : "not_configured",
      },
      { status: 503 },
    );
  }
}
