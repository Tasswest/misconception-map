import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { MisconceptionId } from "@/domain/contracts";
import { exerciseQuestionReference } from "@/domain/exam-labels";
import { canonicalizeMathAnswer } from "@/domain/math-normalization.mjs";
import { extractStudentFinalAnswer } from "@/domain/student-final-answer.mjs";
import {
  effectivePredictionKind,
  mathematicalSkillKey,
} from "@/domain/student-model-predictions.mjs";
import {
  MISCONCEPTION_BY_ID,
  misconceptionIdSchema,
} from "@/domain/misconception-taxonomy.mjs";
import { getDatabase } from "@/lib/db";
import { containsRosterName } from "@/server/privacy/roster-text";

const idSchema = z.string().uuid();

type PredictionRun = {
  result: {
    predictionKind: "FLAWED_RULE_APPLIES" | "MASTERY" | "ABSTAIN";
    ruleApplied: boolean;
    predictedAnswer: string | null;
    confidence: number;
    abstentionReason: string | null;
    masteryEvidenceUsed: string | null;
    trace: {
      inputFormMatched: string;
      appliedTransformation: string;
      predictedResult: string | null;
      scopeCheck: string;
    };
  };
  inputHash: string;
  outputHash: string;
  responseId: string;
  modelName: string;
  promptVersion: string;
  schemaVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

export class PredictionRepositoryError extends Error {
  readonly code:
    | "CLASS_NOT_FOUND"
    | "MODEL_NOT_FOUND"
    | "MODEL_NOT_SUPPORTED"
    | "TARGET_NOT_FOUND"
    | "TARGET_ALREADY_SEEN"
    | "PERSONAL_DATA_DETECTED"
    | "PREDICTION_CONFLICT"
    | "REVISION_NOT_FOUND"
    | "REVISION_ALREADY_DECIDED"
    | "REVISION_MODEL_CHANGED"
    | "PERSISTENCE_ERROR";

  constructor(
    code: PredictionRepositoryError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PredictionRepositoryError";
    this.code = code;
  }
}

export type PredictionContext = {
  classId: string;
  membershipId: string;
  modelVersionId: string;
  modelVersion: number;
  domain: "ALGEBRA" | "FRACTIONS";
  taxonomyVersion: string;
  misconceptionId: MisconceptionId;
  misconceptionLabel: string;
  ruleStatement: string;
  formalPattern: Record<string, string>;
  scopeLimits: string[];
  observedApplicationCount: number | null;
  observedOpportunityCount: number | null;
  observedApplicationRate: number | null;
  masteryEvidence: Array<{
    problemPrompt: string;
    correctAnswer: string;
    skillKey: string;
    evidenceSummary: string;
  }>;
  targetAssignmentId: string;
  targetAssignmentTitle: string;
  targetAssignmentItemId: string;
  targetProblemId: string;
  problemPrompt: string;
  answerFormat:
    | "EXPRESSION"
    | "NUMBER"
    | "FRACTION"
    | "MULTIPLE_CHOICE"
    | "SHORT_TEXT";
  correctAnswer: string;
  canonicalCorrectAnswer: string | null;
};

function parseJsonObject(value: string) {
  const parsed = JSON.parse(value) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, string>)
    : {};
}

function parseStringArray(value: string) {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
    ? parsed
    : [];
}

export function getPredictionContext(input: {
  modelVersionId: string;
  targetAssignmentItemId: string;
}): PredictionContext {
  const modelVersionId = idSchema.parse(input.modelVersionId);
  const targetAssignmentItemId = idSchema.parse(input.targetAssignmentItemId);
  const row = getDatabase()
    .prepare(
      [
        "SELECT hypothesis.class_id, hypothesis.membership_id, hypothesis.domain,",
        "hypothesis.taxonomy_version, hypothesis.misconception_id,",
        "model.id AS model_version_id, model.version AS model_version, model.status,",
        "model.rule_statement, model.formal_pattern_json, model.scope_limits_json,",
        "model.observed_application_count, model.observed_opportunity_count, model.observed_application_rate,",
        "item.id AS target_item_id, assignment.id AS target_assignment_id, assignment.title AS target_assignment_title,",
        "problem.id AS problem_id, problem.prompt, problem.answer_format, problem.correct_answer,",
        "problem.canonical_correct_answer, problem.content_hash",
        "FROM student_model_versions AS model",
        "JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id",
        "JOIN assignment_items AS item ON item.id = ? AND item.class_id = hypothesis.class_id",
        "JOIN assignments AS assignment ON assignment.id = item.assignment_id AND assignment.class_id = item.class_id",
        "JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
        "LEFT JOIN student_model_finalizations AS finalization ON finalization.student_model_version_id = model.id",
        "WHERE model.id = ? AND hypothesis.retired_at IS NULL AND model.superseded_at IS NULL",
        "AND assignment.status = 'READY' AND assignment.archived_at IS NULL",
        "AND problem.domain = hypothesis.domain",
      ].join(" "),
    )
    .get(targetAssignmentItemId, modelVersionId) as
    | {
        class_id: string;
        membership_id: string;
        domain: "ALGEBRA" | "FRACTIONS";
        taxonomy_version: string;
        misconception_id: string;
        model_version_id: string;
        model_version: number;
        status:
          | "PROVISIONAL"
          | "SUPPORTED"
          | "CONTRADICTED"
          | "INSUFFICIENT_EVIDENCE"
          | "RETIRED";
        rule_statement: string;
        formal_pattern_json: string;
        scope_limits_json: string;
        observed_application_count: number | null;
        observed_opportunity_count: number | null;
        observed_application_rate: number | null;
        target_item_id: string;
        target_assignment_id: string;
        target_assignment_title: string;
        problem_id: string;
        prompt: string;
        answer_format: PredictionContext["answerFormat"];
        correct_answer: string;
        canonical_correct_answer: string | null;
        content_hash: string | null;
      }
    | undefined;

  if (!row) {
    throw new PredictionRepositoryError(
      "TARGET_NOT_FOUND",
      "That held-out target is not available for this Student Model.",
    );
  }
  if (row.status !== "SUPPORTED") {
    throw new PredictionRepositoryError(
      "MODEL_NOT_SUPPORTED",
      "Locking a prediction requires a supported Student Model with evidence from two distinct problems.",
    );
  }
  if (!row.content_hash) {
    throw new PredictionRepositoryError(
      "TARGET_NOT_FOUND",
      "The held-out target is missing a stable content fingerprint.",
    );
  }
  if (containsRosterName(row.class_id, [row.prompt])) {
    throw new PredictionRepositoryError(
      "PERSONAL_DATA_DETECTED",
      "Remove roster names from the held-out problem before locking a prediction.",
    );
  }
  const misconceptionId = misconceptionIdSchema.safeParse(row.misconception_id);
  const taxonomy = misconceptionId.success
    ? MISCONCEPTION_BY_ID.get(misconceptionId.data)
    : null;
  if (!misconceptionId.success || !taxonomy) {
    throw new PredictionRepositoryError(
      "MODEL_NOT_FOUND",
      "The Student Model no longer matches the active taxonomy.",
    );
  }

  const alreadySeen = getDatabase()
    .prepare(
      [
        "SELECT 1 FROM submissions AS submission",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN assignment_items AS answered_item ON answered_item.id = answer.assignment_item_id",
        "JOIN problems AS answered_problem ON answered_problem.id = answered_item.problem_id",
        "JOIN problems AS target_problem ON target_problem.id = ?",
        "WHERE submission.membership_id = ?",
        "AND (answered_problem.id = target_problem.id OR answered_problem.content_hash = target_problem.content_hash)",
        "LIMIT 1",
      ].join(" "),
    )
    .get(row.problem_id, row.membership_id);
  if (alreadySeen) {
    throw new PredictionRepositoryError(
      "TARGET_ALREADY_SEEN",
      "This student already has recorded work on that problem content, so it is not held out.",
    );
  }

  const targetSkillKey = mathematicalSkillKey(row.prompt);
  const masteryEvidence = getDatabase()
    .prepare(
      [
        "SELECT problem.prompt, problem.correct_answer, mastery.skill_key, mastery.rationale",
        "FROM student_model_mastery_evidence AS mastery",
        "JOIN diagnoses AS diagnosis ON diagnosis.id = mastery.diagnosis_id",
        "JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id",
        "JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id",
        "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
        "JOIN problems AS problem ON problem.id = item.problem_id",
        "WHERE mastery.student_model_version_id = ? AND mastery.skill_key = ?",
        "ORDER BY mastery.created_at DESC, mastery.diagnosis_id LIMIT 12",
      ].join(" "),
    )
    .all(row.model_version_id, targetSkillKey) as Array<{
    prompt: string;
    correct_answer: string;
    skill_key: string;
    rationale: string;
  }>;

  return {
    classId: row.class_id,
    membershipId: row.membership_id,
    modelVersionId: row.model_version_id,
    modelVersion: row.model_version,
    domain: row.domain,
    taxonomyVersion: row.taxonomy_version,
    misconceptionId: misconceptionId.data,
    misconceptionLabel: taxonomy.label,
    ruleStatement: row.rule_statement,
    formalPattern: parseJsonObject(row.formal_pattern_json),
    scopeLimits: parseStringArray(row.scope_limits_json),
    observedApplicationCount: row.observed_application_count,
    observedOpportunityCount: row.observed_opportunity_count,
    observedApplicationRate: row.observed_application_rate,
    masteryEvidence: masteryEvidence.map((evidence) => ({
      problemPrompt: evidence.prompt,
      correctAnswer: evidence.correct_answer,
      skillKey: evidence.skill_key,
      evidenceSummary: evidence.rationale,
    })),
    targetAssignmentId: row.target_assignment_id,
    targetAssignmentTitle: row.target_assignment_title,
    targetAssignmentItemId: row.target_item_id,
    targetProblemId: row.problem_id,
    problemPrompt: row.prompt,
    answerFormat: row.answer_format,
    correctAnswer: row.correct_answer,
    canonicalCorrectAnswer: row.canonical_correct_answer,
  };
}

export function getPredictionModelScope(input: {
  classId: string;
  modelVersionId: string;
}) {
  const classId = idSchema.parse(input.classId);
  const modelVersionId = idSchema.parse(input.modelVersionId);
  const row = getDatabase()
    .prepare(
      [
        "SELECT hypothesis.class_id, hypothesis.domain, model.id, model.status",
        "FROM student_model_versions AS model",
        "JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id",
        "WHERE model.id = ? AND hypothesis.class_id = ? AND hypothesis.retired_at IS NULL",
        "AND model.superseded_at IS NULL",
      ].join(" "),
    )
    .get(modelVersionId, classId) as
    | {
        class_id: string;
        domain: "ALGEBRA" | "FRACTIONS";
        id: string;
        status: string;
      }
    | undefined;
  if (!row) {
    throw new PredictionRepositoryError(
      "MODEL_NOT_FOUND",
      "That Student Model is not current for this class.",
    );
  }
  if (row.status !== "SUPPORTED") {
    throw new PredictionRepositoryError(
      "MODEL_NOT_SUPPORTED",
      "Create held-out probes only after the Student Model is supported.",
    );
  }
  return row;
}

export function persistLockedPrediction(input: {
  context: PredictionContext;
  run: PredictionRun;
}) {
  const database = getDatabase();
  const predictionId = randomUUID();
  const runId = randomUUID();
  const lockedAt = new Date().toISOString();
  const confidence =
    input.run.result.predictionKind === "FLAWED_RULE_APPLIES" &&
    input.context.observedApplicationRate !== null
      ? input.context.observedApplicationRate
      : input.run.result.confidence;

  try {
    database.transaction(() => {
      database
        .prepare(
          [
            "INSERT INTO ai_runs",
            "(id, class_id, purpose, status, model_name, prompt_version, schema_version, input_hash, output_hash,",
            "openai_response_id, input_tokens, output_tokens, latency_ms, started_at, completed_at)",
            "VALUES (?, ?, 'PREDICTION', 'SUCCEEDED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          runId,
          input.context.classId,
          input.run.modelName,
          input.run.promptVersion,
          input.run.schemaVersion,
          input.run.inputHash,
          input.run.outputHash,
          input.run.responseId,
          input.run.inputTokens,
          input.run.outputTokens,
          input.run.latencyMs,
          lockedAt,
          lockedAt,
        );
      database
        .prepare(
          [
            "INSERT INTO predictions",
            "(id, class_id, membership_id, student_model_version_id, problem_id, target_assignment_item_id,",
            "rule_applied, predicted_answer, canonical_predicted_answer, correct_answer_snapshot, canonical_correct_answer,",
            "trace_json, confidence, abstention_reason, ai_run_id, model_name, prompt_version, schema_version, locked_at, created_at,",
            "prediction_kind, consistency_snapshot, mastery_evidence_summary)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          predictionId,
          input.context.classId,
          input.context.membershipId,
          input.context.modelVersionId,
          input.context.targetProblemId,
          input.context.targetAssignmentItemId,
          input.run.result.predictionKind === "ABSTAIN" ? 0 : 1,
          input.run.result.predictedAnswer,
          input.run.result.predictedAnswer
            ? canonicalizeMathAnswer(input.run.result.predictedAnswer)
            : null,
          input.context.correctAnswer,
          input.context.canonicalCorrectAnswer,
          JSON.stringify(input.run.result.trace),
          confidence,
          input.run.result.abstentionReason,
          runId,
          input.run.modelName,
          input.run.promptVersion,
          input.run.schemaVersion,
          lockedAt,
          lockedAt,
          input.run.result.predictionKind,
          input.context.observedApplicationRate,
          input.run.result.masteryEvidenceUsed,
        );
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      /UNIQUE constraint failed|one prediction per problem content|already has recorded work|must be unseen/u.test(
        message,
      )
    ) {
      throw new PredictionRepositoryError(
        "PREDICTION_CONFLICT",
        "That held-out prediction was already locked or the target is no longer unseen.",
        { cause: error },
      );
    }
    throw new PredictionRepositoryError(
      "PERSISTENCE_ERROR",
      "The prediction was generated but could not be locked.",
      { cause: error },
    );
  }

  return {
    id: predictionId,
    modelVersionId: input.context.modelVersionId,
    modelVersion: input.context.modelVersion,
    targetAssignmentId: input.context.targetAssignmentId,
    targetAssignmentTitle: input.context.targetAssignmentTitle,
    targetAssignmentItemId: input.context.targetAssignmentItemId,
    problemPrompt: input.context.problemPrompt,
    correctAnswer: input.context.correctAnswer,
    ruleApplied: input.run.result.ruleApplied,
    predictionKind: input.run.result.predictionKind,
    predictedAnswer: input.run.result.predictedAnswer,
    confidence,
    abstentionReason: input.run.result.abstentionReason,
    trace: input.run.result.trace,
    lockedAt,
  };
}

export function listPredictionLabClasses() {
  return getDatabase()
    .prepare(
      [
        "SELECT class.id, class.name, class.grade_band, count(membership.id) AS student_count",
        "FROM classes AS class",
        "LEFT JOIN class_memberships AS membership ON membership.class_id = class.id AND membership.archived_at IS NULL",
        "WHERE class.archived_at IS NULL",
        "GROUP BY class.id ORDER BY class.is_demo DESC, class.created_at DESC, class.name COLLATE NOCASE",
      ].join(" "),
    )
    .all() as Array<{
    id: string;
    name: string;
    grade_band: string;
    student_count: number;
  }>;
}

type ModelRow = {
  id: string;
  membership_id: string;
  version: number;
  status:
    | "PROVISIONAL"
    | "SUPPORTED"
    | "CONTRADICTED"
    | "INSUFFICIENT_EVIDENCE"
    | "RETIRED";
  rule_statement: string;
  confidence: number;
  observed_application_count: number | null;
  observed_opportunity_count: number | null;
  observed_application_rate: number | null;
  mastery_evidence_count: number | null;
  domain: "ALGEBRA" | "FRACTIONS";
  taxonomy_version: string;
  misconception_id: MisconceptionId;
  support_count: number;
  distinct_support_content: number;
  finalized_at: string | null;
  created_at: string;
};

export type PredictionLabData = ReturnType<typeof getPredictionLabData>;

export function getPredictionLabData(classIdInput: string) {
  const classId = idSchema.parse(classIdInput);
  const database = getDatabase();
  const classRecord = database
    .prepare(
      "SELECT id, name, grade_band FROM classes WHERE id = ? AND archived_at IS NULL",
    )
    .get(classId) as
    | { id: string; name: string; grade_band: string }
    | undefined;
  if (!classRecord) {
    throw new PredictionRepositoryError(
      "CLASS_NOT_FOUND",
      "That class is not available in Prediction Lab.",
    );
  }

  const memberships = database
    .prepare(
      [
        "SELECT membership.id, student.display_name",
        "FROM class_memberships AS membership",
        "JOIN students AS student ON student.id = membership.student_id AND student.archived_at IS NULL",
        "WHERE membership.class_id = ? AND membership.archived_at IS NULL",
        "ORDER BY membership.sort_order, student.display_name COLLATE NOCASE",
      ].join(" "),
    )
    .all(classId) as Array<{ id: string; display_name: string }>;

  const candidates = database
    .prepare(
      [
        "SELECT submission.membership_id, min(submission.assignment_id) AS assignment_id,",
        "diagnosis.taxonomy_version, diagnosis.misconception_id,",
        "count(DISTINCT answer.id) AS evidence_count, count(DISTINCT problem.content_hash) AS distinct_problem_count,",
        "max(diagnosis.confidence) AS confidence",
        "FROM submissions AS submission",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
        "JOIN problems AS problem ON problem.id = item.problem_id",
        "WHERE submission.class_id = ? AND diagnosis.outcome = 'MISCONCEPTION'",
        "AND diagnosis.id = (",
        "SELECT latest.id FROM diagnoses AS latest",
        "JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id",
        "JOIN submission_answers AS latest_answer ON latest_answer.id = latest_version.submission_answer_id",
        "WHERE latest_answer.id = answer.id",
        "ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1",
        ")",
        "GROUP BY submission.membership_id, diagnosis.taxonomy_version, diagnosis.misconception_id",
        "ORDER BY distinct_problem_count DESC, confidence DESC",
      ].join(" "),
    )
    .all(classId) as Array<{
    membership_id: string;
    assignment_id: string;
    taxonomy_version: string;
    misconception_id: MisconceptionId;
    evidence_count: number;
    distinct_problem_count: number;
    confidence: number;
  }>;

  const models = database
    .prepare(
      [
        "SELECT model.id, hypothesis.membership_id, model.version, model.status, model.rule_statement, model.confidence,",
        "model.observed_application_count, model.observed_opportunity_count, model.observed_application_rate, model.mastery_evidence_count,",
        "hypothesis.domain, hypothesis.taxonomy_version, hypothesis.misconception_id, model.created_at,",
        "coalesce(finalization.support_count, (",
        "SELECT count(DISTINCT answer_version.submission_answer_id) FROM student_model_evidence AS evidence",
        "JOIN diagnoses AS diagnosis ON diagnosis.id = evidence.diagnosis_id",
        "JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id",
        "WHERE evidence.student_model_version_id = model.id AND evidence.role = 'SUPPORTS'",
        "), 0) AS support_count,",
        "(SELECT count(DISTINCT problem.content_hash) FROM student_model_evidence AS evidence",
        "JOIN diagnoses AS diagnosis ON diagnosis.id = evidence.diagnosis_id",
        "JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id",
        "JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id",
        "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
        "JOIN problems AS problem ON problem.id = item.problem_id",
        "WHERE evidence.student_model_version_id = model.id AND evidence.role = 'SUPPORTS'",
        ") AS distinct_support_content, finalization.finalized_at",
        "FROM student_model_versions AS model",
        "JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id",
        "LEFT JOIN student_model_finalizations AS finalization ON finalization.student_model_version_id = model.id",
        "WHERE hypothesis.class_id = ? AND hypothesis.retired_at IS NULL AND model.superseded_at IS NULL",
        "ORDER BY model.created_at DESC",
      ].join(" "),
    )
    .all(classId) as ModelRow[];

  const targets = database
    .prepare(
      [
        "SELECT item.id, item.assignment_id, item.question_label, assignment.title AS assignment_title, problem.id AS problem_id,",
        "exercise.exercise_label, problem.domain, problem.prompt, problem.answer_format, problem.content_hash",
        "FROM assignment_items AS item",
        "JOIN assignments AS assignment ON assignment.id = item.assignment_id AND assignment.class_id = item.class_id",
        "JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
        "JOIN exercises AS exercise ON exercise.id = item.exercise_id AND exercise.assignment_id = item.assignment_id",
        "WHERE item.class_id = ? AND assignment.status = 'READY' AND assignment.archived_at IS NULL",
        "AND problem.content_hash IS NOT NULL",
        "ORDER BY assignment.created_at DESC, item.position",
      ].join(" "),
    )
    .all(classId) as Array<{
    id: string;
    assignment_id: string;
    assignment_title: string;
    exercise_label: string;
    question_label: string;
    problem_id: string;
    domain: "ALGEBRA" | "FRACTIONS";
    prompt: string;
    answer_format: string;
    content_hash: string;
  }>;

  const predictionRows = database
    .prepare(
      [
        "WITH latest_outcome AS (",
        "SELECT outcome.* FROM prediction_outcome_versions AS outcome",
        "WHERE outcome.version = (SELECT max(candidate.version) FROM prediction_outcome_versions AS candidate WHERE candidate.prediction_id = outcome.prediction_id)",
        ")",
        "SELECT prediction.id, prediction.membership_id, prediction.student_model_version_id, model.version AS model_version,",
        "hypothesis.misconception_id, prediction.rule_applied, prediction.prediction_kind, prediction.predicted_answer,",
        "prediction.consistency_snapshot, prediction.mastery_evidence_summary,",
        "prediction.correct_answer_snapshot, prediction.trace_json, prediction.confidence, prediction.abstention_reason, prediction.locked_at,",
        "item.id AS target_item_id, item.question_label, exercise.exercise_label, assignment.id AS assignment_id, assignment.title AS assignment_title, problem.prompt, problem.content_hash AS problem_content_hash,",
        "invalidation.reason AS invalidation_reason, invalidation.note AS invalidation_note, invalidation.invalidated_at,",
        "outcome.actual_answer_snapshot, outcome.match_state, outcome.observed_at, outcome.evaluated_at",
        "FROM predictions AS prediction",
        "JOIN student_model_versions AS model ON model.id = prediction.student_model_version_id",
        "JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id",
        "JOIN assignment_items AS item ON item.id = prediction.target_assignment_item_id",
        "JOIN assignments AS assignment ON assignment.id = item.assignment_id",
        "JOIN exercises AS exercise ON exercise.id = item.exercise_id AND exercise.assignment_id = item.assignment_id",
        "JOIN problems AS problem ON problem.id = prediction.problem_id",
        "LEFT JOIN prediction_invalidations AS invalidation ON invalidation.prediction_id = prediction.id",
        "LEFT JOIN latest_outcome AS outcome ON outcome.prediction_id = prediction.id",
        "WHERE prediction.class_id = ? ORDER BY prediction.locked_at DESC, prediction.id DESC",
      ].join(" "),
    )
    .all(classId) as Array<{
    id: string;
    membership_id: string;
    student_model_version_id: string;
    model_version: number;
    misconception_id: MisconceptionId;
    rule_applied: 0 | 1;
    prediction_kind: "FLAWED_RULE_APPLIES" | "MASTERY" | "ABSTAIN" | null;
    predicted_answer: string | null;
    correct_answer_snapshot: string;
    trace_json: string;
    confidence: number;
    consistency_snapshot: number | null;
    mastery_evidence_summary: string | null;
    abstention_reason: string | null;
    locked_at: string;
    target_item_id: string;
    assignment_id: string;
    assignment_title: string;
    exercise_label: string;
    question_label: string;
    prompt: string;
    problem_content_hash: string;
    invalidation_reason: string | null;
    invalidation_note: string | null;
    invalidated_at: string | null;
    actual_answer_snapshot: string | null;
    match_state: "MATCH" | "MISMATCH" | "AMBIGUOUS" | "UNEVALUABLE" | null;
    observed_at: string | null;
    evaluated_at: string | null;
  }>;

  const revisionRows = database
    .prepare(
      [
        "SELECT suggestion.id, suggestion.prediction_id, suggestion.suggestion_kind, suggestion.proposed_rule_statement,",
        "suggestion.proposed_application_rate, suggestion.rationale, suggestion.evidence_connection, suggestion.created_at,",
        "decision.action, decision.note, decision.resulting_model_version_id, decision.created_at AS decided_at",
        "FROM student_model_revision_suggestions AS suggestion",
        "LEFT JOIN student_model_revision_decisions AS decision ON decision.suggestion_id = suggestion.id",
        "WHERE suggestion.class_id = ? ORDER BY suggestion.created_at DESC",
      ].join(" "),
    )
    .all(classId) as Array<{
    id: string;
    prediction_id: string;
    suggestion_kind: "REVISE_RULE" | "DOWNGRADE_CONSISTENCY";
    proposed_rule_statement: string | null;
    proposed_application_rate: number | null;
    rationale: string;
    evidence_connection: string;
    created_at: string;
    action: "CONFIRM" | "DISMISS" | null;
    note: string | null;
    resulting_model_version_id: string | null;
    decided_at: string | null;
  }>;

  const metricRows = database
    .prepare("SELECT * FROM student_prediction_metrics")
    .all() as Array<{
    membership_id: string;
    total_predictions: number;
    valid_predictions: number;
    invalidated_predictions: number;
    attempted_predictions: number;
    observed_predictions: number;
    scorable_predictions: number;
    matched_predictions: number;
    prediction_accuracy: number | null;
    flawed_rule_predictions: number;
    mastery_predictions: number;
    abstentions: number;
    expected_flawed_matches: number;
    flawed_scorable_predictions: number;
    flawed_matched_predictions: number;
  }>;

  return {
    classRecord: {
      id: classRecord.id,
      name: classRecord.name,
      gradeBand: classRecord.grade_band,
    },
    rows: memberships.map((membership) => {
      const studentModels = models
        .filter((model) => model.membership_id === membership.id)
        .map((model) => {
          const eligibleTargets = targets.filter((target) => {
            if (target.domain !== model.domain || model.status !== "SUPPORTED") {
              return false;
            }
            const seen = database
              .prepare(
                [
                  "SELECT 1 FROM submissions AS submission",
                  "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
                  "JOIN assignment_items AS answered_item ON answered_item.id = answer.assignment_item_id",
                  "JOIN problems AS answered_problem ON answered_problem.id = answered_item.problem_id",
                  "JOIN problems AS target_problem ON target_problem.id = ?",
                  "WHERE submission.membership_id = ?",
                  "AND (answered_problem.id = target_problem.id OR answered_problem.content_hash = target_problem.content_hash)",
                  "LIMIT 1",
                ].join(" "),
              )
              .get(target.problem_id, membership.id);
            const alreadyPredicted = predictionRows.some(
              (prediction) =>
                prediction.membership_id === membership.id &&
                (prediction.target_item_id === target.id ||
                  prediction.problem_content_hash === target.content_hash),
            );
            return !seen && !alreadyPredicted;
          });
          const taxonomy = MISCONCEPTION_BY_ID.get(model.misconception_id);
          return {
            id: model.id,
            version: model.version,
            status: model.status,
            ruleStatement: model.rule_statement,
            confidence: model.confidence,
            observedApplicationCount: model.observed_application_count,
            observedOpportunityCount: model.observed_opportunity_count,
            observedApplicationRate: model.observed_application_rate,
            masteryEvidenceCount: model.mastery_evidence_count,
            domain: model.domain,
            misconceptionId: model.misconception_id,
            misconceptionLabel: taxonomy?.label ?? model.misconception_id,
            supportCount: model.support_count,
            distinctSupportContent: model.distinct_support_content,
            finalizedAt: model.finalized_at,
            createdAt: model.created_at,
            eligibleTargets: eligibleTargets.map((target) => ({
              id: target.id,
              assignmentId: target.assignment_id,
              assignmentTitle: target.assignment_title,
              questionReference: exerciseQuestionReference(
                target.exercise_label,
                target.question_label,
              ),
              prompt: target.prompt,
              answerFormat: target.answer_format,
            })),
          };
        });
      const metric = metricRows.find(
        (candidate) => candidate.membership_id === membership.id,
      );
      return {
        membershipId: membership.id,
        studentName: membership.display_name,
        candidates: candidates
          .filter((candidate) => candidate.membership_id === membership.id)
          .map((candidate) => {
            const taxonomy = MISCONCEPTION_BY_ID.get(candidate.misconception_id);
            return {
              assignmentId: candidate.assignment_id,
              misconceptionId: candidate.misconception_id,
              misconceptionLabel: taxonomy?.label ?? candidate.misconception_id,
              evidenceCount: candidate.evidence_count,
              distinctProblemCount: candidate.distinct_problem_count,
              confidence: candidate.confidence,
              hasCurrentModel: studentModels.some(
                (model) => model.misconceptionId === candidate.misconception_id,
              ),
            };
          }),
        models: studentModels,
        predictions: predictionRows
          .filter((prediction) => prediction.membership_id === membership.id)
          .map((prediction) => ({
            id: prediction.id,
            modelVersionId: prediction.student_model_version_id,
            modelVersion: prediction.model_version,
            misconceptionId: prediction.misconception_id,
            problemPrompt: prediction.prompt,
            assignmentId: prediction.assignment_id,
            assignmentTitle: prediction.assignment_title,
            questionReference: exerciseQuestionReference(
              prediction.exercise_label,
              prediction.question_label,
            ),
            targetAssignmentItemId: prediction.target_item_id,
            ruleApplied:
              effectivePredictionKind({
                predictionKind: prediction.prediction_kind,
                ruleApplied: prediction.rule_applied === 1,
              }) === "FLAWED_RULE_APPLIES",
            predictionKind: effectivePredictionKind({
              predictionKind: prediction.prediction_kind,
              ruleApplied: prediction.rule_applied === 1,
            }) as "FLAWED_RULE_APPLIES" | "MASTERY" | "ABSTAIN",
            predictedAnswer: prediction.predicted_answer,
            correctAnswer: prediction.correct_answer_snapshot,
            confidence: prediction.confidence,
            consistencySnapshot: prediction.consistency_snapshot,
            masteryEvidenceSummary: prediction.mastery_evidence_summary,
            abstentionReason: prediction.abstention_reason,
            trace: parseJsonObject(prediction.trace_json),
            lockedAt: prediction.locked_at,
            invalidation: prediction.invalidation_reason
              ? {
                  reason: prediction.invalidation_reason,
                  note: prediction.invalidation_note,
                  invalidatedAt: prediction.invalidated_at as string,
                }
              : null,
            outcome: prediction.match_state
              ? {
                  actualAnswer: prediction.actual_answer_snapshot as string,
                  matchState: prediction.match_state,
                  observedAt: prediction.observed_at as string,
                  evaluatedAt: prediction.evaluated_at as string,
                }
              : null,
            revisionSuggestion: (() => {
              const suggestion = revisionRows.find(
                (candidate) => candidate.prediction_id === prediction.id,
              );
              return suggestion
                ? {
                    id: suggestion.id,
                    kind: suggestion.suggestion_kind,
                    proposedRuleStatement: suggestion.proposed_rule_statement,
                    proposedApplicationRate:
                      suggestion.proposed_application_rate,
                    rationale: suggestion.rationale,
                    evidenceConnection: suggestion.evidence_connection,
                    createdAt: suggestion.created_at,
                    decision: suggestion.action
                      ? {
                          action: suggestion.action,
                          note: suggestion.note,
                          resultingModelVersionId:
                            suggestion.resulting_model_version_id,
                          decidedAt: suggestion.decided_at as string,
                        }
                      : null,
                  }
                : null;
            })(),
          })),
        metrics: metric
          ? {
              total: metric.total_predictions,
              valid: metric.valid_predictions,
              invalidated: metric.invalidated_predictions,
              attempted: metric.attempted_predictions,
              observed: metric.observed_predictions,
              scorable: metric.scorable_predictions,
              matched: metric.matched_predictions,
              accuracy: metric.prediction_accuracy,
              flawedRule: metric.flawed_rule_predictions,
              mastery: metric.mastery_predictions,
              abstentions: metric.abstentions,
              expectedFlawedMatches: metric.expected_flawed_matches,
              flawedScorable: metric.flawed_scorable_predictions,
              flawedMatched: metric.flawed_matched_predictions,
            }
          : {
              total: 0,
              valid: 0,
              invalidated: 0,
              attempted: 0,
              observed: 0,
              scorable: 0,
              matched: 0,
              accuracy: null,
              flawedRule: 0,
              mastery: 0,
              abstentions: 0,
              expectedFlawedMatches: 0,
              flawedScorable: 0,
              flawedMatched: 0,
            },
      };
    }),
  };
}

export function synchronizePredictionOutcomesForClass(classIdInput: string) {
  const classId = idSchema.parse(classIdInput);
  const database = getDatabase();
  const predictionRows = database
    .prepare(
      [
        "SELECT prediction.id, prediction.target_assignment_item_id, prediction.membership_id,",
        "prediction.canonical_predicted_answer, prediction.correct_answer_snapshot",
        "FROM predictions AS prediction",
        "LEFT JOIN prediction_invalidations AS invalidation ON invalidation.prediction_id = prediction.id",
        "WHERE prediction.class_id = ? AND prediction.rule_applied = 1",
        "AND invalidation.prediction_id IS NULL",
      ].join(" "),
    )
    .all(classId) as Array<{
    id: string;
    target_assignment_item_id: string;
    membership_id: string;
    canonical_predicted_answer: string;
    correct_answer_snapshot: string;
  }>;
  let created = 0;

  database.transaction(() => {
    for (const prediction of predictionRows) {
      const targetWork = database
        .prepare(
          [
            "SELECT submission.id AS submission_id, submission.input_kind, answer.id AS answer_id, submission.submitted_at",
            "FROM submissions AS submission",
            "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
            "JOIN predictions AS prediction ON prediction.id = ?",
            "WHERE submission.membership_id = prediction.membership_id",
            "AND answer.assignment_item_id = prediction.target_assignment_item_id",
            "AND julianday(submission.submitted_at) > julianday(prediction.locked_at)",
            "AND submission.id = (",
            "SELECT first_submission.id FROM submissions AS first_submission",
            "JOIN submission_answers AS first_answer ON first_answer.submission_id = first_submission.id",
            "WHERE first_submission.membership_id = prediction.membership_id",
            "AND first_answer.assignment_item_id = prediction.target_assignment_item_id",
            "AND julianday(first_submission.submitted_at) > julianday(prediction.locked_at)",
            "ORDER BY first_submission.submitted_at, first_submission.id LIMIT 1",
            ") LIMIT 1",
          ].join(" "),
        )
        .get(prediction.id) as
        | {
            submission_id: string;
            input_kind: "IMAGE" | "TYPED" | "CSV";
            answer_id: string;
            submitted_at: string;
          }
        | undefined;
      if (!targetWork) continue;

      const diagnosis = database
        .prepare(
          [
            "SELECT diagnosis.id, diagnosis.outcome, diagnosis.transcription, diagnosis.transcription_confidence",
            "FROM diagnoses AS diagnosis",
            "JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id",
            "WHERE answer_version.submission_answer_id = ?",
            "AND diagnosis.outcome IN ('CORRECT', 'MISCONCEPTION')",
            "ORDER BY diagnosis.created_at DESC, diagnosis.version DESC, diagnosis.id DESC LIMIT 1",
          ].join(" "),
        )
        .get(targetWork.answer_id) as
        | {
            id: string;
            outcome: "CORRECT" | "MISCONCEPTION";
            transcription: string;
            transcription_confidence: number;
          }
        | undefined;
      if (!diagnosis) continue;

      const steps = database
        .prepare(
          "SELECT step_text AS step, step_kind AS stepKind FROM diagnosis_steps WHERE diagnosis_id = ? ORDER BY position",
        )
        .all(diagnosis.id) as Array<{ step: string; stepKind: string }>;
      let actual = database
        .prepare(
          [
            "SELECT id, version, response_text, normalized_answer, source",
            "FROM answer_versions WHERE submission_answer_id = ?",
            "ORDER BY version DESC LIMIT 1",
          ].join(" "),
        )
        .get(targetWork.answer_id) as
        | {
            id: string;
            version: number;
            response_text: string;
            normalized_answer: string | null;
            source:
              | "IMAGE_TRANSCRIPTION"
              | "TYPED"
              | "CSV"
              | "TEACHER_CORRECTION"
              | "SEED";
          }
        | undefined;
      if (!actual) continue;

      if (actual.source !== "TEACHER_CORRECTION") {
        const extracted = extractStudentFinalAnswer({
          steps,
          transcription: diagnosis.transcription,
          fallback: actual.response_text,
          correctAnswer: prediction.correct_answer_snapshot,
        });
        if (
          extracted &&
          (actual.response_text !== extracted.display ||
            actual.normalized_answer !== extracted.canonical)
        ) {
          const correctedId = randomUUID();
          const source =
            targetWork.input_kind === "IMAGE"
              ? "IMAGE_TRANSCRIPTION"
              : targetWork.input_kind === "CSV"
                ? "CSV"
                : "TYPED";
          database
            .prepare(
              [
                "INSERT INTO answer_versions",
                "(id, submission_answer_id, version, response_text, normalized_answer, source, confidence, creator_type, change_reason)",
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'SYSTEM', ?)",
              ].join(" "),
            )
            .run(
              correctedId,
              targetWork.answer_id,
              actual.version + 1,
              extracted.display,
              extracted.canonical,
              source,
              diagnosis.transcription_confidence,
              "Prediction reconciliation extracted the grounded final student answer without using the answer key as content.",
            );
          actual = {
            id: correctedId,
            version: actual.version + 1,
            response_text: extracted.display,
            normalized_answer: extracted.canonical,
            source,
          };
        }
      }
      if (actual.normalized_answer === null) continue;
      const latest = database
        .prepare(
          "SELECT version, answer_version_id FROM prediction_outcome_versions WHERE prediction_id = ? ORDER BY version DESC LIMIT 1",
        )
        .get(prediction.id) as
        | { version: number; answer_version_id: string | null }
        | undefined;
      if (latest?.answer_version_id === actual.id) continue;
      const evaluatedAt = new Date().toISOString();
      const matchState =
        prediction.canonical_predicted_answer === actual.normalized_answer
          ? "MATCH"
          : "MISMATCH";
      database
        .prepare(
          [
            "INSERT INTO prediction_outcome_versions",
            "(id, prediction_id, version, answer_version_id, actual_answer_snapshot, canonical_actual_answer,",
            "match_state, evaluation_method, confidence, observed_at, evaluated_at, created_at)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'DETERMINISTIC', 1, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          randomUUID(),
          prediction.id,
          (latest?.version ?? 0) + 1,
          actual.id,
          actual.response_text,
          actual.normalized_answer,
          matchState,
          targetWork.submitted_at,
          evaluatedAt,
          evaluatedAt,
        );
      created += 1;
    }
  })();

  return { created };
}

export type RevisionSuggestionContext = {
  classId: string;
  membershipId: string;
  modelVersionId: string;
  modelVersion: number;
  domain: "ALGEBRA" | "FRACTIONS";
  misconceptionId: MisconceptionId;
  misconceptionLabel: string;
  ruleStatement: string;
  formalPattern: Record<string, string>;
  scopeLimits: string[];
  observedApplicationCount: number | null;
  observedOpportunityCount: number | null;
  observedApplicationRate: number | null;
  predictionId: string;
  predictionKind: "FLAWED_RULE_APPLIES" | "MASTERY" | "ABSTAIN";
  problemPrompt: string;
  predictedAnswer: string;
  actualAnswer: string;
  correctAnswer: string;
  diagnosisId: string;
  diagnosisOutcome: "CORRECT" | "MISCONCEPTION";
  observedTransformation: string | null;
  evidenceQuote: string | null;
};

export function listUnsuggestedPredictionMismatches(
  classIdInput: string,
): RevisionSuggestionContext[] {
  const classId = idSchema.parse(classIdInput);
  const rows = getDatabase()
    .prepare(
      [
        "WITH latest_outcome AS (",
        "SELECT outcome.* FROM prediction_outcome_versions AS outcome",
        "WHERE outcome.version = (SELECT max(candidate.version) FROM prediction_outcome_versions AS candidate WHERE candidate.prediction_id = outcome.prediction_id)",
        ")",
        "SELECT prediction.class_id, prediction.membership_id, prediction.id AS prediction_id,",
        "prediction.prediction_kind, prediction.rule_applied, prediction.predicted_answer, prediction.correct_answer_snapshot,",
        "model.id AS model_id, model.version AS model_version, model.rule_statement, model.formal_pattern_json, model.scope_limits_json,",
        "model.observed_application_count, model.observed_opportunity_count, model.observed_application_rate,",
        "hypothesis.domain, hypothesis.misconception_id, problem.prompt, outcome.actual_answer_snapshot,",
        "diagnosis.id AS diagnosis_id, diagnosis.outcome AS diagnosis_outcome, diagnosis.observed_transformation, diagnosis.evidence_quote",
        "FROM predictions AS prediction",
        "JOIN latest_outcome AS outcome ON outcome.prediction_id = prediction.id AND outcome.match_state = 'MISMATCH'",
        "JOIN answer_versions AS outcome_answer_version ON outcome_answer_version.id = outcome.answer_version_id",
        "JOIN answer_versions AS diagnosed_answer_version ON diagnosed_answer_version.submission_answer_id = outcome_answer_version.submission_answer_id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = diagnosed_answer_version.id",
        "JOIN student_model_versions AS model ON model.id = prediction.student_model_version_id",
        "JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id",
        "JOIN problems AS problem ON problem.id = prediction.problem_id",
        "LEFT JOIN prediction_invalidations AS invalidation ON invalidation.prediction_id = prediction.id",
        "LEFT JOIN student_model_revision_suggestions AS suggestion ON suggestion.prediction_id = prediction.id",
        "WHERE prediction.class_id = ? AND invalidation.prediction_id IS NULL AND suggestion.id IS NULL",
        "AND diagnosis.id = (",
        "SELECT latest_diagnosis.id FROM diagnoses AS latest_diagnosis",
        "JOIN answer_versions AS latest_answer_version ON latest_answer_version.id = latest_diagnosis.answer_version_id",
        "WHERE latest_answer_version.submission_answer_id = outcome_answer_version.submission_answer_id",
        "ORDER BY latest_diagnosis.created_at DESC, latest_diagnosis.version DESC, latest_diagnosis.id DESC LIMIT 1",
        ") ORDER BY outcome.evaluated_at, prediction.id",
      ].join(" "),
    )
    .all(classId) as Array<{
    class_id: string;
    membership_id: string;
    prediction_id: string;
    prediction_kind: "FLAWED_RULE_APPLIES" | "MASTERY" | "ABSTAIN" | null;
    rule_applied: 0 | 1;
    predicted_answer: string;
    correct_answer_snapshot: string;
    model_id: string;
    model_version: number;
    rule_statement: string;
    formal_pattern_json: string;
    scope_limits_json: string;
    observed_application_count: number | null;
    observed_opportunity_count: number | null;
    observed_application_rate: number | null;
    domain: "ALGEBRA" | "FRACTIONS";
    misconception_id: MisconceptionId;
    prompt: string;
    actual_answer_snapshot: string;
    diagnosis_id: string;
    diagnosis_outcome: "CORRECT" | "MISCONCEPTION";
    observed_transformation: string | null;
    evidence_quote: string | null;
  }>;
  return rows.map((row) => ({
    classId: row.class_id,
    membershipId: row.membership_id,
    modelVersionId: row.model_id,
    modelVersion: row.model_version,
    domain: row.domain,
    misconceptionId: row.misconception_id,
    misconceptionLabel:
      MISCONCEPTION_BY_ID.get(row.misconception_id)?.label ?? row.misconception_id,
    ruleStatement: row.rule_statement,
    formalPattern: parseJsonObject(row.formal_pattern_json),
    scopeLimits: parseStringArray(row.scope_limits_json),
    observedApplicationCount: row.observed_application_count,
    observedOpportunityCount: row.observed_opportunity_count,
    observedApplicationRate: row.observed_application_rate,
    predictionId: row.prediction_id,
    predictionKind: effectivePredictionKind({
      predictionKind: row.prediction_kind,
      ruleApplied: row.rule_applied === 1,
    }) as "FLAWED_RULE_APPLIES" | "MASTERY" | "ABSTAIN",
    problemPrompt: row.prompt,
    predictedAnswer: row.predicted_answer,
    actualAnswer: row.actual_answer_snapshot,
    correctAnswer: row.correct_answer_snapshot,
    diagnosisId: row.diagnosis_id,
    diagnosisOutcome: row.diagnosis_outcome,
    observedTransformation: row.observed_transformation,
    evidenceQuote: row.evidence_quote,
  }));
}

type RevisionSuggestionResult = {
  suggestionKind: "REVISE_RULE" | "DOWNGRADE_CONSISTENCY";
  proposedRuleStatement: string | null;
  proposedFormalPattern: Record<string, string> | null;
  proposedScopeLimits: string[] | null;
  proposedApplicationRate: number | null;
  rationale: string;
  evidenceConnection: string;
};

type RevisionSuggestionRun = Omit<PredictionRun, "result"> & {
  result: RevisionSuggestionResult;
};

export function fallbackConsistencyRevision(
  context: RevisionSuggestionContext,
): RevisionSuggestionResult {
  const applicationCount = context.observedApplicationCount ?? 0;
  const opportunityCount = context.observedOpportunityCount ?? 0;
  const rate = applicationCount / (opportunityCount + 1);
  return {
    suggestionKind: "DOWNGRADE_CONSISTENCY",
    proposedRuleStatement: null,
    proposedFormalPattern: null,
    proposedScopeLimits: null,
    proposedApplicationRate: rate,
    rationale:
      "Keep the observable rule hypothesis, but lower its expected application rate because the later work did not match the locked prediction.",
    evidenceConnection: `The model predicted ${context.predictedAnswer}; the later response was ${context.actualAnswer}.`,
  };
}

export function persistRevisionSuggestion(input: {
  context: RevisionSuggestionContext;
  result: RevisionSuggestionResult;
  run: RevisionSuggestionRun | null;
}) {
  const database = getDatabase();
  const suggestionId = randomUUID();
  const runId = input.run ? randomUUID() : null;
  const createdAt = new Date().toISOString();
  database.transaction(() => {
    if (input.run && runId) {
      database
        .prepare(
          [
            "INSERT INTO ai_runs",
            "(id, class_id, purpose, status, model_name, prompt_version, schema_version, input_hash, output_hash,",
            "openai_response_id, input_tokens, output_tokens, latency_ms, started_at, completed_at)",
            "VALUES (?, ?, 'STUDENT_MODEL', 'SUCCEEDED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          runId,
          input.context.classId,
          input.run.modelName,
          input.run.promptVersion,
          input.run.schemaVersion,
          input.run.inputHash,
          input.run.outputHash,
          input.run.responseId,
          input.run.inputTokens,
          input.run.outputTokens,
          input.run.latencyMs,
          createdAt,
          createdAt,
        );
    }
    database
      .prepare(
        [
          "INSERT INTO student_model_revision_suggestions",
          "(id, class_id, membership_id, student_model_version_id, prediction_id, contradicting_diagnosis_id,",
          "suggestion_kind, proposed_rule_statement, proposed_formal_pattern_json, proposed_scope_limits_json, proposed_application_rate,",
          "rationale, evidence_connection, ai_run_id, model_name, prompt_version, schema_version, created_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        suggestionId,
        input.context.classId,
        input.context.membershipId,
        input.context.modelVersionId,
        input.context.predictionId,
        input.context.diagnosisId,
        input.result.suggestionKind,
        input.result.proposedRuleStatement,
        input.result.proposedFormalPattern
          ? JSON.stringify(input.result.proposedFormalPattern)
          : null,
        input.result.proposedScopeLimits
          ? JSON.stringify(input.result.proposedScopeLimits)
          : null,
        input.result.proposedApplicationRate,
        input.result.rationale,
        input.result.evidenceConnection,
        runId,
        input.run?.modelName ?? null,
        input.run?.promptVersion ?? null,
        input.run?.schemaVersion ?? null,
        createdAt,
      );
  })();
  return { id: suggestionId };
}

export function decideRevisionSuggestion(input: {
  suggestionId: string;
  action: "CONFIRM" | "DISMISS";
  note: string | null;
}) {
  const suggestionId = idSchema.parse(input.suggestionId);
  const database = getDatabase();
  const suggestion = database
    .prepare(
      [
        "SELECT suggestion.*, model.hypothesis_id, model.version, model.rule_statement, model.formal_pattern_json,",
        "model.scope_limits_json, model.confidence, model.observed_application_count, model.observed_opportunity_count,",
        "model.observed_application_rate, model.mastery_evidence_count, model.superseded_at,",
        "prediction.prediction_kind, prediction.rule_applied, problem.prompt, diagnosis.outcome AS diagnosis_outcome",
        "FROM student_model_revision_suggestions AS suggestion",
        "JOIN student_model_versions AS model ON model.id = suggestion.student_model_version_id",
        "JOIN predictions AS prediction ON prediction.id = suggestion.prediction_id",
        "JOIN problems AS problem ON problem.id = prediction.problem_id",
        "JOIN diagnoses AS diagnosis ON diagnosis.id = suggestion.contradicting_diagnosis_id",
        "WHERE suggestion.id = ?",
      ].join(" "),
    )
    .get(suggestionId) as
    | {
        id: string;
        class_id: string;
        membership_id: string;
        student_model_version_id: string;
        contradicting_diagnosis_id: string;
        suggestion_kind: "REVISE_RULE" | "DOWNGRADE_CONSISTENCY";
        proposed_rule_statement: string | null;
        proposed_formal_pattern_json: string | null;
        proposed_scope_limits_json: string | null;
        proposed_application_rate: number | null;
        ai_run_id: string | null;
        model_name: string | null;
        prompt_version: string | null;
        schema_version: string | null;
        hypothesis_id: string;
        version: number;
        rule_statement: string;
        formal_pattern_json: string;
        scope_limits_json: string;
        confidence: number;
        observed_application_count: number | null;
        observed_opportunity_count: number | null;
        observed_application_rate: number | null;
        mastery_evidence_count: number | null;
        superseded_at: string | null;
        prediction_kind: "FLAWED_RULE_APPLIES" | "MASTERY" | "ABSTAIN" | null;
        rule_applied: 0 | 1;
        prompt: string;
        diagnosis_outcome: "CORRECT" | "MISCONCEPTION";
      }
    | undefined;
  if (!suggestion) {
    throw new PredictionRepositoryError(
      "REVISION_NOT_FOUND",
      "That revision suggestion is no longer available.",
    );
  }
  if (
    database
      .prepare("SELECT 1 FROM student_model_revision_decisions WHERE suggestion_id = ?")
      .get(suggestionId)
  ) {
    throw new PredictionRepositoryError(
      "REVISION_ALREADY_DECIDED",
      "That revision suggestion has already been decided.",
    );
  }
  if (input.action === "DISMISS") {
    database
      .prepare(
        "INSERT INTO student_model_revision_decisions (id, suggestion_id, action, note) VALUES (?, ?, 'DISMISS', ?)",
      )
      .run(randomUUID(), suggestionId, input.note);
    return { action: input.action, modelVersionId: null };
  }
  if (suggestion.superseded_at !== null) {
    throw new PredictionRepositoryError(
      "REVISION_MODEL_CHANGED",
      "The Student Model changed before this suggestion was confirmed.",
    );
  }

  const modelVersionId = randomUUID();
  const createdAt = new Date().toISOString();
  const effectiveKind = effectivePredictionKind({
    predictionKind: suggestion.prediction_kind,
    ruleApplied: suggestion.rule_applied === 1,
  });
  const oldOpportunity = database
    .prepare(
      [
        "SELECT count(*) AS opportunity_count,",
        "sum(CASE WHEN application_state = 'APPLIED_RULE' THEN 1 ELSE 0 END) AS application_count",
        "FROM student_model_opportunities WHERE student_model_version_id = ?",
      ].join(" "),
    )
    .get(suggestion.student_model_version_id) as {
    opportunity_count: number;
    application_count: number | null;
  };
  const addsOpportunity = effectiveKind === "FLAWED_RULE_APPLIES";
  const opportunityCount = oldOpportunity.opportunity_count
    ? oldOpportunity.opportunity_count + (addsOpportunity ? 1 : 0)
    : suggestion.observed_opportunity_count === null
      ? null
      : suggestion.observed_opportunity_count + (addsOpportunity ? 1 : 0);
  const applicationCount = oldOpportunity.opportunity_count
    ? (oldOpportunity.application_count ?? 0)
    : suggestion.observed_application_count;
  const applicationRate =
    opportunityCount && applicationCount !== null
      ? applicationCount / opportunityCount
      : null;
  const ruleStatement =
    suggestion.suggestion_kind === "REVISE_RULE"
      ? (suggestion.proposed_rule_statement as string)
      : suggestion.rule_statement;
  const formalPattern =
    suggestion.suggestion_kind === "REVISE_RULE"
      ? (suggestion.proposed_formal_pattern_json as string)
      : suggestion.formal_pattern_json;
  const scopeLimits =
    suggestion.suggestion_kind === "REVISE_RULE"
      ? (suggestion.proposed_scope_limits_json as string)
      : suggestion.scope_limits_json;

  database.transaction(() => {
    const superseded = database
      .prepare(
        "UPDATE student_model_versions SET superseded_at = ? WHERE id = ? AND superseded_at IS NULL",
      )
      .run(createdAt, suggestion.student_model_version_id);
    if (superseded.changes !== 1) {
      throw new PredictionRepositoryError(
        "REVISION_MODEL_CHANGED",
        "The Student Model changed before this suggestion was confirmed.",
      );
    }
    database
      .prepare(
        [
          "INSERT INTO student_model_versions",
          "(id, hypothesis_id, version, status, rule_statement, formal_pattern_json, scope_limits_json, confidence,",
          "support_count, contradiction_count, observed_application_count, observed_opportunity_count, observed_application_rate, mastery_evidence_count,",
          "ai_run_id, model_name, prompt_version, schema_version, created_at)",
          "VALUES (?, ?, ?, 'PROVISIONAL', ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        modelVersionId,
        suggestion.hypothesis_id,
        suggestion.version + 1,
        ruleStatement,
        formalPattern,
        scopeLimits,
        suggestion.confidence,
        applicationCount,
        opportunityCount,
        applicationRate,
        suggestion.mastery_evidence_count,
        suggestion.ai_run_id,
        suggestion.model_name,
        suggestion.prompt_version,
        suggestion.schema_version,
        createdAt,
      );
    database
      .prepare(
        [
          "INSERT INTO student_model_evidence (student_model_version_id, diagnosis_id, role, weight, rationale)",
          "SELECT ?, diagnosis_id, role, weight, 'Retained for teacher-confirmed revision: ' || rationale",
          "FROM student_model_evidence WHERE student_model_version_id = ?",
        ].join(" "),
      )
      .run(modelVersionId, suggestion.student_model_version_id);
    database
      .prepare(
        [
          "INSERT INTO student_model_opportunities (student_model_version_id, diagnosis_id, application_state, rationale)",
          "SELECT ?, diagnosis_id, application_state, 'Retained for teacher-confirmed revision: ' || rationale",
          "FROM student_model_opportunities WHERE student_model_version_id = ?",
        ].join(" "),
      )
      .run(modelVersionId, suggestion.student_model_version_id);
    database
      .prepare(
        [
          "INSERT INTO student_model_mastery_evidence (student_model_version_id, diagnosis_id, skill_key, rationale)",
          "SELECT ?, diagnosis_id, skill_key, 'Retained for teacher-confirmed revision: ' || rationale",
          "FROM student_model_mastery_evidence WHERE student_model_version_id = ?",
        ].join(" "),
      )
      .run(modelVersionId, suggestion.student_model_version_id);
    if (addsOpportunity) {
      database
        .prepare(
          [
            "INSERT OR IGNORE INTO student_model_opportunities",
            "(student_model_version_id, diagnosis_id, application_state, rationale)",
            "VALUES (?, ?, 'DID_NOT_APPLY', ?)",
          ].join(" "),
        )
        .run(
          modelVersionId,
          suggestion.contradicting_diagnosis_id,
          "The teacher-confirmed revision includes the later outcome that contradicted the locked flawed-rule prediction.",
        );
    }
    if (suggestion.diagnosis_outcome === "CORRECT") {
      database
        .prepare(
          [
            "INSERT OR IGNORE INTO student_model_mastery_evidence",
            "(student_model_version_id, diagnosis_id, skill_key, rationale)",
            "VALUES (?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          modelVersionId,
          suggestion.contradicting_diagnosis_id,
          mathematicalSkillKey(suggestion.prompt),
          "The later response demonstrated correct reasoning on the prediction target.",
        );
    }
    database
      .prepare(
        [
          "INSERT INTO student_model_revision_decisions",
          "(id, suggestion_id, action, note, resulting_model_version_id, created_at)",
          "VALUES (?, ?, 'CONFIRM', ?, ?, ?)",
        ].join(" "),
      )
      .run(randomUUID(), suggestionId, input.note, modelVersionId, createdAt);
  })();
  return { action: input.action, modelVersionId };
}
