import { z } from "zod";

import { LOW_CONFIDENCE_REVIEW_THRESHOLD } from "./diagnosis-policy.mjs";
import {
  MISCONCEPTION_IDS,
  misconceptionIdSchema,
} from "./misconception-taxonomy.mjs";

export { LOW_CONFIDENCE_REVIEW_THRESHOLD };

export const assignmentDomainSchema = z.enum([
  "ALGEBRA",
  "FRACTIONS",
  "MIXED",
]);

export const submissionInputKindSchema = z.enum([
  "IMAGE",
  "TYPED",
  "CSV",
  "DEMO",
]);

export const diagnosisOutcomeSchema = z.enum([
  "CORRECT",
  "MISCONCEPTION",
  "NEEDS_REVIEW",
  "INSUFFICIENT_EVIDENCE",
  "MULTIPLE_PLAUSIBLE",
]);

export const diagnosisStepSchema = z.object({
  position: z.number().int().positive(),
  step: z.string().min(1),
  normalizedMath: z.string().min(1).nullable(),
  stepKind: z.enum([
    "EQUATION",
    "EXPRESSION",
    "ANSWER",
    "ANNOTATION",
    "UNPARSEABLE",
  ]),
  parseIssue: z.string().min(1).nullable(),
  correctness: z.enum(["CORRECT", "INCORRECT", "UNCLEAR"]),
  correctNote: z.string().min(1).nullable(),
  errorNote: z.string().min(1).nullable(),
  evidenceQuote: z.string().min(1).nullable(),
});

const diagnosisEvidenceSchema = z.object({
  transcription: z.string().min(1),
  steps: z.array(diagnosisStepSchema).min(1),
  transcriptionConfidence: z.number().min(0).max(1),
  reasoningConfidence: z.number().min(0).max(1),
  evidenceQuote: z.string().min(1).nullable(),
});

const correctDiagnosisSchema = diagnosisEvidenceSchema.extend({
  outcome: z.literal("CORRECT"),
  misconceptionId: z.null(),
  confidence: z.number().min(LOW_CONFIDENCE_REVIEW_THRESHOLD).max(1),
  severity: z.literal(0),
  reviewReason: z.null(),
});

const misconceptionDiagnosisSchema = diagnosisEvidenceSchema.extend({
  outcome: z.literal("MISCONCEPTION"),
  misconceptionId: misconceptionIdSchema,
  confidence: z.number().min(LOW_CONFIDENCE_REVIEW_THRESHOLD).max(1),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reviewReason: z.null(),
});

const abstainingDiagnosisSchema = diagnosisEvidenceSchema.extend({
  outcome: z.enum([
    "NEEDS_REVIEW",
    "INSUFFICIENT_EVIDENCE",
    "MULTIPLE_PLAUSIBLE",
  ]),
  misconceptionId: z.null(),
  confidence: z.number().min(0).max(1),
  severity: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  reviewReason: z.string().min(1),
});

export const structuredDiagnosisSchema = z.discriminatedUnion("outcome", [
  correctDiagnosisSchema,
  misconceptionDiagnosisSchema,
  abstainingDiagnosisSchema,
]);

export const observedTransformationSchema = z.object({
  inputExpression: z.string().min(1),
  observedOutput: z.string().min(1),
  transformationDescription: z.string().min(1),
  sourceStepPosition: z.number().int().positive(),
});

export const formalStudentRuleSchema = z.object({
  inputPattern: z.string().min(1),
  transformation: z.string().min(1),
  outputPattern: z.string().min(1),
  constraints: z.array(z.string().min(1)),
  strategyVariant: z.string().min(1),
});

export const studentModelStatusSchema = z.enum([
  "PROVISIONAL",
  "SUPPORTED",
  "CONTRADICTED",
  "INSUFFICIENT_EVIDENCE",
  "RETIRED",
]);

export const predictionMatchSchema = z.enum([
  "MATCH",
  "MISMATCH",
  "AMBIGUOUS",
  "UNEVALUABLE",
]);

export type MisconceptionId = (typeof MISCONCEPTION_IDS)[number];
export type AssignmentDomain = z.infer<typeof assignmentDomainSchema>;
export type SubmissionInputKind = z.infer<typeof submissionInputKindSchema>;
export type DiagnosisOutcome = z.infer<typeof diagnosisOutcomeSchema>;
export type StructuredDiagnosis = z.infer<typeof structuredDiagnosisSchema>;
export type ObservedTransformation = z.infer<
  typeof observedTransformationSchema
>;
export type FormalStudentRule = z.infer<typeof formalStudentRuleSchema>;
export type StudentModelStatus = z.infer<typeof studentModelStatusSchema>;
export type PredictionMatch = z.infer<typeof predictionMatchSchema>;
