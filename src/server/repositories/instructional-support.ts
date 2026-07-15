import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import {
  MISCONCEPTION_BY_ID,
  misconceptionIdSchema,
} from "@/domain/misconception-taxonomy.mjs";
import { getDatabase } from "@/lib/db";

const idSchema = z.string().uuid();
const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

type MisconceptionId = z.infer<typeof misconceptionIdSchema>;

type GenerationRun<Result> = {
  result: Result;
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

type StudentModelResult = {
  ruleStatement: string;
  formalPattern: Record<string, string>;
  scopeLimits: string[];
  confidence: number;
  evidenceConnection: string;
};

type PracticeResult = {
  title: string;
  rationale: string;
  items: Array<{
    position: number;
    difficulty: number;
    problemPrompt: string;
    answerFormat:
      | "EXPRESSION"
      | "NUMBER"
      | "FRACTION"
      | "MULTIPLE_CHOICE"
      | "SHORT_TEXT";
    correctAnswer: string;
    misconceptionPredictedAnswer: string;
    hint: string;
    explanation: string;
    discrepantEventRationale: string;
  }>;
};

type BriefResult = {
  paragraph: string;
  workedExample: {
    problemPrompt: string;
    correctAnswer: string;
  };
};

type DiagnosisContextRow = {
  diagnosis_id: string;
  class_id: string;
  assignment_id: string;
  membership_id: string;
  domain: "ALGEBRA" | "FRACTIONS";
  taxonomy_version: string;
  misconception_id: MisconceptionId;
  confidence: number;
  transcription: string;
  observed_transformation: string | null;
  evidence_quote: string;
  problem_prompt: string;
  correct_answer: string;
};

export type StudentModelRecord = {
  id: string;
  hypothesisId: string;
  version: number;
  status: "PROVISIONAL" | "SUPPORTED";
  ruleStatement: string;
  formalPattern: Record<string, string>;
  scopeLimits: string[];
  confidence: number;
  taxonomyVersion: string;
  misconceptionId: MisconceptionId;
  createdAt: string;
};

export class InstructionalRepositoryError extends Error {
  readonly code:
    | "ASSIGNMENT_NOT_FOUND"
    | "DIAGNOSIS_NOT_FOUND"
    | "MODEL_UNAVAILABLE"
    | "NO_CLUSTER"
    | "WORKSHEET_NOT_FOUND"
    | "PERSISTENCE_ERROR";

  constructor(
    code: InstructionalRepositoryError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InstructionalRepositoryError";
    this.code = code;
  }
}

function contentHash(domain: string, prompt: string) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        domain,
        prompt: prompt.normalize("NFKC").trim().replace(/\s+/gu, " "),
      }),
    )
    .digest("hex");
}

function canonicalAnswer(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function requireAssignment(assignmentId: string) {
  const id = idSchema.parse(assignmentId);
  const assignment = getDatabase()
    .prepare(
      [
        "SELECT id, class_id, domain FROM assignments",
        "WHERE id = ? AND status = 'READY' AND archived_at IS NULL",
      ].join(" "),
    )
    .get(id) as
    | {
        id: string;
        class_id: string;
        domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
      }
    | undefined;
  if (!assignment) {
    throw new InstructionalRepositoryError(
      "ASSIGNMENT_NOT_FOUND",
      "That assignment is not ready for instructional support.",
    );
  }
  return assignment;
}

export function getPracticeDiagnosisContext(input: {
  assignmentId: string;
  membershipId: string;
  misconceptionId: MisconceptionId;
}) {
  const assignment = requireAssignment(input.assignmentId);
  const membershipId = idSchema.parse(input.membershipId);
  const misconceptionId = misconceptionIdSchema.parse(input.misconceptionId);
  const row = getDatabase()
    .prepare(
      [
        "SELECT diagnosis.id AS diagnosis_id, submission.class_id, submission.assignment_id, submission.membership_id,",
        "problem.domain, diagnosis.taxonomy_version, diagnosis.misconception_id, diagnosis.confidence,",
        "diagnosis.transcription, diagnosis.observed_transformation, diagnosis.evidence_quote,",
        "problem.prompt AS problem_prompt, problem.correct_answer",
        "FROM submissions AS submission",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
        "JOIN problems AS problem ON problem.id = item.problem_id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "WHERE submission.assignment_id = ? AND submission.class_id = ? AND submission.membership_id = ?",
        "AND diagnosis.outcome = 'MISCONCEPTION' AND diagnosis.misconception_id = ?",
        "AND diagnosis.id = (",
        "SELECT latest.id FROM diagnoses AS latest",
        "JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id",
        "JOIN submission_answers AS latest_answer ON latest_answer.id = latest_version.submission_answer_id",
        "WHERE latest_answer.id = answer.id",
        "ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1",
        ")",
        "ORDER BY diagnosis.severity DESC, diagnosis.confidence DESC, diagnosis.created_at DESC LIMIT 1",
      ].join(" "),
    )
    .get(
      assignment.id,
      assignment.class_id,
      membershipId,
      misconceptionId,
    ) as DiagnosisContextRow | undefined;
  if (!row || !row.evidence_quote) {
    throw new InstructionalRepositoryError(
      "DIAGNOSIS_NOT_FOUND",
      "A supported misconception diagnosis is required before generating practice.",
    );
  }
  const taxonomy = MISCONCEPTION_BY_ID.get(misconceptionId);
  if (!taxonomy || taxonomy.domain !== row.domain) {
    throw new InstructionalRepositoryError(
      "DIAGNOSIS_NOT_FOUND",
      "The diagnosis no longer matches the active taxonomy.",
    );
  }
  return { row, taxonomy };
}

function mapStudentModel(row: {
  id: string;
  hypothesis_id: string;
  version: number;
  status: "PROVISIONAL" | "SUPPORTED";
  rule_statement: string;
  formal_pattern_json: string;
  scope_limits_json: string;
  confidence: number;
  taxonomy_version: string;
  misconception_id: MisconceptionId;
  created_at: string;
}): StudentModelRecord {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    version: row.version,
    status: row.status,
    ruleStatement: row.rule_statement,
    formalPattern: JSON.parse(row.formal_pattern_json) as Record<string, string>,
    scopeLimits: JSON.parse(row.scope_limits_json) as string[],
    confidence: row.confidence,
    taxonomyVersion: row.taxonomy_version,
    misconceptionId: row.misconception_id,
    createdAt: row.created_at,
  };
}

function getStudentModelById(modelId: string) {
  const row = getDatabase()
    .prepare(
      [
        "SELECT model.id, model.hypothesis_id, model.version, model.status, model.rule_statement,",
        "model.formal_pattern_json, model.scope_limits_json, model.confidence,",
        "hypothesis.taxonomy_version, hypothesis.misconception_id, model.created_at",
        "FROM student_model_versions AS model",
        "JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id",
        "WHERE model.id = ?",
      ].join(" "),
    )
    .get(modelId) as
    | {
        id: string;
        hypothesis_id: string;
        version: number;
        status: "PROVISIONAL" | "SUPPORTED";
        rule_statement: string;
        formal_pattern_json: string;
        scope_limits_json: string;
        confidence: number;
        taxonomy_version: string;
        misconception_id: MisconceptionId;
        created_at: string;
      }
    | undefined;
  return row ? mapStudentModel(row) : null;
}

export function findReusableStudentModel(context: DiagnosisContextRow) {
  const row = getDatabase()
    .prepare(
      [
        "SELECT model.id, model.hypothesis_id, model.version, model.status, model.rule_statement,",
        "model.formal_pattern_json, model.scope_limits_json, model.confidence,",
        "hypothesis.taxonomy_version, hypothesis.misconception_id, model.created_at",
        "FROM student_model_versions AS model",
        "JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id",
        "WHERE hypothesis.class_id = ? AND hypothesis.membership_id = ?",
        "AND hypothesis.taxonomy_version = ? AND hypothesis.misconception_id = ?",
        "AND hypothesis.retired_at IS NULL AND model.superseded_at IS NULL",
        "AND model.status IN ('PROVISIONAL', 'SUPPORTED')",
        "ORDER BY model.version DESC LIMIT 1",
      ].join(" "),
    )
    .get(
      context.class_id,
      context.membership_id,
      context.taxonomy_version,
      context.misconception_id,
    ) as
    | {
        id: string;
        hypothesis_id: string;
        version: number;
        status: "PROVISIONAL" | "SUPPORTED";
        rule_statement: string;
        formal_pattern_json: string;
        scope_limits_json: string;
        confidence: number;
        taxonomy_version: string;
        misconception_id: MisconceptionId;
        created_at: string;
      }
    | undefined;
  return row ? mapStudentModel(row) : null;
}

function insertSucceededRun(input: {
  id: string;
  classId: string;
  purpose: "STUDENT_MODEL" | "PRACTICE" | "TEACHING_BRIEF";
  run: GenerationRun<unknown>;
}) {
  getDatabase()
    .prepare(
      [
        "INSERT INTO ai_runs",
        "(id, class_id, purpose, status, model_name, prompt_version, schema_version, input_hash, output_hash,",
        "openai_response_id, input_tokens, output_tokens, latency_ms, started_at, completed_at)",
        `VALUES (?, ?, ?, 'SUCCEEDED', ?, ?, ?, ?, ?, ?, ?, ?, ?, (${nowSql}), (${nowSql}))`,
      ].join(" "),
    )
    .run(
      input.id,
      input.classId,
      input.purpose,
      input.run.modelName,
      input.run.promptVersion,
      input.run.schemaVersion,
      input.run.inputHash,
      input.run.outputHash,
      input.run.responseId,
      input.run.inputTokens,
      input.run.outputTokens,
      input.run.latencyMs,
    );
}

export function persistStudentModel(input: {
  context: DiagnosisContextRow;
  run: GenerationRun<StudentModelResult>;
}) {
  const database = getDatabase();
  let result: StudentModelRecord | null = null;
  const createdAt = new Date().toISOString();
  database.transaction(() => {
    const reusable = findReusableStudentModel(input.context);
    if (reusable) {
      result = reusable;
      return;
    }
    const hypothesisId = randomUUID();
    const modelId = randomUUID();
    const runId = randomUUID();
    const scopeKey = `${input.context.domain.toLowerCase()}:${input.context.misconception_id}`;
    insertSucceededRun({
      id: runId,
      classId: input.context.class_id,
      purpose: "STUDENT_MODEL",
      run: input.run,
    });
    database
      .prepare(
        [
          "INSERT INTO student_model_hypotheses",
          "(id, class_id, membership_id, domain, scope_key, taxonomy_version, misconception_id)",
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        hypothesisId,
        input.context.class_id,
        input.context.membership_id,
        input.context.domain,
        scopeKey,
        input.context.taxonomy_version,
        input.context.misconception_id,
      );
    database
      .prepare(
        [
          "INSERT INTO student_model_versions",
          "(id, hypothesis_id, version, status, rule_statement, formal_pattern_json, scope_limits_json, confidence,",
          "support_count, contradiction_count, ai_run_id, model_name, prompt_version, schema_version, created_at)",
          "VALUES (?, ?, 1, 'PROVISIONAL', ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        modelId,
        hypothesisId,
        input.run.result.ruleStatement,
        JSON.stringify(input.run.result.formalPattern),
        JSON.stringify(input.run.result.scopeLimits),
        input.run.result.confidence,
        runId,
        input.run.modelName,
        input.run.promptVersion,
        input.run.schemaVersion,
        createdAt,
      );
    database
      .prepare(
        [
          "INSERT INTO student_model_evidence",
          "(student_model_version_id, diagnosis_id, role, weight, rationale)",
          "VALUES (?, ?, 'SUPPORTS', ?, ?)",
        ].join(" "),
      )
      .run(
        modelId,
        input.context.diagnosis_id,
        input.context.confidence,
        input.run.result.evidenceConnection,
      );
    result = {
      id: modelId,
      hypothesisId,
      version: 1,
      status: "PROVISIONAL",
      ruleStatement: input.run.result.ruleStatement,
      formalPattern: input.run.result.formalPattern,
      scopeLimits: input.run.result.scopeLimits,
      confidence: input.run.result.confidence,
      taxonomyVersion: input.context.taxonomy_version,
      misconceptionId: input.context.misconception_id,
      createdAt,
    };
  })();
  if (!result) {
    throw new InstructionalRepositoryError(
      "PERSISTENCE_ERROR",
      "The provisional Student Model could not be saved.",
    );
  }
  return result;
}

export function getStudentModelRevisionContext(input: {
  context: DiagnosisContextRow;
  model: StudentModelRecord;
}) {
  const row = getDatabase()
    .prepare(
      [
        "SELECT diagnosis.id AS diagnosis_id, submission.class_id, submission.assignment_id, submission.membership_id,",
        "problem.domain, diagnosis.taxonomy_version, diagnosis.misconception_id, diagnosis.confidence,",
        "diagnosis.transcription, diagnosis.observed_transformation, diagnosis.evidence_quote,",
        "problem.prompt AS problem_prompt, problem.correct_answer",
        "FROM submissions AS submission",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
        "JOIN problems AS problem ON problem.id = item.problem_id",
        "WHERE submission.class_id = ? AND submission.membership_id = ?",
        "AND diagnosis.outcome = 'MISCONCEPTION' AND diagnosis.taxonomy_version = ?",
        "AND diagnosis.misconception_id = ? AND julianday(diagnosis.created_at) > julianday(?)",
        "AND diagnosis.id = (",
        "SELECT latest.id FROM diagnoses AS latest",
        "JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id",
        "JOIN submission_answers AS latest_answer ON latest_answer.id = latest_version.submission_answer_id",
        "WHERE latest_answer.id = answer.id",
        "ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1",
        ")",
        "ORDER BY diagnosis.created_at DESC, diagnosis.id DESC LIMIT 1",
      ].join(" "),
    )
    .get(
      input.context.class_id,
      input.context.membership_id,
      input.model.taxonomyVersion,
      input.model.misconceptionId,
      input.model.createdAt,
    ) as DiagnosisContextRow | undefined;
  if (!row?.evidence_quote) return null;
  const taxonomy = MISCONCEPTION_BY_ID.get(input.model.misconceptionId);
  return taxonomy && taxonomy.domain === row.domain ? { row, taxonomy } : null;
}

export function persistRevisedStudentModel(input: {
  context: DiagnosisContextRow;
  previous: StudentModelRecord;
  run: GenerationRun<StudentModelResult>;
}) {
  const database = getDatabase();
  const modelId = randomUUID();
  const runId = randomUUID();
  const createdAt = new Date().toISOString();

  try {
    database.transaction(() => {
      const update = database
        .prepare(
          "UPDATE student_model_versions SET superseded_at = ? WHERE id = ? AND superseded_at IS NULL",
        )
        .run(createdAt, input.previous.id);
      if (update.changes !== 1) {
        throw new InstructionalRepositoryError(
          "PERSISTENCE_ERROR",
          "The Student Model changed before its new version could be saved.",
        );
      }
      insertSucceededRun({
        id: runId,
        classId: input.context.class_id,
        purpose: "STUDENT_MODEL",
        run: input.run,
      });
      database
        .prepare(
          [
            "INSERT INTO student_model_versions",
            "(id, hypothesis_id, version, status, rule_statement, formal_pattern_json, scope_limits_json, confidence,",
            "support_count, contradiction_count, ai_run_id, model_name, prompt_version, schema_version, created_at)",
            "VALUES (?, ?, ?, 'PROVISIONAL', ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          modelId,
          input.previous.hypothesisId,
          input.previous.version + 1,
          input.run.result.ruleStatement,
          JSON.stringify(input.run.result.formalPattern),
          JSON.stringify(input.run.result.scopeLimits),
          input.run.result.confidence,
          runId,
          input.run.modelName,
          input.run.promptVersion,
          input.run.schemaVersion,
          createdAt,
        );
      database
        .prepare(
          [
            "INSERT INTO student_model_evidence",
            "(student_model_version_id, diagnosis_id, role, weight, rationale)",
            "VALUES (?, ?, 'SUPPORTS', ?, ?)",
          ].join(" "),
        )
        .run(
          modelId,
          input.context.diagnosis_id,
          input.context.confidence,
          input.run.result.evidenceConnection,
        );
    })();
  } catch (error) {
    if (error instanceof InstructionalRepositoryError) throw error;
    throw new InstructionalRepositoryError(
      "PERSISTENCE_ERROR",
      "The revised Student Model version could not be saved.",
      { cause: error },
    );
  }

  const result = getStudentModelById(modelId);
  if (!result) {
    throw new InstructionalRepositoryError(
      "PERSISTENCE_ERROR",
      "The revised Student Model could not be read back.",
    );
  }
  return result;
}

export function synchronizeStudentModelEvidence(input: {
  context: DiagnosisContextRow;
  model: StudentModelRecord;
}) {
  if (input.model.status !== "PROVISIONAL") return input.model;
  const database = getDatabase();

  database.transaction(() => {
    const supportingDiagnoses = database
      .prepare(
        [
          "SELECT diagnosis.id, diagnosis.confidence, diagnosis.evidence_quote",
          "FROM submissions AS submission",
          "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
          "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
          "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
          "WHERE submission.class_id = ? AND submission.membership_id = ?",
          "AND diagnosis.outcome = 'MISCONCEPTION'",
          "AND diagnosis.taxonomy_version = ? AND diagnosis.misconception_id = ?",
          "AND julianday(diagnosis.created_at) <= julianday(?)",
          "AND diagnosis.id = (",
          "SELECT latest.id FROM diagnoses AS latest",
          "JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id",
          "JOIN submission_answers AS latest_answer ON latest_answer.id = latest_version.submission_answer_id",
          "WHERE latest_answer.id = answer.id",
          "ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1",
          ")",
          "ORDER BY diagnosis.created_at, diagnosis.id",
        ].join(" "),
      )
      .all(
        input.context.class_id,
        input.context.membership_id,
        input.model.taxonomyVersion,
        input.model.misconceptionId,
        input.model.createdAt,
      ) as Array<{
      id: string;
      confidence: number;
      evidence_quote: string | null;
    }>;

    const insertEvidence = database.prepare(
      [
        "INSERT OR IGNORE INTO student_model_evidence",
        "(student_model_version_id, diagnosis_id, role, weight, rationale)",
        "VALUES (?, ?, 'SUPPORTS', ?, ?)",
      ].join(" "),
    );
    for (const diagnosis of supportingDiagnoses) {
      insertEvidence.run(
        input.model.id,
        diagnosis.id,
        diagnosis.confidence,
        diagnosis.evidence_quote
          ? `The same observable rule pattern recurs in: ${diagnosis.evidence_quote}`
          : "The same taxonomy-grounded transformation recurs in this response.",
      );
    }

    const counts = database
      .prepare(
        [
          "SELECT",
          "count(DISTINCT CASE WHEN evidence.role = 'SUPPORTS' THEN answer_version.submission_answer_id END) AS support_count,",
          "count(DISTINCT CASE WHEN evidence.role = 'CONTRADICTS' THEN answer_version.submission_answer_id END) AS contradiction_count,",
          "count(DISTINCT CASE WHEN evidence.role = 'AMBIGUOUS' THEN answer_version.submission_answer_id END) AS ambiguous_count,",
          "count(DISTINCT CASE WHEN evidence.role = 'SUPPORTS' THEN problem.content_hash END) AS distinct_support_content",
          "FROM student_model_evidence AS evidence",
          "JOIN diagnoses AS diagnosis ON diagnosis.id = evidence.diagnosis_id",
          "JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id",
          "JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id",
          "JOIN assignment_items AS item ON item.id = answer.assignment_item_id",
          "JOIN problems AS problem ON problem.id = item.problem_id",
          "WHERE evidence.student_model_version_id = ?",
        ].join(" "),
      )
      .get(input.model.id) as {
      support_count: number;
      contradiction_count: number;
      ambiguous_count: number;
      distinct_support_content: number;
    };

    if (
      counts.support_count >= 2 &&
      counts.distinct_support_content >= 2 &&
      counts.contradiction_count === 0
    ) {
      database
        .prepare(
          [
            "INSERT INTO student_model_finalizations",
            "(student_model_version_id, final_status, support_count, contradiction_count, ambiguous_count, finalizer_type, note)",
            "VALUES (?, 'SUPPORTED', ?, ?, ?, 'SYSTEM', ?)",
          ].join(" "),
        )
        .run(
          input.model.id,
          counts.support_count,
          counts.contradiction_count,
          counts.ambiguous_count,
          "Repeated diagnosis evidence across two structurally distinct problems supports this falsifiable rule hypothesis.",
        );
    }
  })();

  return getStudentModelById(input.model.id) ?? input.model;
}

function findPreviousWorksheet(input: {
  assignmentId: string;
  membershipId: string;
  hypothesisId: string;
}) {
  return getDatabase()
    .prepare(
      [
        "SELECT worksheet.id FROM worksheets AS worksheet",
        "JOIN student_model_versions AS model ON model.id = worksheet.student_model_version_id",
        "WHERE worksheet.assignment_id = ? AND worksheet.membership_id = ?",
        "AND model.hypothesis_id = ? AND worksheet.status = 'READY'",
        "ORDER BY worksheet.created_at DESC, worksheet.id DESC LIMIT 1",
      ].join(" "),
    )
    .get(input.assignmentId, input.membershipId, input.hypothesisId) as
    | { id: string }
    | undefined;
}

export function persistPracticeWorksheet(input: {
  context: DiagnosisContextRow;
  model: StudentModelRecord;
  run: GenerationRun<PracticeResult>;
}) {
  const database = getDatabase();
  const worksheetId = randomUUID();
  const runId = randomUUID();
  database.transaction(() => {
    const previous = findPreviousWorksheet({
      assignmentId: input.context.assignment_id,
      membershipId: input.context.membership_id,
      hypothesisId: input.model.hypothesisId,
    });
    insertSucceededRun({
      id: runId,
      classId: input.context.class_id,
      purpose: "PRACTICE",
      run: input.run,
    });
    database
      .prepare(
        [
          "INSERT INTO worksheets",
          "(id, class_id, membership_id, student_model_version_id, assignment_id, title, rationale, status,",
          "supersedes_worksheet_id, ai_run_id, model_name, prompt_version, schema_version)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, 'READY', ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        worksheetId,
        input.context.class_id,
        input.context.membership_id,
        input.model.id,
        input.context.assignment_id,
        input.run.result.title,
        input.run.result.rationale,
        previous?.id ?? null,
        runId,
        input.run.modelName,
        input.run.promptVersion,
        input.run.schemaVersion,
      );
    const insertProblem = database.prepare(
      [
        "INSERT INTO problems",
        "(id, class_id, domain, prompt, answer_format, correct_answer, canonical_correct_answer, origin, content_hash)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'PREDICTION', ?)",
      ].join(" "),
    );
    const insertItem = database.prepare(
      [
        "INSERT INTO worksheet_items",
        "(id, worksheet_id, class_id, problem_id, position, difficulty, taxonomy_version, misconception_id,",
        "misconception_predicted_answer, hint, explanation, discrepant_event_rationale)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    );
    for (const item of input.run.result.items) {
      const problemId = randomUUID();
      insertProblem.run(
        problemId,
        input.context.class_id,
        input.context.domain,
        item.problemPrompt,
        item.answerFormat,
        item.correctAnswer,
        canonicalAnswer(item.correctAnswer),
        contentHash(input.context.domain, item.problemPrompt),
      );
      insertItem.run(
        randomUUID(),
        worksheetId,
        input.context.class_id,
        problemId,
        item.position,
        item.difficulty,
        input.model.taxonomyVersion,
        input.model.misconceptionId,
        item.misconceptionPredictedAnswer,
        item.hint,
        item.explanation,
        item.discrepantEventRationale,
      );
    }
  })();
  return getPrintableWorksheet(worksheetId);
}

type LatestDiagnosisRow = {
  diagnosis_id: string;
  membership_id: string;
  outcome: string;
  taxonomy_version: string | null;
  misconception_id: string | null;
  evidence_quote: string | null;
  created_at: string;
};

export function getLargestClusterContext(assignmentId: string) {
  const assignment = requireAssignment(assignmentId);
  const rows = getDatabase()
    .prepare(
      [
        "SELECT diagnosis.id AS diagnosis_id, submission.membership_id, diagnosis.outcome,",
        "diagnosis.taxonomy_version, diagnosis.misconception_id, diagnosis.evidence_quote, diagnosis.created_at",
        "FROM submissions AS submission",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "WHERE submission.assignment_id = ? AND submission.class_id = ?",
        "AND diagnosis.id = (",
        "SELECT latest.id FROM diagnoses AS latest",
        "JOIN answer_versions AS latest_version ON latest_version.id = latest.answer_version_id",
        "JOIN submission_answers AS latest_answer ON latest_answer.id = latest_version.submission_answer_id",
        "WHERE latest_answer.id = answer.id",
        "ORDER BY latest.created_at DESC, latest.version DESC, latest.id DESC LIMIT 1",
        ")",
        "ORDER BY diagnosis.created_at DESC",
      ].join(" "),
    )
    .all(assignment.id, assignment.class_id) as LatestDiagnosisRow[];
  const diagnosedStudentCount = new Set(rows.map((row) => row.membership_id)).size;
  const clusters = new Map<
    MisconceptionId,
    {
      taxonomyVersion: string;
      memberships: Set<string>;
      diagnoses: LatestDiagnosisRow[];
    }
  >();
  for (const row of rows) {
    const parsed = misconceptionIdSchema.safeParse(row.misconception_id);
    if (
      row.outcome !== "MISCONCEPTION" ||
      !parsed.success ||
      !row.taxonomy_version ||
      !row.evidence_quote
    ) {
      continue;
    }
    const cluster = clusters.get(parsed.data) ?? {
      taxonomyVersion: row.taxonomy_version,
      memberships: new Set<string>(),
      diagnoses: [],
    };
    cluster.memberships.add(row.membership_id);
    cluster.diagnoses.push(row);
    clusters.set(parsed.data, cluster);
  }
  const largest = [...clusters.entries()].sort(
    (left, right) =>
      right[1].memberships.size - left[1].memberships.size ||
      right[1].diagnoses.length - left[1].diagnoses.length ||
      left[0].localeCompare(right[0]),
  )[0];
  if (!largest || diagnosedStudentCount === 0) {
    throw new InstructionalRepositoryError(
      "NO_CLUSTER",
      "A supported misconception cluster is required before writing the brief.",
    );
  }
  const [misconceptionId, cluster] = largest;
  const taxonomy = MISCONCEPTION_BY_ID.get(misconceptionId);
  if (!taxonomy) {
    throw new InstructionalRepositoryError(
      "NO_CLUSTER",
      "The largest cluster no longer matches the active taxonomy.",
    );
  }
  return {
    assignment,
    taxonomy,
    taxonomyVersion: cluster.taxonomyVersion,
    misconceptionId,
    clusterStudentCount: cluster.memberships.size,
    diagnosedStudentCount,
    diagnosisIds: cluster.diagnoses.map((row) => row.diagnosis_id),
    evidenceQuotes: cluster.diagnoses.map(
      (row) => row.evidence_quote as string,
    ),
    evidenceCutoffAt: cluster.diagnoses
      .map((row) => row.created_at)
      .sort((left, right) => right.localeCompare(left))[0],
  };
}

export function persistTeachingBrief(input: {
  context: ReturnType<typeof getLargestClusterContext>;
  run: GenerationRun<BriefResult>;
}) {
  const database = getDatabase();
  const briefId = randomUUID();
  const problemId = randomUUID();
  const runId = randomUUID();
  database.transaction(() => {
    const previous = database
      .prepare(
        [
          "SELECT id FROM teaching_briefs WHERE assignment_id = ? AND class_id = ?",
          "AND taxonomy_version = ? AND misconception_id = ?",
          "ORDER BY created_at DESC, id DESC LIMIT 1",
        ].join(" "),
      )
      .get(
        input.context.assignment.id,
        input.context.assignment.class_id,
        input.context.taxonomyVersion,
        input.context.misconceptionId,
      ) as { id: string } | undefined;
    insertSucceededRun({
      id: runId,
      classId: input.context.assignment.class_id,
      purpose: "TEACHING_BRIEF",
      run: input.run,
    });
    database
      .prepare(
        [
          "INSERT INTO problems",
          "(id, class_id, domain, prompt, answer_format, correct_answer, canonical_correct_answer, origin, content_hash)",
          "VALUES (?, ?, ?, ?, 'EXPRESSION', ?, ?, 'PREDICTION', ?)",
        ].join(" "),
      )
      .run(
        problemId,
        input.context.assignment.class_id,
        input.context.taxonomy.domain,
        input.run.result.workedExample.problemPrompt,
        input.run.result.workedExample.correctAnswer,
        canonicalAnswer(input.run.result.workedExample.correctAnswer),
        contentHash(
          input.context.taxonomy.domain,
          input.run.result.workedExample.problemPrompt,
        ),
      );
    database
      .prepare(
        [
          "INSERT INTO teaching_briefs",
          "(id, class_id, assignment_id, taxonomy_version, misconception_id, paragraph, cluster_student_count,",
          "diagnosed_student_count, evidence_cutoff_at, worked_example_problem_id, supersedes_brief_id,",
          "ai_run_id, model_name, prompt_version, schema_version)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        briefId,
        input.context.assignment.class_id,
        input.context.assignment.id,
        input.context.taxonomyVersion,
        input.context.misconceptionId,
        input.run.result.paragraph,
        input.context.clusterStudentCount,
        input.context.diagnosedStudentCount,
        input.context.evidenceCutoffAt,
        problemId,
        previous?.id ?? null,
        runId,
        input.run.modelName,
        input.run.promptVersion,
        input.run.schemaVersion,
      );
    const insertEvidence = database.prepare(
      "INSERT INTO teaching_brief_evidence (teaching_brief_id, diagnosis_id) VALUES (?, ?)",
    );
    for (const diagnosisId of input.context.diagnosisIds) {
      insertEvidence.run(briefId, diagnosisId);
    }
  })();
  return getLatestTeachingBrief(input.context.assignment.id);
}

export type TeachingBriefRecord = {
  id: string;
  misconceptionId: MisconceptionId;
  misconceptionLabel: string;
  paragraph: string;
  clusterStudentCount: number;
  diagnosedStudentCount: number;
  evidenceCutoffAt: string;
  workedExample: { problemPrompt: string; correctAnswer: string };
  createdAt: string;
};

export function getLatestTeachingBrief(assignmentId: string) {
  const row = getDatabase()
    .prepare(
      [
        "SELECT brief.id, brief.misconception_id, brief.paragraph, brief.cluster_student_count,",
        "brief.diagnosed_student_count, brief.evidence_cutoff_at, brief.created_at,",
        "problem.prompt AS problem_prompt, problem.correct_answer",
        "FROM teaching_briefs AS brief",
        "JOIN problems AS problem ON problem.id = brief.worked_example_problem_id",
        "WHERE brief.assignment_id = ?",
        "ORDER BY brief.created_at DESC, brief.id DESC LIMIT 1",
      ].join(" "),
    )
    .get(assignmentId) as
    | {
        id: string;
        misconception_id: MisconceptionId;
        paragraph: string;
        cluster_student_count: number;
        diagnosed_student_count: number;
        evidence_cutoff_at: string;
        created_at: string;
        problem_prompt: string;
        correct_answer: string;
      }
    | undefined;
  if (!row) return null;
  const taxonomy = MISCONCEPTION_BY_ID.get(row.misconception_id);
  if (!taxonomy) return null;
  return {
    id: row.id,
    misconceptionId: row.misconception_id,
    misconceptionLabel: taxonomy.label,
    paragraph: row.paragraph,
    clusterStudentCount: row.cluster_student_count,
    diagnosedStudentCount: row.diagnosed_student_count,
    evidenceCutoffAt: row.evidence_cutoff_at,
    workedExample: {
      problemPrompt: row.problem_prompt,
      correctAnswer: row.correct_answer,
    },
    createdAt: row.created_at,
  } satisfies TeachingBriefRecord;
}

export type PracticeSummary = {
  worksheetId: string;
  membershipId: string;
  misconceptionId: MisconceptionId;
  title: string;
  modelStatus: "PROVISIONAL" | "SUPPORTED";
  ruleStatement: string;
  createdAt: string;
};

export function listLatestPracticeByMembership(assignmentId: string) {
  const rows = getDatabase()
    .prepare(
      [
        "SELECT worksheet.id AS worksheet_id, worksheet.membership_id, worksheet.title, worksheet.created_at,",
        "model.status AS model_status, model.rule_statement, hypothesis.misconception_id",
        "FROM worksheets AS worksheet",
        "JOIN student_model_versions AS model ON model.id = worksheet.student_model_version_id",
        "JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id",
        "WHERE worksheet.assignment_id = ? AND worksheet.status = 'READY'",
        "AND worksheet.id = (",
        "SELECT latest.id FROM worksheets AS latest",
        "JOIN student_model_versions AS latest_model ON latest_model.id = latest.student_model_version_id",
        "JOIN student_model_hypotheses AS latest_hypothesis ON latest_hypothesis.id = latest_model.hypothesis_id",
        "WHERE latest.assignment_id = worksheet.assignment_id",
        "AND latest.membership_id = worksheet.membership_id",
        "AND latest_hypothesis.misconception_id = hypothesis.misconception_id",
        "AND latest.status = 'READY' ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1",
        ")",
      ].join(" "),
    )
    .all(assignmentId) as Array<{
    worksheet_id: string;
    membership_id: string;
    title: string;
    created_at: string;
    model_status: "PROVISIONAL" | "SUPPORTED";
    rule_statement: string;
    misconception_id: MisconceptionId;
  }>;
  return rows.map(
    (row) =>
      ({
        worksheetId: row.worksheet_id,
        membershipId: row.membership_id,
        misconceptionId: row.misconception_id,
        title: row.title,
        modelStatus: row.model_status,
        ruleStatement: row.rule_statement,
        createdAt: row.created_at,
      }) satisfies PracticeSummary,
  );
}

export type PrintableWorksheet = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  className: string;
  studentName: string;
  title: string;
  rationale: string;
  modelStatus: "PROVISIONAL" | "SUPPORTED";
  ruleStatement: string;
  misconceptionLabel: string;
  createdAt: string;
  items: Array<{
    position: number;
    difficulty: number;
    problemPrompt: string;
    correctAnswer: string;
    predictedAnswer: string;
    hint: string;
    explanation: string;
    discrepantEventRationale: string;
  }>;
};

export function getPrintableWorksheet(worksheetId: string) {
  const parsedId = idSchema.safeParse(worksheetId);
  if (!parsedId.success) return null;
  const id = parsedId.data;
  const row = getDatabase()
    .prepare(
      [
        "SELECT worksheet.id, worksheet.assignment_id, assignment.title AS assignment_title, class.name AS class_name,",
        "student.display_name AS student_name, worksheet.title, worksheet.rationale, worksheet.created_at,",
        "model.status AS model_status, model.rule_statement, hypothesis.misconception_id",
        "FROM worksheets AS worksheet",
        "JOIN assignments AS assignment ON assignment.id = worksheet.assignment_id",
        "JOIN classes AS class ON class.id = worksheet.class_id",
        "JOIN class_memberships AS membership ON membership.id = worksheet.membership_id",
        "JOIN students AS student ON student.id = membership.student_id",
        "JOIN student_model_versions AS model ON model.id = worksheet.student_model_version_id",
        "JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id",
        "WHERE worksheet.id = ? AND worksheet.status = 'READY'",
      ].join(" "),
    )
    .get(id) as
    | {
        id: string;
        assignment_id: string;
        assignment_title: string;
        class_name: string;
        student_name: string;
        title: string;
        rationale: string;
        created_at: string;
        model_status: "PROVISIONAL" | "SUPPORTED";
        rule_statement: string;
        misconception_id: MisconceptionId;
      }
    | undefined;
  if (!row) return null;
  const items = getDatabase()
    .prepare(
      [
        "SELECT item.position, item.difficulty, problem.prompt AS problem_prompt, problem.correct_answer,",
        "item.misconception_predicted_answer, item.hint, item.explanation, item.discrepant_event_rationale",
        "FROM worksheet_items AS item",
        "JOIN problems AS problem ON problem.id = item.problem_id",
        "WHERE item.worksheet_id = ? ORDER BY item.position",
      ].join(" "),
    )
    .all(row.id) as Array<{
    position: number;
    difficulty: number;
    problem_prompt: string;
    correct_answer: string;
    misconception_predicted_answer: string;
    hint: string;
    explanation: string;
    discrepant_event_rationale: string;
  }>;
  const taxonomy = MISCONCEPTION_BY_ID.get(row.misconception_id);
  if (!taxonomy || items.length !== 5) {
    throw new InstructionalRepositoryError(
      "WORKSHEET_NOT_FOUND",
      "This worksheet is incomplete and cannot be printed.",
    );
  }
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    assignmentTitle: row.assignment_title,
    className: row.class_name,
    studentName: row.student_name,
    title: row.title,
    rationale: row.rationale,
    modelStatus: row.model_status,
    ruleStatement: row.rule_statement,
    misconceptionLabel: taxonomy.label,
    createdAt: row.created_at,
    items: items.map((item) => ({
      position: item.position,
      difficulty: item.difficulty,
      problemPrompt: item.problem_prompt,
      correctAnswer: item.correct_answer,
      predictedAnswer: item.misconception_predicted_answer,
      hint: item.hint,
      explanation: item.explanation,
      discrepantEventRationale: item.discrepant_event_rationale,
    })),
  } satisfies PrintableWorksheet;
}
