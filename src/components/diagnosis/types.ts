export type StudentOption = {
  membershipId: string;
  displayName: string;
};

export type AssignmentOption = {
  id: string;
  title: string;
  description: string | null;
  domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
  problemPrompt: string | null;
  correctAnswer: string | null;
};

export type ClassWorkspaceOption = {
  id: string;
  name: string;
  gradeBand: "GRADE_5" | "GRADE_6" | "GRADE_7" | "GRADE_8" | "MIXED_5_8";
  schoolYear: string | null;
  students: StudentOption[];
  assignments: AssignmentOption[];
};

export type DiagnosisStep = {
  position?: number;
  step: string;
  normalizedMath?: string | null;
  stepKind?: "EQUATION" | "EXPRESSION" | "ANSWER" | "ANNOTATION" | "UNPARSEABLE";
  parseIssue?: string | null;
  correctness?: "CORRECT" | "INCORRECT" | "UNCLEAR";
  correct?: boolean;
  correctNote?: string | null;
  errorNote?: string | null;
  evidenceQuote?: string | null;
};

export type DiagnosisSummary = {
  submissionId: string;
  outcome:
    | "CORRECT"
    | "MISCONCEPTION"
    | "NEEDS_REVIEW"
    | "INSUFFICIENT_EVIDENCE"
    | "MULTIPLE_PLAUSIBLE";
  confidence: number;
  severity: 0 | 1 | 2 | 3;
  misconception: {
    id: string;
    shortLabel: string;
    label?: string;
  } | null;
  reviewReason: string | null;
  transcription: string;
  evidenceQuote?: string | null;
  steps: DiagnosisStep[];
  segmentedProblemCount?: number;
};

export type PersistedDiagnosisQueueItem = {
  submissionId: string;
  membershipId: string;
  scopeKind: "SINGLE_PROBLEM" | "FULL_PAGE";
  assignmentItemId: string | null;
  inputKind: "IMAGE" | "TYPED";
  status:
    | "UPLOADED"
    | "PROCESSING"
    | "DIAGNOSED"
    | "NEEDS_REVIEW"
    | "FAILED";
  filename: string | null;
  responseText: string | null;
  sanitizedErrorMessage: string | null;
  createdAt: string;
  diagnosis: DiagnosisSummary | null;
};
