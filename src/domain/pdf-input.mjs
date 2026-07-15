export const PDF_MEDIA_TYPE = "application/pdf";
export const PDF_DIRECT_INPUT_VERSION = "pdf-direct-v1";

/**
 * PDF files may begin with a small amount of whitespace before the header.
 * Keep validation intentionally narrow so renamed arbitrary files never reach
 * storage or the OpenAI file-input boundary.
 *
 * @param {Uint8Array} bytes
 */
export function hasPdfSignature(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 5) return false;
  const prefix = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
  return /^\s*%PDF-/u.test(prefix);
}

/**
 * Raw local filenames are deliberately replaced at the API boundary so a
 * roster label embedded in a filename can never be sent to OpenAI.
 *
 * @param {Uint8Array} bytes
 * @param {"worksheet.pdf" | "student-work.pdf"} safeFilename
 */
export function buildPdfInputFile(bytes, safeFilename) {
  if (!hasPdfSignature(bytes)) {
    throw new TypeError("The file does not contain a valid PDF header.");
  }
  return {
    type: /** @type {const} */ ("input_file"),
    filename: safeFilename,
    file_data: `data:${PDF_MEDIA_TYPE};base64,${Buffer.from(bytes).toString("base64")}`,
    detail: /** @type {const} */ ("high"),
  };
}
