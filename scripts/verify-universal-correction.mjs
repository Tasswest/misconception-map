import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const migration = read("db/migrations/019_universal_correction_scope.sql");
assert.match(migration, /ADD COLUMN in_taxonomy_scope/);
assert.match(migration, /out_of_scope_diagnoses_cannot_claim_taxonomy/);
assert.match(migration, /out_of_scope_diagnoses_cannot_have_candidates/);
assert.match(migration, /predictions_require_taxonomy_scope/);
assert.match(migration, /row_number\(\) OVER/);

const extraction = read("src/server/repositories/worksheet.ts");
assert.doesNotMatch(extraction, /for \(const question[\s\S]{0,240}continue;/);
assert.match(extraction, /in_taxonomy_scope/);

const diagnosisService = read("src/server/openai/diagnose-submission.ts");
assert.match(diagnosisService, /unmatchedProblems/);
assert.match(diagnosisService, /\[No safely matched student work\]/);
assert.match(diagnosisService, /inTaxonomyScope: problem\.inTaxonomyScope/);

const policy = read("src/domain/diagnosis-policy.mjs");
assert.match(policy, /!inTaxonomyScope && parsed\.outcome === "MISCONCEPTION"/);
assert.match(policy, /\? "INCORRECT"/);

const correctedCopy = read(
  "src/app/assignments/[assignmentId]/students/[membershipId]/corrected/page.tsx",
);
assert.doesNotMatch(
  correctedCopy,
  /Corrected — outside misconception analysis/,
  "a teacher-selected exam question is corrected without an out-of-scope exclusion label",
);

const databasePath = path.join(root, "data", "misconception-map.db");
if (fs.existsSync(databasePath)) {
  const database = new Database(databasePath, { readonly: true });
  try {
    const asia = database
      .prepare("SELECT id FROM assignments WHERE title = 'Asia' LIMIT 1")
      .get();
    if (asia) {
      const exercises = database
        .prepare(
          "SELECT exercise.position, count(item.id) AS item_count, COALESCE(sum(item.in_taxonomy_scope), 0) AS scoped_count FROM exercises AS exercise LEFT JOIN assignment_items AS item ON item.exercise_id = exercise.id WHERE exercise.assignment_id = ? GROUP BY exercise.id ORDER BY exercise.position",
        )
        .all(asia.id);
      assert.equal(exercises.length, 7);
      assert.ok(exercises.every((exercise) => exercise.item_count > 0));
      assert.deepEqual(
        exercises.filter((exercise) => exercise.scoped_count > 0).map((exercise) => exercise.position),
        [1, 7],
      );
      const unaccountable = database
        .prepare(
          "SELECT count(*) AS count FROM submissions AS submission WHERE submission.assignment_id = ? AND submission.status IN ('DIAGNOSED', 'NEEDS_REVIEW') AND COALESCE(TRIM(submission.sanitized_error_message), '') = '' AND NOT EXISTS (SELECT 1 FROM submission_answers AS answer JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id WHERE answer.submission_id = submission.id)",
        )
        .get(asia.id).count;
      assert.equal(unaccountable, 0);
    }
  } finally {
    database.close();
  }
}

console.log("Universal correction and taxonomy-scope verification passed.");
