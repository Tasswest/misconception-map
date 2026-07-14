import { NextResponse } from "next/server";
import { z } from "zod";
import {
  guardLocalApiRequest,
  LocalRequestBodyError,
  requireDeclaredBodyWithinLimit,
} from "@/server/http/local-request-guard";

import {
  createImageUploadBatch,
  DiagnosisRepositoryError,
  preflightImageUploadBatch,
  validateDiagnosisTargets,
} from "@/server/repositories/diagnosis";
import {
  MAX_FILES_PER_UPLOAD,
  MAX_STUDENT_WORK_BYTES,
  type PreparedStudentWorkAsset,
  prepareStudentWorkAsset,
  removeStoredStudentWorkAsset,
  StudentWorkAssetError,
  writePreparedStudentWorkAsset,
} from "@/server/storage/submission-assets";

export const runtime = "nodejs";

const MAX_MULTIPART_REQUEST_BYTES = 82 * 1024 * 1024;

const metadataSchema = z
  .object({
    deidentified: z.literal(true, {
      error: "Confirm that visible student names were removed or covered.",
    }),
    items: z
      .array(
        z
          .object({
            clientId: z.string().uuid(),
            membershipId: z.string().uuid(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_FILES_PER_UPLOAD)
      .superRefine((items, context) => {
        const clientIds = new Set<string>();
        items.forEach((item, index) => {
          if (clientIds.has(item.clientId)) {
            context.addIssue({
              code: "custom",
              message: "Each queued image needs a unique local identifier.",
              path: [index, "clientId"],
            });
          }
          clientIds.add(item.clientId);
        });
      }),
  })
  .strict();

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_UPLOAD",
          message: error.issues[0]?.message ?? "Check the upload details.",
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof LocalRequestBodyError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  if (error instanceof StudentWorkAssetError) {
    const status =
      error.code === "STORAGE_ERROR"
        ? 500
        : error.code === "FILE_TOO_LARGE"
          ? 413
          : 400;
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status },
    );
  }

  if (error instanceof DiagnosisRepositoryError) {
    const status =
      error.code === "ASSIGNMENT_NOT_FOUND"
        ? 404
        : error.code === "IDEMPOTENCY_CONFLICT" ||
            error.code === "ASSIGNMENT_NOT_READY"
          ? 409
          : 400;
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "UPLOAD_FAILED",
        message: "The images could not be saved. Nothing was diagnosed.",
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
  const { assignmentId } = await context.params;
  const storedKeys: string[] = [];

  try {
    requireDeclaredBodyWithinLimit(request, MAX_MULTIPART_REQUEST_BYTES);
    const formData = await request.formData();
    const metadataValue = formData.get("metadata");
    if (typeof metadataValue !== "string") {
      throw new StudentWorkAssetError(
        "UNSUPPORTED_IMAGE",
        "Student tags are required for every image.",
      );
    }

    let decodedMetadata: unknown;
    try {
      decodedMetadata = JSON.parse(metadataValue);
    } catch {
      throw new StudentWorkAssetError(
        "UNSUPPORTED_IMAGE",
        "The image-to-student tags could not be read.",
      );
    }

    const metadata = metadataSchema.parse(decodedMetadata).items;
    const fileValues = formData.getAll("files");

    if (
      fileValues.length !== metadata.length ||
      fileValues.some((value) => !(value instanceof File))
    ) {
      throw new StudentWorkAssetError(
        "UNSUPPORTED_IMAGE",
        "Every queued image must have exactly one student tag.",
      );
    }

    const files = fileValues as File[];
    if (files.some((file) => file.size === 0)) {
      throw new StudentWorkAssetError("EMPTY_FILE", "Remove any empty files.");
    }
    if (files.some((file) => file.size > MAX_STUDENT_WORK_BYTES)) {
      throw new StudentWorkAssetError(
        "FILE_TOO_LARGE",
        "Each student-work image must be 10 MB or smaller.",
      );
    }

    const aggregateBytes = files.reduce((total, file) => total + file.size, 0);
    if (aggregateBytes > 80 * 1024 * 1024) {
      throw new StudentWorkAssetError(
        "FILE_TOO_LARGE",
        "Upload at most 80 MB of student work in one batch.",
      );
    }

    // Reject stale assignments and roster selections before decoding sensitive
    // student-work images or writing anything to disk.
    validateDiagnosisTargets({
      assignmentId,
      membershipIds: metadata.map((item) => item.membershipId),
    });

    const preparedAssets: PreparedStudentWorkAsset[] = [];
    for (const [index, file] of files.entries()) {
      const bytes = Buffer.from(await file.arrayBuffer());
      preparedAssets.push(
        await prepareStudentWorkAsset({
          bytes,
          claimedMediaType: file.type,
          originalFilename: file.name,
          submissionId: metadata[index].clientId,
        }),
      );
    }

    if (new Set(preparedAssets.map((asset) => asset.sha256)).size !== preparedAssets.length) {
      throw new StudentWorkAssetError(
        "UNSUPPORTED_IMAGE",
        "Remove duplicate images before diagnosing this batch.",
      );
    }

    const items = metadata.map((item, index) => ({
      ...item,
      submissionId: item.clientId,
      asset: preparedAssets[index],
    }));
    const replay = preflightImageUploadBatch({ assignmentId, items });
    if (replay) {
      return NextResponse.json(replay);
    }

    for (const asset of preparedAssets) {
      await writePreparedStudentWorkAsset(asset);
      storedKeys.push(asset.storageKey);
    }

    const batch = createImageUploadBatch({
      assignmentId,
      items,
    });

    // A concurrent request may have completed after preflight. Its records own
    // the stable client IDs, so remove this request's unreferenced files.
    if (batch.replayed) {
      const cleanup = await Promise.allSettled(
        storedKeys.map((storageKey) =>
          removeStoredStudentWorkAsset(storageKey),
        ),
      );
      if (cleanup.some((result) => result.status === "rejected")) {
        return NextResponse.json(
          {
            error: {
              code: "LOCAL_CLEANUP_REQUIRED",
              message:
                "The upload was safely replayed, but a redundant local file could not be removed.",
            },
          },
          { status: 500 },
        );
      }
      storedKeys.length = 0;
      return NextResponse.json(batch);
    }

    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    const cleanup = await Promise.allSettled(
      storedKeys.map((storageKey) =>
        removeStoredStudentWorkAsset(storageKey),
      ),
    );
    if (cleanup.some((result) => result.status === "rejected")) {
      return NextResponse.json(
        {
          error: {
            code: "LOCAL_CLEANUP_REQUIRED",
            message:
              "The upload failed and one protected local file could not be removed.",
          },
        },
        { status: 500 },
      );
    }
    return errorResponse(error);
  }
}
