import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const management = read("src/server/repositories/management.ts");
assert.match(management, /submission\.status = 'DIAGNOSED'[\s\S]*NOT EXISTS/);
assert.match(
  management,
  /submission\.status = 'NEEDS_REVIEW'[\s\S]*sanitized_error_message[\s\S]*NOT EXISTS/,
);

const diagnosis = read("src/server/repositories/diagnosis.ts");
assert.match(
  diagnosis,
  /submission\.status = 'DIAGNOSED' AND EXISTS[\s\S]*diagnoses AS diagnosis/,
);
assert.match(
  diagnosis,
  /submission\.status = 'NEEDS_REVIEW'[\s\S]*sanitized_error_message[\s\S]*EXISTS/,
);
assert.match(diagnosis, /submission\.status = 'FAILED'/);

const triage = read("src/server/repositories/triage.ts");
assert.match(triage, /submission\.status = 'NEEDS_REVIEW'/);
assert.match(triage, /submission\.sanitized_error_message/);

const inventory = read("src/server/repositories/error-inventory.ts");
assert.match(inventory, /listUnmatchedReviewRows/);
assert.match(inventory, /classification: "AWAITING_REVIEW"/);
assert.match(inventory, /row\.reason/);

const dashboard = read("src/server/repositories/dashboard.ts");
assert.match(dashboard, /unmatchedReviewCount/);
assert.match(
  dashboard,
  /awaitingReviewCount:[\s\S]*\+ unmatchedReviewCount/,
);

console.log("Accountable correction verification passed.");
