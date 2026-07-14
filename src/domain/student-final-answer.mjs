import { canonicalizeMathAnswer } from "./math-normalization.mjs";

/**
 * Extracts the student's visible terminal answer from grounded diagnosis text.
 * The answer key is used only to preserve the expected response shape: when the
 * key is an equation, keep the student's equation; otherwise compare the last
 * right-hand side. It is never used as answer content.
 *
 * @param {{
 *   steps?: Array<{step?: string, stepKind?: string}>,
 *   transcription?: string | null,
 *   studentAnswer?: string | null,
 *   fallback?: string | null,
 *   correctAnswer?: string | null,
 * }} input
 */
export function extractStudentFinalAnswer(input) {
  const groundedStep = [...(input.steps ?? [])]
    .reverse()
    .find(
      (step) =>
        typeof step.step === "string" &&
        step.step.trim().length > 0 &&
        step.stepKind !== "ANNOTATION" &&
        step.stepKind !== "UNPARSEABLE",
    )?.step;
  const candidate = [
    groundedStep,
    input.transcription,
    input.studentAnswer,
    input.fallback,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  if (!candidate) return null;

  const finalLine = candidate
    .normalize("NFC")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!finalLine) return null;

  const expectedIsEquation =
    typeof input.correctAnswer === "string" &&
    canonicalizeMathAnswer(input.correctAnswer).includes("=");
  const equationParts = finalLine.split("=").map((part) => part.trim());
  const display =
    !expectedIsEquation && equationParts.length > 1
      ? equationParts.at(-1)
      : finalLine;

  if (!display) return null;
  return {
    display,
    canonical: canonicalizeMathAnswer(display),
  };
}
