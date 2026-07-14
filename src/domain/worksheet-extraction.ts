import { z } from "zod";

export const WORKSHEET_EXTRACTION_SCHEMA_VERSION = "1.0.0";

export const worksheetProblemSchema = z
  .object({
    position: z.number().int().positive(),
    prompt: z.string().trim().min(1).max(4_000),
    domain: z.enum(["ALGEBRA", "FRACTIONS"]),
    answerFormat: z.enum([
      "EXPRESSION",
      "NUMBER",
      "FRACTION",
      "MULTIPLE_CHOICE",
      "SHORT_TEXT",
    ]),
    correctAnswer: z.string().trim().min(1).max(1_000),
    extractionConfidence: z.number().min(0).max(1),
    answerConfidence: z.number().min(0).max(1),
    reviewNote: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export const worksheetExtractionAIOutputSchema = z
  .object({
    sourceSummary: z.string().trim().min(1).max(500),
    overallConfidence: z.number().min(0).max(1),
    problems: z.array(worksheetProblemSchema).min(1).max(30),
  })
  .strict();

export type WorksheetProblem = z.infer<typeof worksheetProblemSchema>;
export type WorksheetExtraction = z.infer<
  typeof worksheetExtractionAIOutputSchema
>;
