import { z } from "zod";

import { misconceptionIdSchema } from "./misconception-taxonomy.mjs";

export const DIAGNOSIS_SCHEMA_VERSION = "1.0.0";

export const DIAGNOSIS_REVIEW_REASON_CODES = /** @type {const} */ ([
  "MODEL_REQUESTED_REVIEW",
  "LOW_CONFIDENCE",
  "LOW_REASONING_CONFIDENCE",
  "LOW_TRANSCRIPTION_CONFIDENCE",
  "POOR_IMAGE_QUALITY",
  "IMAGE_QUALITY_NOT_ASSESSED",
  "UNREADABLE_TRANSCRIPTION",
  "INSUFFICIENT_WORK_SHOWN",
  "MULTIPLE_PLAUSIBLE_RULES",
  "NO_TAXONOMY_MATCH",
  "MISSING_EVIDENCE",
  "UNGROUNDED_EVIDENCE",
  "DOMAIN_MISMATCH",
  "INCONSISTENT_OUTPUT",
]);

export const diagnosisReviewReasonSchema = z.enum(
  DIAGNOSIS_REVIEW_REASON_CODES,
);

export const diagnosisImageQualitySchema = z.enum([
  "GOOD",
  "USABLE",
  "POOR",
  "NOT_APPLICABLE",
]);

const diagnosisOutcomeSchema = z.enum([
  "CORRECT",
  "MISCONCEPTION",
  "NEEDS_REVIEW",
  "INSUFFICIENT_EVIDENCE",
  "MULTIPLE_PLAUSIBLE",
]);

const diagnosisStepAIOutputSchema = z
  .object({
    position: z.number().int().positive(),
    step: z.string().min(1),
    normalizedMath: z.string().min(1).nullable(),
    correctness: z.enum(["CORRECT", "INCORRECT", "UNCLEAR"]),
    errorNote: z.string().min(1).nullable(),
    evidenceQuote: z.string().min(1).nullable(),
  })
  .strict();

const observedTransformationAIOutputSchema = z
  .object({
    inputExpression: z.string().min(1),
    observedOutput: z.string().min(1),
    transformationDescription: z.string().min(1),
    sourceStepPosition: z.number().int().positive(),
  })
  .strict();

const diagnosisCandidateAIOutputSchema = z
  .object({
    rank: z.number().int().positive(),
    misconceptionId: misconceptionIdSchema,
    confidence: z.number().min(0).max(1),
    evidenceQuote: z.string().min(1).nullable(),
  })
  .strict();

/**
 * This is deliberately one strict root object. OpenAI Structured Outputs does
 * not accept a top-level discriminated union, and every property must be
 * required. Fields that may be absent semantically therefore use `null`.
 */
export const diagnosisAIOutputSchema = z
  .object({
    outcome: diagnosisOutcomeSchema,
    transcription: z.string().min(1),
    steps: z.array(diagnosisStepAIOutputSchema).min(1),
    observedPrompt: z.string().min(1),
    studentAnswer: z.string().min(1).nullable(),
    normalizedAnswer: z.string().min(1).nullable(),
    misconceptionId: misconceptionIdSchema.nullable(),
    confidence: z.number().min(0).max(1),
    transcriptionConfidence: z.number().min(0).max(1),
    reasoningConfidence: z.number().min(0).max(1),
    evidenceQuote: z.string().min(1).nullable(),
    severity: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ]),
    imageQuality: diagnosisImageQualitySchema,
    observedTransformation: observedTransformationAIOutputSchema.nullable(),
    strategyVariant: z.string().min(1).nullable(),
    reviewReasons: z.array(diagnosisReviewReasonSchema),
    candidates: z.array(diagnosisCandidateAIOutputSchema),
  })
  .strict();
