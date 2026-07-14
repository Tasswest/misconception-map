import { z } from "zod";

export const STUDENT_MODEL_SCHEMA_VERSION = "1.0.0";
export const PRACTICE_SCHEMA_VERSION = "1.0.0";
export const TEACHING_BRIEF_SCHEMA_VERSION = "1.0.0";

/** @param {string} value */
function canonicalMath(value) {
  return value
    .normalize("NFKC")
    .replace(/[−–—]/gu, "-")
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("en-US");
}

export const studentModelSynthesisSchema = z
  .object({
    ruleStatement: z.string().trim().min(12).max(500),
    formalPattern: z
      .object({
        inputForm: z.string().trim().min(1).max(300),
        flawedTransformation: z.string().trim().min(1).max(300),
        predictedOutputForm: z.string().trim().min(1).max(300),
        contrastWithCorrectRule: z.string().trim().min(1).max(500),
      })
      .strict(),
    scopeLimits: z.array(z.string().trim().min(1).max(300)).max(6),
    confidence: z.number().min(0).max(1),
    evidenceConnection: z.string().trim().min(1).max(700),
  })
  .strict();

const practiceItemSchema = z
  .object({
    position: z.number().int().min(1).max(5),
    difficulty: z.number().int().min(1).max(5),
    problemPrompt: z.string().trim().min(1).max(1_000),
    answerFormat: z.enum([
      "EXPRESSION",
      "NUMBER",
      "FRACTION",
      "MULTIPLE_CHOICE",
      "SHORT_TEXT",
    ]),
    correctAnswer: z.string().trim().min(1).max(500),
    misconceptionPredictedAnswer: z.string().trim().min(1).max(500),
    hint: z.string().trim().min(1).max(500),
    explanation: z.string().trim().min(1).max(800),
    discrepantEventRationale: z.string().trim().min(1).max(700),
  })
  .strict()
  .superRefine((item, context) => {
    if (
      canonicalMath(item.correctAnswer) ===
      canonicalMath(item.misconceptionPredictedAnswer)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The flawed rule and correct rule must produce visibly different answers.",
        path: ["misconceptionPredictedAnswer"],
      });
    }
  });

export const practiceWorksheetOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    rationale: z.string().trim().min(1).max(900),
    items: z.array(practiceItemSchema).length(5),
  })
  .strict()
  .superRefine((worksheet, context) => {
    const prompts = new Set();
    worksheet.items.forEach((item, index) => {
      if (item.position !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Practice positions must be consecutive from 1 through 5.",
          path: ["items", index, "position"],
        });
      }
      if (item.difficulty !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Practice difficulty must ramp from 1 through 5.",
          path: ["items", index, "difficulty"],
        });
      }
      const prompt = canonicalMath(item.problemPrompt);
      if (prompts.has(prompt)) {
        context.addIssue({
          code: "custom",
          message: "Every practice problem must be structurally distinct.",
          path: ["items", index, "problemPrompt"],
        });
      }
      prompts.add(prompt);
    });
  });

export const teachingBriefOutputSchema = z
  .object({
    paragraph: z
      .string()
      .trim()
      .min(80)
      .max(1_800)
      .refine((value) => !/[\r\n]/u.test(value), {
        message: "The teaching brief must be one paragraph.",
      }),
    workedExample: z
      .object({
        problemPrompt: z.string().trim().min(1).max(1_000),
        correctAnswer: z.string().trim().min(1).max(700),
      })
      .strict(),
  })
  .strict();
