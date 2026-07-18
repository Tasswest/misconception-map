import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { MISCONCEPTIONS } from "../src/domain/misconception-taxonomy.mjs";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

assert.equal(MISCONCEPTIONS.length, 16);
assert.equal(
  new Set(MISCONCEPTIONS.map((term) => term.teacherLabel)).size,
  MISCONCEPTIONS.length,
  "teacher labels must be present and distinct",
);
for (const term of MISCONCEPTIONS) {
  assert.ok(term.teacherLabel.trim(), `${term.id} needs a teacher label`);
  assert.ok(term.label.trim(), `${term.id} must retain its formal label`);
  assert.ok(term.citationNote.trim(), `${term.id} must retain its citation`);
}

const heatmap = read("src/components/dashboard/misconception-heatmap.tsx");
assert.match(heatmap, /Most frequent difficulties/);
assert.match(heatmap, /column\.frequency >= 2/);
assert.match(heatmap, /What is known/);
assert.match(heatmap, /items?" : "items"\} diagnosed/);
assert.match(heatmap, /flagged as uncertain/);
assert.match(heatmap, /exercises?" : "exercises"\} not yet diagnosed/);
assert.match(heatmap, /See corrected copies/);
assert.match(heatmap, /student(?:s)?[^`]*occurrence(?:s)?/s);
assert.match(heatmap, /Teach This Tomorrow/);
assert.match(heatmap, /Which exercise needs attention\?/);
assert.match(heatmap, /Which student has which difficulty\?/);
assert.match(
  heatmap,
  /A colored cell = this error is evidenced in this student&apos;s work; the number = how many times; click for the student&apos;s actual work\./,
);
assert.match(heatmap, /column\.teacherLabel/);
assert.match(heatmap, /Formal taxonomy label:/);
assert.match(heatmap, /selected\.citationNote/);
assert.match(heatmap, /\{cell\.frequency\}/);
assert.match(heatmap, /exercise\.questionCount === 0/);
assert.match(heatmap, />\s*Not yet diagnosed\s*</);
assert.doesNotMatch(heatmap, /Out of scope|out of scope/);
assert.doesNotMatch(heatmap, /No repeated misconception|No flags|safe/);
assert.match(heatmap, /No repeated error pattern yet/);
assert.match(heatmap, /reasons remain visible in the corrected copies/);
assert.match(heatmap, /errors found are isolated slips or outside the algebra\/fractions analysis scope/);

const legend = read("src/components/evidence-legend.tsx");
for (const label of [
  "Correct reasoning shown",
  "Seen once",
  "Seen repeatedly",
  "Not assessed",
]) {
  assert.match(legend, new RegExp(label));
}
assert.doesNotMatch(
  legend,
  /Demonstrated correct reasoning|Emerging misconception|Strong misconception/,
);

const prediction = read("src/components/prediction/prediction-lab.tsx");
assert.match(prediction, /How well are the learner models predicting\?/);
assert.match(prediction, /we dared to make/);
assert.match(prediction, /outside the rule’s scope, so the model declined to guess/);
assert.match(prediction, /visible but never count/);
assert.match(prediction, /href="#prediction-evidence"/);

const results = read("src/components/results/assignment-results-summary.tsx");
assert.match(results, /Results summary/);
assert.match(results, /items?" : "items"\} flagged as uncertain/);
assert.match(results, /items the AI could not settle/);
assert.match(results, /See corrected copies/);
assert.match(results, /See error inventory/);
assert.doesNotMatch(results, /Mark as reviewed|Teacher note|awaiting your review/);

const corrected = read(
  "src/app/assignments/[assignmentId]/students/[membershipId]/corrected/page.tsx",
);
assert.match(corrected, /items diagnosed ·/);
assert.match(corrected, /items flagged as uncertain/);
assert.match(corrected, /How did this copy go, exercise by exercise\?/);
assert.match(corrected, /select it to read the student&apos;s work and feedback/);
assert.match(corrected, /The AI could not settle this item/);

console.log("Representation clarity verification passed.");
