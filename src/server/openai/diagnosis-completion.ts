import type { z } from "zod";

import {
  selectDiagnosisCompletionFields,
  selectStudentPageCompletionFields,
} from "./diagnosis-completion-fields.mjs";
import type {
  DiagnoseStudentPageResult,
  DiagnoseSubmissionResult,
} from "./diagnose-submission";
import type {
  diagnosisRunCompletionSchema,
  DiagnosisRunCompletionInput,
  studentPageRunCompletionSchema,
  StudentPageRunCompletionInput,
} from "../repositories/diagnosis";

type ContractAlignedServiceResult<
  Service extends object,
  Completion extends object,
  ServiceOnly extends keyof Service,
  RouteOnly extends keyof Completion,
> = [
  Exclude<keyof Service, keyof Completion | ServiceOnly>,
  Exclude<keyof Completion, keyof Service | RouteOnly>,
] extends [never, never]
  ? Service
  : never;

type AlignedDiagnosisResult = ContractAlignedServiceResult<
  DiagnoseSubmissionResult,
  DiagnosisRunCompletionInput,
  "inputHash" | "totalTokens",
  "attempts"
>;

type AlignedStudentPageResult = ContractAlignedServiceResult<
  DiagnoseStudentPageResult,
  StudentPageRunCompletionInput,
  "inputHash" | "totalTokens",
  "attempts"
>;

type DiagnosisCompletionMetrics = Pick<
  DiagnosisRunCompletionInput,
  "inputTokens" | "outputTokens" | "latencyMs" | "attempts"
>;

type StudentPageCompletionMetrics = Pick<
  StudentPageRunCompletionInput,
  "inputTokens" | "outputTokens" | "latencyMs" | "attempts"
>;

export function buildDiagnosisRunCompletion(
  selected: AlignedDiagnosisResult,
  metrics: DiagnosisCompletionMetrics,
) {
  return selectDiagnosisCompletionFields(selected, metrics) satisfies z.input<
    typeof diagnosisRunCompletionSchema
  >;
}

export function buildStudentPageRunCompletion(
  selected: AlignedStudentPageResult,
  metrics: StudentPageCompletionMetrics,
) {
  return selectStudentPageCompletionFields(
    selected,
    metrics,
  ) satisfies z.input<typeof studentPageRunCompletionSchema>;
}
