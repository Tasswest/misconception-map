import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const service = read("src", "server", "openai", "diagnose-submission.ts");
const prompt = read(
  "src",
  "server",
  "openai",
  "student-page-diagnosis-prompt.ts",
);
const route = read(
  "src",
  "app",
  "api",
  "submissions",
  "[submissionId]",
  "diagnose",
  "route.ts",
);
const repository = read("src", "server", "repositories", "diagnosis.ts");

assert.match(service, /SINGLE_DIAGNOSIS_TIMEOUT_MS = 85_000/);
assert.match(service, /FULL_PAGE_DIAGNOSIS_TIMEOUT_MS = 300_000/);
assert.match(service, /timeout: SINGLE_DIAGNOSIS_TIMEOUT_MS/);
assert.match(service, /timeout: FULL_PAGE_DIAGNOSIS_TIMEOUT_MS/);
assert.match(service, /FULL_PAGE_MAX_OUTPUT_TOKENS = 20_000/);
assert.match(service, /max_output_tokens: FULL_PAGE_MAX_OUTPUT_TOKENS/);
assert.match(service, /error instanceof APIConnectionTimeoutError/);
assert.match(service, /DiagnosisServiceError\("OPENAI_TIMEOUT", metadata\)/);
assert.match(
  service,
  /shouldRetryStudentPageWithOriginal[\s\S]*pageTranscriptionConfidence < 0\.72[\s\S]*shouldRetryDiagnosisWithOriginal/,
  "the original rendition fallback must remain an OCR-quality decision",
);
assert.doesNotMatch(
  service.match(/shouldRetryStudentPageWithOriginal[\s\S]*?\n\}/)?.[0] ?? "",
  /OPENAI_TIMEOUT|results\.length === 0/,
  "timeouts and synthetic empty results must not trigger the costly fallback",
);

assert.match(route, /maxDuration = 360/);
assert.match(route, /reportableError\.latencyMs > 0/);
assert.match(repository, /"OPENAI_TIMEOUT"/);
assert.match(
  repository,
  /UPDATE ai_runs SET status = 'FAILED', error_code = \?, latency_ms = \?/,
);
assert.match(
  repository,
  /The page needed more time than allowed — retry once; if it persists, the page may be too dense\./,
);
assert.match(prompt, /one or two short sentences at most/);

console.log(
  "Full-page timeout separation, truthful failure persistence, bounded output, and quality-only fallback verification passed.",
);
