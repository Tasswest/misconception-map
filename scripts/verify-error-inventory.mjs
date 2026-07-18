import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const repository = read("src/server/repositories/error-inventory.ts");
for (const classification of [
  "TAXONOMY_MISCONCEPTION",
  "CALCULATION_SLIP",
  "UNCERTAIN",
  "OUT_OF_SCOPE",
]) {
  assert.match(repository, new RegExp(`"${classification}"`));
}
assert.match(repository, /diagnosis\.id = \(SELECT latest\.id/);
assert.match(repository, /correctness = 'INCORRECT'/);
assert.match(repository, /row\.outcome === "MISCONCEPTION" && term/);
assert.match(repository, /reasons\.includes\("DOMAIN_MISMATCH"\)/);
assert.doesNotMatch(repository, /teacher_item_reviews|reviewed_at/);
assert.match(
  repository,
  /right\.distinctStudentCount - left\.distinctStudentCount[\s\S]*right\.occurrenceCount - left\.occurrenceCount/,
);
assert.match(
  repository,
  /right\.occurrenceCount - left\.occurrenceCount[\s\S]*left\.exercisePosition - right\.exercisePosition/,
);
assert.doesNotMatch(repository, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/);

const errorLog = read("src/components/analytics/error-log.tsx");
assert.match(errorLog, /What errors were found in the copies\?/);
assert.match(errorLog, /Misconceptions:/);
assert.match(errorLog, /Isolated slips:/);
assert.match(errorLog, /AI uncertainty:/);
assert.match(errorLog, /items?" : "items"\} the AI could not settle/);
assert.match(errorLog, /Out of scope:/);
assert.match(errorLog, /A one-off slip is not a misconception/);
assert.match(errorLog, /Only repeated, evidenced patterns can feed Student Models/);
assert.match(errorLog, /Sleeman \(1984\)/);
assert.match(errorLog, /Open corrected copy/);
assert.match(errorLog, /<details/);
assert.doesNotMatch(errorLog, /Review flagged work|awaiting review/);

const assignmentAnalytics = read(
  "src/components/dashboard/misconception-heatmap.tsx",
);
assert.match(assignmentAnalytics, /<ErrorLog inventory=\{dashboard\.errorInventory\}/);

const rollup = read("src/app/dashboard/page.tsx");
assert.match(rollup, /Class profile over time/);
assert.match(rollup, /Misconceptions roll up across assignments/);
assert.match(rollup, /isolated slips stay attached to the assignment/);
assert.match(rollup, /leadingMisconceptions/);
assert.match(rollup, /slipsByAssignment/);

console.log("Error inventory verification passed.");
