import "server-only";

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  aiGradeProposalOutputSchema,
  GRADING_PROPOSAL_SCHEMA_VERSION,
} from "@/domain/grading-proposal";
import {
  classifyGradeProposalQuestion,
  guardAIGradeProposal,
  manualGradeProposalItem,
} from "@/domain/grading-policy.mjs";
import { OPENAI_MODEL } from "@/lib/config";

export const GRADING_PROPOSAL_PROMPT_VERSION = "1.0.0";
export const GRADING_PROPOSAL_MODEL = OPENAI_MODEL;
export const GRADING_PROPOSAL_TIMEOUT_MS = 180_000;

const diagnosisStepSchema = z
  .object({
    position: z.number().int().positive(),
    step: z.string().trim().min(1).max(12_000),
    correctness: z.enum(["CORRECT", "INCORRECT", "UNCLEAR"]),
    correctNote: z.string().trim().min(1).max(2_000).nullable(),
    errorNote: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

const gradingQuestionSchema = z
  .object({
    assignmentItemId: z.string().uuid(),
    diagnosisId: z.string().uuid().nullable(),
    position: z.number().int().positive(),
    questionReference: z.string().trim().min(1).max(320),
    problemPrompt: z.string().trim().min(1).max(4_000),
    correctAnswer: z.string().trim().min(1).max(1_000),
    maxPoints: z.number().finite().gt(0).max(1_000),
    diagnosis: z
      .object({
        id: z.string().uuid(),
        outcome: z.enum([
          "CORRECT",
          "INCORRECT",
          "MISCONCEPTION",
          "NEEDS_REVIEW",
          "INSUFFICIENT_EVIDENCE",
          "MULTIPLE_PLAUSIBLE",
        ]),
        transcription: z.string().trim().min(1).max(12_000),
        evidenceQuote: z.string().trim().min(1).max(2_000).nullable(),
        steps: z.array(diagnosisStepSchema).max(80),
      })
      .strict()
      .nullable(),
  })
  .strict();

const gradingProposalInputSchema = z
  .object({
    questions: z.array(gradingQuestionSchema).min(1).max(60),
  })
  .strict();

export type GradingProposalQuestion = z.infer<typeof gradingQuestionSchema>;
export type GradingProposalRun = Awaited<ReturnType<typeof proposeGrade>>;

export class GradingProposalServiceError extends Error {
  readonly code:
    | "OPENAI_NOT_CONFIGURED"
    | "OPENAI_AUTH_FAILED"
    | "OPENAI_RATE_LIMITED"
    | "OPENAI_TIMEOUT"
    | "OPENAI_UNAVAILABLE"
    | "OPENAI_REQUEST_FAILED"
    | "OPENAI_OUTPUT_INVALID";

  constructor(
    code: GradingProposalServiceError["code"],
    options?: ErrorOptions,
  ) {
    const messages = {
      OPENAI_NOT_CONFIGURED:
        "AI grading proposals need OPENAI_API_KEY in the local environment.",
      OPENAI_AUTH_FAILED:
        "The AI grading proposal could not authenticate with OpenAI.",
      OPENAI_RATE_LIMITED:
        "AI grading proposals are busy. Try this copy again shortly.",
      OPENAI_TIMEOUT:
        "The grading proposal needed more time than allowed. Try this copy again.",
      OPENAI_UNAVAILABLE:
        "OpenAI is temporarily unavailable. Try the grading proposal again.",
      OPENAI_REQUEST_FAILED:
        "The grading proposal could not be completed.",
      OPENAI_OUTPUT_INVALID:
        "The grading proposal was not safely grounded in the corrected work.",
    } as const;
    super(messages[code], options);
    this.name = "GradingProposalServiceError";
    this.code = code;
  }
}

let client: OpenAI | null = null;

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new GradingProposalServiceError("OPENAI_NOT_CONFIGURED");
  }
  client ??= new OpenAI({
    apiKey,
    timeout: GRADING_PROPOSAL_TIMEOUT_MS,
    maxRetries: 0,
  });
  return client;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function elapsedMilliseconds(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function mapApiError(error: APIError) {
  if (error.status === 401 || error.status === 403) {
    return "OPENAI_AUTH_FAILED" as const;
  }
  if (error.status === 429) return "OPENAI_RATE_LIMITED" as const;
  if (typeof error.status === "number" && error.status >= 500) {
    return "OPENAI_UNAVAILABLE" as const;
  }
  return "OPENAI_REQUEST_FAILED" as const;
}

export function gradeProposalNeedsAI(questions: GradingProposalQuestion[]) {
  return questions.some(
    (question) => classifyGradeProposalQuestion(question).eligible,
  );
}

export async function proposeGrade(rawInput: {
  questions: GradingProposalQuestion[];
}) {
  const input = gradingProposalInputSchema.parse(rawInput);
  const inputHash = hash({
    model: GRADING_PROPOSAL_MODEL,
    promptVersion: GRADING_PROPOSAL_PROMPT_VERSION,
    schemaVersion: GRADING_PROPOSAL_SCHEMA_VERSION,
    questions: input.questions,
  });
  const classified = input.questions.map((question) => ({
    question,
    classification: classifyGradeProposalQuestion(question),
  }));
  const eligible = classified.filter(
    (entry) => entry.classification.eligible,
  );
  const manualItems = classified.flatMap((entry) =>
    entry.classification.eligible
      ? []
      : [
          manualGradeProposalItem(
            entry.question,
            entry.classification.manualReason === "NEEDS_REVIEW"
              ? "NEEDS_REVIEW"
              : entry.classification.manualReason === "ABSTAINED"
                ? "ABSTAINED"
                : "CANNOT_CORRECT",
          ),
        ],
  );
  const startedAt = performance.now();

  if (eligible.length === 0) {
    const result = { items: manualItems };
    return {
      result,
      inputHash,
      outputHash: hash(result),
      responseId: null,
      modelName: GRADING_PROPOSAL_MODEL,
      promptVersion: GRADING_PROPOSAL_PROMPT_VERSION,
      schemaVersion: GRADING_PROPOSAL_SCHEMA_VERSION,
      inputTokens: null,
      outputTokens: null,
      latencyMs: elapsedMilliseconds(startedAt),
    };
  }

  const instructions = [
    "Propose per-question scores for a teacher. This is advisory: a teacher must validate every score before it becomes a grade.",
    "Use only the supplied corrected diagnosis and exact student-work evidence. Never infer a student identity and never add facts not present in the transcription or steps.",
    "For a CORRECT diagnosis, award the full maxPoints.",
    "For an INCORRECT or MISCONCEPTION diagnosis, award partial credit when one or more CORRECT steps appear before the first INCORRECT step. The score must be greater than zero and below maxPoints, and the justification must explain which correct prefix earned credit before the flaw.",
    "Award zero only when no grounded correct step appears before the first flaw. Explain why no creditable work precedes that flaw.",
    "evidenceQuote must copy an exact, concise fragment of the supplied transcription or steps. Do not paraphrase it.",
    "Write each justification in the language of the problem. Use one or two concise sentences and no hidden chain-of-thought.",
    "Return exactly one item for every supplied assignmentItemId and no additional items.",
  ].join("\n");
  const payload = eligible.map(({ question, classification }) => ({
    assignmentItemId: question.assignmentItemId,
    questionReference: question.questionReference,
    problemPrompt: question.problemPrompt,
    correctAnswer: question.correctAnswer,
    maxPoints: question.maxPoints,
    outcome: question.diagnosis?.outcome,
    requiredCreditRule: classification.creditBasis,
    leadingCorrectStepCount: classification.leadingCorrectStepCount,
    transcription: question.diagnosis?.transcription,
    evidenceQuote: question.diagnosis?.evidenceQuote,
    steps: question.diagnosis?.steps,
  }));

  try {
    const response = await getClient()
      .responses.stream({
        model: GRADING_PROPOSAL_MODEL,
        store: false,
        reasoning: { effort: "medium" },
        instructions,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({ questions: payload }),
              },
            ],
          },
        ],
        text: {
          format: zodTextFormat(
            aiGradeProposalOutputSchema,
            "teacher_grade_proposal",
            {
              description:
                "Evidence-grounded advisory question scores awaiting teacher validation.",
            },
          ),
        },
        max_output_tokens: 12_000,
      })
      .finalResponse();

    if (response.status !== "completed" || response.output_parsed === null) {
      throw new GradingProposalServiceError("OPENAI_OUTPUT_INVALID");
    }
    const output = aiGradeProposalOutputSchema.parse(response.output_parsed);
    const byItemId = new Map(
      output.items.map((item) => [item.assignmentItemId, item]),
    );
    if (
      byItemId.size !== output.items.length ||
      byItemId.size !== eligible.length
    ) {
      throw new GradingProposalServiceError("OPENAI_OUTPUT_INVALID");
    }
    const guardedItems = eligible.map(({ question }) => {
      const proposed = byItemId.get(question.assignmentItemId);
      if (!proposed) {
        throw new GradingProposalServiceError("OPENAI_OUTPUT_INVALID");
      }
      try {
        return {
          ...guardAIGradeProposal(question, proposed),
          diagnosisId: question.diagnosisId,
          position: question.position,
          questionReference: question.questionReference,
          maxPoints: question.maxPoints,
          manualReason: null,
        };
      } catch (error) {
        throw new GradingProposalServiceError("OPENAI_OUTPUT_INVALID", {
          cause: error,
        });
      }
    });
    const itemById = new Map(
      [...guardedItems, ...manualItems].map((item) => [
        item.assignmentItemId,
        item,
      ]),
    );
    const result = {
      items: input.questions.map((question) => {
        const item = itemById.get(question.assignmentItemId);
        if (!item) {
          throw new GradingProposalServiceError("OPENAI_OUTPUT_INVALID");
        }
        return item;
      }),
    };
    return {
      result,
      inputHash,
      outputHash: hash(result),
      responseId: response.id,
      modelName: GRADING_PROPOSAL_MODEL,
      promptVersion: GRADING_PROPOSAL_PROMPT_VERSION,
      schemaVersion: GRADING_PROPOSAL_SCHEMA_VERSION,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      latencyMs: elapsedMilliseconds(startedAt),
    };
  } catch (error) {
    if (error instanceof GradingProposalServiceError) throw error;
    if (error instanceof APIConnectionTimeoutError) {
      throw new GradingProposalServiceError("OPENAI_TIMEOUT", { cause: error });
    }
    if (error instanceof APIError) {
      throw new GradingProposalServiceError(mapApiError(error), {
        cause: error,
      });
    }
    if (error instanceof z.ZodError || error instanceof TypeError) {
      throw new GradingProposalServiceError("OPENAI_OUTPUT_INVALID", {
        cause: error,
      });
    }
    throw new GradingProposalServiceError("OPENAI_REQUEST_FAILED", {
      cause: error,
    });
  }
}
