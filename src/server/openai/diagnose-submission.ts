import "server-only";

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import OpenAI, { APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { assignmentDomainSchema, structuredDiagnosisSchema } from "@/domain/contracts";
import {
  DIAGNOSIS_SCHEMA_VERSION,
  diagnosisAIOutputSchema,
} from "@/domain/diagnosis-ai-output.mjs";
import { normalizeDiagnosisAIOutput } from "@/domain/diagnosis-policy.mjs";
import { OPENAI_MODEL } from "@/lib/config";
import {
  DIAGNOSIS_PROMPT_VERSION,
  buildDiagnosisPrompt,
} from "@/server/openai/diagnosis-prompt";

export { DIAGNOSIS_PROMPT_VERSION, DIAGNOSIS_SCHEMA_VERSION };

export const DIAGNOSIS_MODEL = OPENAI_MODEL;

const normalizedTextSchema = z
  .string()
  .max(12_000)
  .transform((value) =>
    value.normalize("NFC").replace(/\r\n?/g, "\n").trim(),
  )
  .pipe(z.string().min(1));

const sharedInputShape = {
  assignmentDomain: assignmentDomainSchema,
  observedPrompt: normalizedTextSchema,
  correctAnswer: normalizedTextSchema,
};

const typedDiagnosisInputSchema = z
  .object({
    ...sharedInputShape,
    inputKind: z.literal("TYPED"),
    typedResponse: normalizedTextSchema,
  })
  .strict();

const imageDiagnosisInputSchema = z
  .object({
    ...sharedInputShape,
    inputKind: z.literal("IMAGE"),
    imageBytes: z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength > 0),
    imageMediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    imageSha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .transform((value) => value.toLowerCase()),
  })
  .strict();

export const diagnoseSubmissionInputSchema = z.discriminatedUnion(
  "inputKind",
  [typedDiagnosisInputSchema, imageDiagnosisInputSchema],
);

export type DiagnoseSubmissionInput = z.input<
  typeof diagnoseSubmissionInputSchema
>;
type PreparedDiagnosisInput = z.output<typeof diagnoseSubmissionInputSchema>;

export const DIAGNOSIS_SERVICE_ERROR_CODES = [
  "INVALID_DIAGNOSIS_INPUT",
  "INCONSISTENT_DIAGNOSIS",
  "IMAGE_HASH_MISMATCH",
  "OPENAI_NOT_CONFIGURED",
  "OPENAI_AUTH_FAILED",
  "OPENAI_RATE_LIMITED",
  "OPENAI_INVALID_REQUEST",
  "OPENAI_UNAVAILABLE",
  "OPENAI_REQUEST_FAILED",
  "OPENAI_RESPONSE_FAILED",
  "OPENAI_RESPONSE_INCOMPLETE_MAX_TOKENS",
  "OPENAI_RESPONSE_INCOMPLETE_CONTENT_FILTER",
  "OPENAI_RESPONSE_NOT_COMPLETED",
  "OPENAI_REFUSAL",
  "OPENAI_OUTPUT_MISSING",
  "OPENAI_OUTPUT_INVALID",
] as const;

export type DiagnosisServiceErrorCode =
  (typeof DIAGNOSIS_SERVICE_ERROR_CODES)[number];

const ERROR_MESSAGES: Record<DiagnosisServiceErrorCode, string> = {
  INVALID_DIAGNOSIS_INPUT:
    "The submission could not be prepared for diagnosis.",
  INCONSISTENT_DIAGNOSIS:
    "The diagnosis input changed before the result could be saved.",
  IMAGE_HASH_MISMATCH:
    "The saved image changed before diagnosis. Upload it again.",
  OPENAI_NOT_CONFIGURED:
    "Live diagnosis is unavailable until an OpenAI API key is configured.",
  OPENAI_AUTH_FAILED:
    "Live diagnosis could not authenticate with OpenAI.",
  OPENAI_RATE_LIMITED:
    "Live diagnosis is busy. Try this submission again shortly.",
  OPENAI_INVALID_REQUEST:
    "OpenAI could not process this student-work submission.",
  OPENAI_UNAVAILABLE:
    "OpenAI is temporarily unavailable. Try this submission again.",
  OPENAI_REQUEST_FAILED:
    "The live diagnosis request did not complete.",
  OPENAI_RESPONSE_FAILED:
    "OpenAI could not complete this diagnosis.",
  OPENAI_RESPONSE_INCOMPLETE_MAX_TOKENS:
    "The diagnosis was too long to finish safely. Try it again.",
  OPENAI_RESPONSE_INCOMPLETE_CONTENT_FILTER:
    "The diagnosis could not be completed and needs teacher review.",
  OPENAI_RESPONSE_NOT_COMPLETED:
    "The diagnosis did not reach a completed state.",
  OPENAI_REFUSAL:
    "The submission could not be diagnosed automatically and needs teacher review.",
  OPENAI_OUTPUT_MISSING:
    "The diagnosis returned no usable structured result.",
  OPENAI_OUTPUT_INVALID:
    "The diagnosis result was inconsistent and was not saved.",
};

const RETRYABLE_ERROR_CODES = new Set<DiagnosisServiceErrorCode>([
  "OPENAI_RATE_LIMITED",
  "OPENAI_UNAVAILABLE",
  "OPENAI_REQUEST_FAILED",
  "OPENAI_RESPONSE_FAILED",
  "OPENAI_RESPONSE_INCOMPLETE_MAX_TOKENS",
  "OPENAI_RESPONSE_NOT_COMPLETED",
]);

export class DiagnosisServiceError extends Error {
  readonly code: DiagnosisServiceErrorCode;
  readonly retryable: boolean;
  readonly inputHash: string | null;
  readonly responseId: string | null;
  readonly latencyMs: number;

  constructor(
    code: DiagnosisServiceErrorCode,
    metadata:
      | {
          inputHash?: string | null;
          responseId?: string | null;
          latencyMs?: number;
          cause?: unknown;
        }
      | string = {},
  ) {
    const details = typeof metadata === "string" ? {} : metadata;
    super(ERROR_MESSAGES[code], { cause: details.cause });
    this.name = "DiagnosisServiceError";
    this.code = code;
    this.retryable = RETRYABLE_ERROR_CODES.has(code);
    this.inputHash = details.inputHash ?? null;
    this.responseId = details.responseId ?? null;
    this.latencyMs = details.latencyMs ?? 0;
  }
}

function parseDiagnosisInput(
  input: DiagnoseSubmissionInput,
): PreparedDiagnosisInput {
  try {
    const parsed = diagnoseSubmissionInputSchema.parse(input);

    if (parsed.inputKind === "IMAGE") {
      const actualSha256 = createHash("sha256")
        .update(parsed.imageBytes)
        .digest("hex");
      if (actualSha256 !== parsed.imageSha256) {
        throw new DiagnosisServiceError("IMAGE_HASH_MISMATCH");
      }
    }

    return parsed;
  } catch (error) {
    if (error instanceof DiagnosisServiceError) throw error;
    throw new DiagnosisServiceError("INVALID_DIAGNOSIS_INPUT", { cause: error });
  }
}

function stableStringify(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("Value is not JSON serializable.");
    }
    return serialized;
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  throw new TypeError("Value is not JSON serializable.");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function createPreparedDiagnosisInputHash(input: PreparedDiagnosisInput) {
  const work =
    input.inputKind === "TYPED"
      ? { typedResponse: input.typedResponse }
      : {
          imageMediaType: input.imageMediaType,
          imageSha256: input.imageSha256,
        };

  return sha256(
    stableStringify({
      model: DIAGNOSIS_MODEL,
      promptVersion: DIAGNOSIS_PROMPT_VERSION,
      schemaVersion: DIAGNOSIS_SCHEMA_VERSION,
      assignmentDomain: input.assignmentDomain,
      observedPrompt: input.observedPrompt,
      correctAnswer: input.correctAnswer,
      inputKind: input.inputKind,
      work,
    }),
  );
}

/**
 * The hash intentionally excludes student identity, membership IDs, filenames,
 * and storage paths. Image provenance uses the normalized asset SHA instead of
 * embedding raw bytes in the canonical hash payload.
 */
export function createDiagnosisInputHash(input: DiagnoseSubmissionInput) {
  return createPreparedDiagnosisInputHash(parseDiagnosisInput(input));
}

let openAIClient: OpenAI | null = null;

function getOpenAIClient(inputHash: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new DiagnosisServiceError("OPENAI_NOT_CONFIGURED", { inputHash });
  }

  // Keep one request comfortably inside the 120-second route budget. Automatic
  // SDK retries could otherwise hold both UI diagnosis slots for several
  // minutes; the saved-submission retry flow is explicit and observable.
  openAIClient ??= new OpenAI({
    apiKey,
    timeout: 85_000,
    maxRetries: 0,
  });
  return openAIClient;
}

function elapsedMilliseconds(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function mapAPIError(error: APIError): DiagnosisServiceErrorCode {
  if (error.status === 401 || error.status === 403) {
    return "OPENAI_AUTH_FAILED";
  }
  if (error.status === 429) return "OPENAI_RATE_LIMITED";
  if (error.status === 400 || error.status === 422) {
    return "OPENAI_INVALID_REQUEST";
  }
  if (typeof error.status === "number" && error.status >= 500) {
    return "OPENAI_UNAVAILABLE";
  }
  return "OPENAI_REQUEST_FAILED";
}

export async function diagnoseSubmission(input: DiagnoseSubmissionInput) {
  const prepared = parseDiagnosisInput(input);
  const inputHash = createPreparedDiagnosisInputHash(prepared);
  const prompt = buildDiagnosisPrompt({
    assignmentDomain: prepared.assignmentDomain,
    inputKind: prepared.inputKind,
    observedPrompt: prepared.observedPrompt,
    correctAnswer: prepared.correctAnswer,
    typedResponse:
      prepared.inputKind === "TYPED" ? prepared.typedResponse : null,
  });
  const content =
    prepared.inputKind === "IMAGE"
      ? [
          { type: "input_text" as const, text: prompt.inputText },
          {
            type: "input_image" as const,
            image_url: `data:${prepared.imageMediaType};base64,${Buffer.from(
              prepared.imageBytes,
            ).toString("base64")}`,
            detail: "high" as const,
          },
        ]
      : [{ type: "input_text" as const, text: prompt.inputText }];
  const startedAt = performance.now();

  try {
    const response = await getOpenAIClient(inputHash).responses.parse({
      model: DIAGNOSIS_MODEL,
      store: false,
      reasoning: { effort: "medium" },
      instructions: prompt.instructions,
      input: [{ role: "user", content }],
      text: {
        format: zodTextFormat(
          diagnosisAIOutputSchema,
          "misconception_diagnosis",
          {
            description:
              "Evidence-grounded diagnosis of one middle-school math submission.",
          },
        ),
      },
      max_output_tokens: 6_000,
    });
    const latencyMs = elapsedMilliseconds(startedAt);
    const errorMetadata = {
      inputHash,
      responseId: response.id,
      latencyMs,
    };

    if (response.error !== null) {
      throw new DiagnosisServiceError(
        "OPENAI_RESPONSE_FAILED",
        errorMetadata,
      );
    }

    if (response.status === "incomplete") {
      throw new DiagnosisServiceError(
        response.incomplete_details?.reason === "max_output_tokens"
          ? "OPENAI_RESPONSE_INCOMPLETE_MAX_TOKENS"
          : "OPENAI_RESPONSE_INCOMPLETE_CONTENT_FILTER",
        errorMetadata,
      );
    }

    if (response.status && response.status !== "completed") {
      throw new DiagnosisServiceError(
        "OPENAI_RESPONSE_NOT_COMPLETED",
        errorMetadata,
      );
    }

    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type === "refusal") {
          throw new DiagnosisServiceError("OPENAI_REFUSAL", errorMetadata);
        }
      }
    }

    if (response.output_parsed === null) {
      throw new DiagnosisServiceError(
        "OPENAI_OUTPUT_MISSING",
        errorMetadata,
      );
    }

    const normalized = normalizeDiagnosisAIOutput({
      output: response.output_parsed,
      assignmentDomain: prepared.assignmentDomain,
      inputKind: prepared.inputKind,
      observedPrompt: prepared.observedPrompt,
      correctAnswer: prepared.correctAnswer,
      typedResponse:
        prepared.inputKind === "TYPED" ? prepared.typedResponse : null,
    });
    const diagnosis = structuredDiagnosisSchema.parse(
      normalized.coreDiagnosis,
    );
    const result = {
      diagnosis,
      observedPrompt: normalized.observedPrompt,
      studentAnswer: normalized.studentAnswer,
      normalizedAnswer: normalized.normalizedAnswer,
      imageQuality: normalized.imageQuality,
      observedTransformation: normalized.observedTransformation,
      strategyVariant: normalized.strategyVariant,
      reviewReasons: normalized.reviewReasons,
      // Candidate rank is an internal policy-ordering aid. Persistence derives
      // rank from array order, so keep the strict storage boundary free of the
      // redundant field.
      candidates: normalized.candidates.map((candidate) => ({
        misconceptionId: candidate.misconceptionId,
        confidence: candidate.confidence,
        evidenceNote: candidate.evidenceNote,
      })),
    };

    return {
      inputHash,
      outputHash: sha256(stableStringify(result)),
      responseId: response.id,
      modelName: DIAGNOSIS_MODEL,
      promptVersion: DIAGNOSIS_PROMPT_VERSION,
      schemaVersion: DIAGNOSIS_SCHEMA_VERSION,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
      latencyMs,
      result,
    };
  } catch (error) {
    if (error instanceof DiagnosisServiceError) throw error;

    const metadata = {
      inputHash,
      latencyMs: elapsedMilliseconds(startedAt),
      cause: error,
    };
    if (error instanceof APIError) {
      throw new DiagnosisServiceError(mapAPIError(error), metadata);
    }
    if (error instanceof z.ZodError || error instanceof TypeError) {
      throw new DiagnosisServiceError("OPENAI_OUTPUT_INVALID", metadata);
    }
    throw new DiagnosisServiceError("OPENAI_REQUEST_FAILED", metadata);
  }
}
