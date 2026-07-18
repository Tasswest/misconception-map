import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  observedTransformationSchema,
  structuredDiagnosisSchema,
  type StructuredDiagnosis,
  type SubmissionInputKind,
} from "@/domain/contracts";
import { canonicalizeMathAnswer } from "@/domain/math-normalization.mjs";
import { normalizedProblemRegionSchema } from "@/domain/problem-region.mjs";
import { extractStudentFinalAnswer } from "@/domain/student-final-answer.mjs";
import {
  MISCONCEPTION_BY_ID,
  MISCONCEPTION_IDS,
  TAXONOMY_VERSION,
  misconceptionIdSchema,
} from "@/domain/misconception-taxonomy.mjs";
import { OPENAI_MODEL } from "@/lib/config";
import { getDatabase } from "@/lib/db";
import { containsRosterName } from "@/server/privacy/roster-text";
import type { PreparedStudentWorkAsset } from "@/server/storage/submission-assets";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const staleRunCutoffSql =
  "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes')";

const clientIdSchema = z.string().uuid();
const idSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const imageUploadItemSchema = z
  .object({
    clientId: clientIdSchema,
    membershipId: idSchema,
    submissionId: idSchema,
    scopeKind: z.enum(["SINGLE_PROBLEM", "FULL_PAGE"]),
    assignmentItemId: idSchema.nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    if (
      (item.scopeKind === "SINGLE_PROBLEM" && item.assignmentItemId === null) ||
      (item.scopeKind === "FULL_PAGE" && item.assignmentItemId !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "The file scope does not match its worksheet problem selection.",
        path: ["assignmentItemId"],
      });
    }
  });

export const typedSubmissionItemSchema = z
  .object({
    clientId: clientIdSchema,
    membershipId: idSchema,
    assignmentItemId: idSchema,
    responseText: z.string().trim().min(1).max(12_000),
  })
  .strict();

export const typedSubmissionItemsSchema = z
  .array(typedSubmissionItemSchema)
  .min(1)
  .max(20)
  .superRefine((items, context) => {
    const clientIds = new Set<string>();
    items.forEach((item, index) => {
      if (clientIds.has(item.clientId)) {
        context.addIssue({
          code: "custom",
          message: "Each typed response needs a unique request identifier.",
          path: [index, "clientId"],
        });
      }
      clientIds.add(item.clientId);
    });
  });

const persistableDiagnosisResultSchema = z
  .object({
    diagnosis: structuredDiagnosisSchema,
    observedPrompt: z.string().min(1).max(12_000).nullable(),
    studentAnswer: z.string().max(12_000).nullable(),
    normalizedAnswer: z.string().max(12_000).nullable(),
    imageQuality: z.enum(["GOOD", "USABLE", "POOR", "NOT_APPLICABLE"]),
    observedTransformation: observedTransformationSchema.nullable(),
    strategyVariant: z.string().min(1).max(1_000).nullable(),
    reviewReasons: z.array(z.string().min(1).max(240)).max(20),
    candidates: z
      .array(
        z
          .object({
            misconceptionId: misconceptionIdSchema,
            confidence: z.number().min(0).max(1),
            evidenceNote: z.string().min(1).max(4_000),
          })
          .strict(),
      )
      .max(MISCONCEPTION_IDS.length),
  })
  .strict()
  .superRefine((result, context) => {
    const candidateIds = new Set<string>();
    result.candidates.forEach((candidate, index) => {
      if (candidateIds.has(candidate.misconceptionId)) {
        context.addIssue({
          code: "custom",
          message: "Diagnosis candidates must be unique.",
          path: ["candidates", index, "misconceptionId"],
        });
      }
      candidateIds.add(candidate.misconceptionId);
    });
  });

const diagnosisImageAttemptSchema = z
  .object({
    rendition: z.enum(["NORMALIZED", "ORIGINAL_FALLBACK"]),
    selected: z.boolean(),
    inputHash: sha256Schema,
    outputHash: sha256Schema,
    responseId: z.string().min(1).max(240),
    visibleProblemCount: z.number().int().nonnegative(),
    minimumTranscriptionConfidence: z.number().min(0).max(1).nullable(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    latencyMs: z.number().int().nonnegative(),
  })
  .strict();

const diagnosisAttemptsSchema = z
  .array(diagnosisImageAttemptSchema)
  .min(1)
  .max(2)
  .refine(
    (attempts) => attempts.filter((attempt) => attempt.selected).length === 1,
    "Exactly one image attempt must be selected.",
  );

export const diagnosisRunCompletionSchema = z
  .object({
    responseId: z.string().min(1).max(240),
    modelName: z.string().min(1).max(120),
    promptVersion: z.string().min(1).max(120),
    schemaVersion: z.string().min(1).max(120),
    outputHash: sha256Schema,
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    latencyMs: z.number().int().nonnegative(),
    attempts: diagnosisAttemptsSchema.optional(),
    result: persistableDiagnosisResultSchema,
  })
  .strict();

export const studentPageRunCompletionSchema = z
  .object({
    responseId: z.string().min(1).max(240),
    modelName: z.string().min(1).max(120),
    promptVersion: z.string().min(1).max(120),
    schemaVersion: z.string().min(1).max(120),
    outputHash: sha256Schema,
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    latencyMs: z.number().int().nonnegative(),
    attempts: diagnosisAttemptsSchema,
    result: z
      .object({
        pageTranscriptionConfidence: z.number().min(0).max(1),
        imageQuality: z.enum(["GOOD", "USABLE", "POOR"]),
        segmentationReviewNote: z.string().min(1).max(4_000).nullable(),
        results: z
          .array(
            z
              .object({
                assignmentItemId: idSchema,
                position: z.number().int().positive(),
                correctAnswer: z.string().min(1).max(12_000),
                region: normalizedProblemRegionSchema.nullable().optional(),
                result: persistableDiagnosisResultSchema,
              })
              .strict(),
          )
          .max(60),
      })
      .strict(),
  })
  .strict();

export const DIAGNOSIS_FAILURE_CODES = [
  "INVALID_DIAGNOSIS_INPUT",
  "PERSONAL_DATA_DETECTED",
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
  "ASSIGNMENT_NOT_FOUND",
  "ASSIGNMENT_NOT_READY",
  "ASSIGNMENT_CONTEXT_MISSING",
  "STUDENT_NOT_IN_CLASS",
  "SUBMISSION_NOT_FOUND",
  "SUBMISSION_NOT_READY",
  "IDEMPOTENCY_CONFLICT",
  "PERSISTENCE_ERROR",
  "DIAGNOSIS_FAILED",
  "STALE_DIAGNOSIS_RUN",
] as const;

const diagnosisFailureCodeSchema = z.enum(DIAGNOSIS_FAILURE_CODES);
export type DiagnosisFailureCode = z.infer<typeof diagnosisFailureCodeSchema>;

const FAILURE_MESSAGES: Record<DiagnosisFailureCode, string> = {
  INVALID_DIAGNOSIS_INPUT:
    "The saved work could not be prepared for diagnosis.",
  PERSONAL_DATA_DETECTED:
    "Remove roster names from the assignment context and typed work before diagnosing.",
  INCONSISTENT_DIAGNOSIS:
    "The diagnosis input changed before the result could be saved.",
  IMAGE_HASH_MISMATCH:
    "The saved image changed before diagnosis. Upload it again.",
  OPENAI_NOT_CONFIGURED:
    "Live diagnosis is unavailable until an OpenAI API key is configured.",
  OPENAI_AUTH_FAILED: "Live diagnosis could not authenticate with OpenAI.",
  OPENAI_RATE_LIMITED:
    "Live diagnosis is busy. Try this submission again shortly.",
  OPENAI_INVALID_REQUEST:
    "OpenAI could not process this student-work submission.",
  OPENAI_UNAVAILABLE:
    "OpenAI is temporarily unavailable. Try this submission again.",
  OPENAI_REQUEST_FAILED: "The live diagnosis request did not complete.",
  OPENAI_RESPONSE_FAILED: "OpenAI could not complete this diagnosis.",
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
  ASSIGNMENT_NOT_FOUND: "The assignment is no longer available.",
  ASSIGNMENT_NOT_READY: "The assignment is not ready for diagnosis.",
  ASSIGNMENT_CONTEXT_MISSING:
    "The assignment no longer has enough context for diagnosis.",
  STUDENT_NOT_IN_CLASS: "The student is no longer active in this class.",
  SUBMISSION_NOT_FOUND: "The saved submission is no longer available.",
  SUBMISSION_NOT_READY: "The saved submission is not ready for diagnosis.",
  IDEMPOTENCY_CONFLICT:
    "This request identifier was already used for different student work.",
  PERSISTENCE_ERROR:
    "The diagnosis result could not be saved. The work is ready to retry.",
  DIAGNOSIS_FAILED:
    "The diagnosis could not be completed. The work is ready to retry.",
  STALE_DIAGNOSIS_RUN:
    "The previous diagnosis timed out. The saved work is ready to retry.",
};

type AssignmentDiagnosisRow = {
  id: string;
  class_id: string;
  domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
  status: "DRAFT" | "READY" | "ARCHIVED";
  assignment_item_id: string;
  exercise_label: string;
  question_label: string;
  prompt: string;
  correct_answer: string;
  answer_format: string;
};

export type SubmissionDiagnosisContext = {
  submissionId: string;
  classId: string;
  assignmentId: string;
  membershipId: string;
  inputKind: SubmissionInputKind;
  domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
  assignmentItemId: string;
  problemPrompt: string;
  correctAnswer: string;
  answerFormat: string;
  storageKey: string | null;
  mediaType: string | null;
  assetSha256: string | null;
  fallbackStorageKey: string | null;
  fallbackMediaType: string | null;
  fallbackSha256: string | null;
  typedResponse: string | null;
};

export type PersistableDiagnosisResult = z.infer<
  typeof persistableDiagnosisResultSchema
>;

export type DiagnosisRunCompletion = z.infer<
  typeof diagnosisRunCompletionSchema
>;

export type DiagnosisRunCompletionInput = z.input<
  typeof diagnosisRunCompletionSchema
>;

function insertDiagnosisImageAttempts(
  runId: string,
  attempts: DiagnosisRunCompletion["attempts"],
) {
  if (!attempts || attempts.length === 0) return;
  const insert = getDatabase().prepare(
    [
      "INSERT INTO diagnosis_image_attempts",
      "(id, ai_run_id, ordinal, rendition, selected, input_hash, output_hash, openai_response_id,",
      "visible_problem_count, minimum_transcription_confidence, input_tokens, output_tokens, latency_ms)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join(" "),
  );
  attempts.forEach((attempt, index) => {
    insert.run(
      randomUUID(),
      runId,
      index + 1,
      attempt.rendition,
      attempt.selected ? 1 : 0,
      attempt.inputHash,
      attempt.outputHash,
      attempt.responseId,
      attempt.visibleProblemCount,
      attempt.minimumTranscriptionConfidence,
      attempt.inputTokens,
      attempt.outputTokens,
      attempt.latencyMs,
    );
  });
}

export class DiagnosisRepositoryError extends Error {
  readonly code:
    | "ASSIGNMENT_NOT_FOUND"
    | "ASSIGNMENT_NOT_READY"
    | "ASSIGNMENT_CONTEXT_MISSING"
    | "STUDENT_NOT_IN_CLASS"
    | "SUBMISSION_NOT_FOUND"
    | "SUBMISSION_NOT_READY"
    | "PERSONAL_DATA_DETECTED"
    | "IDEMPOTENCY_CONFLICT"
    | "PERSISTENCE_ERROR";

  constructor(
    code: DiagnosisRepositoryError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DiagnosisRepositoryError";
    this.code = code;
  }
}

function logPersistenceContractIssues(
  scope: "SINGLE_PROBLEM" | "FULL_PAGE",
  error: unknown,
) {
  if (!(error instanceof z.ZodError)) return;

  // Paths and issue codes identify contract drift without logging prompts,
  // transcriptions, answers, student names, or any other student data.
  console.error(
    "[diagnosis:persistence-contract]",
    JSON.stringify({
      scope,
      issues: error.issues.map((issue) => ({
        path:
          issue.path.length === 0
            ? "<root>"
            : issue.path.map((part) => String(part)).join("."),
        code: issue.code,
        ...(issue.code === "unrecognized_keys"
          ? { unexpectedKeys: [...issue.keys].sort() }
          : {}),
      })),
    }),
  );
}

function getAssignmentDiagnosisRows(assignmentId: string) {
  const rows = getDatabase()
    .prepare(
      [
        "SELECT assignment.id, assignment.class_id, assignment.domain, assignment.status,",
        "item.id AS assignment_item_id, exercise.exercise_label, item.question_label,",
        "problem.prompt, problem.correct_answer, problem.answer_format",
        "FROM assignments AS assignment",
        "JOIN classes AS class ON class.id = assignment.class_id AND class.archived_at IS NULL",
        "LEFT JOIN assignment_items AS item",
        "ON item.assignment_id = assignment.id AND item.class_id = assignment.class_id",
        "LEFT JOIN exercises AS exercise ON exercise.id = item.exercise_id",
        "AND exercise.assignment_id = assignment.id AND exercise.class_id = assignment.class_id",
        "LEFT JOIN problems AS problem",
        "ON problem.id = item.problem_id AND problem.class_id = assignment.class_id",
        "WHERE assignment.id = ? AND assignment.archived_at IS NULL",
        "ORDER BY item.position",
      ].join(" "),
    )
    .all(assignmentId) as AssignmentDiagnosisRow[];

  if (rows.length === 0) {
    throw new DiagnosisRepositoryError(
      "ASSIGNMENT_NOT_FOUND",
      "That assignment could not be found.",
    );
  }

  if (rows[0].status !== "READY") {
    throw new DiagnosisRepositoryError(
      "ASSIGNMENT_NOT_READY",
      "That assignment is not ready for diagnosis.",
    );
  }

  if (
    rows.some(
      (row) =>
        !row.assignment_item_id ||
        !row.exercise_label ||
        !row.question_label ||
        !row.prompt ||
        !row.correct_answer,
    )
  ) {
    throw new DiagnosisRepositoryError(
      "ASSIGNMENT_CONTEXT_MISSING",
      "Add a diagnostic problem and correct answer before uploading work.",
    );
  }

  return rows;
}

function getAssignmentDiagnosisRow(
  assignmentId: string,
  assignmentItemId?: string,
) {
  const rows = getAssignmentDiagnosisRows(assignmentId);
  if (assignmentItemId === undefined) {
    if (rows.length !== 1) {
      throw new DiagnosisRepositoryError(
        "ASSIGNMENT_CONTEXT_MISSING",
        "Choose which worksheet problem this student work answers.",
      );
    }
    return rows[0];
  }

  const row = rows.find((candidate) => candidate.assignment_item_id === assignmentItemId);
  if (!row) {
    throw new DiagnosisRepositoryError(
      "ASSIGNMENT_CONTEXT_MISSING",
      "The selected worksheet problem is unavailable.",
    );
  }
  return row;
}

export function validateDiagnosisTargets(input: {
  assignmentId: string;
  targets: Array<{
    membershipId: string;
    scopeKind: "SINGLE_PROBLEM" | "FULL_PAGE";
    assignmentItemId: string | null;
  }>;
}) {
  const parsed = z
    .object({
      assignmentId: z.string().trim().min(1).max(200),
      targets: z
        .array(
          z
            .object({
              membershipId: idSchema,
              scopeKind: z.enum(["SINGLE_PROBLEM", "FULL_PAGE"]),
              assignmentItemId: idSchema.nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict()
    .parse(input);
  const allAssignmentRows = getAssignmentDiagnosisRows(parsed.assignmentId);
  const assignments = parsed.targets.map((target) =>
    target.scopeKind === "FULL_PAGE"
      ? allAssignmentRows[0]
      : getAssignmentDiagnosisRow(
          parsed.assignmentId,
          target.assignmentItemId ?? undefined,
        ),
  );
  const assignment = assignments[0];
  requireMembershipsInClass(
    assignment.class_id,
    parsed.targets.map((target) => target.membershipId),
  );
  requireNoRosterNamesInText(
    assignment.class_id,
    allAssignmentRows.flatMap((target) => [target.prompt, target.correct_answer]),
  );

  return {
    assignmentId: assignment.id,
    classId: assignment.class_id,
    domain: assignment.domain,
  };
}

function requireMembershipsInClass(classId: string, membershipIds: string[]) {
  const database = getDatabase();
  const membershipExists = database.prepare(
    [
      "SELECT 1 FROM class_memberships AS membership",
      "JOIN students AS student ON student.id = membership.student_id",
      "WHERE membership.id = ? AND membership.class_id = ?",
      "AND membership.archived_at IS NULL AND student.archived_at IS NULL",
    ].join(" "),
  );

  for (const membershipId of new Set(membershipIds)) {
    if (!membershipExists.get(membershipId, classId)) {
      throw new DiagnosisRepositoryError(
        "STUDENT_NOT_IN_CLASS",
        "One selected student is not active in this class.",
      );
    }
  }
}

function requireNoRosterNamesInText(
  classId: string,
  values: Array<string | null>,
) {
  if (containsRosterName(classId, values)) {
    throw new DiagnosisRepositoryError(
      "PERSONAL_DATA_DETECTED",
      FAILURE_MESSAGES.PERSONAL_DATA_DETECTED,
    );
  }
}

function nextAttemptNumber(assignmentId: string, membershipId: string) {
  const row = getDatabase()
    .prepare(
      [
        "SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt",
        "FROM submissions WHERE assignment_id = ? AND membership_id = ?",
      ].join(" "),
    )
    .get(assignmentId, membershipId) as { next_attempt: number };

  return row.next_attempt;
}

function refreshUploadBatchState(uploadBatchId: string | null) {
  if (!uploadBatchId) return;

  const database = getDatabase();
  const counts = database
    .prepare(
      [
        "SELECT batch.total_files,",
        "SUM(CASE WHEN (",
        "submission.status = 'DIAGNOSED' AND EXISTS (SELECT 1 FROM submission_answers AS answer JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id WHERE answer.submission_id = submission.id)",
        ") OR (submission.status = 'NEEDS_REVIEW' AND (COALESCE(TRIM(submission.sanitized_error_message), '') <> '' OR EXISTS (SELECT 1 FROM submission_answers AS answer JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id WHERE answer.submission_id = submission.id))) THEN 1 ELSE 0 END) AS processed_files,",
        "SUM(CASE WHEN submission.status = 'FAILED' THEN 1 ELSE 0 END) AS failed_files",
        "FROM upload_batches AS batch",
        "LEFT JOIN submissions AS submission ON submission.upload_batch_id = batch.id",
        "WHERE batch.id = ? GROUP BY batch.id",
      ].join(" "),
    )
    .get(uploadBatchId) as
    | {
        total_files: number;
        processed_files: number;
        failed_files: number;
      }
    | undefined;

  if (!counts) return;

  const processedFiles = counts.processed_files ?? 0;
  const failedFiles = counts.failed_files ?? 0;
  const terminalCount = processedFiles + failedFiles;
  let status: "PROCESSING" | "COMPLETE" | "PARTIAL" | "FAILED" =
    "PROCESSING";

  if (terminalCount >= counts.total_files) {
    if (failedFiles === 0) status = "COMPLETE";
    else if (processedFiles === 0) status = "FAILED";
    else status = "PARTIAL";
  }

  database
    .prepare(
      [
        "UPDATE upload_batches",
        "SET processed_files = ?, failed_files = ?, status = ?,",
        `completed_at = CASE WHEN ? = 'PROCESSING' THEN NULL ELSE (${nowSql}) END`,
        "WHERE id = ?",
      ].join(" "),
    )
    .run(processedFiles, failedFiles, status, status, uploadBatchId);
}

type ImageUploadBatchInput = {
  assignmentId: string;
  items: Array<{
    clientId: string;
    membershipId: string;
    scopeKind: "SINGLE_PROBLEM" | "FULL_PAGE";
    assignmentItemId: string | null;
    submissionId: string;
    asset: PreparedStudentWorkAsset;
  }>;
};

type ImageUploadBatchResult = {
  batchId: string;
  replayed: boolean;
  items: Array<{
    clientId: string;
    submissionId: string;
    filename: string;
  }>;
};

type ExistingImageSubmissionRow = {
  id: string;
  assignment_id: string;
  class_id: string;
  membership_id: string;
  assignment_item_id: string | null;
  scope_kind: "SINGLE_PROBLEM" | "FULL_PAGE";
  upload_batch_id: string | null;
  input_kind: SubmissionInputKind;
  sha256: string | null;
  fallback_sha256: string | null;
  original_filename: string | null;
};

function parseImageUploadItems(input: ImageUploadBatchInput) {
  if (input.items.length < 1 || input.items.length > 20) {
    throw new DiagnosisRepositoryError(
      "PERSISTENCE_ERROR",
      "Upload between 1 and 20 student-work files at a time.",
    );
  }

  const clientIds = new Set<string>();
  return input.items.map((item) => {
    const parsed = imageUploadItemSchema.parse({
      clientId: item.clientId,
      membershipId: item.membershipId,
      scopeKind: item.scopeKind,
      assignmentItemId: item.assignmentItemId,
      submissionId: item.submissionId,
    });
    if (
      clientIds.has(parsed.clientId) ||
      parsed.clientId !== parsed.submissionId ||
      item.asset.submissionId !== parsed.clientId ||
      !sha256Schema.safeParse(item.asset.sha256).success
    ) {
      throw new DiagnosisRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "Each file needs one stable, unique request identifier.",
      );
    }
    clientIds.add(parsed.clientId);
    return { ...parsed, asset: item.asset };
  });
}

function findImageUploadReplay(
  assignmentId: string,
  classId: string,
  items: ReturnType<typeof parseImageUploadItems>,
): ImageUploadBatchResult | null {
  const findExisting = getDatabase().prepare(
    [
      "SELECT submission.id, submission.assignment_id, submission.class_id,",
      "submission.membership_id, submission.assignment_item_id, submission.scope_kind, submission.upload_batch_id, submission.input_kind,",
      "asset.sha256, asset.fallback_sha256, asset.original_filename",
      "FROM submissions AS submission",
      "LEFT JOIN submission_assets AS asset",
      "ON asset.submission_id = submission.id AND asset.page_position = 1",
      "WHERE submission.id = ?",
    ].join(" "),
  );
  const matched: Array<{
    clientId: string;
    submissionId: string;
    filename: string;
    batchId: string;
  }> = [];
  let existingCount = 0;

  for (const item of items) {
    const existing = findExisting.get(
      item.clientId,
    ) as ExistingImageSubmissionRow | undefined;
    if (!existing) continue;
    existingCount += 1;

    if (
      existing.assignment_id !== assignmentId ||
      existing.class_id !== classId ||
      existing.membership_id !== item.membershipId ||
      existing.assignment_item_id !== item.assignmentItemId ||
      existing.scope_kind !== item.scopeKind ||
      existing.input_kind !== "IMAGE" ||
      existing.sha256 !== item.asset.sha256 ||
      existing.fallback_sha256 !== item.asset.fallbackSha256 ||
      existing.original_filename === null ||
      existing.upload_batch_id === null
    ) {
      throw new DiagnosisRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "This request identifier was already used for different student work.",
      );
    }

    matched.push({
      clientId: item.clientId,
      submissionId: item.clientId,
      filename: existing.original_filename,
      batchId: existing.upload_batch_id,
    });
  }

  if (existingCount === 0) return null;
  if (existingCount !== items.length) {
    throw new DiagnosisRepositoryError(
      "IDEMPOTENCY_CONFLICT",
      "A replay must match the complete original upload.",
    );
  }

  const batchIds = new Set(matched.map((item) => item.batchId));
  if (batchIds.size !== 1) {
    throw new DiagnosisRepositoryError(
      "IDEMPOTENCY_CONFLICT",
      "A replay must match one original upload batch.",
    );
  }

  return {
    batchId: matched[0].batchId,
    replayed: true,
    items: matched.map((item) => ({
      clientId: item.clientId,
      submissionId: item.submissionId,
      filename: item.filename,
    })),
  };
}

export function preflightImageUploadBatch(input: ImageUploadBatchInput) {
  const items = parseImageUploadItems(input);
  const assignmentRows = getAssignmentDiagnosisRows(input.assignmentId);
  const targets = items.map((item) =>
    item.scopeKind === "FULL_PAGE"
      ? assignmentRows[0]
      : getAssignmentDiagnosisRow(
          input.assignmentId,
          item.assignmentItemId ?? undefined,
        ),
  );
  const assignment = targets[0];
  requireMembershipsInClass(
    assignment.class_id,
    items.map((item) => item.membershipId),
  );
  requireNoRosterNamesInText(assignment.class_id, [
    ...assignmentRows.flatMap((target) => [target.prompt, target.correct_answer]),
  ]);
  return findImageUploadReplay(assignment.id, assignment.class_id, items);
}

export function createImageUploadBatch(
  input: ImageUploadBatchInput,
): ImageUploadBatchResult {
  const items = parseImageUploadItems(input);
  const batchId = randomUUID();
  const database = getDatabase();
  let result: ImageUploadBatchResult | null = null;

  database.transaction(() => {
    const assignmentRows = getAssignmentDiagnosisRows(input.assignmentId);
    const targets = items.map((item) =>
      item.scopeKind === "FULL_PAGE"
        ? assignmentRows[0]
        : getAssignmentDiagnosisRow(
            input.assignmentId,
            item.assignmentItemId ?? undefined,
          ),
    );
    const assignment = targets[0];
    requireMembershipsInClass(
      assignment.class_id,
      items.map((item) => item.membershipId),
    );
    requireNoRosterNamesInText(assignment.class_id, [
      ...assignmentRows.flatMap((target) => [target.prompt, target.correct_answer]),
    ]);
    const replay = findImageUploadReplay(assignment.id, assignment.class_id, items);
    if (replay) {
      result = replay;
      return;
    }

    database
      .prepare(
        [
          "INSERT INTO upload_batches",
          "(id, class_id, assignment_id, status, total_files)",
          "VALUES (?, ?, ?, 'PROCESSING', ?)",
        ].join(" "),
      )
      .run(batchId, assignment.class_id, assignment.id, items.length);

    for (const item of items) {
      database
        .prepare(
          [
            "INSERT INTO submissions",
            "(id, class_id, assignment_id, assignment_item_id, scope_kind, membership_id, upload_batch_id, attempt_number, input_kind, status)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IMAGE', 'UPLOADED')",
          ].join(" "),
        )
        .run(
          item.clientId,
          assignment.class_id,
          assignment.id,
          item.assignmentItemId,
          item.scopeKind,
          item.membershipId,
          batchId,
          nextAttemptNumber(assignment.id, item.membershipId),
        );

      database
        .prepare(
          [
            "INSERT INTO submission_assets",
            "(id, submission_id, page_position, storage_key, original_filename, media_type, byte_size, sha256, width, height,",
            "source_width, source_height, crop_left, crop_top, crop_width, crop_height, preprocessing_version,",
            "fallback_storage_key, fallback_media_type, fallback_byte_size, fallback_sha256, fallback_width, fallback_height, fallback_preprocessing_version)",
            "VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          item.asset.id,
          item.clientId,
          item.asset.storageKey,
          item.asset.originalFilename,
          item.asset.mediaType,
          item.asset.byteSize,
          item.asset.sha256,
          item.asset.width,
          item.asset.height,
          item.asset.sourceWidth,
          item.asset.sourceHeight,
          item.asset.cropLeft,
          item.asset.cropTop,
          item.asset.cropWidth,
          item.asset.cropHeight,
          item.asset.preprocessingVersion,
          item.asset.fallbackStorageKey,
          item.asset.fallbackMediaType,
          item.asset.fallbackByteSize,
          item.asset.fallbackSha256,
          item.asset.fallbackWidth,
          item.asset.fallbackHeight,
          item.asset.fallbackPreprocessingVersion,
        );
    }

    result = {
      batchId,
      replayed: false,
      items: items.map((item) => ({
        clientId: item.clientId,
        submissionId: item.clientId,
        filename: item.asset.originalFilename,
      })),
    };
  })();

  if (!result) {
    throw new DiagnosisRepositoryError(
      "PERSISTENCE_ERROR",
      "The upload result could not be confirmed.",
    );
  }
  return result;
}

export function createTypedSubmissions(input: {
  assignmentId: string;
  items: Array<z.input<typeof typedSubmissionItemSchema>>;
}) {
  const items = typedSubmissionItemsSchema.parse(input.items);
  const database = getDatabase();
  const createdItems: Array<{
    clientId: string;
    submissionId: string;
    filename: null;
  }> = [];
  let replayed = false;

  database.transaction(() => {
    const targets = items.map((item) =>
      getAssignmentDiagnosisRow(input.assignmentId, item.assignmentItemId),
    );
    const assignment = targets[0];
    requireMembershipsInClass(
      assignment.class_id,
      items.map((item) => item.membershipId),
    );
    requireNoRosterNamesInText(assignment.class_id, [
      ...targets.flatMap((target) => [target.prompt, target.correct_answer]),
      ...items.map((item) => item.responseText),
    ]);
    const findExisting = database.prepare(
      [
        "SELECT submission.id, submission.assignment_id, submission.class_id,",
        "submission.membership_id, submission.assignment_item_id, submission.input_kind, answer_version.response_text",
        "FROM submissions AS submission",
        "LEFT JOIN submission_answers AS answer",
        "ON answer.submission_id = submission.id AND answer.position = 1",
        "LEFT JOIN answer_versions AS answer_version",
        "ON answer_version.submission_answer_id = answer.id AND answer_version.version = 1",
        "WHERE submission.id = ?",
      ].join(" "),
    );
    let existingCount = 0;

    for (const item of items) {
      const existing = findExisting.get(item.clientId) as
        | {
            id: string;
            assignment_id: string;
            class_id: string;
            membership_id: string;
            assignment_item_id: string | null;
            input_kind: SubmissionInputKind;
            response_text: string | null;
          }
        | undefined;
      if (!existing) continue;
      existingCount += 1;
      if (
        existing.assignment_id !== assignment.id ||
        existing.class_id !== assignment.class_id ||
        existing.membership_id !== item.membershipId ||
        existing.assignment_item_id !== item.assignmentItemId ||
        existing.input_kind !== "TYPED" ||
        existing.response_text !== item.responseText
      ) {
        throw new DiagnosisRepositoryError(
          "IDEMPOTENCY_CONFLICT",
          "This request identifier was already used for different student work.",
        );
      }
    }

    if (existingCount > 0 && existingCount !== items.length) {
      throw new DiagnosisRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "A replay must match the complete original typed submission request.",
      );
    }
    if (existingCount === items.length) {
      replayed = true;
      createdItems.push(
        ...items.map((item) => ({
          clientId: item.clientId,
          submissionId: item.clientId,
          filename: null,
        })),
      );
      return;
    }

    for (const item of items) {
      const submissionId = item.clientId;
      const answerId = randomUUID();
      const target = getAssignmentDiagnosisRow(
        input.assignmentId,
        item.assignmentItemId,
      );

      database
        .prepare(
          [
            "INSERT INTO submissions",
            "(id, class_id, assignment_id, assignment_item_id, membership_id, attempt_number, input_kind, status)",
            "VALUES (?, ?, ?, ?, ?, ?, 'TYPED', 'UPLOADED')",
          ].join(" "),
        )
        .run(
          submissionId,
          assignment.class_id,
          assignment.id,
          item.assignmentItemId,
          item.membershipId,
          nextAttemptNumber(assignment.id, item.membershipId),
        );

      database
        .prepare(
          [
            "INSERT INTO submission_answers",
            "(id, submission_id, assignment_id, class_id, assignment_item_id, position, observed_prompt)",
            "VALUES (?, ?, ?, ?, ?, 1, ?)",
          ].join(" "),
        )
        .run(
          answerId,
          submissionId,
          assignment.id,
          assignment.class_id,
          target.assignment_item_id,
          target.prompt,
        );

      database
        .prepare(
          [
            "INSERT INTO answer_versions",
            "(id, submission_answer_id, version, response_text, normalized_answer, source, confidence, creator_type)",
            "VALUES (?, ?, 1, ?, ?, 'TYPED', 1, 'TEACHER')",
          ].join(" "),
        )
        .run(
          randomUUID(),
          answerId,
          item.responseText,
          canonicalizeMathAnswer(item.responseText),
        );

      createdItems.push({
        clientId: item.clientId,
        submissionId,
        filename: null,
      });
    }
  })();

  return { replayed, items: createdItems };
}

type SubmissionDiagnosisRow = {
  submission_id: string;
  class_id: string;
  assignment_id: string;
  membership_id: string;
  input_kind: SubmissionInputKind;
  domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
  assignment_item_id: string;
  prompt: string;
  correct_answer: string;
  answer_format: string;
  storage_key: string | null;
  media_type: string | null;
  asset_sha256: string | null;
  fallback_storage_key: string | null;
  fallback_media_type: string | null;
  fallback_sha256: string | null;
  typed_response: string | null;
};

export function getSubmissionDiagnosisContext(
  submissionId: string,
): SubmissionDiagnosisContext {
  const row = getDatabase()
    .prepare(
      [
        "SELECT submission.id AS submission_id, submission.class_id, submission.assignment_id,",
        "submission.membership_id, submission.input_kind, assignment.domain,",
        "item.id AS assignment_item_id, problem.prompt, problem.correct_answer, problem.answer_format,",
        "asset.storage_key, asset.media_type, asset.sha256 AS asset_sha256,",
        "asset.fallback_storage_key, asset.fallback_media_type, asset.fallback_sha256,",
        "CASE WHEN submission.input_kind = 'TYPED' THEN answer_version.response_text ELSE NULL END AS typed_response",
        "FROM submissions AS submission",
        "JOIN assignments AS assignment ON assignment.id = submission.assignment_id",
        "AND assignment.status = 'READY' AND assignment.archived_at IS NULL",
        "JOIN classes AS class ON class.id = submission.class_id AND class.archived_at IS NULL",
        "JOIN assignment_items AS item ON item.id = submission.assignment_item_id",
        "AND item.assignment_id = assignment.id AND item.class_id = submission.class_id",
        "JOIN problems AS problem ON problem.id = item.problem_id",
        "LEFT JOIN submission_assets AS asset ON asset.submission_id = submission.id AND asset.page_position = 1 AND asset.purged_at IS NULL",
        "LEFT JOIN submission_answers AS answer ON answer.submission_id = submission.id AND answer.position = 1",
        "LEFT JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id AND answer_version.version = 1",
        "WHERE submission.id = ?",
      ].join(" "),
    )
    .get(submissionId) as SubmissionDiagnosisRow | undefined;

  if (!row) {
    throw new DiagnosisRepositoryError(
      "SUBMISSION_NOT_FOUND",
      "That submission could not be found.",
    );
  }

  if (row.input_kind === "IMAGE" && !row.storage_key) {
    throw new DiagnosisRepositoryError(
      "SUBMISSION_NOT_READY",
      "The saved image is missing from this submission.",
    );
  }

  if (row.input_kind === "TYPED" && !row.typed_response) {
    throw new DiagnosisRepositoryError(
      "SUBMISSION_NOT_READY",
      "The typed response is missing from this submission.",
    );
  }

  requireNoRosterNamesInText(row.class_id, [
    row.prompt,
    row.correct_answer,
    row.typed_response,
  ]);

  return {
    submissionId: row.submission_id,
    classId: row.class_id,
    assignmentId: row.assignment_id,
    membershipId: row.membership_id,
    inputKind: row.input_kind,
    domain: row.domain,
    assignmentItemId: row.assignment_item_id,
    problemPrompt: row.prompt,
    correctAnswer: row.correct_answer,
    answerFormat: row.answer_format,
    storageKey: row.storage_key,
    mediaType: row.media_type,
    assetSha256: row.asset_sha256,
    fallbackStorageKey: row.fallback_storage_key,
    fallbackMediaType: row.fallback_media_type,
    fallbackSha256: row.fallback_sha256,
    typedResponse: row.typed_response,
  };
}

export type StudentPageDiagnosisContext = {
  submissionId: string;
  classId: string;
  assignmentId: string;
  membershipId: string;
  domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
  storageKey: string;
  mediaType: string;
  assetSha256: string;
  fallbackStorageKey: string | null;
  fallbackMediaType: string | null;
  fallbackSha256: string | null;
  problems: Array<{
    assignmentItemId: string;
    position: number;
    exerciseLabel: string;
    questionLabel: string;
    prompt: string;
    correctAnswer: string;
    answerFormat: string;
  }>;
};

export function getSubmissionScopeKind(submissionId: string) {
  const row = getDatabase()
    .prepare("SELECT scope_kind FROM submissions WHERE id = ?")
    .get(submissionId) as
    | { scope_kind: "SINGLE_PROBLEM" | "FULL_PAGE" }
    | undefined;
  if (!row) {
    throw new DiagnosisRepositoryError(
      "SUBMISSION_NOT_FOUND",
      "That submission could not be found.",
    );
  }
  return row.scope_kind;
}

export function getStudentPageDiagnosisContext(
  submissionId: string,
): StudentPageDiagnosisContext {
  const row = getDatabase()
    .prepare(
      [
        "SELECT submission.id AS submission_id, submission.class_id, submission.assignment_id, submission.membership_id,",
        "assignment.domain, asset.storage_key, asset.media_type, asset.sha256 AS asset_sha256,",
        "asset.fallback_storage_key, asset.fallback_media_type, asset.fallback_sha256",
        "FROM submissions AS submission",
        "JOIN assignments AS assignment ON assignment.id = submission.assignment_id",
        "AND assignment.class_id = submission.class_id AND assignment.status = 'READY' AND assignment.archived_at IS NULL",
        "JOIN classes AS class ON class.id = submission.class_id AND class.archived_at IS NULL",
        "JOIN submission_assets AS asset ON asset.submission_id = submission.id AND asset.page_position = 1 AND asset.purged_at IS NULL",
        "WHERE submission.id = ? AND submission.input_kind = 'IMAGE' AND submission.scope_kind = 'FULL_PAGE'",
      ].join(" "),
    )
    .get(submissionId) as
    | {
        submission_id: string;
        class_id: string;
        assignment_id: string;
        membership_id: string;
        domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
        storage_key: string | null;
        media_type: string | null;
        asset_sha256: string | null;
        fallback_storage_key: string | null;
        fallback_media_type: string | null;
        fallback_sha256: string | null;
      }
    | undefined;
  if (
    !row ||
    !row.storage_key ||
    !row.media_type ||
    !row.asset_sha256 ||
    (row.media_type !== "application/pdf" &&
      (!row.fallback_storage_key ||
        !row.fallback_media_type ||
        !row.fallback_sha256))
  ) {
    throw new DiagnosisRepositoryError(
      row ? "SUBMISSION_NOT_READY" : "SUBMISSION_NOT_FOUND",
      row
        ? "This full-page submission is missing an OCR rendition."
        : "That full-page submission could not be found.",
    );
  }
  const problems = getAssignmentDiagnosisRows(row.assignment_id).map(
    (problem, index) => ({
      assignmentItemId: problem.assignment_item_id,
      position: index + 1,
      exerciseLabel: problem.exercise_label,
      questionLabel: problem.question_label,
      prompt: problem.prompt,
      correctAnswer: problem.correct_answer,
      answerFormat: problem.answer_format,
    }),
  );
  requireNoRosterNamesInText(
    row.class_id,
    problems.flatMap((problem) => [problem.prompt, problem.correctAnswer]),
  );
  return {
    submissionId: row.submission_id,
    classId: row.class_id,
    assignmentId: row.assignment_id,
    membershipId: row.membership_id,
    domain: row.domain,
    storageKey: row.storage_key,
    mediaType: row.media_type,
    assetSha256: row.asset_sha256,
    fallbackStorageKey: row.fallback_storage_key,
    fallbackMediaType: row.fallback_media_type,
    fallbackSha256: row.fallback_sha256,
    problems,
  };
}

function recoverStaleDiagnosisRun(submissionId: string) {
  const database = getDatabase();
  const activeRuns = database
    .prepare(
      [
        "SELECT run.id, submission.upload_batch_id,",
        `CASE WHEN COALESCE(run.started_at, run.created_at) <= (${staleRunCutoffSql}) THEN 1 ELSE 0 END AS is_stale`,
        "FROM diagnosis_run_targets AS target",
        "JOIN ai_runs AS run ON run.id = target.ai_run_id AND run.status = 'RUNNING'",
        "JOIN submissions AS submission ON submission.id = target.submission_id AND submission.status = 'PROCESSING'",
        "WHERE target.submission_id = ?",
      ].join(" "),
    )
    .all(submissionId) as Array<{
    id: string;
    upload_batch_id: string | null;
    is_stale: 0 | 1;
  }>;

  if (
    activeRuns.length === 0 ||
    activeRuns.some((run) => run.is_stale === 0)
  ) {
    return false;
  }

  const code: DiagnosisFailureCode = "STALE_DIAGNOSIS_RUN";
  const failRun = database.prepare(
    [
      "UPDATE ai_runs SET status = 'FAILED', error_code = ?,",
      `completed_at = (${nowSql})`,
      "WHERE id = ? AND status = 'RUNNING'",
    ].join(" "),
  );
  for (const run of activeRuns) {
    if (failRun.run(code, run.id).changes !== 1) {
      throw new DiagnosisRepositoryError(
        "PERSISTENCE_ERROR",
        "The stale diagnosis run could not be recovered safely.",
      );
    }
  }

  const submissionUpdate = database
    .prepare(
      [
        "UPDATE submissions SET status = 'FAILED', sanitized_error_code = ?, sanitized_error_message = ?,",
        `processed_at = (${nowSql}), updated_at = (${nowSql})`,
        "WHERE id = ? AND status = 'PROCESSING'",
      ].join(" "),
    )
    .run(code, FAILURE_MESSAGES[code], submissionId);
  if (submissionUpdate.changes !== 1) {
    throw new DiagnosisRepositoryError(
      "PERSISTENCE_ERROR",
      "The stale submission could not be recovered safely.",
    );
  }
  refreshUploadBatchState(activeRuns[0]?.upload_batch_id ?? null);
  return true;
}

export function claimDiagnosisRun(input: {
  submissionId: string;
  classId: string;
  inputHash: string;
  promptVersion: string;
  schemaVersion: string;
}) {
  const runId = randomUUID();
  const database = getDatabase();

  database.transaction(() => {
    const submission = database
      .prepare(
        "SELECT class_id, upload_batch_id FROM submissions WHERE id = ?",
      )
      .get(input.submissionId) as
      | { class_id: string; upload_batch_id: string | null }
      | undefined;

    if (!submission || submission.class_id !== input.classId) {
      throw new DiagnosisRepositoryError(
        "SUBMISSION_NOT_FOUND",
        "That submission could not be found.",
      );
    }

    recoverStaleDiagnosisRun(input.submissionId);

    const update = database
      .prepare(
        [
          "UPDATE submissions",
          "SET status = 'PROCESSING', sanitized_error_code = NULL, sanitized_error_message = NULL, processed_at = NULL,",
          `updated_at = (${nowSql})`,
          "WHERE id = ? AND status IN ('UPLOADED', 'FAILED')",
        ].join(" "),
      )
      .run(input.submissionId);

    if (update.changes !== 1) {
      throw new DiagnosisRepositoryError(
        "SUBMISSION_NOT_READY",
        "This submission is already being processed or has a diagnosis.",
      );
    }

    database
      .prepare(
        [
          "INSERT INTO ai_runs",
          "(id, class_id, purpose, status, model_name, prompt_version, schema_version, input_hash, started_at)",
          `VALUES (?, ?, 'DIAGNOSIS', 'RUNNING', ?, ?, ?, ?, (${nowSql}))`,
        ].join(" "),
      )
      .run(
        runId,
        input.classId,
        OPENAI_MODEL,
        input.promptVersion,
        input.schemaVersion,
        input.inputHash,
      );

    database
      .prepare(
        "INSERT INTO diagnosis_run_targets (ai_run_id, submission_id) VALUES (?, ?)",
      )
      .run(runId, input.submissionId);

    refreshUploadBatchState(submission.upload_batch_id);
  })();

  return { runId, modelName: OPENAI_MODEL };
}

type RunAndSubmissionRow = {
  run_id: string;
  model_name: string;
  prompt_version: string;
  schema_version: string;
  class_id: string;
  assignment_id: string;
  assignment_item_id: string | null;
  input_kind: SubmissionInputKind;
  upload_batch_id: string | null;
  correct_answer: string | null;
};

function getRunAndSubmission(runId: string, submissionId: string) {
  return getDatabase()
    .prepare(
      [
        "SELECT run.id AS run_id, run.model_name, run.prompt_version, run.schema_version,",
        "submission.class_id, submission.assignment_id, item.id AS assignment_item_id,",
        "submission.input_kind, submission.upload_batch_id, problem.correct_answer",
        "FROM ai_runs AS run",
        "JOIN diagnosis_run_targets AS target ON target.ai_run_id = run.id",
        "JOIN submissions AS submission ON submission.id = target.submission_id AND submission.class_id = run.class_id",
        "LEFT JOIN assignment_items AS item ON item.id = submission.assignment_item_id",
        "AND item.assignment_id = submission.assignment_id AND item.class_id = submission.class_id",
        "LEFT JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
        "WHERE run.id = ? AND target.submission_id = ? AND run.purpose = 'DIAGNOSIS'",
      ].join(" "),
    )
    .get(runId, submissionId) as RunAndSubmissionRow | undefined;
}

export function completeDiagnosisRun(input: {
  submissionId: string;
  runId: string;
  completion: DiagnosisRunCompletionInput;
}) {
  const database = getDatabase();
  let diagnosisId = "";
  let completion: DiagnosisRunCompletion;
  try {
    completion = diagnosisRunCompletionSchema.parse(input.completion);
  } catch (error) {
    logPersistenceContractIssues("SINGLE_PROBLEM", error);
    throw new DiagnosisRepositoryError(
      "PERSISTENCE_ERROR",
      "The diagnosis result did not match the persistence contract.",
      { cause: error },
    );
  }

  database.transaction(() => {
    const scope = getRunAndSubmission(input.runId, input.submissionId);
    if (!scope) {
      throw new DiagnosisRepositoryError(
        "PERSISTENCE_ERROR",
        "The diagnosis run no longer matches this submission.",
      );
    }

    if (
      completion.modelName !== scope.model_name ||
      completion.promptVersion !== scope.prompt_version ||
      completion.schemaVersion !== scope.schema_version
    ) {
      throw new DiagnosisRepositoryError(
        "PERSISTENCE_ERROR",
        "The diagnosis provenance did not match its claimed run.",
      );
    }
    if (!scope.assignment_item_id || !scope.correct_answer) {
      throw new DiagnosisRepositoryError(
        "PERSISTENCE_ERROR",
        "A single-problem diagnosis cannot be saved for a full-page submission.",
      );
    }

    const runUpdate = database
      .prepare(
        [
          "UPDATE ai_runs SET status = 'SUCCEEDED', output_hash = ?, openai_response_id = ?,",
          "input_tokens = ?, output_tokens = ?, latency_ms = ?, error_code = NULL,",
          `completed_at = (${nowSql})`,
          "WHERE id = ? AND status = 'RUNNING'",
        ].join(" "),
      )
      .run(
        completion.outputHash,
        completion.responseId,
        completion.inputTokens,
        completion.outputTokens,
        completion.latencyMs,
        input.runId,
      );

    if (runUpdate.changes !== 1) {
      throw new DiagnosisRepositoryError(
        "SUBMISSION_NOT_READY",
        "This diagnosis run is no longer active.",
      );
    }

    insertDiagnosisImageAttempts(input.runId, completion.attempts);

    const result = completion.result;
    const studentFinalAnswer = extractStudentFinalAnswer({
      steps: result.diagnosis.steps,
      transcription: result.diagnosis.transcription,
      studentAnswer: result.studentAnswer,
      correctAnswer: scope.correct_answer,
    });
    let answerVersionId: string;
    if (scope.input_kind === "IMAGE") {
      const answerId = randomUUID();
      answerVersionId = randomUUID();

      database
        .prepare(
          [
            "INSERT INTO submission_answers",
            "(id, submission_id, assignment_id, class_id, assignment_item_id, position, observed_prompt)",
            "VALUES (?, ?, ?, ?, ?, 1, ?)",
          ].join(" "),
        )
        .run(
          answerId,
          input.submissionId,
          scope.assignment_id,
          scope.class_id,
          scope.assignment_item_id,
          result.observedPrompt,
        );

      database
        .prepare(
          [
            "INSERT INTO answer_versions",
            "(id, submission_answer_id, version, response_text, normalized_answer, source, confidence, creator_type)",
            "VALUES (?, ?, 1, ?, ?, 'IMAGE_TRANSCRIPTION', ?, 'AI')",
          ].join(" "),
        )
        .run(
          answerVersionId,
          answerId,
          studentFinalAnswer?.display ??
            result.studentAnswer ??
            result.diagnosis.transcription,
          studentFinalAnswer?.canonical ?? null,
          result.diagnosis.transcriptionConfidence,
        );
    } else {
      const answerVersion = database
        .prepare(
          [
            "SELECT answer_version.id, answer_version.submission_answer_id, answer_version.version,",
            "answer_version.response_text, answer_version.normalized_answer",
            "FROM answer_versions AS answer_version",
            "JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id",
            "WHERE answer.submission_id = ? ORDER BY answer_version.version DESC LIMIT 1",
          ].join(" "),
        )
        .get(input.submissionId) as
        | {
            id: string;
            submission_answer_id: string;
            version: number;
            response_text: string;
            normalized_answer: string | null;
          }
        | undefined;

      if (!answerVersion) {
        throw new DiagnosisRepositoryError(
          "PERSISTENCE_ERROR",
          "The typed answer version could not be found.",
        );
      }
      if (
        studentFinalAnswer &&
        (answerVersion.normalized_answer !== studentFinalAnswer.canonical ||
          answerVersion.response_text !== studentFinalAnswer.display)
      ) {
        answerVersionId = randomUUID();
        database
          .prepare(
            [
              "INSERT INTO answer_versions",
              "(id, submission_answer_id, version, response_text, normalized_answer, source, confidence, creator_type, change_reason)",
              "VALUES (?, ?, ?, ?, ?, 'TYPED', ?, 'AI', ?)",
            ].join(" "),
          )
          .run(
            answerVersionId,
            answerVersion.submission_answer_id,
            answerVersion.version + 1,
            studentFinalAnswer.display,
            studentFinalAnswer.canonical,
            result.diagnosis.transcriptionConfidence,
            "Problem-aware diagnosis extracted the final mathematical answer from the typed work.",
          );
      } else {
        answerVersionId = answerVersion.id;
      }
    }

    const diagnosis = result.diagnosis;
    diagnosisId = randomUUID();
    const reviewReasons = Array.from(
      new Set(
        result.reviewReasons.length > 0
          ? result.reviewReasons
          : diagnosis.reviewReason
            ? [diagnosis.reviewReason]
            : [],
      ),
    );

    database
      .prepare(
        [
          "INSERT INTO diagnoses",
          "(id, answer_version_id, version, source, ai_run_id, outcome, taxonomy_version, misconception_id,",
          "confidence, severity, transcription, observed_transformation, strategy_variant, evidence_quote,",
          "transcription_confidence, reasoning_confidence, image_quality, review_reasons_json,",
          "model_name, prompt_version, schema_version, openai_response_id)",
          "VALUES (?, ?, 1, 'AI', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        diagnosisId,
        answerVersionId,
        input.runId,
        diagnosis.outcome,
        diagnosis.outcome === "MISCONCEPTION" ? TAXONOMY_VERSION : null,
        diagnosis.outcome === "MISCONCEPTION"
          ? diagnosis.misconceptionId
          : null,
        diagnosis.confidence,
        diagnosis.severity,
        diagnosis.transcription,
        result.observedTransformation
          ? JSON.stringify(result.observedTransformation)
          : null,
        result.strategyVariant,
        diagnosis.evidenceQuote,
        diagnosis.transcriptionConfidence,
        diagnosis.reasoningConfidence,
        result.imageQuality,
        JSON.stringify(reviewReasons),
        scope.model_name,
        scope.prompt_version,
        scope.schema_version,
        completion.responseId,
      );

    const insertStep = database.prepare(
      [
        "INSERT INTO diagnosis_steps",
        "(id, diagnosis_id, position, step_text, normalized_math, step_kind, parse_issue, correctness, correct_note, error_note, evidence_quote)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    for (const step of diagnosis.steps) {
      insertStep.run(
        randomUUID(),
        diagnosisId,
        step.position,
        step.step,
        step.normalizedMath,
        step.stepKind,
        step.parseIssue,
        step.correctness,
        step.correctNote,
        step.errorNote,
        step.evidenceQuote,
      );
    }

    const insertCandidate = database.prepare(
      [
        "INSERT INTO diagnosis_candidates",
        "(diagnosis_id, rank, taxonomy_version, misconception_id, confidence, evidence_note)",
        "VALUES (?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    result.candidates.forEach((candidate, index) => {
      insertCandidate.run(
        diagnosisId,
        index + 1,
        TAXONOMY_VERSION,
        candidate.misconceptionId,
        candidate.confidence,
        candidate.evidenceNote,
      );
    });

    const submissionStatus =
      diagnosis.outcome === "CORRECT" || diagnosis.outcome === "MISCONCEPTION"
        ? "DIAGNOSED"
        : "NEEDS_REVIEW";
    const submissionUpdate = database
      .prepare(
        [
          "UPDATE submissions SET status = ?, sanitized_error_code = NULL, sanitized_error_message = NULL,",
          `processed_at = (${nowSql}), updated_at = (${nowSql})`,
          "WHERE id = ? AND status = 'PROCESSING'",
        ].join(" "),
      )
      .run(submissionStatus, input.submissionId);

    if (submissionUpdate.changes !== 1) {
      throw new DiagnosisRepositoryError(
        "SUBMISSION_NOT_READY",
        "The submission changed while its diagnosis was being saved.",
      );
    }

    refreshUploadBatchState(scope.upload_batch_id);
  })();

  return getDiagnosisSummary(diagnosisId);
}

export type StudentPageRunCompletion = z.infer<
  typeof studentPageRunCompletionSchema
>;

export type StudentPageRunCompletionInput = z.input<
  typeof studentPageRunCompletionSchema
>;

export function completeStudentPageDiagnosisRun(input: {
  submissionId: string;
  runId: string;
  completion: StudentPageRunCompletionInput;
}) {
  const database = getDatabase();
  let completion: StudentPageRunCompletion;
  try {
    completion = studentPageRunCompletionSchema.parse(input.completion);
  } catch (error) {
    logPersistenceContractIssues("FULL_PAGE", error);
    throw new DiagnosisRepositoryError(
      "PERSISTENCE_ERROR",
      "The full-page diagnosis did not match the persistence contract.",
      { cause: error },
    );
  }
  const diagnosisIds: string[] = [];

  database.transaction(() => {
    const scope = getRunAndSubmission(input.runId, input.submissionId);
    if (!scope || scope.input_kind !== "IMAGE" || scope.assignment_item_id !== null) {
      throw new DiagnosisRepositoryError(
        "PERSISTENCE_ERROR",
        "The diagnosis run no longer matches this full-page submission.",
      );
    }
    if (
      completion.modelName !== scope.model_name ||
      completion.promptVersion !== scope.prompt_version ||
      completion.schemaVersion !== scope.schema_version
    ) {
      throw new DiagnosisRepositoryError(
        "PERSISTENCE_ERROR",
        "The full-page diagnosis provenance did not match its claimed run.",
      );
    }

    const selectedAttempt = completion.attempts.find((attempt) => attempt.selected);
    if (!selectedAttempt || selectedAttempt.responseId !== completion.responseId) {
      throw new DiagnosisRepositoryError(
        "PERSISTENCE_ERROR",
        "The selected OCR attempt did not match the saved page result.",
      );
    }

    const runUpdate = database
      .prepare(
        [
          "UPDATE ai_runs SET status = 'SUCCEEDED', output_hash = ?, openai_response_id = ?,",
          "input_tokens = ?, output_tokens = ?, latency_ms = ?, error_code = NULL,",
          `completed_at = (${nowSql})`,
          "WHERE id = ? AND status = 'RUNNING'",
        ].join(" "),
      )
      .run(
        completion.outputHash,
        completion.responseId,
        completion.inputTokens,
        completion.outputTokens,
        completion.latencyMs,
        input.runId,
      );
    if (runUpdate.changes !== 1) {
      throw new DiagnosisRepositoryError(
        "SUBMISSION_NOT_READY",
        "This full-page diagnosis run is no longer active.",
      );
    }
    insertDiagnosisImageAttempts(input.runId, completion.attempts);

    const findTarget = database.prepare(
      [
        "SELECT item.position, problem.prompt, problem.correct_answer",
        "FROM assignment_items AS item",
        "JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
        "WHERE item.id = ? AND item.assignment_id = ? AND item.class_id = ?",
      ].join(" "),
    );
    const insertAnswer = database.prepare(
      [
        "INSERT INTO submission_answers",
        "(id, submission_id, assignment_id, class_id, assignment_item_id, position, observed_prompt,",
        "region_x, region_y, region_width, region_height)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    const insertAnswerVersion = database.prepare(
      [
        "INSERT INTO answer_versions",
        "(id, submission_answer_id, version, response_text, normalized_answer, source, confidence, creator_type)",
        "VALUES (?, ?, 1, ?, ?, 'IMAGE_TRANSCRIPTION', ?, 'AI')",
      ].join(" "),
    );
    const insertDiagnosis = database.prepare(
      [
        "INSERT INTO diagnoses",
        "(id, answer_version_id, version, source, ai_run_id, outcome, taxonomy_version, misconception_id,",
        "confidence, severity, transcription, observed_transformation, strategy_variant, evidence_quote,",
        "transcription_confidence, reasoning_confidence, image_quality, review_reasons_json,",
        "model_name, prompt_version, schema_version, openai_response_id)",
        "VALUES (?, ?, 1, 'AI', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    const insertStep = database.prepare(
      [
        "INSERT INTO diagnosis_steps",
        "(id, diagnosis_id, position, step_text, normalized_math, step_kind, parse_issue, correctness, correct_note, error_note, evidence_quote)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    const insertCandidate = database.prepare(
      [
        "INSERT INTO diagnosis_candidates",
        "(diagnosis_id, rank, taxonomy_version, misconception_id, confidence, evidence_note)",
        "VALUES (?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    const seenItems = new Set<string>();

    for (const pageResult of completion.result.results) {
      if (seenItems.has(pageResult.assignmentItemId)) {
        throw new DiagnosisRepositoryError(
          "PERSISTENCE_ERROR",
          "A full page cannot contain two diagnoses for the same problem.",
        );
      }
      seenItems.add(pageResult.assignmentItemId);
      const target = findTarget.get(
        pageResult.assignmentItemId,
        scope.assignment_id,
        scope.class_id,
      ) as
        | { position: number; prompt: string; correct_answer: string }
        | undefined;
      if (
        !target ||
        target.position !== pageResult.position ||
        target.correct_answer !== pageResult.correctAnswer
      ) {
        throw new DiagnosisRepositoryError(
          "PERSISTENCE_ERROR",
          "A segmented result did not match the assignment problem list.",
        );
      }

      const result = pageResult.result;
      const studentFinalAnswer = extractStudentFinalAnswer({
        steps: result.diagnosis.steps,
        transcription: result.diagnosis.transcription,
        studentAnswer: result.studentAnswer,
        correctAnswer: target.correct_answer,
      });
      const answerId = randomUUID();
      const answerVersionId = randomUUID();
      insertAnswer.run(
        answerId,
        input.submissionId,
        scope.assignment_id,
        scope.class_id,
        pageResult.assignmentItemId,
        pageResult.position,
        result.observedPrompt ?? target.prompt,
        pageResult.region?.x ?? null,
        pageResult.region?.y ?? null,
        pageResult.region?.width ?? null,
        pageResult.region?.height ?? null,
      );
      insertAnswerVersion.run(
        answerVersionId,
        answerId,
        studentFinalAnswer?.display ??
          result.studentAnswer ??
          result.diagnosis.transcription,
        studentFinalAnswer?.canonical ?? null,
        result.diagnosis.transcriptionConfidence,
      );

      const diagnosis = result.diagnosis;
      const diagnosisId = randomUUID();
      diagnosisIds.push(diagnosisId);
      const reviewReasons = Array.from(
        new Set(
          result.reviewReasons.length > 0
            ? result.reviewReasons
            : diagnosis.reviewReason
              ? [diagnosis.reviewReason]
              : [],
        ),
      );
      insertDiagnosis.run(
        diagnosisId,
        answerVersionId,
        input.runId,
        diagnosis.outcome,
        diagnosis.outcome === "MISCONCEPTION" ? TAXONOMY_VERSION : null,
        diagnosis.outcome === "MISCONCEPTION"
          ? diagnosis.misconceptionId
          : null,
        diagnosis.confidence,
        diagnosis.severity,
        diagnosis.transcription,
        result.observedTransformation
          ? JSON.stringify(result.observedTransformation)
          : null,
        result.strategyVariant,
        diagnosis.evidenceQuote,
        diagnosis.transcriptionConfidence,
        diagnosis.reasoningConfidence,
        result.imageQuality,
        JSON.stringify(reviewReasons),
        scope.model_name,
        scope.prompt_version,
        scope.schema_version,
        completion.responseId,
      );
      for (const step of diagnosis.steps) {
        insertStep.run(
          randomUUID(),
          diagnosisId,
          step.position,
          step.step,
          step.normalizedMath,
          step.stepKind,
          step.parseIssue,
          step.correctness,
          step.correctNote,
          step.errorNote,
          step.evidenceQuote,
        );
      }
      result.candidates.forEach((candidate, index) => {
        insertCandidate.run(
          diagnosisId,
          index + 1,
          TAXONOMY_VERSION,
          candidate.misconceptionId,
          candidate.confidence,
          candidate.evidenceNote,
        );
      });
    }

    const needsReview =
      completion.result.results.length === 0 ||
      completion.result.segmentationReviewNote !== null ||
      completion.result.results.some(
        (item) =>
          item.result.diagnosis.outcome !== "CORRECT" &&
          item.result.diagnosis.outcome !== "MISCONCEPTION",
      );
    const submissionUpdate = database
      .prepare(
        [
          "UPDATE submissions SET status = ?, sanitized_error_code = NULL, sanitized_error_message = ?,",
          `processed_at = (${nowSql}), updated_at = (${nowSql})`,
          "WHERE id = ? AND status = 'PROCESSING'",
        ].join(" "),
      )
      .run(
        needsReview ? "NEEDS_REVIEW" : "DIAGNOSED",
        completion.result.segmentationReviewNote,
        input.submissionId,
      );
    if (submissionUpdate.changes !== 1) {
      throw new DiagnosisRepositoryError(
        "SUBMISSION_NOT_READY",
        "The full-page submission changed while its diagnoses were saved.",
      );
    }
    refreshUploadBatchState(scope.upload_batch_id);
  })();

  return {
    submissionId: input.submissionId,
    segmentedProblemCount: diagnosisIds.length,
    segmentationReviewNote: completion.result.segmentationReviewNote,
    diagnoses: diagnosisIds.map((diagnosisId) => getDiagnosisSummary(diagnosisId)),
  };
}

export function failDiagnosisRun(input: {
  submissionId: string;
  runId: string;
  errorCode: DiagnosisFailureCode;
  latencyMs: number;
}) {
  const database = getDatabase();
  const parsedCode = diagnosisFailureCodeSchema.safeParse(input.errorCode);
  const errorCode: DiagnosisFailureCode = parsedCode.success
    ? parsedCode.data
    : "DIAGNOSIS_FAILED";
  const latencyMs = Math.max(0, Math.round(input.latencyMs));

  database.transaction(() => {
    const scope = getRunAndSubmission(input.runId, input.submissionId);

    if (!scope) {
      throw new DiagnosisRepositoryError(
        "PERSISTENCE_ERROR",
        "The failed diagnosis run did not target this submission.",
      );
    }

    const runUpdate = database
      .prepare(
        [
          "UPDATE ai_runs SET status = 'FAILED', error_code = ?, latency_ms = ?,",
          `completed_at = (${nowSql})`,
          "WHERE id = ? AND status = 'RUNNING'",
        ].join(" "),
      )
      .run(errorCode, latencyMs, input.runId);

    const submissionUpdate = database
      .prepare(
        [
          "UPDATE submissions SET status = 'FAILED', sanitized_error_code = ?, sanitized_error_message = ?,",
          `processed_at = (${nowSql}), updated_at = (${nowSql})`,
          "WHERE id = ? AND status = 'PROCESSING'",
        ].join(" "),
      )
      .run(
        errorCode,
        FAILURE_MESSAGES[errorCode],
        input.submissionId,
      );

    if (runUpdate.changes !== 1 || submissionUpdate.changes !== 1) {
      throw new DiagnosisRepositoryError(
        "PERSISTENCE_ERROR",
        "The failed diagnosis could not be finalized safely.",
      );
    }

    refreshUploadBatchState(scope.upload_batch_id);
  })();
}

type DiagnosisSummaryRow = {
  submission_id: string;
  outcome: StructuredDiagnosis["outcome"];
  confidence: number;
  severity: 0 | 1 | 2 | 3;
  misconception_id: string | null;
  review_reasons_json: string;
  transcription: string;
  evidence_quote: string | null;
  image_quality: PersistableDiagnosisResult["imageQuality"];
};

type AssignmentDiagnosisQueueRow = {
  submission_id: string;
  membership_id: string;
  assignment_item_id: string | null;
  scope_kind: "SINGLE_PROBLEM" | "FULL_PAGE";
  input_kind: "IMAGE" | "TYPED";
  status:
    | "UPLOADED"
    | "PROCESSING"
    | "DIAGNOSED"
    | "NEEDS_REVIEW"
    | "FAILED";
  filename: string | null;
  response_text: string | null;
  sanitized_error_message: string | null;
  created_at: string;
  latest_diagnosis_id: string | null;
};

export function getDiagnosisSummary(diagnosisId: string) {
  const row = getDatabase()
    .prepare(
      [
        "SELECT submission.id AS submission_id, diagnosis.outcome, diagnosis.confidence, diagnosis.severity,",
        "diagnosis.misconception_id, diagnosis.review_reasons_json, diagnosis.transcription,",
        "diagnosis.evidence_quote, diagnosis.image_quality",
        "FROM diagnoses AS diagnosis",
        "JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id",
        "JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id",
        "JOIN submissions AS submission ON submission.id = answer.submission_id",
        "WHERE diagnosis.id = ?",
      ].join(" "),
    )
    .get(diagnosisId) as DiagnosisSummaryRow | undefined;

  if (!row) {
    throw new DiagnosisRepositoryError(
      "PERSISTENCE_ERROR",
      "The saved diagnosis could not be read back.",
    );
  }

  const misconceptionId = misconceptionIdSchema.safeParse(
    row.misconception_id,
  );
  const misconception = misconceptionId.success
    ? MISCONCEPTION_BY_ID.get(misconceptionId.data)
    : null;
  const reviewReasons = JSON.parse(row.review_reasons_json) as string[];
  const steps = getDatabase()
    .prepare(
      [
        "SELECT position, step_text, normalized_math, step_kind, parse_issue, correctness, correct_note, error_note, evidence_quote",
        "FROM diagnosis_steps WHERE diagnosis_id = ? ORDER BY position",
      ].join(" "),
    )
    .all(diagnosisId) as Array<{
    position: number;
    step_text: string;
    normalized_math: string | null;
    step_kind: "EQUATION" | "EXPRESSION" | "ANSWER" | "ANNOTATION" | "UNPARSEABLE";
    parse_issue: string | null;
    correctness: "CORRECT" | "INCORRECT" | "UNCLEAR";
    correct_note: string | null;
    error_note: string | null;
    evidence_quote: string | null;
  }>;

  return {
    submissionId: row.submission_id,
    outcome: row.outcome,
    confidence: row.confidence,
    severity: row.severity,
    misconception: misconception
      ? {
          id: misconception.id,
          label: misconception.label,
          shortLabel: misconception.shortLabel,
        }
      : null,
    reviewReason: reviewReasons[0] ?? null,
    reviewReasons,
    transcription: row.transcription,
    evidenceQuote: row.evidence_quote,
    imageQuality: row.image_quality,
    steps: steps.map((step) => ({
      position: step.position,
      step: step.step_text,
      normalizedMath: step.normalized_math,
      stepKind: step.step_kind,
      parseIssue: step.parse_issue,
      correctness: step.correctness,
      correctNote: step.correct_note,
      errorNote: step.error_note,
      evidenceQuote: step.evidence_quote,
    })),
  };
}

export function getPersistedDiagnosisSummaryForSubmission(
  submissionId: string,
) {
  const row = getDatabase()
    .prepare(
      [
        "SELECT diagnosis.id",
        "FROM submissions AS submission",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "WHERE submission.id = ?",
        "AND submission.status IN ('DIAGNOSED', 'NEEDS_REVIEW')",
        "ORDER BY diagnosis.created_at DESC, diagnosis.version DESC, diagnosis.id DESC",
        "LIMIT 1",
      ].join(" "),
    )
    .get(submissionId) as { id: string } | undefined;

  return row ? getDiagnosisSummary(row.id) : null;
}

export function listAssignmentDiagnosisQueue(assignmentId: string) {
  const assignment = getAssignmentDiagnosisRows(assignmentId)[0];
  const database = getDatabase();
  const processingRows = database
    .prepare(
      [
        "SELECT id FROM submissions",
        "WHERE assignment_id = ? AND class_id = ? AND status = 'PROCESSING'",
      ].join(" "),
    )
    .all(assignment.id, assignment.class_id) as Array<{ id: string }>;

  database.transaction(() => {
    for (const submission of processingRows) {
      recoverStaleDiagnosisRun(submission.id);
    }
  })();

  const rows = database
    .prepare(
      [
        "SELECT submission.id AS submission_id, submission.membership_id, submission.assignment_item_id, submission.scope_kind,",
        "submission.input_kind, submission.status,",
        "CASE WHEN submission.input_kind = 'IMAGE' THEN asset.original_filename ELSE NULL END AS filename,",
        "CASE WHEN submission.input_kind = 'TYPED' THEN input_version.response_text ELSE NULL END AS response_text,",
        "submission.sanitized_error_message, submission.created_at,",
        "CASE WHEN submission.status IN ('DIAGNOSED', 'NEEDS_REVIEW') THEN (",
        "SELECT diagnosis.id FROM submission_answers AS diagnosis_answer",
        "JOIN answer_versions AS diagnosis_version",
        "ON diagnosis_version.submission_answer_id = diagnosis_answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = diagnosis_version.id",
        "WHERE diagnosis_answer.submission_id = submission.id",
        "AND diagnosis_answer.assignment_id = submission.assignment_id",
        "AND diagnosis_answer.class_id = submission.class_id",
        "ORDER BY diagnosis.created_at DESC, diagnosis.version DESC, diagnosis.id DESC LIMIT 1",
        ") ELSE NULL END AS latest_diagnosis_id",
        "FROM submissions AS submission",
        "JOIN assignments AS scoped_assignment",
        "ON scoped_assignment.id = submission.assignment_id",
        "AND scoped_assignment.class_id = submission.class_id",
        "AND scoped_assignment.status = 'READY' AND scoped_assignment.archived_at IS NULL",
        "JOIN classes AS scoped_class",
        "ON scoped_class.id = submission.class_id AND scoped_class.archived_at IS NULL",
        "LEFT JOIN submission_assets AS asset",
        "ON asset.submission_id = submission.id AND asset.page_position = 1 AND asset.purged_at IS NULL",
        "LEFT JOIN submission_answers AS input_answer",
        "ON input_answer.submission_id = submission.id",
        "AND input_answer.assignment_id = submission.assignment_id",
        "AND input_answer.class_id = submission.class_id AND input_answer.position = 1",
        "LEFT JOIN answer_versions AS input_version",
        "ON input_version.submission_answer_id = input_answer.id",
        "AND input_version.version = 1 AND input_version.source = 'TYPED'",
        "WHERE submission.assignment_id = ? AND submission.class_id = ?",
        "AND submission.input_kind IN ('IMAGE', 'TYPED')",
        "ORDER BY submission.created_at DESC, submission.id DESC",
      ].join(" "),
    )
    .all(assignment.id, assignment.class_id) as AssignmentDiagnosisQueueRow[];

  return rows.map((row) => ({
    submissionId: row.submission_id,
    membershipId: row.membership_id,
    assignmentItemId: row.assignment_item_id,
    scopeKind: row.scope_kind,
    inputKind: row.input_kind,
    status: row.status,
    filename: row.filename,
    responseText: row.response_text,
    sanitizedErrorMessage: row.sanitized_error_message,
    createdAt: row.created_at,
    diagnosis: row.latest_diagnosis_id
      ? getDiagnosisSummary(row.latest_diagnosis_id)
      : null,
  }));
}
