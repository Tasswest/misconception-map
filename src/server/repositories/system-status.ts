import "server-only";

import {
  MISCONCEPTIONS,
  TAXONOMY_VERSION,
} from "@/domain/misconception-taxonomy.mjs";
import { isOpenAIConfigured, OPENAI_MODEL } from "@/lib/config";
import { getDatabase } from "@/lib/db";
import { getAiAvailability } from "@/server/openai/spend-protection";

export function getSystemStatus() {
  try {
    const aiAvailability = getAiAvailability();
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
    const aiRuns = database
      .prepare(
        [
          "SELECT purpose, status, model_name, input_tokens, output_tokens, latency_ms, created_at",
          "FROM ai_runs ORDER BY created_at DESC, id DESC LIMIT 25",
        ].join(" "),
      )
      .all() as Array<{
        purpose: string;
        status: string;
        model_name: string;
        input_tokens: number | null;
        output_tokens: number | null;
        latency_ms: number | null;
        created_at: string;
      }>;
    const extractionRuns = database
      .prepare(
        [
          "SELECT 'WORKSHEET_EXTRACTION' AS purpose, 'SUCCEEDED' AS status, extraction.model_name,",
          "extraction.input_tokens, extraction.output_tokens, extraction.latency_ms, extraction.cache_hit, extraction.created_at",
          "FROM assignment_source_extractions AS extraction",
          "ORDER BY extraction.created_at DESC, extraction.id DESC LIMIT 25",
        ].join(" "),
      )
      .all() as Array<{
        purpose: string;
        status: string;
        model_name: string;
        input_tokens: number | null;
        output_tokens: number | null;
        latency_ms: number | null;
        cache_hit: 0 | 1;
        created_at: string;
      }>;
    const recentRuns = [
      ...aiRuns.map((run) => ({ ...run, cache_hit: 0 as const })),
      ...extractionRuns,
    ]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, 25)
      .map((run) => ({
        purpose: run.purpose,
        status: run.status,
        model: run.model_name,
        inputTokens: run.input_tokens,
        outputTokens: run.output_tokens,
        totalTokens:
          run.input_tokens === null && run.output_tokens === null
            ? null
            : (run.input_tokens ?? 0) + (run.output_tokens ?? 0),
        latencyMs: run.latency_ms,
        cacheHit: run.cache_hit === 1,
        createdAt: run.created_at,
      }));

    return {
      healthy: application?.value === "misconception-map",
      databaseReady: application?.value === "misconception-map",
      latestMigration: migration?.name ?? null,
      taxonomyVersion: TAXONOMY_VERSION,
      misconceptionCount: taxonomy.count,
      codeMisconceptionCount: MISCONCEPTIONS.length,
      liveAiReady: isOpenAIConfigured(),
      aiAvailability,
      model: OPENAI_MODEL,
      recentRuns,
    };
  } catch {
    const aiAvailability = getAiAvailability();
    return {
      healthy: false,
      databaseReady: false,
      latestMigration: null,
      taxonomyVersion: TAXONOMY_VERSION,
      misconceptionCount: 0,
      codeMisconceptionCount: MISCONCEPTIONS.length,
      liveAiReady: isOpenAIConfigured(),
      aiAvailability,
      model: OPENAI_MODEL,
      recentRuns: [],
    };
  }
}
