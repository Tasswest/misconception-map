/**
 * Read the declared page-tree count without rendering the PDF. Printed exam
 * PDFs normally expose `/Type /Pages` and `/Count` in uncompressed objects.
 * When they do not (for example, an encrypted or fully object-stream PDF),
 * return null instead of guessing.
 *
 * This deliberately small parser is safe in both the browser and Node. It is
 * a size guard, not a PDF renderer or validator.
 *
 * @param {Uint8Array} bytes
 * @returns {number | null}
 */
export function detectPdfPageCount(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 5) return null;

  const source = new TextDecoder("latin1").decode(bytes);
  const declaredCounts = [];
  const pageTreePatterns = [
    /\/Type\s*\/Pages\b[\s\S]{0,1024}?\/Count\s+(\d+)/gu,
    /\/Count\s+(\d+)[\s\S]{0,1024}?\/Type\s*\/Pages\b/gu,
  ];
  for (const pattern of pageTreePatterns) {
    for (const match of source.matchAll(pattern)) {
      const count = Number.parseInt(match[1], 10);
      if (Number.isSafeInteger(count) && count > 0) declaredCounts.push(count);
    }
  }

  const visiblePageObjects = Array.from(
    source.matchAll(/\/Type\s*\/Page\b(?!s)/gu),
  ).length;
  const pageCount = Math.max(visiblePageObjects, ...declaredCounts, 0);
  return pageCount > 0 ? pageCount : null;
}

export const MAX_DIRECT_EXTRACTION_PDF_PAGES = 10;
