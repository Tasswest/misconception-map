import assert from "node:assert/strict";

import {
  practiceWorksheetOutputSchema,
  predictionOutputSchema,
  studentModelSynthesisSchema,
  teachingBriefOutputSchema,
} from "../src/domain/generation-output.mjs";
import { extractStudentFinalAnswer } from "../src/domain/student-final-answer.mjs";

assert.deepEqual(
  extractStudentFinalAnswer({
    steps: [
      {
        step: "−(4y + 7) = −4y + 7",
        stepKind: "EQUATION",
      },
    ],
    transcription: "−(4y + 7) = −4y + 7",
    studentAnswer: "−4y + 7",
    correctAnswer: "−4y − 7",
  }),
  { display: "−4y + 7", canonical: "-4y+7" },
);
assert.deepEqual(
  extractStudentFinalAnswer({
    steps: [{ step: "x = 4", stepKind: "EQUATION" }],
    correctAnswer: "x = −4",
  }),
  { display: "x = 4", canonical: "x=4" },
);

const studentModel = studentModelSynthesisSchema.parse({
  ruleStatement:
    "When a negative multiplies parentheses, applies it to the first term only.",
  formalPattern: {
    inputForm: "-(a + b)",
    flawedTransformation: "negate only the first addend",
    predictedOutputForm: "-a + b",
    contrastWithCorrectRule: "The correct rule negates both addends: -a - b.",
  },
  scopeLimits: ["Expressions with a negative factor outside parentheses"],
  confidence: 0.91,
  evidenceConnection: "The visible expansion changes the sign of x but not 4.",
});
assert.match(studentModel.ruleStatement, /negative/u);

const item = (position) => ({
  position,
  difficulty: position,
  problemPrompt: `Expand −${position}(x + ${position + 1}).`,
  answerFormat: "EXPRESSION",
  correctAnswer: `−${position}x − ${position * (position + 1)}`,
  misconceptionPredictedAnswer: `−${position}x + ${position * (position + 1)}`,
  hint: "Apply the outside factor to every term inside the parentheses.",
  explanation: "Both terms receive the negative factor.",
  discrepantEventRationale:
    "The flawed rule and correct rule produce opposite signs on the constant.",
});

const practice = practiceWorksheetOutputSchema.parse({
  title: "Distribute the negative to every term",
  rationale:
    "These problems make the provisional rule and the correct rule visibly disagree.",
  items: [1, 2, 3, 4, 5].map(item),
});
assert.equal(practice.items.length, 5);
assert.deepEqual(
  practice.items.map((entry) => entry.difficulty),
  [1, 2, 3, 4, 5],
);

assert.equal(
  practiceWorksheetOutputSchema.safeParse({
    ...practice,
    items: practice.items.map((entry, index) =>
      index === 0
        ? { ...entry, misconceptionPredictedAnswer: entry.correctAnswer }
        : entry,
    ),
  }).success,
  false,
);

const prediction = predictionOutputSchema.parse({
  ruleApplied: true,
  predictedAnswer: "−4x + 3",
  confidence: 0.91,
  abstentionReason: null,
  trace: {
    inputFormMatched: "A leading negative multiplies a two-term sum.",
    appliedTransformation: "Negate the first term and preserve the second sign.",
    predictedResult: "−4x + 3",
    scopeCheck: "The target is inside the supported two-term distribution scope.",
  },
});
assert.equal(prediction.ruleApplied, true);
assert.equal(
  predictionOutputSchema.safeParse({
    ...prediction,
    predictedAnswer: null,
  }).success,
  false,
);

const abstention = predictionOutputSchema.parse({
  ruleApplied: false,
  predictedAnswer: null,
  confidence: 0.86,
  abstentionReason: "The target is fraction division, outside this algebra rule's scope.",
  trace: {
    inputFormMatched: "No supported input form matched.",
    appliedTransformation: "No transformation was applied.",
    predictedResult: null,
    scopeCheck: "Outside the versioned model scope.",
  },
});
assert.equal(abstention.ruleApplied, false);
assert.equal(
  practiceWorksheetOutputSchema.safeParse({
    ...practice,
    items: practice.items.slice(0, 4),
  }).success,
  false,
);

const brief = teachingBriefOutputSchema.parse({
  paragraph:
    "Students are applying a negative factor to only the first term because the minus sign is being treated as a local mark rather than multiplication by −1. Begin by comparing −(x + 4) with −1(x + 4), ask students to predict both signs, model distributing −1 to each addend, and spend ten minutes alternating predictions with quick checks. Put −2(x + 3) = −2x − 6 on the board and verify it by substitution so the class can see why the constant must also change sign.",
  workedExample: {
    problemPrompt: "Expand −2(x + 3).",
    correctAnswer: "−2x − 6",
  },
});
assert.match(brief.paragraph, /ten minutes/u);
assert.equal(
  teachingBriefOutputSchema.safeParse({
    ...brief,
    paragraph: `${brief.paragraph}\nSecond paragraph.`,
  }).success,
  false,
);

console.log(
  "Phase 4 output verification passed: provisional rule, five-step difficulty ramp, discrepant answers, one-paragraph teaching brief, and prediction abstention contract.",
);
