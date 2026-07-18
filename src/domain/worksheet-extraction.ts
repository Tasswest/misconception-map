import { z } from "zod";

export const WORKSHEET_EXTRACTION_SCHEMA_VERSION = "2.2.0";

export const worksheetAnswerKindSchema = z.enum([
  "EXPRESSION",
  "NUMBER",
  "FRACTION",
  "MULTIPLE_CHOICE",
  "SHORT_TEXT",
]);

export const worksheetQuestionSchema = z
  .object({
    questionLabel: z.string().trim().min(1).max(120),
    problemStatement: z.string().trim().min(1).max(4_000),
    expectedAnswer: z.string().trim().min(1).max(1_000),
    answerKind: worksheetAnswerKindSchema,
    domain: z.enum(["ALGEBRA", "FRACTIONS"]).nullable(),
    inTaxonomyScope: z.boolean(),
    extractionConfidence: z.number().min(0).max(1),
    answerConfidence: z.number().min(0).max(1),
    reviewNote: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export const worksheetExerciseSchema = z
  .object({
    exerciseLabel: z.string().trim().min(1).max(200),
    sharedContext: z.string().trim().min(1).max(8_000).nullable(),
    questions: z.array(worksheetQuestionSchema).min(1).max(30),
  })
  .strict();

/**
 * OpenAI Structured Outputs receives one strict root object. Optional semantic
 * values use null, and every property at every level is required.
 */
export const worksheetExtractionAIOutputSchema = z
  .object({
    sourceSummary: z.string().trim().min(1).max(500),
    overallConfidence: z.number().min(0).max(1),
    exercises: z.array(worksheetExerciseSchema).min(1).max(30),
  })
  .strict()
  .superRefine((extraction, context) => {
    const exerciseLabels = new Set<string>();
    let questionCount = 0;
    extraction.exercises.forEach((exercise, exerciseIndex) => {
      const canonicalExerciseLabel = exercise.exerciseLabel.toLocaleLowerCase();
      if (exerciseLabels.has(canonicalExerciseLabel)) {
        context.addIssue({
          code: "custom",
          message: "Exercise labels must be unique.",
          path: ["exercises", exerciseIndex, "exerciseLabel"],
        });
      }
      exerciseLabels.add(canonicalExerciseLabel);
      const questionLabels = new Set<string>();
      exercise.questions.forEach((question, questionIndex) => {
        questionCount += 1;
        const canonicalQuestionLabel = question.questionLabel.toLocaleLowerCase();
        if (questionLabels.has(canonicalQuestionLabel)) {
          context.addIssue({
            code: "custom",
            message: "Question labels must be unique within an exercise.",
            path: ["exercises", exerciseIndex, "questions", questionIndex, "questionLabel"],
          });
        }
        questionLabels.add(canonicalQuestionLabel);
      });
    });
    if (questionCount > 60) {
      context.addIssue({
        code: "custom",
        message: "A worksheet can contain at most 60 questions.",
        path: ["exercises"],
      });
    }
  });

export type WorksheetQuestion = z.infer<typeof worksheetQuestionSchema>;
export type WorksheetExercise = z.infer<typeof worksheetExerciseSchema>;
export type WorksheetExtraction = z.infer<
  typeof worksheetExtractionAIOutputSchema
>;
