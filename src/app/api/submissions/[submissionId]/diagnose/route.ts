import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

import { isOpenAIConfigured } from "@/lib/config";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";
import {
  chooseBetterDiagnosisAttempt,
  chooseBetterStudentPageAttempt,
  createDiagnosisInputHash,
  createStudentPageDiagnosisInputHash,
  diagnoseSubmission,
  diagnoseStudentPage,
  DIAGNOSIS_RETRY_POLICY_VERSION,
  DIAGNOSIS_PROMPT_VERSION,
  DIAGNOSIS_SCHEMA_VERSION,
  DiagnosisServiceError,
  shouldRetryDiagnosisWithOriginal,
  shouldRetryStudentPageWithOriginal,
  STUDENT_PAGE_DIAGNOSIS_PROMPT_VERSION,
  STUDENT_PAGE_DIAGNOSIS_SCHEMA_VERSION,
  type DiagnoseStudentPageInput,
  type DiagnoseSubmissionInput,
} from "@/server/openai/diagnose-submission";
import {
  claimDiagnosisRun,
  completeDiagnosisRun,
  completeStudentPageDiagnosisRun,
  DiagnosisRepositoryError,
  failDiagnosisRun,
  getPersistedDiagnosisSummaryForSubmission,
  getStudentPageDiagnosisContext,
  getSubmissionDiagnosisContext,
  getSubmissionScopeKind,
} from "@/server/repositories/diagnosis";
import { synchronizePredictionOutcomesForClass } from "@/server/repositories/prediction-lab";
import { resolveStoredStudentWorkAsset } from "@/server/storage/submission-assets";

export const runtime = "nodejs";
export const maxDuration = 240;

function serviceErrorStatus(code: string) {
  if (code === "OPENAI_NOT_CONFIGURED") return 503;
  if (code === "OPENAI_RATE_LIMITED") return 429;
  if (code === "INVALID_DIAGNOSIS_INPUT") return 400;
  return 502;
}

function errorResponse(error: unknown) {
  if (error instanceof DiagnosisServiceError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: serviceErrorStatus(error.code) },
    );
  }

  if (error instanceof DiagnosisRepositoryError) {
    const status =
      error.code === "SUBMISSION_NOT_FOUND"
        ? 404
        : error.code === "SUBMISSION_NOT_READY"
          ? 409
          : error.code === "PERSISTENCE_ERROR"
            ? 500
            : 400;
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "DIAGNOSIS_FAILED",
        message:
          "The diagnosis could not be completed. The saved work is ready to retry.",
      },
    },
    { status: 500 },
  );
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";

function isImageMediaType(value: string | null): value is ImageMediaType {
  return (
    value === "image/jpeg" || value === "image/png" || value === "image/webp"
  );
}

async function buildSingleDiagnosisInput(
  submissionId: string,
): Promise<{
  input: DiagnoseSubmissionInput;
  fallbackInput: DiagnoseSubmissionInput | null;
  classId: string;
}> {
  const context = getSubmissionDiagnosisContext(submissionId);
  const shared = {
    assignmentDomain: context.domain,
    observedPrompt: context.problemPrompt,
    correctAnswer: context.correctAnswer,
  } as const;

  if (context.inputKind === "TYPED" && context.typedResponse) {
    return {
      classId: context.classId,
      fallbackInput: null,
      input: {
        ...shared,
        inputKind: "TYPED",
        typedResponse: context.typedResponse,
      },
    };
  }

  if (
    context.inputKind === "IMAGE" &&
    context.storageKey &&
    context.assetSha256 &&
    isImageMediaType(context.mediaType)
  ) {
    const imageBytes = await readFile(
      /* turbopackIgnore: true */ resolveStoredStudentWorkAsset(
        context.storageKey,
      ),
    );
    return {
      classId: context.classId,
      input: {
        ...shared,
        inputKind: "IMAGE",
        imageBytes,
        imageMediaType: context.mediaType,
        imageSha256: context.assetSha256,
      },
      fallbackInput:
        context.fallbackStorageKey &&
        context.fallbackSha256 &&
        isImageMediaType(context.fallbackMediaType)
          ? {
              ...shared,
              inputKind: "IMAGE",
              imageBytes: await readFile(
                /* turbopackIgnore: true */ resolveStoredStudentWorkAsset(
                  context.fallbackStorageKey,
                ),
              ),
              imageMediaType: context.fallbackMediaType,
              imageSha256: context.fallbackSha256,
            }
          : null,
    };
  }

  throw new DiagnosisRepositoryError(
    "SUBMISSION_NOT_READY",
    "This submission does not contain diagnosable work.",
  );
}

async function buildStudentPageInputs(submissionId: string): Promise<{
  classId: string;
  primary: DiagnoseStudentPageInput;
  fallback: DiagnoseStudentPageInput;
}> {
  const context = getStudentPageDiagnosisContext(submissionId);
  if (
    !isImageMediaType(context.mediaType) ||
    !isImageMediaType(context.fallbackMediaType)
  ) {
    throw new DiagnosisRepositoryError(
      "SUBMISSION_NOT_READY",
      "This full-page submission does not contain supported OCR renditions.",
    );
  }
  const shared = {
    assignmentDomain: context.domain,
    problems: context.problems.map((problem) => ({
      assignmentItemId: problem.assignmentItemId,
      position: problem.position,
      prompt: problem.prompt,
      correctAnswer: problem.correctAnswer,
      answerFormat: problem.answerFormat,
    })),
  } as const;
  const [primaryBytes, fallbackBytes] = await Promise.all([
    readFile(
      /* turbopackIgnore: true */ resolveStoredStudentWorkAsset(
        context.storageKey,
      ),
    ),
    readFile(
      /* turbopackIgnore: true */ resolveStoredStudentWorkAsset(
        context.fallbackStorageKey,
      ),
    ),
  ]);
  return {
    classId: context.classId,
    primary: {
      ...shared,
      imageBytes: primaryBytes,
      imageMediaType: context.mediaType,
      imageSha256: context.assetSha256,
    },
    fallback: {
      ...shared,
      imageBytes: fallbackBytes,
      imageMediaType: context.fallbackMediaType,
      imageSha256: context.fallbackSha256,
    },
  };
}

function sumNullable(values: Array<number | null>) {
  return values.every((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function attemptRecord(
  attempt: Awaited<ReturnType<typeof diagnoseSubmission>>,
  rendition: "NORMALIZED" | "ORIGINAL_FALLBACK",
  selected: boolean,
) {
  return {
    rendition,
    selected,
    inputHash: attempt.inputHash,
    outputHash: attempt.outputHash,
    responseId: attempt.responseId,
    visibleProblemCount: 1,
    minimumTranscriptionConfidence:
      attempt.result.diagnosis.transcriptionConfidence,
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    latencyMs: attempt.latencyMs,
  };
}

function pageAttemptRecord(
  attempt: Awaited<ReturnType<typeof diagnoseStudentPage>>,
  rendition: "NORMALIZED" | "ORIGINAL_FALLBACK",
  selected: boolean,
) {
  return {
    rendition,
    selected,
    inputHash: attempt.inputHash,
    outputHash: attempt.outputHash,
    responseId: attempt.responseId,
    visibleProblemCount: attempt.result.results.length,
    minimumTranscriptionConfidence:
      attempt.result.results.length === 0
        ? attempt.result.pageTranscriptionConfidence
        : Math.min(
            attempt.result.pageTranscriptionConfidence,
            ...attempt.result.results.map(
              (result) => result.result.diagnosis.transcriptionConfidence,
            ),
          ),
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    latencyMs: attempt.latencyMs,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  const guard = guardLocalApiRequest(request);
  if (guard) return guard;
  const { submissionId } = await context.params;

  try {
    const persisted = getPersistedDiagnosisSummaryForSubmission(submissionId);
    if (persisted) {
      return NextResponse.json(persisted);
    }
  } catch (error) {
    return errorResponse(error);
  }

  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      {
        error: {
          code: "OPENAI_NOT_CONFIGURED",
          message:
            "Add OPENAI_API_KEY to .env.local, then restart the local app.",
        },
      },
      { status: 503 },
    );
  }

  let runId: string | null = null;
  const routeStartedAt = performance.now();

  try {
    const scopeKind = getSubmissionScopeKind(submissionId);
    let classId: string;
    let responseBody: unknown;

    if (scopeKind === "FULL_PAGE") {
      const prepared = await buildStudentPageInputs(submissionId);
      classId = prepared.classId;
      const primaryHash = createStudentPageDiagnosisInputHash(prepared.primary);
      const fallbackHash = createStudentPageDiagnosisInputHash(prepared.fallback);
      const pipelineHash = createHash("sha256")
        .update(
          JSON.stringify({
            primaryHash,
            fallbackHash,
            retryPolicyVersion: DIAGNOSIS_RETRY_POLICY_VERSION,
          }),
        )
        .digest("hex");
      const claimed = claimDiagnosisRun({
        submissionId,
        classId,
        inputHash: pipelineHash,
        promptVersion: STUDENT_PAGE_DIAGNOSIS_PROMPT_VERSION,
        schemaVersion: STUDENT_PAGE_DIAGNOSIS_SCHEMA_VERSION,
      });
      runId = claimed.runId;

      const primary = await diagnoseStudentPage(prepared.primary);
      const fallback = shouldRetryStudentPageWithOriginal(primary)
        ? await diagnoseStudentPage(prepared.fallback)
        : null;
      const selected = fallback
        ? chooseBetterStudentPageAttempt(primary, fallback)
        : primary;
      const attempts = [
        pageAttemptRecord(primary, "NORMALIZED", selected === primary),
        ...(fallback
          ? [
              pageAttemptRecord(
                fallback,
                "ORIGINAL_FALLBACK",
                selected === fallback,
              ),
            ]
          : []),
      ];
      const pageSummary = completeStudentPageDiagnosisRun({
        submissionId,
        runId,
        completion: {
          ...selected,
          inputTokens: sumNullable(attempts.map((attempt) => attempt.inputTokens)),
          outputTokens: sumNullable(
            attempts.map((attempt) => attempt.outputTokens),
          ),
          latencyMs: attempts.reduce(
            (total, attempt) => total + attempt.latencyMs,
            0,
          ),
          attempts,
        },
      });
      const reviewDiagnosis = pageSummary.diagnoses.find(
        (diagnosis) =>
          diagnosis.outcome !== "CORRECT" &&
          diagnosis.outcome !== "MISCONCEPTION",
      );
      const representative = reviewDiagnosis ?? pageSummary.diagnoses[0];
      responseBody = representative
        ? {
            ...representative,
            segmentedProblemCount: pageSummary.segmentedProblemCount,
            segmentationReviewNote: pageSummary.segmentationReviewNote,
            diagnoses: pageSummary.diagnoses,
          }
        : {
            submissionId,
            outcome: "NEEDS_REVIEW",
            confidence: selected.result.pageTranscriptionConfidence,
            severity: 0,
            misconception: null,
            reviewReason:
              pageSummary.segmentationReviewNote ??
              "No assignment problem could be matched safely on this page.",
            transcription: "[no matched problem work]",
            evidenceQuote: null,
            steps: [],
            segmentedProblemCount: 0,
            diagnoses: [],
          };
    } else {
      const prepared = await buildSingleDiagnosisInput(submissionId);
      classId = prepared.classId;
      const primaryHash = createDiagnosisInputHash(prepared.input);
      const fallbackHash = prepared.fallbackInput
        ? createDiagnosisInputHash(prepared.fallbackInput)
        : null;
      const pipelineHash = fallbackHash
        ? createHash("sha256")
            .update(
              JSON.stringify({
                primaryHash,
                fallbackHash,
                retryPolicyVersion: DIAGNOSIS_RETRY_POLICY_VERSION,
              }),
            )
            .digest("hex")
        : primaryHash;
      const claimed = claimDiagnosisRun({
        submissionId,
        classId,
        inputHash: pipelineHash,
        promptVersion: DIAGNOSIS_PROMPT_VERSION,
        schemaVersion: DIAGNOSIS_SCHEMA_VERSION,
      });
      runId = claimed.runId;

      const primary = await diagnoseSubmission(prepared.input);
      const fallback =
        prepared.fallbackInput && shouldRetryDiagnosisWithOriginal(primary)
          ? await diagnoseSubmission(prepared.fallbackInput)
          : null;
      const selected = fallback
        ? chooseBetterDiagnosisAttempt(primary, fallback)
        : primary;
      const attempts =
        prepared.input.inputKind === "IMAGE"
          ? [
              attemptRecord(primary, "NORMALIZED", selected === primary),
              ...(fallback
                ? [
                    attemptRecord(
                      fallback,
                      "ORIGINAL_FALLBACK",
                      selected === fallback,
                    ),
                  ]
                : []),
            ]
          : undefined;
      responseBody = completeDiagnosisRun({
        submissionId,
        runId,
        completion: {
          ...selected,
          inputTokens: attempts
            ? sumNullable(attempts.map((attempt) => attempt.inputTokens))
            : selected.inputTokens,
          outputTokens: attempts
            ? sumNullable(attempts.map((attempt) => attempt.outputTokens))
            : selected.outputTokens,
          latencyMs: attempts
            ? attempts.reduce((total, attempt) => total + attempt.latencyMs, 0)
            : selected.latencyMs,
          attempts,
        },
      });
    }

    try {
      synchronizePredictionOutcomesForClass(classId);
    } catch {
      // The diagnosis is already durably saved. Prediction Lab also provides
      // an explicit reconciliation action if a later outcome needs attention.
    }
    return NextResponse.json(responseBody);
  } catch (error) {
    if (runId) {
      const errorCode =
        error instanceof DiagnosisServiceError
          ? error.code
          : error instanceof DiagnosisRepositoryError
            ? error.code
            : "DIAGNOSIS_FAILED";

      try {
        failDiagnosisRun({
          submissionId,
          runId,
          errorCode,
          latencyMs: Math.max(0, Math.round(performance.now() - routeStartedAt)),
        });
      } catch {
        // Preserve the original failure response. A later retry can reclaim a
        // submission only after the database has reached a terminal state.
      }
    }

    return errorResponse(error);
  }
}
