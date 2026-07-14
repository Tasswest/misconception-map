import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_STUDENT_WORK_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 20;

const allowedInputMediaTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
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
  mediaType: "image/webp";
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
  bytes: Buffer;
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
}): Promise<PreparedStudentWorkAsset> {
  if (input.bytes.byteLength === 0) {
    throw new StudentWorkAssetError("EMPTY_FILE", "This image file is empty.");
  }

  if (input.bytes.byteLength > MAX_STUDENT_WORK_BYTES) {
    throw new StudentWorkAssetError(
      "FILE_TOO_LARGE",
      "Each student-work image must be 10 MB or smaller.",
    );
  }

  if (!allowedInputMediaTypes.has(input.claimedMediaType)) {
    throw new StudentWorkAssetError(
      "UNSUPPORTED_IMAGE",
      "Use a JPEG, PNG, or WebP image.",
    );
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

    const normalized = await image
      .rotate()
      .resize({
        width: 2_200,
        height: 2_200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    if (!normalized.info.width || !normalized.info.height) {
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

    return {
      id: assetId,
      submissionId: input.submissionId,
      storageKey,
      originalFilename: safeOriginalFilename(input.originalFilename),
      mediaType: "image/webp",
      byteSize: normalized.data.byteLength,
      sha256: createHash("sha256").update(normalized.data).digest("hex"),
      width: normalized.info.width,
      height: normalized.info.height,
      bytes: normalized.data,
    };
  } catch (error) {
    if (error instanceof StudentWorkAssetError) {
      throw error;
    }

    throw new StudentWorkAssetError(
      "UNREADABLE_IMAGE",
      "This image could not be opened. Try exporting it as JPEG or PNG.",
      { cause: error },
    );
  }
}

function getUploadRoot() {
  return path.resolve(
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
  const absolutePath = path.resolve(
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
  const absolutePath = absoluteStoragePath(asset.storageKey);
  const assetDirectory = path.dirname(absolutePath);
  const temporaryPath = path.join(
    assetDirectory,
    `.${path.basename(absolutePath)}.${randomUUID()}.tmp`,
  );
  let renamed = false;

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

    await writeFile(temporaryPath, asset.bytes, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, absolutePath);
    renamed = true;
    await chmod(absolutePath, 0o600);
  } catch (error) {
    await Promise.allSettled([
      unlink(temporaryPath),
      ...(renamed ? [unlink(absolutePath)] : []),
    ]);
    throw new StudentWorkAssetError(
      "STORAGE_ERROR",
      "The student-work image could not be saved locally.",
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
