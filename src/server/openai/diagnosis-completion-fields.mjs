// @ts-check

/** @typedef {import("./diagnose-submission").DiagnoseSubmissionResult} DiagnoseSubmissionResult */
/** @typedef {import("./diagnose-submission").DiagnoseStudentPageResult} DiagnoseStudentPageResult */
/** @typedef {import("../repositories/diagnosis").DiagnosisRunCompletionInput} DiagnosisRunCompletionInput */
/** @typedef {import("../repositories/diagnosis").StudentPageRunCompletionInput} StudentPageRunCompletionInput */

/**
 * @typedef {Pick<DiagnosisRunCompletionInput,
 *   "inputTokens" | "outputTokens" | "latencyMs" | "attempts"
 * >} DiagnosisCompletionMetrics
 */

/**
 * @typedef {Pick<StudentPageRunCompletionInput,
 *   "inputTokens" | "outputTokens" | "latencyMs" | "attempts"
 * >} StudentPageCompletionMetrics
 */

/**
 * Selects only fields owned by the single-problem persistence contract.
 * Service-only metadata such as inputHash and totalTokens must not cross this
 * boundary accidentally.
 *
 * @param {DiagnoseSubmissionResult} selected
 * @param {DiagnosisCompletionMetrics} metrics
 */
export function selectDiagnosisCompletionFields(selected, metrics) {
  return /** @satisfies {DiagnosisRunCompletionInput} */ ({
    responseId: selected.responseId,
    modelName: selected.modelName,
    promptVersion: selected.promptVersion,
    schemaVersion: selected.schemaVersion,
    outputHash: selected.outputHash,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    latencyMs: metrics.latencyMs,
    attempts: metrics.attempts,
    result: selected.result,
  });
}

/**
 * Selects only fields owned by the full-page persistence contract.
 *
 * @param {DiagnoseStudentPageResult} selected
 * @param {StudentPageCompletionMetrics} metrics
 */
export function selectStudentPageCompletionFields(selected, metrics) {
  return /** @satisfies {StudentPageRunCompletionInput} */ ({
    responseId: selected.responseId,
    modelName: selected.modelName,
    promptVersion: selected.promptVersion,
    schemaVersion: selected.schemaVersion,
    outputHash: selected.outputHash,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    latencyMs: metrics.latencyMs,
    attempts: metrics.attempts,
    result: selected.result,
  });
}
