import "server-only";

import { getDatabase } from "@/lib/db";

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Conservative local check for exact roster names or name components. It is
 * intentionally run before any teacher-entered text is sent to OpenAI.
 */
export function containsRosterName(
  classId: string,
  values: Array<string | null>,
) {
  const rosterNames = getDatabase()
    .prepare(
      [
        "SELECT student.display_name",
        "FROM class_memberships AS membership",
        "JOIN students AS student ON student.id = membership.student_id",
        "WHERE membership.class_id = ?",
        "AND membership.archived_at IS NULL AND student.archived_at IS NULL",
      ].join(" "),
    )
    .all(classId) as Array<{ display_name: string }>;
  const normalizedValues = values
    .filter((value): value is string => value !== null)
    .map((value) => value.normalize("NFKC").toLocaleLowerCase("en-US"));

  for (const { display_name: displayName } of rosterNames) {
    const normalizedName = displayName
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("en-US");
    if (!normalizedName) continue;
    const rosterNameTerms = new Set([
      normalizedName,
      ...normalizedName
        .split(/[^\p{L}\p{N}]+/u)
        .filter((part) => part.length >= 2),
    ]);
    for (const term of rosterNameTerms) {
      const pattern = new RegExp(
        `(?:^|[^\\p{L}\\p{N}])${escapeRegularExpression(term)}(?=$|[^\\p{L}\\p{N}])`,
        "u",
      );
      if (normalizedValues.some((value) => pattern.test(value))) return true;
    }
  }

  return false;
}
