import { readFile } from "node:fs/promises";

import { guardLocalApiRequest } from "@/server/http/local-request-guard";
import { getCorrectedExamSourceAsset } from "@/server/repositories/corrected-exam";
import { resolveStoredStudentWorkAsset } from "@/server/storage/submission-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;

  const { submissionId } = await context.params;
  const asset = getCorrectedExamSourceAsset(submissionId);
  if (!asset) {
    return Response.json(
      {
        error: {
          code: "ASSET_NOT_FOUND",
          message: "That student-work image is no longer available.",
        },
      },
      { status: 404 },
    );
  }

  try {
    const bytes = await readFile(
      /* turbopackIgnore: true */ resolveStoredStudentWorkAsset(
        asset.storage_key,
      ),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": 'inline; filename="student-work.webp"',
        "Content-Length": String(bytes.byteLength),
        "Content-Type": asset.media_type,
        ETag: `"${asset.sha256}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "ASSET_UNAVAILABLE",
          message: "That student-work image could not be opened.",
        },
      },
      { status: 404 },
    );
  }
}
