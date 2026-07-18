import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  hasPdfSignature,
  PDF_DIRECT_INPUT_VERSION,
  PDF_MEDIA_TYPE,
} from "@/domain/pdf-input.mjs";
import {
  detectPdfPageCount,
  MAX_DIRECT_EXTRACTION_PDF_PAGES,
} from "@/domain/pdf-page-count.mjs";
import { WORKSHEET_EXTRACTION_SCHEMA_VERSION } from "@/domain/worksheet-extraction";
import { OPENAI_MODEL } from "@/lib/config";
import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";
import {
  createWorksheetExtractionInputHash,
  extractWorksheet,
  type ExtractWorksheetInput,
  WORKSHEET_EXTRACTION_PROMPT_VERSION,
  WorksheetExtractionError,
} from "@/server/openai/extract-worksheet";
import { beginAiRequest } from "@/server/openai/spend-protection";
import { containsRosterName } from "@/server/privacy/roster-text";
import {
  confirmWorksheetExtraction,
  confirmWorksheetInputSchema,
  completeWorksheetExtractionAttempt,
  getCachedWorksheetExtractionRun,
  getDraftWorksheetAssignment,
  saveWorksheetExtraction,
  startWorksheetExtractionAttempt,
  WorksheetRepositoryError,
} from "@/server/repositories/worksheet";
import { preprocessWorksheetImage } from "@/server/storage/image-preprocessing.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WORKSHEET_FILE_BYTES = 15 * 1024 * 1024;
const MAX_WORKSHEET_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_CONFIRM_REQUEST_BYTES = 180_000;

class WorksheetPdfTooLongError extends Error {
  readonly code = "PDF_TOO_LONG";
  readonly pageCount: number;

  constructor(pageCount: number) {
    super(
      `PDF too long — ${pageCount} pages. Select the exam pages, save them as a PDF of ${MAX_DIRECT_EXTRACTION_PDF_PAGES} pages or fewer, and retry.`,
    );
    this.name = "WorksheetPdfTooLongError";
    this.pageCount = pageCount;
  }
}

async function extractOrReuseWorksheet(
  input: ExtractWorksheetInput,
  request: Request,
  metadata: { assignmentId: string; originalFilename: string | null },
) {
  const startedAt = performance.now();
  const inputHash = createWorksheetExtractionInputHash(input);
  const attemptId = startWorksheetExtractionAttempt({
    assignmentId: metadata.assignmentId,
    sourceKind: input.sourceKind,
    originalFilename: metadata.originalFilename,
    pageCount: input.sourceKind === "PDF" ? input.pdfPageCount : null,
    inputHash,
    modelName: OPENAI_MODEL,
    promptVersion: WORKSHEET_EXTRACTION_PROMPT_VERSION,
    schemaVersion: WORKSHEET_EXTRACTION_SCHEMA_VERSION,
  });

  if (
    input.sourceKind === "PDF" &&
    input.pdfPageCount > MAX_DIRECT_EXTRACTION_PDF_PAGES
  ) {
    const error = new WorksheetPdfTooLongError(input.pdfPageCount);
    completeWorksheetExtractionAttempt({
      attemptId,
      status: "FAILED",
      cacheHit: false,
      errorCode: error.code,
      errorMessage: error.message,
      inputTokens: null,
      outputTokens: null,
      latencyMs: performance.now() - startedAt,
    });
    throw error;
  }

  const cached = getCachedWorksheetExtractionRun(inputHash);
  if (cached) {
    completeWorksheetExtractionAttempt({
      attemptId,
      status: "SUCCEEDED",
      cacheHit: true,
      errorCode: null,
      errorMessage: null,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: performance.now() - startedAt,
    });
    return { run: cached, denied: null };
  }

  const protectedRequest = await beginAiRequest(request);
  if (!protectedRequest.allowed) {
    completeWorksheetExtractionAttempt({
      attemptId,
      status: "FAILED",
      cacheHit: false,
      errorCode: "AI_ACTION_UNAVAILABLE",
      errorMessage: "Live worksheet extraction is currently unavailable.",
      inputTokens: null,
      outputTokens: null,
      latencyMs: performance.now() - startedAt,
    });
    return { run: null, denied: protectedRequest.response };
  }
  try {
    const run = await extractWorksheet(input);
    completeWorksheetExtractionAttempt({
      attemptId,
      status: "SUCCEEDED",
      cacheHit: false,
      errorCode: null,
      errorMessage: null,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      latencyMs: run.latencyMs,
    });
    return { run, denied: null };
  } catch (error) {
    const extractionError =
      error instanceof WorksheetExtractionError ? error : null;
    completeWorksheetExtractionAttempt({
      attemptId,
      status: "FAILED",
      cacheHit: false,
      errorCode: extractionError?.code ?? "WORKSHEET_FAILED",
      errorMessage:
        extractionError?.message ?? "The worksheet extraction failed unexpectedly.",
      inputTokens: extractionError?.inputTokens ?? null,
      outputTokens: extractionError?.outputTokens ?? null,
      latencyMs:
        extractionError && extractionError.latencyMs > 0
          ? extractionError.latencyMs
          : performance.now() - startedAt,
    });
    throw error;
  } finally {
    protectedRequest.release();
  }
}

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
  if (error instanceof WorksheetPdfTooLongError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          pageCount: error.pageCount,
        },
      },
      { status: 422 },
    );
  }
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
        message: "The worksheet could not be prepared. Try a clearer photo, PDF, or typed copy.",
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
      const extraction = await extractOrReuseWorksheet({
        sourceKind,
        assignmentDomain: assignment.domain,
        sourceText,
      }, request, { assignmentId, originalFilename: null });
      if (extraction.denied) return extraction.denied;
      const run = extraction.run;
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
          message: "Choose typed text, a worksheet photo, or a PDF.",
        },
      ]);
    }
    const sourceFile = formData.get("sourceFile");
    if (!(sourceFile instanceof File) || sourceFile.size === 0) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["sourceFile"],
          message: "Choose a worksheet photo or PDF.",
        },
      ]);
    }
    if (
      !["image/jpeg", "image/png", "image/webp", PDF_MEDIA_TYPE].includes(
        sourceFile.type,
      ) || sourceFile.size > MAX_WORKSHEET_FILE_BYTES
    ) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["sourceFile"],
          message: "Use one JPEG, PNG, WebP, or PDF worksheet file up to 15 MB.",
        },
      ]);
    }

    const sourceBytes = Buffer.from(await sourceFile.arrayBuffer());
    if (sourceFile.type === PDF_MEDIA_TYPE) {
      if (!hasPdfSignature(sourceBytes)) {
        throw new z.ZodError([
          {
            code: "custom",
            path: ["sourceFile"],
            message: "The selected file does not contain a valid PDF document.",
          },
        ]);
      }
      const pdfSha256 = createHash("sha256").update(sourceBytes).digest("hex");
      const pdfPageCount = detectPdfPageCount(sourceBytes);
      if (pdfPageCount === null) {
        throw new z.ZodError([
          {
            code: "custom",
            path: ["sourceFile"],
            message:
              "The PDF page count could not be read. Re-save or split the PDF, then retry.",
          },
        ]);
      }
      const extraction = await extractOrReuseWorksheet({
        sourceKind: "PDF",
        assignmentDomain: assignment.domain,
        pdfBytes: sourceBytes,
        pdfSha256,
        pdfPageCount,
      }, request, {
        assignmentId,
        originalFilename: safeFilename(sourceFile.name),
      });
      if (extraction.denied) return extraction.denied;
      const run = extraction.run;
      const saved = saveWorksheetExtraction({
        assignmentId,
        source: {
          sourceKind: "PDF",
          bytes: sourceBytes,
          originalFilename: safeFilename(sourceFile.name),
          mediaType: PDF_MEDIA_TYPE,
          sha256: pdfSha256,
          preprocessingVersion: PDF_DIRECT_INPUT_VERSION,
        },
        run,
      });
      return NextResponse.json({ data: saved }, { status: 201 });
    }

    const prepared = await preprocessWorksheetImage(sourceBytes);
    const imageSha256 = createHash("sha256")
      .update(prepared.bytes)
      .digest("hex");
    const extraction = await extractOrReuseWorksheet({
      sourceKind,
      assignmentDomain: assignment.domain,
      imageBytes: prepared.bytes,
      imageMediaType: "image/webp",
      imageSha256,
    }, request, {
      assignmentId,
      originalFilename: safeFilename(sourceFile.name),
    });
    if (extraction.denied) return extraction.denied;
    const run = extraction.run;
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
