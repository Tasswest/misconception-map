import { z } from "zod";

export const GRADING_PROPOSAL_SCHEMA_VERSION = "1.0.0";

export const gradingCreditBasisSchema = z.enum([
  "FULL_CORRECT_REASONING",
  "PARTIAL_CORRECT_PREFIX",
  "ZERO_NO_CREDITABLE_WORK",
  "MANUAL_REQUIRED",
]);

export const manualScoringReasonSchema = z.enum([
  "NEEDS_REVIEW",
  "ABSTAINED",
  "CANNOT_CORRECT",
]);

export const aiGradeProposalItemSchema = z
  .object({
    assignmentItemId: z.string().uuid(),
    proposedScore: z.number().finite().min(0).max(1_000),
    evidenceQuote: z.string().trim().min(1).max(2_000),
    justification: z.string().trim().min(1).max(700),
  })
  .strict();

export const aiGradeProposalOutputSchema = z
  .object({
    items: z.array(aiGradeProposalItemSchema).min(1).max(60),
  })
  .strict();

export const validateGradeProposalInputSchema = z
  .object({
    proposalId: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            assignmentItemId: z.string().uuid(),
            finalScore: z.number().finite().min(0).max(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();

export type ValidateGradeProposalInput = z.input<
  typeof validateGradeProposalInputSchema
>;
