import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { guardLocalApiRequest } from "@/server/http/local-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIXTURES = new Map([
  ["negative-distribution.jpeg", "01-negative-distribution.jpeg"],
  ["full-page-followup.jpeg", "09-full-page-followup.jpeg"],
]);

export async function GET(
  request: Request,
  context: { params: Promise<{ fixtureName: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  const { fixtureName } = await context.params;
  const storedFilename = FIXTURES.get(fixtureName);
  if (!storedFilename) {
    return NextResponse.json(
      { error: { code: "FIXTURE_NOT_FOUND", message: "That synthetic fixture is unavailable." } },
      { status: 404 },
    );
  }
  try {
    const bytes = await readFile(
      path.join(
        /* turbopackIgnore: true */ process.cwd(),
        "sample-work",
        storedFilename,
      ),
    );
    return new NextResponse(bytes, {
      headers: {
        "cache-control": "private, max-age=3600",
        "content-disposition": `attachment; filename="${fixtureName}"`,
        "content-type": "image/jpeg",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "FIXTURE_UNAVAILABLE", message: "The synthetic fixture could not be read." } },
      { status: 500 },
    );
  }
}
