import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";
import {
  extractWorksheet,
  WorksheetExtractionError,
} from "@/server/openai/extract-worksheet";
import { containsRosterName } from "@/server/privacy/roster-text";
import {
  confirmWorksheetExtraction,
  confirmWorksheetInputSchema,
  getDraftWorksheetAssignment,
  saveWorksheetExtraction,
  WorksheetRepositoryError,
} from "@/server/repositories/worksheet";
import { preprocessWorksheetImage } from "@/server/storage/image-preprocessing.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WORKSHEET_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_WORKSHEET_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_CONFIRM_REQUEST_BYTES = 180_000;

function safeFilename(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[\\/\u0000-\u001f\u007f]+/g, "-")
      .trim()
      .slice(0, 180) || "worksheet-image"
  );
}

function worksheetErrorResponse(error: unknown) {
  if (error instanceof LocalRequestBodyError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_WORKSHEET",
          message: error.issues[0]?.message ?? "Check the worksheet details.",
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof WorksheetRepositoryError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status:
          error.code === "ASSIGNMENT_NOT_FOUND"
            ? 404
            : error.code === "ASSIGNMENT_NOT_DRAFT" ||
                error.code === "ASSIGNMENT_SOURCE_EXISTS"
              ? 409
              : 400,
      },
    );
  }
  if (error instanceof WorksheetExtractionError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status:
          error.code === "OPENAI_AUTH_FAILED" ||
          error.code === "OPENAI_NOT_CONFIGURED"
            ? 503
            : error.code === "OPENAI_RATE_LIMITED"
              ? 429
              : 502,
      },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "WORKSHEET_FAILED",
        message: "The worksheet could not be prepared. Try a clearer image or typed copy.",
      },
    },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;

  try {
    requireDeclaredBodyWithinLimit(request, MAX_WORKSHEET_REQUEST_BYTES);
    const { assignmentId } = await context.params;
    const assignment = getDraftWorksheetAssignment(assignmentId);
    const formData = await request.formData();
    const sourceKind = formData.get("sourceKind");
    if (formData.get("deidentified") !== "true") {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["deidentified"],
          message: "Confirm that the worksheet is a blank teacher copy with no student names.",
        },
      ]);
    }

    if (sourceKind === "TYPED") {
      const sourceText = z
        .string()
        .trim()
        .min(1, "Paste at least one worksheet problem.")
        .max(30_000)
        .parse(formData.get("sourceText"));
      if (containsRosterName(assignment.classId, [sourceText])) {
        throw new z.ZodError([
          {
            code: "custom",
            path: ["sourceText"],
            message: "Remove roster names from the worksheet text before extraction.",
          },
        ]);
      }
      const run = await extractWorksheet({
        sourceKind,
        assignmentDomain: assignment.domain,
        sourceText,
      });
      const saved = saveWorksheetExtraction({
        assignmentId,
        source: { sourceKind, sourceText },
        run,
      });
      return NextResponse.json({ data: saved }, { status: 201 });
    }

    if (sourceKind !== "IMAGE") {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["sourceKind"],
          message: "Choose a typed or photographed worksheet.",
        },
      ]);
    }
    const sourceFile = formData.get("sourceFile");
    if (!(sourceFile instanceof File) || sourceFile.size === 0) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["sourceFile"],
          message: "Choose a worksheet image.",
        },
      ]);
    }
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(sourceFile.type) ||
      sourceFile.size > MAX_WORKSHEET_IMAGE_BYTES
    ) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["sourceFile"],
          message: "Use one JPEG, PNG, or WebP worksheet image up to 15 MB.",
        },
      ]);
    }

    const prepared = await preprocessWorksheetImage(
      Buffer.from(await sourceFile.arrayBuffer()),
    );
    const imageSha256 = createHash("sha256")
      .update(prepared.bytes)
      .digest("hex");
    const run = await extractWorksheet({
      sourceKind,
      assignmentDomain: assignment.domain,
      imageBytes: prepared.bytes,
      imageMediaType: "image/webp",
      imageSha256,
    });
    const saved = saveWorksheetExtraction({
      assignmentId,
      source: {
        sourceKind,
        bytes: prepared.bytes,
        originalFilename: safeFilename(sourceFile.name),
        mediaType: "image/webp",
        sha256: imageSha256,
        width: prepared.width,
        height: prepared.height,
        preprocessingVersion: prepared.preprocessingVersion,
      },
      run,
    });
    return NextResponse.json({ data: saved }, { status: 201 });
  } catch (error) {
    return worksheetErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;

  try {
    requireDeclaredBodyWithinLimit(request, MAX_CONFIRM_REQUEST_BYTES);
    const { assignmentId } = await context.params;
    const input = confirmWorksheetInputSchema.parse(await request.json());
    const result = confirmWorksheetExtraction(assignmentId, input);
    return NextResponse.json({ data: result });
  } catch (error) {
    return worksheetErrorResponse(error);
  }
}
