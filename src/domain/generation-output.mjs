import { z } from "zod";

import { canonicalizeMathAnswer } from "./math-normalization.mjs";

export const STUDENT_MODEL_SCHEMA_VERSION = "1.1.0";
export const PRACTICE_SCHEMA_VERSION = "1.0.0";
export const TEACHING_BRIEF_SCHEMA_VERSION = "1.0.0";
export const PREDICTION_SCHEMA_VERSION = "2.0.0";
export const MODEL_REVISION_SCHEMA_VERSION = "1.0.0";

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
      canonicalizeMathAnswer(item.correctAnswer) ===
      canonicalizeMathAnswer(item.misconceptionPredictedAnswer)
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
      const prompt = canonicalizeMathAnswer(item.problemPrompt);
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

export const predictionOutputSchema = z
  .object({
    predictionKind: z.enum([
      "FLAWED_RULE_APPLIES",
      "MASTERY",
      "ABSTAIN",
    ]),
    ruleApplied: z.boolean(),
    predictedAnswer: z.string().trim().min(1).max(700).nullable(),
    confidence: z.number().min(0).max(1),
    abstentionReason: z.string().trim().min(1).max(500).nullable(),
    masteryEvidenceUsed: z.string().trim().min(1).max(700).nullable(),
    trace: z
      .object({
        inputFormMatched: z.string().trim().min(1).max(500),
        appliedTransformation: z.string().trim().min(1).max(700),
        predictedResult: z.string().trim().min(1).max(700).nullable(),
        scopeCheck: z.string().trim().min(1).max(500),
      })
      .strict(),
  })
  .strict()
  .superRefine((prediction, context) => {
    const predictsAnswer = prediction.predictionKind !== "ABSTAIN";
    if (
      predictsAnswer &&
      (prediction.predictedAnswer === null || prediction.abstentionReason !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Applied rules require a predicted answer and no abstention.",
        path: ["predictedAnswer"],
      });
    }
    if (
      !predictsAnswer &&
      (prediction.predictedAnswer !== null || prediction.abstentionReason === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Abstentions require a reason and no predicted answer.",
        path: ["abstentionReason"],
      });
    }
    if (
      predictsAnswer &&
      prediction.trace.predictedResult !== prediction.predictedAnswer
    ) {
      context.addIssue({
        code: "custom",
        message: "The trace must snapshot the exact predicted answer.",
        path: ["trace", "predictedResult"],
      });
    }
    if (!predictsAnswer && prediction.trace.predictedResult !== null) {
      context.addIssue({
        code: "custom",
        message: "An abstention cannot claim a predicted result.",
        path: ["trace", "predictedResult"],
      });
    }
    if (
      prediction.ruleApplied !==
      (prediction.predictionKind === "FLAWED_RULE_APPLIES")
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a flawed-rule prediction may report that the flawed rule applied.",
        path: ["ruleApplied"],
      });
    }
    if (
      (prediction.predictionKind === "MASTERY") !==
      (prediction.masteryEvidenceUsed !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Mastery predictions require an explicit demonstrated-correct evidence summary.",
        path: ["masteryEvidenceUsed"],
      });
    }
  });

export const modelRevisionSuggestionSchema = z
  .object({
    suggestionKind: z.enum(["REVISE_RULE", "DOWNGRADE_CONSISTENCY"]),
    proposedRuleStatement: z.string().trim().min(12).max(500).nullable(),
    proposedFormalPattern: z
      .object({
        inputForm: z.string().trim().min(1).max(300),
        flawedTransformation: z.string().trim().min(1).max(300),
        predictedOutputForm: z.string().trim().min(1).max(300),
        contrastWithCorrectRule: z.string().trim().min(1).max(500),
      })
      .strict()
      .nullable(),
    proposedScopeLimits: z
      .array(z.string().trim().min(1).max(300))
      .max(6)
      .nullable(),
    proposedApplicationRate: z.number().min(0).max(1).nullable(),
    rationale: z.string().trim().min(1).max(900),
    evidenceConnection: z.string().trim().min(1).max(900),
  })
  .strict()
  .superRefine((suggestion, context) => {
    const revisesRule = suggestion.suggestionKind === "REVISE_RULE";
    const hasCompleteRule =
      suggestion.proposedRuleStatement !== null &&
      suggestion.proposedFormalPattern !== null &&
      suggestion.proposedScopeLimits !== null;
    const hasNoRule =
      suggestion.proposedRuleStatement === null &&
      suggestion.proposedFormalPattern === null &&
      suggestion.proposedScopeLimits === null;
    if ((revisesRule && !hasCompleteRule) || (!revisesRule && !hasNoRule)) {
      context.addIssue({
        code: "custom",
        message: "Rule revisions require a complete proposed rule, pattern, and scope.",
        path: ["proposedRuleStatement"],
      });
    }
    if (
      (!revisesRule && suggestion.proposedApplicationRate === null) ||
      (revisesRule && suggestion.proposedApplicationRate !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a consistency downgrade carries a proposed application rate.",
        path: ["proposedApplicationRate"],
      });
    }
  });
