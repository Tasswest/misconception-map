import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  observedTransformationSchema,
  structuredDiagnosisSchema,
  type StructuredDiagnosis,
  type SubmissionInputKind,
} from "@/domain/contracts";
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
    assignmentItemId: idSchema,
  })
  .strict();

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

const diagnosisRunCompletionSchema = z.object({
  responseId: z.string().min(1).max(240),
  modelName: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(120),
  schemaVersion: z.string().min(1).max(120),
  outputHash: sha256Schema,
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative(),
  result: persistableDiagnosisResultSchema,
});

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
  typedResponse: string | null;
};

export type PersistableDiagnosisResult = z.infer<
  typeof persistableDiagnosisResultSchema
>;

export type DiagnosisRunCompletion = z.infer<
  typeof diagnosisRunCompletionSchema
>;

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

function getAssignmentDiagnosisRows(assignmentId: string) {
  const rows = getDatabase()
    .prepare(
      [
        "SELECT assignment.id, assignment.class_id, assignment.domain, assignment.status,",
        "item.id AS assignment_item_id, problem.prompt, problem.correct_answer, problem.answer_format",
        "FROM assignments AS assignment",
        "JOIN classes AS class ON class.id = assignment.class_id AND class.archived_at IS NULL",
        "LEFT JOIN assignment_items AS item",
        "ON item.assignment_id = assignment.id AND item.class_id = assignment.class_id",
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
      (row) => !row.assignment_item_id || !row.prompt || !row.correct_answer,
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
  targets: Array<{ membershipId: string; assignmentItemId: string }>;
}) {
  const parsed = z
    .object({
      assignmentId: z.string().trim().min(1).max(200),
      targets: z
        .array(
          z
            .object({
              membershipId: idSchema,
              assignmentItemId: idSchema,
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict()
    .parse(input);
  const assignments = parsed.targets.map((target) =>
    getAssignmentDiagnosisRow(parsed.assignmentId, target.assignmentItemId),
  );
  const assignment = assignments[0];
  requireMembershipsInClass(
    assignment.class_id,
    parsed.targets.map((target) => target.membershipId),
  );
  requireNoRosterNamesInText(
    assignment.class_id,
    assignments.flatMap((target) => [target.prompt, target.correct_answer]),
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
        "SUM(CASE WHEN submission.status IN ('DIAGNOSED', 'NEEDS_REVIEW') THEN 1 ELSE 0 END) AS processed_files,",
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
    assignmentItemId: string;
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
  upload_batch_id: string | null;
  input_kind: SubmissionInputKind;
  sha256: string | null;
  original_filename: string | null;
};

function parseImageUploadItems(input: ImageUploadBatchInput) {
  if (input.items.length < 1 || input.items.length > 20) {
    throw new DiagnosisRepositoryError(
      "PERSISTENCE_ERROR",
      "Upload between 1 and 20 student-work images at a time.",
    );
  }

  const clientIds = new Set<string>();
  return input.items.map((item) => {
    const parsed = imageUploadItemSchema.parse({
      clientId: item.clientId,
      membershipId: item.membershipId,
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
        "Each image needs one stable, unique request identifier.",
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
      "submission.membership_id, submission.assignment_item_id, submission.upload_batch_id, submission.input_kind,",
      "asset.sha256, asset.original_filename",
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
      existing.input_kind !== "IMAGE" ||
      existing.sha256 !== item.asset.sha256 ||
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
            "(id, class_id, assignment_id, assignment_item_id, membership_id, upload_batch_id, attempt_number, input_kind, status)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'IMAGE', 'UPLOADED')",
          ].join(" "),
        )
        .run(
          item.clientId,
          assignment.class_id,
          assignment.id,
          item.assignmentItemId,
          item.membershipId,
          batchId,
          nextAttemptNumber(assignment.id, item.membershipId),
        );

      database
        .prepare(
          [
            "INSERT INTO submission_assets",
            "(id, submission_id, page_position, storage_key, original_filename, media_type, byte_size, sha256, width, height,",
            "source_width, source_height, crop_left, crop_top, crop_width, crop_height, preprocessing_version)",
            "VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
            "VALUES (?, ?, 1, ?, NULL, 'TYPED', 1, 'TEACHER')",
          ].join(" "),
        )
        .run(randomUUID(), answerId, item.responseText);

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
    typedResponse: row.typed_response,
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
  assignment_item_id: string;
  input_kind: SubmissionInputKind;
  upload_batch_id: string | null;
};

function getRunAndSubmission(runId: string, submissionId: string) {
  return getDatabase()
    .prepare(
      [
        "SELECT run.id AS run_id, run.model_name, run.prompt_version, run.schema_version,",
        "submission.class_id, submission.assignment_id, item.id AS assignment_item_id,",
        "submission.input_kind, submission.upload_batch_id",
        "FROM ai_runs AS run",
        "JOIN diagnosis_run_targets AS target ON target.ai_run_id = run.id",
        "JOIN submissions AS submission ON submission.id = target.submission_id AND submission.class_id = run.class_id",
        "JOIN assignment_items AS item ON item.id = submission.assignment_item_id",
        "AND item.assignment_id = submission.assignment_id AND item.class_id = submission.class_id",
        "WHERE run.id = ? AND target.submission_id = ? AND run.purpose = 'DIAGNOSIS'",
      ].join(" "),
    )
    .get(runId, submissionId) as RunAndSubmissionRow | undefined;
}

export function completeDiagnosisRun(input: {
  submissionId: string;
  runId: string;
  completion: DiagnosisRunCompletion;
}) {
  const database = getDatabase();
  let diagnosisId = "";
  let completion: DiagnosisRunCompletion;
  try {
    completion = diagnosisRunCompletionSchema.parse(input.completion);
  } catch (error) {
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

    let answerVersionId: string;
    if (scope.input_kind === "IMAGE") {
      const answerId = randomUUID();
      answerVersionId = randomUUID();
      const result = completion.result;

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
          result.studentAnswer ?? result.diagnosis.transcription,
          result.normalizedAnswer,
          result.diagnosis.transcriptionConfidence,
        );
    } else {
      const answerVersion = database
        .prepare(
          [
            "SELECT answer_version.id",
            "FROM answer_versions AS answer_version",
            "JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id",
            "WHERE answer.submission_id = ? ORDER BY answer_version.version DESC LIMIT 1",
          ].join(" "),
        )
        .get(input.submissionId) as { id: string } | undefined;

      if (!answerVersion) {
        throw new DiagnosisRepositoryError(
          "PERSISTENCE_ERROR",
          "The typed answer version could not be found.",
        );
      }
      answerVersionId = answerVersion.id;
    }

    const result = completion.result;
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
        "(id, diagnosis_id, position, step_text, normalized_math, step_kind, parse_issue, correctness, error_note, evidence_quote)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
  assignment_item_id: string;
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
        "SELECT position, step_text, normalized_math, step_kind, parse_issue, correctness, error_note, evidence_quote",
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
        "SELECT submission.id AS submission_id, submission.membership_id, submission.assignment_item_id,",
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
