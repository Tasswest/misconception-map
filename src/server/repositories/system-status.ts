import "server-only";

import {
  MISCONCEPTIONS,
  TAXONOMY_VERSION,
} from "@/domain/misconception-taxonomy.mjs";
import { isOpenAIConfigured, OPENAI_MODEL } from "@/lib/config";
import { getDatabase } from "@/lib/db";

export function getSystemStatus() {
  try {
    const database = getDatabase();
    const application = database
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get("application") as { value: string } | undefined;
    const migration = database
      .prepare("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1")
      .get() as { name: string } | undefined;
    const taxonomy = database
      .prepare(
        "SELECT count(*) AS count FROM taxonomy_terms WHERE taxonomy_version = ?",
      )
      .get(TAXONOMY_VERSION) as { count: number };

    return {
      healthy: application?.value === "misconception-map",
      databaseReady: application?.value === "misconception-map",
      latestMigration: migration?.name ?? null,
      taxonomyVersion: TAXONOMY_VERSION,
      misconceptionCount: taxonomy.count,
      codeMisconceptionCount: MISCONCEPTIONS.length,
      liveAiReady: isOpenAIConfigured(),
      model: OPENAI_MODEL,
    };
  } catch {
    return {
      healthy: false,
      databaseReady: false,
      latestMigration: null,
      taxonomyVersion: TAXONOMY_VERSION,
      misconceptionCount: 0,
      codeMisconceptionCount: MISCONCEPTIONS.length,
      liveAiReady: isOpenAIConfigured(),
      model: OPENAI_MODEL,
    };
  }
}
