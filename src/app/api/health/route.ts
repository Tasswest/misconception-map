import { isOpenAIConfigured, OPENAI_MODEL } from "@/lib/config";
import { getDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const database = getDatabase();
    const application = database
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get("application") as { value: string } | undefined;

    return Response.json({
      status: "ok",
      database: application?.value === "misconception-map" ? "ready" : "unknown",
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
