/**
 * Canonicalizes a short math answer for deterministic prediction matching.
 * This is deliberately syntactic, not a computer-algebra equivalence test.
 * Equivalent rearrangements that do not normalize identically remain visible
 * for teacher review instead of being silently declared a match.
 *
 * @param {string} value
 */
export function canonicalizeMathAnswer(value) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[−–—]/gu, "-")
    .replace(/[×·]/gu, "*")
    .replace(/÷/gu, "/")
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("en-US");
}
