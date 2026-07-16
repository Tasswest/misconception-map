/**
 * @typedef {{
 *   membershipId: string;
 *   displayName: string;
 * }} LocalStudentOption
 */

/**
 * Match a local filename to exactly one full roster display name.
 *
 * The filename never leaves the local workspace. Partial names, roster order,
 * and "only student left" guesses are intentionally excluded because a wrong
 * identity is more harmful than asking the teacher to choose.
 *
 * @param {string} filename
 * @param {LocalStudentOption[]} students
 * @returns {string | null}
 */
export function inferLocalMembershipIdFromFilename(filename, students) {
  const normalizedFilename = padForWholeLabelMatch(normalizeLabel(filename));
  if (!normalizedFilename.trim()) return null;

  const matches = students.filter((student) => {
    const normalizedName = normalizeLabel(student.displayName);
    return (
      normalizedName.length > 0 &&
      normalizedFilename.includes(padForWholeLabelMatch(normalizedName))
    );
  });

  return matches.length === 1 ? matches[0].membershipId : null;
}

/** @param {string} value */
function normalizeLabel(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/** @param {string} value */
function padForWholeLabelMatch(value) {
  return ` ${value} `;
}
