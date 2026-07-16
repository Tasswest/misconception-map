import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import {
  hasPdfSignature,
  PDF_DIRECT_INPUT_VERSION,
  PDF_MEDIA_TYPE,
} from "@/domain/pdf-input.mjs";
import {
  prepareOriginalImageFallback,
  preprocessMathImage,
  preprocessStudentPageImage,
} from "@/server/storage/image-preprocessing.mjs";

export const MAX_STUDENT_WORK_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 20;

const allowedInputMediaTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  PDF_MEDIA_TYPE,
]);

const allowedDetectedFormats = new Set(["jpeg", "png", "webp"]);

export class StudentWorkAssetError extends Error {
  readonly code:
    | "EMPTY_FILE"
    | "FILE_TOO_LARGE"
    | "UNSUPPORTED_IMAGE"
    | "UNREADABLE_IMAGE"
    | "STORAGE_ERROR";

  constructor(
    code: StudentWorkAssetError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudentWorkAssetError";
    this.code = code;
  }
}

export type PreparedStudentWorkAsset = {
  id: string;
  submissionId: string;
  storageKey: string;
  originalFilename: string;
  mediaType: "image/webp" | "application/pdf";
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  cropLeft: number | null;
  cropTop: number | null;
  cropWidth: number | null;
  cropHeight: number | null;
  preprocessingVersion: string;
  fallbackStorageKey: string | null;
  fallbackMediaType: "image/webp" | null;
  fallbackByteSize: number | null;
  fallbackSha256: string | null;
  fallbackWidth: number | null;
  fallbackHeight: number | null;
  fallbackPreprocessingVersion: string | null;
  bytes: Buffer;
  fallbackBytes: Buffer | null;
};

function safeOriginalFilename(filename: string) {
  const basename = path.basename(filename).replace(/[\u0000-\u001f\u007f]/g, "");
  return (basename.trim() || "student-work").slice(0, 240);
}

export async function prepareStudentWorkAsset(input: {
  bytes: Buffer;
  claimedMediaType: string;
  originalFilename: string;
  submissionId: string;
  scopeKind?: "SINGLE_PROBLEM" | "FULL_PAGE";
}): Promise<PreparedStudentWorkAsset> {
  if (input.bytes.byteLength === 0) {
    throw new StudentWorkAssetError("EMPTY_FILE", "This student-work file is empty.");
  }

  if (input.bytes.byteLength > MAX_STUDENT_WORK_BYTES) {
    throw new StudentWorkAssetError(
      "FILE_TOO_LARGE",
      "Each student-work file must be 10 MB or smaller.",
    );
  }

  if (!allowedInputMediaTypes.has(input.claimedMediaType)) {
    throw new StudentWorkAssetError(
      "UNSUPPORTED_IMAGE",
      "Use a JPEG, PNG, WebP, or PDF file.",
    );
  }

  if (input.claimedMediaType === PDF_MEDIA_TYPE) {
    if (!hasPdfSignature(input.bytes)) {
      throw new StudentWorkAssetError(
        "UNSUPPORTED_IMAGE",
        "The selected file does not contain a valid PDF document.",
      );
    }

    const assetId = randomUUID();
    const storageKey = path.posix.join(
      "uploads",
      "submissions",
      input.submissionId,
      `${assetId}.pdf`,
    );

    return {
      id: assetId,
      submissionId: input.submissionId,
      storageKey,
      originalFilename: safeOriginalFilename(input.originalFilename),
      mediaType: PDF_MEDIA_TYPE,
      byteSize: input.bytes.byteLength,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      width: null,
      height: null,
      sourceWidth: null,
      sourceHeight: null,
      cropLeft: null,
      cropTop: null,
      cropWidth: null,
      cropHeight: null,
      preprocessingVersion: PDF_DIRECT_INPUT_VERSION,
      fallbackStorageKey: null,
      fallbackMediaType: null,
      fallbackByteSize: null,
      fallbackSha256: null,
      fallbackWidth: null,
      fallbackHeight: null,
      fallbackPreprocessingVersion: null,
      bytes: input.bytes,
      fallbackBytes: null,
    };
  }

  try {
    const image = sharp(input.bytes, {
      failOn: "warning",
      limitInputPixels: 40_000_000,
    });
    const metadata = await image.metadata();

    if (!metadata.format || !allowedDetectedFormats.has(metadata.format)) {
      throw new StudentWorkAssetError(
        "UNSUPPORTED_IMAGE",
        "The file contents are not a supported JPEG, PNG, or WebP image.",
      );
    }

    const [normalized, fallback] = await Promise.all([
      input.scopeKind === "FULL_PAGE"
        ? preprocessStudentPageImage(input.bytes)
        : preprocessMathImage(input.bytes),
      prepareOriginalImageFallback(input.bytes),
    ]);

    if (!normalized.width || !normalized.height) {
      throw new StudentWorkAssetError(
        "UNREADABLE_IMAGE",
        "The image dimensions could not be read.",
      );
    }

    const assetId = randomUUID();
    const storageKey = path.posix.join(
      "uploads",
      "submissions",
      input.submissionId,
      `${assetId}.webp`,
    );
    const fallbackStorageKey = path.posix.join(
      "uploads",
      "submissions",
      input.submissionId,
      `${assetId}.original.webp`,
    );

    return {
      id: assetId,
      submissionId: input.submissionId,
      storageKey,
      originalFilename: safeOriginalFilename(input.originalFilename),
      mediaType: "image/webp",
      byteSize: normalized.bytes.byteLength,
      sha256: createHash("sha256").update(normalized.bytes).digest("hex"),
      width: normalized.width,
      height: normalized.height,
      sourceWidth: normalized.sourceWidth,
      sourceHeight: normalized.sourceHeight,
      cropLeft: normalized.crop.left,
      cropTop: normalized.crop.top,
      cropWidth: normalized.crop.width,
      cropHeight: normalized.crop.height,
      preprocessingVersion: normalized.preprocessingVersion,
      fallbackStorageKey,
      fallbackMediaType: "image/webp",
      fallbackByteSize: fallback.bytes.byteLength,
      fallbackSha256: createHash("sha256").update(fallback.bytes).digest("hex"),
      fallbackWidth: fallback.width,
      fallbackHeight: fallback.height,
      fallbackPreprocessingVersion: fallback.preprocessingVersion,
      bytes: normalized.bytes,
      fallbackBytes: fallback.bytes,
    };
  } catch (error) {
    if (error instanceof StudentWorkAssetError) {
      throw error;
    }

    throw new StudentWorkAssetError(
      "UNREADABLE_IMAGE",
      "This image could not be opened. Try exporting it as JPEG, PNG, or PDF.",
      { cause: error },
    );
  }
}

function getUploadRoot() {
  const configuredDataDirectory = process.env.DATA_DIR?.trim();
  if (configuredDataDirectory) {
    return path.join(
      path.resolve(
        /* turbopackIgnore: true */ process.cwd(),
        configuredDataDirectory,
        "uploads",
      ),
    );
  }
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "uploads",
  );
}

function absoluteStoragePath(storageKey: string) {
  const uploadRoot = getUploadRoot();
  const uploadPrefix = "uploads/";
  const normalizedKey = path.posix.normalize(storageKey);
  if (
    storageKey.includes("\\") ||
    normalizedKey !== storageKey ||
    !normalizedKey.startsWith(uploadPrefix)
  ) {
    throw new StudentWorkAssetError(
      "STORAGE_ERROR",
      "The generated upload path was invalid.",
    );
  }

  const relativeKey = normalizedKey.slice(uploadPrefix.length);
  if (!relativeKey || path.posix.isAbsolute(relativeKey)) {
    throw new StudentWorkAssetError(
      "STORAGE_ERROR",
      "The generated upload path was invalid.",
    );
  }

  // Resolve runtime keys beneath the fixed uploads root, never against the
  // project root. Besides traversal containment, this keeps build tracing away
  // from the live SQLite database and the rest of the workspace.
  const absolutePath = path.join(
    /* turbopackIgnore: true */ uploadRoot,
    ...relativeKey.split("/"),
  );

  if (
    absolutePath === uploadRoot ||
    !absolutePath.startsWith(`${uploadRoot}${path.sep}`)
  ) {
    throw new StudentWorkAssetError(
      "STORAGE_ERROR",
      "The generated upload path was invalid.",
    );
  }

  return absolutePath;
}

export async function writePreparedStudentWorkAsset(
  asset: PreparedStudentWorkAsset,
) {
  const renditions = [
    { storageKey: asset.storageKey, bytes: asset.bytes },
    ...(asset.fallbackStorageKey && asset.fallbackBytes
      ? [{ storageKey: asset.fallbackStorageKey, bytes: asset.fallbackBytes }]
      : []),
  ];
  const absolutePaths = renditions.map((rendition) =>
    absoluteStoragePath(rendition.storageKey),
  );
  const absolutePath = absolutePaths[0];
  const assetDirectory = path.dirname(absolutePath);
  const temporaryPaths = absolutePaths.map((renditionPath) =>
    path.join(
      assetDirectory,
      `.${path.basename(renditionPath)}.${randomUUID()}.tmp`,
    ),
  );
  const renamedPaths: string[] = [];

  try {
    const uploadRoot = getUploadRoot();
    await mkdir(uploadRoot, { recursive: true, mode: 0o700 });
    await chmod(uploadRoot, 0o700);

    let currentDirectory = uploadRoot;
    const relativeParts = path
      .relative(uploadRoot, assetDirectory)
      .split(path.sep)
      .filter(Boolean);
    for (const part of relativeParts) {
      currentDirectory = path.join(currentDirectory, part);
      await mkdir(currentDirectory, { recursive: true, mode: 0o700 });
      await chmod(currentDirectory, 0o700);
    }

    for (const [index, rendition] of renditions.entries()) {
      await writeFile(temporaryPaths[index], rendition.bytes, {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPaths[index], absolutePaths[index]);
      renamedPaths.push(absolutePaths[index]);
      await chmod(absolutePaths[index], 0o600);
    }
  } catch (error) {
    await Promise.allSettled([
      ...temporaryPaths.map((temporaryPath) => unlink(temporaryPath)),
      ...renamedPaths.map((renamedPath) => unlink(renamedPath)),
    ]);
    throw new StudentWorkAssetError(
      "STORAGE_ERROR",
      "The student-work file could not be saved locally.",
      { cause: error },
    );
  }
}

export async function removeStoredStudentWorkAsset(storageKey: string) {
  try {
    await unlink(absoluteStoragePath(storageKey));
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : null;

    if (code !== "ENOENT") {
      throw error;
    }
  }
}

export function resolveStoredStudentWorkAsset(storageKey: string) {
  return absoluteStoragePath(storageKey);
}
