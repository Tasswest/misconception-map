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
      "020_worksheet_extraction_attempts.sql",
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
    assert.deepEqual(
      fresh
        .prepare("PRAGMA table_info(worksheet_extraction_attempts)")
        .all()
        .filter((column) => ["status", "error_code", "page_count"].includes(column.name))
        .map((column) => column.name)
        .sort(),
      ["error_code", "page_count", "status"],
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
    assert.deepEqual(
      seeded
        .prepare(
          [
            "SELECT observed_application_count AS applicationCount,",
            "observed_opportunity_count AS opportunityCount, observed_application_rate AS applicationRate",
            "FROM student_model_versions WHERE observed_application_rate IS NOT NULL LIMIT 1",
          ].join(" "),
        )
        .get(),
      { applicationCount: 4, opportunityCount: 5, applicationRate: 0.8 },
    );
    assert.equal(
      seeded
        .prepare("SELECT count(*) FROM predictions WHERE prediction_kind = 'MASTERY'")
        .pluck()
        .get(),
      1,
    );
    assert.equal(
      seeded
        .prepare("SELECT count(*) FROM student_model_revision_suggestions")
        .pluck()
        .get(),
      1,
    );
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
    "src/app/classes/page.tsx",
    "src/app/dashboard/page.tsx",
    "src/app/prediction-lab/page.tsx",
  ]) {
    assert.match(read(page), /FreshDatabaseState/, `${page} must handle an unseeded database`);
  }
  assert.match(read("src/app/page.tsx"), /First run/);
  assert.match(read("src/app/page.tsx"), /npm run seed/);
  assert.match(read("src/app/assignments/page.tsx"), /SingleActionEmptyState/);
  assert.match(read("src/app/assignments/page.tsx"), /SetupWorkspace/);

  assert.match(read("src/app/error.tsx"), /Retry this screen/);
  assert.match(read("src/app/not-found.tsx"), /Return to assignments/);

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

  const predictionLab = read("src/components/prediction/prediction-lab.tsx");
  assert.match(predictionLab, /Siegler &amp; Pyke \(2013\)/);
  assert.match(predictionLab, /CONSISTENT WITH MODEL/);
  assert.match(predictionLab, /teacher decision required/);
}

function verifyCopyAndHierarchy() {
  const legend = read("src/components/evidence-legend.tsx");
  assert.match(legend, /Correct reasoning shown/);
  assert.match(legend, /Seen once/);
  assert.match(legend, /Seen repeatedly/);
  assert.match(legend, /Not assessed/);
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
  assert.match(triage, /submittedCopyCount === 1 \? "copy" : "copies"/);
  assert.match(triage, /flaggedItemCount === 1 \? "item" : "items"/);

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
  assert.match(worksheetRoute, /const cached = getCachedWorksheetExtractionRun\(inputHash\)/);
  assert.match(worksheetRoute, /if \(cached\) \{/);
  assert.ok(
    worksheetRoute.indexOf("if (cached)") <
      worksheetRoute.indexOf("beginAiRequest(request)"),
    "stored extraction reuse must happen before hosted budget and rate guards",
  );
  const worksheetRepository = read("src/server/repositories/worksheet.ts");
  assert.match(worksheetRepository, /WHERE input_hash = \?/);
  assert.match(worksheetRepository, /cacheHit: true/);

  const diagnosisRoute = read("src/app/api/submissions/[submissionId]/diagnose/route.ts");
  assert.ok(
    diagnosisRoute.indexOf("getPersistedDiagnosisSummaryForSubmission(submissionId)") <
      diagnosisRoute.indexOf("beginAiRequest(request)"),
    "stored diagnosis reuse must happen before hosted budget and rate guards",
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

function verifyHostedDeploymentContracts() {
  const proxy = read("src/proxy.ts");
  const access = read("src/lib/hosted-access.ts");
  const accessRoute = read("src/app/api/access/route.ts");
  const spend = read("src/server/openai/spend-protection.ts");
  const start = read("scripts/start.mjs");
  const storage = read("src/server/storage/submission-assets.ts");
  const dockerfile = read("Dockerfile");
  const railway = read("railway.toml");

  assert.match(proxy, /verifyHostedAccessCookie/);
  assert.match(proxy, /ACCESS_CODE_REQUIRED/);
  assert.match(access, /HMAC/);
  assert.match(accessRoute, /httpOnly: true/);
  assert.match(accessRoute, /ACCESS_RATE_LIMITED/);
  assert.match(spend, /OPENAI_DAILY_BUDGET_USD/);
  assert.match(spend, /MAX_CONCURRENT_REQUESTS = 2/);
  assert.match(spend, /OPENAI_REQUESTS_PER_SESSION_HOUR/);
  assert.match(spend, /cache_hit = 0/);
  assert.match(start, /hosted \? "0\.0\.0\.0" : "127\.0\.0\.1"/);
  assert.match(start, /scripts\/seed\.mjs/);
  assert.match(storage, /process\.env\.DATA_DIR/);
  assert.match(dockerfile, /ENV DATA_DIR=\/data/);
  assert.match(railway, /healthcheckPath = "\/access"/);
}

try {
  verifyFreshAndSeededDatabases();
  verifyIntentionalStates();
  verifyCopyAndHierarchy();
  verifyAccessibilityAndPrint();
  verifyCostCacheAndStatus();
  verifyHostedDeploymentContracts();
  console.log(
    "Submission-readiness verification passed: fresh/seeded databases, no-key states, hierarchy, language, accessibility, print rules, cost tiers, cache reuse, and token reporting are locked.",
  );
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
