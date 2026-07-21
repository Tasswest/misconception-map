import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  MISCONCEPTION_BY_ID,
  misconceptionIdSchema,
  TAXONOMY_VERSION,
} from "@/domain/misconception-taxonomy.mjs";
import type { MisconceptionId } from "@/domain/contracts";
import type { FollowUpEvaluationGenerationInput } from "@/server/openai/generate-instructional-support";
import { getAssignmentErrorInventory } from "@/server/repositories/error-inventory";
import { getDatabase } from "@/lib/db";

const idSchema = z.string().uuid();

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

type FollowUpEvaluationResult = {
  title: string;
  overview: string;
  exercises: Array<{
    position: number;
    exerciseLabel: string;
    sharedContext: string | null;
    questions: Array<{
      position: number;
      questionLabel: string;
      prompt: string;
      answerFormat:
        | "EXPRESSION"
        | "NUMBER"
        | "FRACTION"
        | "MULTIPLE_CHOICE"
        | "SHORT_TEXT";
      expectedAnswer: string;
      points: number;
      targetKind: "MISCONCEPTION" | "SLIP" | "UNCERTAIN_RETEST";
      targetMisconceptionId: string | null;
      sourceQuestionReference: string;
      whyThisQuestion: string;
    }>;
  }>;
};

export class FollowUpRepositoryError extends Error {
  readonly code:
    | "ASSIGNMENT_NOT_FOUND"
    | "NO_MISTAKES"
    | "EVALUATION_NOT_FOUND"
    | "PERSISTENCE_ERROR";

  constructor(
    code: FollowUpRepositoryError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FollowUpRepositoryError";
    this.code = code;
  }
}

function clip(value: string, maximum: number) {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1)}…`
    : normalized;
}

export type FollowUpGenerationContext = {
  assignment: { id: string; classId: string; title: string };
  payload: FollowUpEvaluationGenerationInput;
  affectedStudentsByMisconception: Map<MisconceptionId, number>;
  affectedStudentsBySlipReference: Map<string, number>;
};

export function getFollowUpGenerationContext(
  assignmentId: string,
): FollowUpGenerationContext {
  const id = idSchema.parse(assignmentId);
  const database = getDatabase();
  const assignment = database
    .prepare(
      [
        "SELECT id, class_id, title, domain FROM assignments",
        "WHERE id = ? AND status = 'READY' AND archived_at IS NULL",
      ].join(" "),
    )
    .get(id) as
    | {
        id: string;
        class_id: string;
        title: string;
        domain: "ALGEBRA" | "FRACTIONS" | "MIXED";
      }
    | undefined;
  if (!assignment) {
    throw new FollowUpRepositoryError(
      "ASSIGNMENT_NOT_FOUND",
      "That assignment is not ready for a follow-up evaluation.",
    );
  }

  const sourceRows = database
    .prepare(
      [
        "SELECT exercise.position AS exercise_position, exercise.exercise_label, exercise.shared_context,",
        "item.question_label, item.points, problem.prompt, problem.correct_answer",
        "FROM exercises AS exercise",
        "JOIN assignment_items AS item ON item.exercise_id = exercise.id",
        "AND item.assignment_id = exercise.assignment_id AND item.class_id = exercise.class_id",
        "JOIN problems AS problem ON problem.id = item.problem_id AND problem.class_id = item.class_id",
        "WHERE exercise.assignment_id = ? AND exercise.class_id = ?",
        "ORDER BY exercise.position, item.position",
      ].join(" "),
    )
    .all(assignment.id, assignment.class_id) as Array<{
    exercise_position: number;
    exercise_label: string;
    shared_context: string | null;
    question_label: string | null;
    points: number;
    prompt: string;
    correct_answer: string;
  }>;
  if (sourceRows.length === 0) {
    throw new FollowUpRepositoryError(
      "ASSIGNMENT_NOT_FOUND",
      "The source exam has no confirmed questions to mirror.",
    );
  }

  const exerciseByPosition = new Map<
    number,
    FollowUpEvaluationGenerationInput["sourceExercises"][number]
  >();
  for (const row of sourceRows) {
    const exercise = exerciseByPosition.get(row.exercise_position) ?? {
      position: row.exercise_position,
      exerciseLabel: clip(row.exercise_label, 200),
      sharedContext: row.shared_context ? clip(row.shared_context, 2_000) : null,
      questions: [],
    };
    if (exercise.questions.length < 30) {
      exercise.questions.push({
        questionLabel: clip(row.question_label ?? "?", 60),
        prompt: clip(row.prompt, 1_200),
        expectedAnswer: clip(row.correct_answer, 500),
        points: Math.min(row.points, 100),
      });
    }
    exerciseByPosition.set(row.exercise_position, exercise);
  }
  const sourceExercises = [...exerciseByPosition.values()]
    .sort((left, right) => left.position - right.position)
    .slice(0, 12);

  const inventory = getAssignmentErrorInventory(assignment.id);
  if (
    !inventory ||
    (inventory.misconceptions.length === 0 &&
      inventory.slipsByExercise.length === 0 &&
      inventory.uncertain.length === 0)
  ) {
    throw new FollowUpRepositoryError(
      "NO_MISTAKES",
      "No diagnosed mistakes are available to retest. Run the AI correction first.",
    );
  }

  const affectedStudentsByMisconception = new Map<MisconceptionId, number>();
  const misconceptions = inventory.misconceptions.flatMap((group) => {
    const taxonomy = MISCONCEPTION_BY_ID.get(group.misconceptionId);
    if (!taxonomy) return [];
    affectedStudentsByMisconception.set(
      group.misconceptionId,
      group.distinctStudentCount,
    );
    return [
      {
        misconceptionId: group.misconceptionId,
        teacherLabel: clip(taxonomy.teacherLabel, 300),
        definition: clip(taxonomy.definition, 1_000),
        repairMove: clip(taxonomy.repairMove, 1_000),
        distinctStudentCount: group.distinctStudentCount,
        occurrenceCount: group.occurrenceCount,
        sourceQuestionReferences: [
          ...new Set(group.items.map((item) => clip(item.questionReference, 80))),
        ].slice(0, 8),
        evidenceQuotes: group.items
          .slice(0, 6)
          .map((item) => clip(item.evidenceQuote, 1_200)),
      },
    ];
  });

  const affectedStudentsBySlipReference = new Map<string, number>();
  const slips = inventory.slipsByExercise.map((group) => {
    const references = [
      ...new Set(group.items.map((item) => clip(item.questionReference, 80))),
    ].slice(0, 8);
    for (const reference of references) {
      affectedStudentsBySlipReference.set(reference, group.distinctStudentCount);
    }
    return {
      exerciseLabel: clip(group.exerciseLabel, 200),
      distinctStudentCount: group.distinctStudentCount,
      occurrenceCount: group.occurrenceCount,
      sourceQuestionReferences: references,
      evidenceQuotes: group.items
        .slice(0, 4)
        .map((item) => clip(item.evidenceQuote, 1_200)),
    };
  });

  const uncertainItems = inventory.uncertain.slice(0, 12).map((item) => ({
    sourceQuestionReference: clip(item.questionReference, 80),
    evidenceQuote: item.evidenceQuote ? clip(item.evidenceQuote, 1_200) : null,
    explanation: item.explanation ? clip(item.explanation, 700) : null,
  }));

  return {
    assignment: {
      id: assignment.id,
      classId: assignment.class_id,
      title: assignment.title,
    },
    payload: {
      assignmentTitle: clip(assignment.title, 300),
      domain: assignment.domain,
      sourceExercises,
      mistakes: {
        misconceptions: misconceptions.slice(0, 16),
        slips: slips.slice(0, 12),
        uncertainItems,
      },
    },
    affectedStudentsByMisconception,
    affectedStudentsBySlipReference,
  };
}

export function findFollowUpEvaluationIdByInputHash(
  assignmentId: string,
  inputHash: string,
) {
  const row = getDatabase()
    .prepare(
      [
        "SELECT id FROM follow_up_evaluations",
        "WHERE assignment_id = ? AND input_hash = ?",
        "ORDER BY created_at DESC, id DESC LIMIT 1",
      ].join(" "),
    )
    .get(assignmentId, inputHash) as { id: string } | undefined;
  return row?.id ?? null;
}

export function persistFollowUpEvaluation(input: {
  context: FollowUpGenerationContext;
  run: GenerationRun<FollowUpEvaluationResult>;
}) {
  const database = getDatabase();
  const evaluationId = randomUUID();
  try {
    database.transaction(() => {
      const latest = database
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS version FROM follow_up_evaluations WHERE assignment_id = ?",
        )
        .get(input.context.assignment.id) as { version: number };
      database
        .prepare(
          [
            "INSERT INTO follow_up_evaluations",
            "(id, class_id, assignment_id, version, title, overview, model_name, prompt_version, schema_version,",
            "openai_response_id, input_hash, output_hash, input_tokens, output_tokens, latency_ms)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          evaluationId,
          input.context.assignment.classId,
          input.context.assignment.id,
          latest.version + 1,
          input.run.result.title,
          input.run.result.overview,
          input.run.modelName,
          input.run.promptVersion,
          input.run.schemaVersion,
          input.run.responseId,
          input.run.inputHash,
          input.run.outputHash,
          input.run.inputTokens,
          input.run.outputTokens,
          input.run.latencyMs,
        );
      const insertExercise = database.prepare(
        [
          "INSERT INTO follow_up_evaluation_exercises",
          "(id, evaluation_id, position, exercise_label, shared_context)",
          "VALUES (?, ?, ?, ?, ?)",
        ].join(" "),
      );
      const insertItem = database.prepare(
        [
          "INSERT INTO follow_up_evaluation_items",
          "(id, evaluation_id, exercise_id, position, question_label, prompt, answer_format, expected_answer,",
          "points, target_kind, target_misconception_id, taxonomy_version, source_question_reference,",
          "affected_student_count, why_this_question)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      );
      for (const exercise of input.run.result.exercises) {
        const exerciseId = randomUUID();
        insertExercise.run(
          exerciseId,
          evaluationId,
          exercise.position,
          exercise.exerciseLabel,
          exercise.sharedContext,
        );
        for (const question of exercise.questions) {
          const misconceptionId =
            question.targetKind === "MISCONCEPTION"
              ? misconceptionIdSchema.parse(question.targetMisconceptionId)
              : null;
          const affectedCount =
            question.targetKind === "MISCONCEPTION" && misconceptionId
              ? (input.context.affectedStudentsByMisconception.get(
                  misconceptionId,
                ) ?? 1)
              : question.targetKind === "SLIP"
                ? (input.context.affectedStudentsBySlipReference.get(
                    question.sourceQuestionReference,
                  ) ?? 1)
                : 1;
          insertItem.run(
            randomUUID(),
            evaluationId,
            exerciseId,
            question.position,
            question.questionLabel,
            question.prompt,
            question.answerFormat,
            question.expectedAnswer,
            question.points,
            question.targetKind,
            misconceptionId,
            misconceptionId ? TAXONOMY_VERSION : null,
            question.sourceQuestionReference,
            affectedCount,
            question.whyThisQuestion,
          );
        }
      }
    })();
  } catch (error) {
    throw new FollowUpRepositoryError(
      "PERSISTENCE_ERROR",
      "The follow-up evaluation could not be saved.",
      { cause: error },
    );
  }
  return evaluationId;
}

export type PrintableFollowUpEvaluation = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  className: string;
  version: number;
  title: string;
  overview: string;
  createdAt: string;
  totalPoints: number;
  questionCount: number;
  targeted: {
    misconceptionTypeCount: number;
    slipQuestionCount: number;
    uncertainRetestCount: number;
  };
  exercises: Array<{
    position: number;
    exerciseLabel: string;
    sharedContext: string | null;
    questions: Array<{
      position: number;
      questionLabel: string;
      prompt: string;
      expectedAnswer: string;
      points: number;
      targetKind: "MISCONCEPTION" | "SLIP" | "UNCERTAIN_RETEST";
      targetLabel: string | null;
      sourceQuestionReference: string;
      affectedStudentCount: number;
      whyThisQuestion: string;
    }>;
  }>;
};

export function getPrintableFollowUpEvaluation(
  evaluationId: string,
): PrintableFollowUpEvaluation | null {
  const parsed = idSchema.safeParse(evaluationId);
  if (!parsed.success) return null;
  const database = getDatabase();
  const row = database
    .prepare(
      [
        "SELECT evaluation.id, evaluation.assignment_id, evaluation.version, evaluation.title, evaluation.overview,",
        "evaluation.created_at, assignment.title AS assignment_title, class.name AS class_name",
        "FROM follow_up_evaluations AS evaluation",
        "JOIN assignments AS assignment ON assignment.id = evaluation.assignment_id",
        "JOIN classes AS class ON class.id = evaluation.class_id",
        "WHERE evaluation.id = ?",
      ].join(" "),
    )
    .get(parsed.data) as
    | {
        id: string;
        assignment_id: string;
        version: number;
        title: string;
        overview: string;
        created_at: string;
        assignment_title: string;
        class_name: string;
      }
    | undefined;
  if (!row) return null;

  const itemRows = database
    .prepare(
      [
        "SELECT exercise.position AS exercise_position, exercise.exercise_label, exercise.shared_context,",
        "item.position, item.question_label, item.prompt, item.expected_answer, item.points,",
        "item.target_kind, item.target_misconception_id, item.source_question_reference,",
        "item.affected_student_count, item.why_this_question",
        "FROM follow_up_evaluation_exercises AS exercise",
        "JOIN follow_up_evaluation_items AS item ON item.exercise_id = exercise.id",
        "WHERE exercise.evaluation_id = ?",
        "ORDER BY exercise.position, item.position",
      ].join(" "),
    )
    .all(row.id) as Array<{
    exercise_position: number;
    exercise_label: string;
    shared_context: string | null;
    position: number;
    question_label: string;
    prompt: string;
    expected_answer: string;
    points: number;
    target_kind: "MISCONCEPTION" | "SLIP" | "UNCERTAIN_RETEST";
    target_misconception_id: string | null;
    source_question_reference: string;
    affected_student_count: number;
    why_this_question: string;
  }>;
  if (itemRows.length === 0) return null;

  const exercises = new Map<number, PrintableFollowUpEvaluation["exercises"][number]>();
  const targetedMisconceptions = new Set<string>();
  let slipQuestionCount = 0;
  let uncertainRetestCount = 0;
  let totalPoints = 0;
  for (const item of itemRows) {
    const exercise = exercises.get(item.exercise_position) ?? {
      position: item.exercise_position,
      exerciseLabel: item.exercise_label,
      sharedContext: item.shared_context,
      questions: [],
    };
    const parsedMisconception = misconceptionIdSchema.safeParse(
      item.target_misconception_id,
    );
    const taxonomy = parsedMisconception.success
      ? MISCONCEPTION_BY_ID.get(parsedMisconception.data)
      : null;
    if (item.target_kind === "MISCONCEPTION" && item.target_misconception_id) {
      targetedMisconceptions.add(item.target_misconception_id);
    }
    if (item.target_kind === "SLIP") slipQuestionCount += 1;
    if (item.target_kind === "UNCERTAIN_RETEST") uncertainRetestCount += 1;
    totalPoints += item.points;
    exercise.questions.push({
      position: item.position,
      questionLabel: item.question_label,
      prompt: item.prompt,
      expectedAnswer: item.expected_answer,
      points: item.points,
      targetKind: item.target_kind,
      targetLabel: taxonomy?.teacherLabel ?? null,
      sourceQuestionReference: item.source_question_reference,
      affectedStudentCount: item.affected_student_count,
      whyThisQuestion: item.why_this_question,
    });
    exercises.set(item.exercise_position, exercise);
  }

  return {
    id: row.id,
    assignmentId: row.assignment_id,
    assignmentTitle: row.assignment_title,
    className: row.class_name,
    version: row.version,
    title: row.title,
    overview: row.overview,
    createdAt: row.created_at,
    totalPoints: Math.round(totalPoints * 100) / 100,
    questionCount: itemRows.length,
    targeted: {
      misconceptionTypeCount: targetedMisconceptions.size,
      slipQuestionCount,
      uncertainRetestCount,
    },
    exercises: [...exercises.values()].sort(
      (left, right) => left.position - right.position,
    ),
  };
}

export type FollowUpEvaluationSummary = {
  id: string;
  version: number;
  title: string;
  createdAt: string;
  questionCount: number;
  totalPoints: number;
};

export function getLatestFollowUpEvaluationSummary(
  assignmentId: string,
): FollowUpEvaluationSummary | null {
  const parsed = idSchema.safeParse(assignmentId);
  if (!parsed.success) return null;
  const row = getDatabase()
    .prepare(
      [
        "SELECT evaluation.id, evaluation.version, evaluation.title, evaluation.created_at,",
        "count(item.id) AS question_count, COALESCE(sum(item.points), 0) AS total_points",
        "FROM follow_up_evaluations AS evaluation",
        "JOIN follow_up_evaluation_items AS item ON item.evaluation_id = evaluation.id",
        "WHERE evaluation.assignment_id = ?",
        "GROUP BY evaluation.id",
        "ORDER BY evaluation.created_at DESC, evaluation.id DESC LIMIT 1",
      ].join(" "),
    )
    .get(parsed.data) as
    | {
        id: string;
        version: number;
        title: string;
        created_at: string;
        question_count: number;
        total_points: number;
      }
    | undefined;
  return row
    ? {
        id: row.id,
        version: row.version,
        title: row.title,
        createdAt: row.created_at,
        questionCount: row.question_count,
        totalPoints: Math.round(row.total_points * 100) / 100,
      }
    : null;
}
