import { z } from "zod";

import { diagnosisAIOutputSchema } from "./diagnosis-ai-output.mjs";

export const STUDENT_PAGE_DIAGNOSIS_SCHEMA_VERSION = "1.0.0";

export const studentPageDiagnosisAIOutputSchema = z
  .object({
    pageTranscriptionConfidence: z.number().min(0).max(1),
    imageQuality: z.enum(["GOOD", "USABLE", "POOR"]),
    segmentationReviewNote: z.string().min(1).nullable(),
    visibleProblems: z
      .array(
        z
          .object({
            problemPosition: z.number().int().positive(),
            diagnosis: diagnosisAIOutputSchema,
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
