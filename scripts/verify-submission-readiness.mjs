import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

import { inferLocalMembershipIdFromFilename } from "../src/domain/local-roster-matching.mjs";
import { rosterNameTerms } from "../src/server/privacy/roster-terms.mjs";

const root = process.cwd();
const tempDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "misconception-map-readiness-"),
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function runScript(script, databasePath) {
  const result = spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root,
    env: {
      ...process.env,
      MISCONCEPTION_MAP_DB_PATH: databasePath,
      OPENAI_API_KEY: "",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${script} failed:\n${result.stderr || result.stdout}`);
}

function verifyFreshAndSeededDatabases() {
  const freshDatabasePath = path.join(tempDirectory, "fresh.db");
  runScript("scripts/migrate.mjs", freshDatabasePath);
  const fresh = new Database(freshDatabasePath, { readonly: true });
  try {
    assert.equal(
      fresh.prepare("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1").pluck().get(),
      "016_extraction_cache_provenance.sql",
    );
    assert.deepEqual(
      fresh
        .prepare("PRAGMA table_info(assignment_source_extractions)")
        .all()
        .filter((column) => ["source_summary", "cache_hit"].includes(column.name))
        .map((column) => column.name)
        .sort(),
      ["cache_hit", "source_summary"],
    );
    assert.ok(
      fresh
        .prepare("PRAGMA index_list(assignment_source_extractions)")
        .all()
        .some((index) => index.name === "assignment_source_extractions_input_cache"),
    );
    assert.equal(fresh.prepare("SELECT count(*) FROM classes").pluck().get(), 0);
  } finally {
    fresh.close();
  }

  const seededDatabasePath = path.join(tempDirectory, "seeded.db");
  runScript("scripts/migrate.mjs", seededDatabasePath);
  runScript("scripts/seed.mjs", seededDatabasePath);
  const seeded = new Database(seededDatabasePath, { readonly: true });
  try {
    assert.ok(seeded.prepare("SELECT count(*) FROM classes").pluck().get() > 0);
    assert.ok(seeded.prepare("SELECT count(*) FROM exercises").pluck().get() > 0);
    assert.ok(
      seeded
        .prepare(
          "SELECT count(*) FROM assignment_items WHERE exercise_id IS NOT NULL AND question_label IS NOT NULL",
        )
        .pluck()
        .get() > 0,
    );
    assert.ok(seeded.prepare("SELECT count(*) FROM diagnoses").pluck().get() > 0);
  } finally {
    seeded.close();
  }
}

function verifyIntentionalStates() {
  const readiness = read("src/components/readiness-states.tsx");
  assert.match(readiness, /Run this one command to load the complete synthetic classroom/);
  assert.match(readiness, /npm run seed/);
  assert.match(readiness, /OPENAI_API_KEY/);
  assert.match(readiness, /\.env\.local/);
  assert.match(readiness, /enable live correction/);

  for (const page of [
    "src/app/page.tsx",
    "src/app/classes/page.tsx",
    "src/app/assignments/page.tsx",
    "src/app/dashboard/page.tsx",
    "src/app/diagnose/page.tsx",
    "src/app/prediction-lab/page.tsx",
  ]) {
    assert.match(read(page), /FreshDatabaseState/, `${page} must handle an unseeded database`);
  }

  assert.match(read("src/app/error.tsx"), /Retry this screen/);
  assert.match(read("src/app/not-found.tsx"), /Return to overview/);
  assert.match(read("src/app/diagnose/error.tsx"), /Retry/);

  const setup = read("src/components/diagnosis/setup-workspace.tsx");
  const workbench = read("src/components/diagnosis/diagnosis-workbench.tsx");
  assert.match(setup, /!liveAiReady/);
  assert.match(setup, /OPENAI_API_KEY/);
  assert.match(workbench, /!liveAiReady/);
  assert.match(workbench, /disabled=.*!liveAiReady/s);
  assert.match(setup, /diagnose#student-copies/);
  assert.match(workbench, /currentStep === 2 \|\| currentStep === 3/);
  assert.match(workbench, /id="student-work-files"[\s\S]*multiple/);
  assert.match(workbench, /Choose up to \{MAX_PHOTOS\} files together/);
  assert.match(workbench, /const diagnosableItems = actionableItems\.filter/);
  assert.match(workbench, /persistAndDiagnose\(diagnosableItems\)/);
  assert.match(workbench, /diagnosableItems\.length === 0/);
}

function verifyCopyAndHierarchy() {
  const legend = read("src/components/evidence-legend.tsx");
  assert.match(legend, /Demonstrated correct reasoning/);
  assert.match(legend, /Not assessed/);
  assert.match(read("src/app/page.tsx"), /EvidenceLegend/);
  assert.match(read("src/components/dashboard/misconception-heatmap.tsx"), /EvidenceLegend/);

  for (const file of [
    "src/server/repositories/triage.ts",
    "src/server/repositories/dashboard.ts",
    "src/server/repositories/prediction-lab.ts",
    "src/server/repositories/corrected-exam.ts",
    "src/server/repositories/instructional-support.ts",
  ]) {
    assert.match(
      read(file),
      /exerciseQuestionReference/,
      `${file} must use the shared Ex. · Q reference formatter`,
    );
  }

  const prompt = read("src/server/openai/diagnosis-prompt.ts");
  assert.match(prompt, /in the language of observedPrompt/);
  assert.match(prompt, /Preserve quoted student work exactly/);

  const setup = read("src/components/diagnosis/setup-workspace.tsx");
  assert.match(setup, /questionCount === 1 \? "question" : "questions"/);
  const triage = read("src/components/triage/assignment-triage-screen.tsx");
  assert.match(triage, /automaticallyCorrectedCount === 1 \? "copy" : "copies"/);
  assert.match(triage, /needsReviewCount === 1 \? "item needs" : "items need"/);

  const roster = [
    { membershipId: "cecilia", displayName: "Cecilia" },
    { membershipId: "julia", displayName: "Julia" },
    { membershipId: "thomas", displayName: "Thomas" },
  ];
  assert.equal(
    inferLocalMembershipIdFromFilename(
      "2019_07_Amerique_du_Sud_Thomas.pdf",
      roster,
    ),
    "thomas",
  );
  assert.equal(
    inferLocalMembershipIdFromFilename("unlabelled-copy.pdf", roster),
    null,
  );
  assert.equal(
    inferLocalMembershipIdFromFilename("Julia-and-Cecilia.pdf", roster),
    null,
    "filenames matching multiple roster names must remain unassigned",
  );
}

function verifyAccessibilityAndPrint() {
  const css = read("src/app/globals.css");
  assert.match(css, /:focus-visible/);
  assert.match(css, /@page\s*\{\s*size: A4/);
  assert.match(css, /\.app-shell-sidebar,[\s\S]*\.print-hidden[\s\S]*display: none !important/);
  assert.match(css, /\.corrected-copy-exercise \+ \.corrected-copy-exercise[\s\S]*break-before: page/);
  assert.match(css, /\.corrected-copy-problem[\s\S]*break-inside: avoid/);

  const heatmap = read("src/components/dashboard/misconception-heatmap.tsx");
  assert.match(heatmap, /event\.key [!=]==? "Escape"/);
  assert.match(heatmap, /selectedCellRef\.current\?\.focus\(\)/);
  assert.match(heatmap, /aria-labelledby=/);

  const triage = read("src/components/triage/assignment-triage-screen.tsx");
  assert.match(triage, /event\.key === "ArrowLeft"/);
  assert.match(triage, /event\.key === "ArrowRight"/);
  assert.match(triage, /event\.key === "Escape"/);
  assert.match(triage, /First incorrect step/);
  assert.match(triage, /not a confirmed mistake/);
  assert.match(triage, /HighlightedTranscription/);
  assert.match(triage, /#page=\$\{item\.suggestedPage\}/);
}

function verifyCostCacheAndStatus() {
  const extraction = read("src/server/openai/extract-worksheet.ts");
  assert.match(extraction, /reasoning: \{ effort: "low" \}/);
  assert.match(extraction, /buildPdfInputFile\(input\.pdfBytes, "worksheet\.pdf", "low"\)/);
  assert.match(extraction, /detail: "low" as const/);

  const diagnosis = read("src/server/openai/diagnose-submission.ts");
  assert.match(diagnosis, /reasoning: \{ effort: "medium" \}/);
  assert.match(diagnosis, /detail: "high" as const/);

  const worksheetRoute = read("src/app/api/assignments/[assignmentId]/worksheet/route.ts");
  assert.match(
    worksheetRoute,
    /getCachedWorksheetExtractionRun\(inputHash\) \?\? extractWorksheet\(input\)/,
  );
  const worksheetRepository = read("src/server/repositories/worksheet.ts");
  assert.match(worksheetRepository, /WHERE input_hash = \?/);
  assert.match(worksheetRepository, /cacheHit: true/);

  const diagnosisRoute = read("src/app/api/submissions/[submissionId]/diagnose/route.ts");
  assert.ok(
    diagnosisRoute.indexOf("getPersistedDiagnosisSummaryForSubmission(submissionId)") <
      diagnosisRoute.indexOf("if (!isOpenAIConfigured())"),
    "stored diagnosis reuse must happen before the API-key gate",
  );

  const statusRepository = read("src/server/repositories/system-status.ts");
  const statusPage = read("src/app/status/page.tsx");
  assert.match(statusRepository, /input_tokens/);
  assert.match(statusRepository, /output_tokens/);
  assert.match(statusRepository, /totalTokens/);
  assert.match(statusPage, /Tokens per saved run/);
  assert.match(statusPage, /cache hit/);

  assert.deepEqual(rosterNameTerms("Demo learner 12"), [
    "demo learner 12",
    "demo",
    "learner",
  ]);
  assert.equal(
    rosterNameTerms("Demo learner 12").includes("12"),
    false,
    "numeric demo roster suffixes must not collide with ordinary math answers",
  );
}

try {
  verifyFreshAndSeededDatabases();
  verifyIntentionalStates();
  verifyCopyAndHierarchy();
  verifyAccessibilityAndPrint();
  verifyCostCacheAndStatus();
  console.log(
    "Submission-readiness verification passed: fresh/seeded databases, no-key states, hierarchy, language, accessibility, print rules, cost tiers, cache reuse, and token reporting are locked.",
  );
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
