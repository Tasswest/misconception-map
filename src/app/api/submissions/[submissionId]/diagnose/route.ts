import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

import { isOpenAIConfigured } from "@/lib/config";
import { guardLocalApiRequest } from "@/server/http/local-request-guard";
import {
  createDiagnosisInputHash,
  diagnoseSubmission,
  DIAGNOSIS_PROMPT_VERSION,
  DIAGNOSIS_SCHEMA_VERSION,
  DiagnosisServiceError,
  type DiagnoseSubmissionInput,
} from "@/server/openai/diagnose-submission";
import {
  claimDiagnosisRun,
  completeDiagnosisRun,
  DiagnosisRepositoryError,
  failDiagnosisRun,
  getPersistedDiagnosisSummaryForSubmission,
  getSubmissionDiagnosisContext,
} from "@/server/repositories/diagnosis";
import { synchronizePredictionOutcomesForClass } from "@/server/repositories/prediction-lab";
import { resolveStoredStudentWorkAsset } from "@/server/storage/submission-assets";

export const runtime = "nodejs";
export const maxDuration = 120;

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

async function buildDiagnosisInput(
  submissionId: string,
): Promise<{
  input: DiagnoseSubmissionInput;
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
    (context.mediaType === "image/jpeg" ||
      context.mediaType === "image/png" ||
      context.mediaType === "image/webp")
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
    };
  }

  throw new DiagnosisRepositoryError(
    "SUBMISSION_NOT_READY",
    "This submission does not contain diagnosable work.",
  );
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
    const prepared = await buildDiagnosisInput(submissionId);
    const inputHash = createDiagnosisInputHash(prepared.input);
    const claimed = claimDiagnosisRun({
      submissionId,
      classId: prepared.classId,
      inputHash,
      promptVersion: DIAGNOSIS_PROMPT_VERSION,
      schemaVersion: DIAGNOSIS_SCHEMA_VERSION,
    });
    runId = claimed.runId;

    const completion = await diagnoseSubmission(prepared.input);
    if (completion.inputHash !== inputHash) {
      throw new DiagnosisRepositoryError(
        "PERSISTENCE_ERROR",
        "The diagnosis input changed before the result could be saved.",
      );
    }

    const summary = completeDiagnosisRun({
      submissionId,
      runId,
      completion,
    });
    try {
      synchronizePredictionOutcomesForClass(prepared.classId);
    } catch {
      // The diagnosis is already durably saved. Prediction Lab also provides
      // an explicit reconciliation action if a later outcome needs attention.
    }
    return NextResponse.json(summary);
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
