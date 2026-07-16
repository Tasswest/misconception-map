// @ts-check

/**
 * Numeric roster suffixes are organizational identifiers, not useful name
 * signals. Excluding them prevents ordinary math answers such as 12 from
 * colliding with a synthetic label such as "Demo learner 12".
 *
 * @param {string} displayName
 */
export function rosterNameTerms(displayName) {
  const normalizedName = displayName
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US");
  if (!normalizedName) return [];
  return [
    ...new Set([
      normalizedName,
      ...normalizedName
        .split(/[^\p{L}\p{N}]+/u)
        .filter((part) => part.length >= 2 && /\p{L}/u.test(part)),
    ]),
  ];
}
