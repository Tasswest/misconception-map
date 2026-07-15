import { createHash } from "node:crypto";

import { TAXONOMY_VERSION } from "../../domain/misconception-taxonomy.mjs";

export const DEMO_CLASS_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_BASELINE_ASSIGNMENT_ID =
  "00000000-0000-4000-8000-000000000100";
export const DEMO_FOLLOWUP_ASSIGNMENT_ID =
  "00000000-0000-4000-8000-000000000200";

const CLASS_NAME = "Riverside Grade 7 · Synthetic Demo";
const BASELINE_CREATED = "2026-01-10T08:00:00.000Z";
const MODEL_CREATED = "2026-01-15T08:00:00.000Z";
const MODEL_FINALIZED = "2026-01-15T08:05:00.000Z";
const PREDICTION_LOCKED = "2026-01-20T08:00:00.000Z";
const FOLLOWUP_SUBMITTED = "2026-01-21T09:00:00.000Z";
const FOLLOWUP_ANSWERED = "2026-01-21T09:01:00.000Z";
const FOLLOWUP_DIAGNOSED = "2026-01-21T09:02:00.000Z";

/** @typedef {import("better-sqlite3").Database} Database */
/** @typedef {{ prompt: string; correct: string }} DemoProblem */
/** @typedef {"baseline" | "followup"} DemoPhase */
/**
 * @typedef {{
 *   outcome: "CORRECT" | "MISCONCEPTION" | "NEEDS_REVIEW";
 *   misconceptionId: string | null;
 *   response: string;
 *   severity: number;
 *   confidence: number;
 * }} DemoOutcome
 */
/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   description: string;
 *   createdAt: string;
 *   problems: DemoProblem[];
 *   problemIdStart: number;
 *   itemIdStart: number;
 * }} DemoAssignmentInput
 */
/**
 * @typedef {{
 *   assignmentId: string;
 *   problems: DemoProblem[];
 *   itemIdStart: number;
 *   submissionIdStart: number;
 *   answerIdStart: number;
 *   answerVersionIdStart: number;
 *   diagnosisIdStart: number;
 *   stepIdStart: number;
 *   submittedAt: string;
 *   answeredAt: string;
 *   diagnosedAt: string;
 *   phase: DemoPhase;
 *   diagnosisIds: Map<string, string>;
 * }} DemoWorkInput
 */

const baselineProblems = [
  { prompt: "Expand −(x + 6).", correct: "−x − 6" },
  { prompt: "Expand −2(y + 5).", correct: "−2y − 10" },
  { prompt: "Expand 3(a + 4).", correct: "3a + 12" },
  { prompt: "Solve x + 7 = 12.", correct: "x = 5" },
  { prompt: "Simplify 2x + 3 + x.", correct: "3x + 3" },
];

const followupProblems = [
  { prompt: "Expand −3(x + 4).", correct: "−3x − 12" },
  { prompt: "Expand −(2y − 5).", correct: "−2y + 5" },
  { prompt: "Expand −2(a + 7).", correct: "−2a − 14" },
  { prompt: "Expand −4(m − 3).", correct: "−4m + 12" },
  { prompt: "Solve 2x + 5 = 17.", correct: "x = 6" },
];

const predictedAnswers = [
  { applied: true, answer: "−3x + 12", canonical: "-3x+12" },
  { applied: true, answer: "−2y − 5", canonical: "-2y-5" },
  { applied: true, answer: "−2a + 14", canonical: "-2a+14" },
  { applied: true, answer: "−4m − 12", canonical: "-4m-12" },
  { applied: false, answer: null, canonical: null },
];

/** @param {number} number */
function id(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

/** @param {string} value */
function canonical(value) {
  return value
    .normalize("NFKC")
    .replaceAll("−", "-")
    .replace(/\s+/gu, "")
    .trim();
}

/** @param {string} domain @param {string} prompt */
function contentHash(domain, prompt) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        domain,
        prompt: prompt.normalize("NFKC").trim().replace(/\s+/gu, " "),
      }),
    )
    .digest("hex");
}

/**
 * @param {number} studentIndex
 * @param {number} problemIndex
 * @param {DemoPhase} phase
 * @returns {DemoOutcome}
 */
function demoOutcome(studentIndex, problemIndex, phase) {
  const problem = phase === "baseline" ? baselineProblems[problemIndex] : followupProblems[problemIndex];
  if (phase === "baseline") {
    if (studentIndex <= 8 && problemIndex === 0) {
      return misconception("SIGN_ERROR_DISTRIBUTION", "−x + 6", 3);
    }
    if (studentIndex === 1 && problemIndex === 1) {
      return misconception("SIGN_ERROR_DISTRIBUTION", "−2y + 10", 3);
    }
    if (studentIndex >= 9 && studentIndex <= 12 && problemIndex === 2) {
      return misconception("DISTRIBUTION_ONE_TERM_ONLY", "3a + 4", 2);
    }
    if (studentIndex >= 13 && studentIndex <= 15 && problemIndex === 3) {
      return misconception("INVERSE_OPERATION_CONFUSION", "x = 19", 2);
    }
    if (studentIndex >= 16 && studentIndex <= 18 && problemIndex === 4) {
      return misconception("UNLIKE_TERMS_CONJOINED", "6x", 2);
    }
    return correct(problem.correct);
  }

  if (studentIndex === 1) {
    if (problemIndex === 0) return misconception("SIGN_ERROR_DISTRIBUTION", "−3x + 12", 3);
    if (problemIndex === 1) return misconception("SIGN_ERROR_DISTRIBUTION", "−2y − 5", 3);
    if (problemIndex === 2) return misconception("SIGN_ERROR_DISTRIBUTION", "−2a + 14", 3);
    if (problemIndex === 3) return misconception("SIGN_ERROR_DISTRIBUTION", "4m − 12", 3);
    return correct("x = 6");
  }
  if (studentIndex >= 2 && studentIndex <= 8 && problemIndex === 0) {
    return misconception("SIGN_ERROR_DISTRIBUTION", "−3x + 12", studentIndex <= 5 ? 3 : 2);
  }
  if (studentIndex >= 9 && studentIndex <= 12 && problemIndex === 2) {
    return misconception("DISTRIBUTION_ONE_TERM_ONLY", "−2a + 7", 2);
  }
  if (studentIndex >= 13 && studentIndex <= 15 && problemIndex === 4) {
    return misconception("INVERSE_OPERATION_CONFUSION", "x = 11", 2);
  }
  if (studentIndex >= 16 && studentIndex <= 17 && problemIndex === 4) {
    return misconception("UNLIKE_TERMS_CONJOINED", "7x = 17", 2);
  }
  if (studentIndex === 18 && problemIndex === 4) {
    return misconception("EQUALITY_AS_OPERATOR", "17", 2);
  }
  if (studentIndex === 20 && problemIndex === 0) {
    return review("−3x 12");
  }
  return correct(problem.correct);
}

/** @param {string} response @returns {DemoOutcome} */
function correct(response) {
  return {
    outcome: "CORRECT",
    misconceptionId: null,
    response,
    severity: 0,
    confidence: 0.98,
  };
}

/**
 * @param {string} misconceptionId
 * @param {string} response
 * @param {number} severity
 * @returns {DemoOutcome}
 */
function misconception(misconceptionId, response, severity) {
  return {
    outcome: "MISCONCEPTION",
    misconceptionId,
    response,
    severity,
    confidence: severity === 3 ? 0.94 : 0.88,
  };
}

/** @param {string} response @returns {DemoOutcome} */
function review(response) {
  return {
    outcome: "NEEDS_REVIEW",
    misconceptionId: null,
    response,
    severity: 0,
    confidence: 0.42,
  };
}

/** @param {Database} database */
export function seedDemoDatabase(database) {
  const existing = database
    .prepare("SELECT id, archived_at FROM classes WHERE id = ?")
    .get(DEMO_CLASS_ID);
  if (existing) {
    database.transaction(() => {
      database
        .prepare(
          "UPDATE classes SET name = ?, archived_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        )
        .run(CLASS_NAME, DEMO_CLASS_ID);
      database
        .prepare(
          "UPDATE assignments SET status = 'READY', archived_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE class_id = ?",
        )
        .run(DEMO_CLASS_ID);
    })();
    return {
      classId: DEMO_CLASS_ID,
      assignmentId: DEMO_FOLLOWUP_ASSIGNMENT_ID,
      created: false,
    };
  }

  database.transaction(() => {
    database
      .prepare(
        "INSERT INTO classes (id, name, grade_band, school_year, is_demo, created_at, updated_at) VALUES (?, ?, 'GRADE_7', '2026–27', 1, ?, ?)",
      )
      .run(DEMO_CLASS_ID, CLASS_NAME, BASELINE_CREATED, BASELINE_CREATED);

    const insertStudent = database.prepare(
      "INSERT INTO students (id, display_name, is_demo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
    );
    const insertMembership = database.prepare(
      "INSERT INTO class_memberships (id, class_id, student_id, sort_order, joined_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (let studentIndex = 1; studentIndex <= 20; studentIndex += 1) {
      const studentId = id(1000 + studentIndex);
      const membershipId = id(2000 + studentIndex);
      const displayName = `Demo learner ${String(studentIndex).padStart(2, "0")}`;
      insertStudent.run(studentId, displayName, BASELINE_CREATED, BASELINE_CREATED);
      insertMembership.run(
        membershipId,
        DEMO_CLASS_ID,
        studentId,
        studentIndex,
        BASELINE_CREATED,
        BASELINE_CREATED,
        BASELINE_CREATED,
      );
    }

    insertAssignment(database, {
      id: DEMO_BASELINE_ASSIGNMENT_ID,
      title: "Unit 3 baseline · Expressions and equations",
      description: "Synthetic baseline evidence used to form versioned Student Model hypotheses.",
      createdAt: BASELINE_CREATED,
      problems: baselineProblems,
      problemIdStart: 3000,
      itemIdStart: 3100,
    });
    insertAssignment(database, {
      id: DEMO_FOLLOWUP_ASSIGNMENT_ID,
      title: "Unit 3 follow-up · Held-out check",
      description: "Synthetic held-out work collected after Prediction Lab claims were locked.",
      createdAt: "2026-01-18T08:00:00.000Z",
      problems: followupProblems,
      problemIdStart: 4000,
      itemIdStart: 4100,
    });

    const diagnosisIds = new Map();
    insertClassWork(database, {
      assignmentId: DEMO_BASELINE_ASSIGNMENT_ID,
      problems: baselineProblems,
      itemIdStart: 3100,
      submissionIdStart: 10000,
      answerIdStart: 11000,
      answerVersionIdStart: 12000,
      diagnosisIdStart: 13000,
      stepIdStart: 14000,
      submittedAt: "2026-01-11T09:00:00.000Z",
      answeredAt: "2026-01-11T09:01:00.000Z",
      diagnosedAt: "2026-01-11T09:02:00.000Z",
      phase: "baseline",
      diagnosisIds,
    });

    const hypothesisId = id(5000);
    const modelId = id(5001);
    database
      .prepare(
        "INSERT INTO student_model_hypotheses (id, class_id, membership_id, domain, scope_key, taxonomy_version, misconception_id, created_at) VALUES (?, ?, ?, 'ALGEBRA', ?, ?, 'SIGN_ERROR_DISTRIBUTION', ?)",
      )
      .run(
        hypothesisId,
        DEMO_CLASS_ID,
        id(2001),
        "ALGEBRA:SIGN_ERROR_DISTRIBUTION",
        TAXONOMY_VERSION,
        MODEL_CREATED,
      );
    database
      .prepare(
        "INSERT INTO student_model_versions (id, hypothesis_id, version, status, rule_statement, formal_pattern_json, scope_limits_json, confidence, support_count, contradiction_count, model_name, prompt_version, schema_version, created_at) VALUES (?, ?, 1, 'PROVISIONAL', ?, ?, ?, 0.93, 0, 0, 'gpt-5.6', 'demo-seed-v1', 'student-model-v1', ?)",
      )
      .run(
        modelId,
        hypothesisId,
        "When a negative factor multiplies parentheses, this learner changes the first term’s sign but preserves the later sign.",
        JSON.stringify({
          inputForm: "−k(a ± b)",
          flawedTransformation: "distribute the magnitude, change only the first sign",
          predictedOutputForm: "−ka ± kb",
          contrastWithCorrectRule: "The signed factor multiplies every term.",
        }),
        JSON.stringify([
          "Two-term algebraic expressions with a negative factor outside parentheses",
          "Abstain when no grouped negative factor is present",
        ]),
        MODEL_CREATED,
      );
    const evidenceOne = diagnosisIds.get("baseline:1:1");
    const evidenceTwo = diagnosisIds.get("baseline:1:2");
    const insertEvidence = database.prepare(
      "INSERT INTO student_model_evidence (student_model_version_id, diagnosis_id, role, weight, rationale, created_at) VALUES (?, ?, 'SUPPORTS', 1, ?, ?)",
    );
    insertEvidence.run(
      modelId,
      evidenceOne,
      "The constant keeps a positive sign after a leading negative is distributed.",
      "2026-01-15T08:02:00.000Z",
    );
    insertEvidence.run(
      modelId,
      evidenceTwo,
      "The same signed transformation repeats on a structurally different problem.",
      "2026-01-15T08:03:00.000Z",
    );
    database
      .prepare(
        "INSERT INTO student_model_finalizations (student_model_version_id, final_status, support_count, contradiction_count, ambiguous_count, finalizer_type, note, finalized_at) VALUES (?, 'SUPPORTED', 2, 0, 0, 'SYSTEM', ?, ?)",
      )
      .run(
        modelId,
        "Synthetic demo model supported by two distinct baseline problems.",
        MODEL_FINALIZED,
      );

    insertPredictions(database, modelId);

    insertClassWork(database, {
      assignmentId: DEMO_FOLLOWUP_ASSIGNMENT_ID,
      problems: followupProblems,
      itemIdStart: 4100,
      submissionIdStart: 20000,
      answerIdStart: 21000,
      answerVersionIdStart: 22000,
      diagnosisIdStart: 23000,
      stepIdStart: 24000,
      submittedAt: FOLLOWUP_SUBMITTED,
      answeredAt: FOLLOWUP_ANSWERED,
      diagnosedAt: FOLLOWUP_DIAGNOSED,
      phase: "followup",
      diagnosisIds,
    });

    insertPredictionOutcomes(database);
    insertTeachingBrief(database, diagnosisIds);
    insertDemoWorksheet(database, modelId);
  })();

  return {
    classId: DEMO_CLASS_ID,
    assignmentId: DEMO_FOLLOWUP_ASSIGNMENT_ID,
    created: true,
  };
}

/** @param {Database} database @param {DemoAssignmentInput} input */
function insertAssignment(database, input) {
  database
    .prepare(
      "INSERT INTO assignments (id, class_id, title, description, domain, status, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'ALGEBRA', 'READY', ?, ?, ?)",
    )
    .run(
      input.id,
      DEMO_CLASS_ID,
      input.title,
      input.description,
      input.createdAt,
      input.createdAt,
      input.createdAt,
    );
  const insertProblem = database.prepare(
    "INSERT INTO problems (id, class_id, domain, prompt, answer_format, correct_answer, canonical_correct_answer, origin, content_hash, created_at) VALUES (?, ?, 'ALGEBRA', ?, 'EXPRESSION', ?, ?, 'SEED', ?, ?)",
  );
  const insertItem = database.prepare(
    "INSERT INTO assignment_items (id, class_id, assignment_id, problem_id, position, points, is_required, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?)",
  );
  input.problems.forEach((problem, index) => {
    const problemId = id(input.problemIdStart + index + 1);
    insertProblem.run(
      problemId,
      DEMO_CLASS_ID,
      problem.prompt,
      problem.correct,
      canonical(problem.correct),
      contentHash("ALGEBRA", problem.prompt),
      input.createdAt,
    );
    insertItem.run(
      id(input.itemIdStart + index + 1),
      DEMO_CLASS_ID,
      input.id,
      problemId,
      index + 1,
      input.createdAt,
    );
  });
}

/** @param {Database} database @param {DemoWorkInput} input */
function insertClassWork(database, input) {
  const insertSubmission = database.prepare(
    "INSERT INTO submissions (id, class_id, assignment_id, membership_id, attempt_number, input_kind, status, submitted_at, processed_at, created_at, updated_at, assignment_item_id, scope_kind) VALUES (?, ?, ?, ?, ?, 'DEMO', ?, ?, ?, ?, ?, ?, 'SINGLE_PROBLEM')",
  );
  const insertAnswer = database.prepare(
    "INSERT INTO submission_answers (id, submission_id, assignment_id, class_id, assignment_item_id, position, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
  );
  const insertVersion = database.prepare(
    "INSERT INTO answer_versions (id, submission_answer_id, version, response_text, normalized_answer, source, confidence, creator_type, change_reason, created_at) VALUES (?, ?, 1, ?, ?, 'SEED', ?, 'SYSTEM', 'Deterministic synthetic demo work', ?)",
  );
  const insertDiagnosis = database.prepare(
    "INSERT INTO diagnoses (id, answer_version_id, version, source, outcome, taxonomy_version, misconception_id, confidence, severity, transcription, observed_transformation, strategy_variant, evidence_quote, transcription_confidence, reasoning_confidence, image_quality, review_reasons_json, model_name, prompt_version, schema_version, created_at) VALUES (?, ?, 1, 'SEED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_APPLICABLE', ?, 'gpt-5.6', 'demo-seed-v1', 'diagnosis-v1', ?)",
  );
  const insertStep = database.prepare(
    "INSERT INTO diagnosis_steps (id, diagnosis_id, position, step_text, normalized_math, correctness, error_note, evidence_quote, created_at, step_kind, parse_issue, correct_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  for (let studentIndex = 1; studentIndex <= 20; studentIndex += 1) {
    for (let problemIndex = 0; problemIndex < input.problems.length; problemIndex += 1) {
      const offset = (studentIndex - 1) * input.problems.length + problemIndex + 1;
      const submissionId = id(input.submissionIdStart + offset);
      const answerId = id(input.answerIdStart + offset);
      const versionId = id(input.answerVersionIdStart + offset);
      const diagnosisId = id(input.diagnosisIdStart + offset);
      const result = demoOutcome(studentIndex, problemIndex, input.phase);
      const isReview = result.outcome === "NEEDS_REVIEW";
      insertSubmission.run(
        submissionId,
        DEMO_CLASS_ID,
        input.assignmentId,
        id(2000 + studentIndex),
        problemIndex + 1,
        isReview ? "NEEDS_REVIEW" : "DIAGNOSED",
        input.submittedAt,
        input.diagnosedAt,
        input.submittedAt,
        input.diagnosedAt,
        id(input.itemIdStart + problemIndex + 1),
      );
      insertAnswer.run(
        answerId,
        submissionId,
        input.assignmentId,
        DEMO_CLASS_ID,
        id(input.itemIdStart + problemIndex + 1),
        input.answeredAt,
      );
      insertVersion.run(
        versionId,
        answerId,
        result.response,
        canonical(result.response),
        isReview ? 0.55 : 0.99,
        input.answeredAt,
      );
      const evidence =
        result.outcome === "CORRECT"
          ? result.response
          : result.outcome === "MISCONCEPTION"
            ? result.response
            : null;
      insertDiagnosis.run(
        diagnosisId,
        versionId,
        result.outcome,
        result.outcome === "MISCONCEPTION" ? TAXONOMY_VERSION : null,
        result.misconceptionId,
        result.confidence,
        result.severity,
        result.response,
        result.outcome === "MISCONCEPTION" ? result.response : null,
        result.misconceptionId,
        evidence,
        isReview ? 0.55 : 0.99,
        result.confidence,
        isReview
          ? JSON.stringify([
              "The final line cannot be parsed confidently as an equation.",
              "Teacher confirmation is required before classification.",
            ])
          : "[]",
        input.diagnosedAt,
      );

      const problem = input.problems[problemIndex];
      if (result.outcome === "CORRECT") {
        insertStep.run(
          id(input.stepIdStart + offset * 2),
          diagnosisId,
          1,
          result.response,
          canonical(result.response),
          "CORRECT",
          null,
          result.response,
          input.diagnosedAt,
          "ANSWER",
          null,
          `This answer is equivalent to the expected result ${problem.correct}.`,
        );
      } else if (result.outcome === "MISCONCEPTION") {
        insertStep.run(
          id(input.stepIdStart + offset * 2 - 1),
          diagnosisId,
          1,
          problem.prompt,
          null,
          "CORRECT",
          null,
          problem.prompt,
          input.diagnosedAt,
          "EXPRESSION",
          null,
          "The problem was copied and the intended operation was identified correctly.",
        );
        insertStep.run(
          id(input.stepIdStart + offset * 2),
          diagnosisId,
          2,
          result.response,
          canonical(result.response),
          "INCORRECT",
          misconceptionNote(result.misconceptionId, problem.correct),
          result.response,
          input.diagnosedAt,
          "ANSWER",
          null,
          null,
        );
      } else {
        insertStep.run(
          id(input.stepIdStart + offset * 2),
          diagnosisId,
          1,
          result.response,
          null,
          "UNCLEAR",
          "The marks do not reliably distinguish an equals sign from a minus sign.",
          null,
          input.diagnosedAt,
          "UNPARSEABLE",
          "No plausible equation can be confirmed from the final line.",
          null,
        );
      }
      input.diagnosisIds.set(
        `${input.phase}:${studentIndex}:${problemIndex + 1}`,
        diagnosisId,
      );
    }
  }
}

/** @param {string | null} misconceptionId @param {string} correctAnswer */
function misconceptionNote(misconceptionId, correctAnswer) {
  /** @type {Record<string, string>} */
  const notes = {
    SIGN_ERROR_DISTRIBUTION:
      "The negative factor must multiply every term, including the constant.",
    DISTRIBUTION_ONE_TERM_ONLY:
      "The outside factor reaches every term inside the parentheses.",
    INVERSE_OPERATION_CONFUSION:
      "Undo addition before dividing so the equation stays balanced.",
    UNLIKE_TERMS_CONJOINED:
      "Unlike constants and variable terms cannot be combined into one term.",
    EQUALITY_AS_OPERATOR:
      "The equal sign states that both sides have the same value; it is not an instruction to copy the right side.",
  };
  const explanation = misconceptionId
    ? notes[misconceptionId]
    : undefined;
  return `${explanation ?? "The observed rule does not preserve equivalence."} The expected answer is ${correctAnswer}.`;
}

/** @param {Database} database @param {string} modelId */
function insertPredictions(database, modelId) {
  const insert = database.prepare(
    "INSERT INTO predictions (id, class_id, membership_id, student_model_version_id, problem_id, target_assignment_item_id, rule_applied, predicted_answer, canonical_predicted_answer, correct_answer_snapshot, canonical_correct_answer, trace_json, confidence, abstention_reason, model_name, prompt_version, schema_version, locked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gpt-5.6', 'demo-seed-v1', 'prediction-v1', ?, ?)",
  );
  followupProblems.forEach((problem, index) => {
    const prediction = predictedAnswers[index];
    insert.run(
      id(6001 + index),
      DEMO_CLASS_ID,
      id(2001),
      modelId,
      id(4001 + index),
      id(4101 + index),
      prediction.applied ? 1 : 0,
      prediction.answer,
      prediction.canonical,
      problem.correct,
      canonical(problem.correct),
      JSON.stringify({
        inputFormMatched: prediction.applied
          ? "A negative factor multiplies a two-term grouped expression."
          : "No grouped negative factor is present.",
        appliedTransformation: prediction.applied
          ? "Change the first sign and preserve the later sign."
          : "No transformation was applied.",
        predictedResult: prediction.answer,
        scopeCheck: prediction.applied
          ? "Inside the supported model scope."
          : "Outside the versioned model scope.",
      }),
      prediction.applied ? 0.93 : 0.91,
      prediction.applied
        ? null
        : "This equation has no negative factor outside parentheses, so the model abstains.",
      PREDICTION_LOCKED,
      PREDICTION_LOCKED,
    );
  });
}

/** @param {Database} database */
function insertPredictionOutcomes(database) {
  const insert = database.prepare(
    "INSERT INTO prediction_outcome_versions (id, prediction_id, version, answer_version_id, actual_answer_snapshot, canonical_actual_answer, match_state, evaluation_method, confidence, note, observed_at, evaluated_at, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, 'DETERMINISTIC', 1, ?, ?, ?, ?)",
  );
  for (let problemIndex = 0; problemIndex < 4; problemIndex += 1) {
    const answerOffset = problemIndex + 1;
    const result = demoOutcome(1, problemIndex, "followup");
    const prediction = predictedAnswers[problemIndex];
    const match = canonical(result.response) === prediction.canonical;
    insert.run(
      id(7001 + problemIndex),
      id(6001 + problemIndex),
      id(22000 + answerOffset),
      result.response,
      canonical(result.response),
      match ? "MATCH" : "MISMATCH",
      match
        ? "Canonical predicted and actual answers match."
        : "The held-out answer differs from the locked model prediction.",
      FOLLOWUP_SUBMITTED,
      "2026-01-21T09:05:00.000Z",
      "2026-01-21T09:05:00.000Z",
    );
  }
}

/** @param {Database} database @param {Map<string, string>} diagnosisIds */
function insertTeachingBrief(database, diagnosisIds) {
  const briefId = id(8001);
  database
    .prepare(
      "INSERT INTO teaching_briefs (id, class_id, assignment_id, taxonomy_version, misconception_id, paragraph, cluster_student_count, diagnosed_student_count, evidence_cutoff_at, worked_example_problem_id, model_name, prompt_version, schema_version, created_at) VALUES (?, ?, ?, ?, 'SIGN_ERROR_DISTRIBUTION', ?, 8, 20, ?, ?, 'gpt-5.6', 'demo-seed-v1', 'teaching-brief-v1', ?)",
    )
    .run(
      briefId,
      DEMO_CLASS_ID,
      DEMO_FOLLOWUP_ASSIGNMENT_ID,
      TAXONOMY_VERSION,
      "Students are treating a negative sign as a local mark on the first term instead of multiplication by −1 across the whole group. This often forms when distribution is memorized as a visual arrow rather than understood as equivalent multiplication. For a 10-minute intervention, write −3(x + 4), ask students to predict both products, rewrite it as −1 · 3 · (x + 4), and verify the correct expansion −3x − 12 by substituting x = 2; then have pairs contrast it with the tempting −3x + 12 and explain why only one preserves the original value.",
      FOLLOWUP_DIAGNOSED,
      id(4001),
      "2026-01-21T09:06:00.000Z",
    );
  const insertEvidence = database.prepare(
    "INSERT INTO teaching_brief_evidence (teaching_brief_id, diagnosis_id) VALUES (?, ?)",
  );
  for (let studentIndex = 1; studentIndex <= 8; studentIndex += 1) {
    insertEvidence.run(
      briefId,
      diagnosisIds.get(`followup:${studentIndex}:1`),
    );
  }
}

/** @param {Database} database @param {string} modelId */
function insertDemoWorksheet(database, modelId) {
  const worksheetId = id(9001);
  database
    .prepare(
      "INSERT INTO worksheets (id, class_id, membership_id, student_model_version_id, assignment_id, title, rationale, status, model_name, prompt_version, schema_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'READY', 'gpt-5.6', 'demo-seed-v1', 'practice-v1', ?)",
    )
    .run(
      worksheetId,
      DEMO_CLASS_ID,
      id(2001),
      modelId,
      DEMO_FOLLOWUP_ASSIGNMENT_ID,
      "Distribute the negative to every term",
      "Each problem creates a discrepant event: the supported flawed rule and the correct rule produce visibly different signs.",
      "2026-01-21T09:07:00.000Z",
    );
  const insertProblem = database.prepare(
    "INSERT INTO problems (id, class_id, domain, prompt, answer_format, correct_answer, canonical_correct_answer, origin, content_hash, created_at) VALUES (?, ?, 'ALGEBRA', ?, 'EXPRESSION', ?, ?, 'WORKSHEET', ?, ?)",
  );
  const insertItem = database.prepare(
    "INSERT INTO worksheet_items (id, worksheet_id, class_id, problem_id, position, difficulty, taxonomy_version, misconception_id, misconception_predicted_answer, hint, explanation, discrepant_event_rationale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'SIGN_ERROR_DISTRIBUTION', ?, ?, ?, ?, ?)",
  );
  const practice = [
    ["Expand −(x + 3).", "−x − 3", "−x + 3"],
    ["Expand −2(y + 4).", "−2y − 8", "−2y + 8"],
    ["Expand −3(2a + 5).", "−6a − 15", "−6a + 15"],
    ["Simplify 4 − 2(m + 6).", "−2m − 8", "−2m + 16"],
    ["Expand −5(2p − 3q + 1).", "−10p + 15q − 5", "−10p − 15q + 5"],
  ];
  practice.forEach(([prompt, answer, flawed], index) => {
    const problemId = id(9101 + index);
    const createdAt = "2026-01-21T09:07:00.000Z";
    insertProblem.run(
      problemId,
      DEMO_CLASS_ID,
      prompt,
      answer,
      canonical(answer),
      contentHash("ALGEBRA", prompt),
      createdAt,
    );
    insertItem.run(
      id(9201 + index),
      worksheetId,
      DEMO_CLASS_ID,
      problemId,
      index + 1,
      index + 1,
      TAXONOMY_VERSION,
      flawed,
      "Treat the negative factor as multiplication and apply it to every term.",
      `Every top-level term receives the signed factor, so the correct result is ${answer}.`,
      `The flawed rule predicts ${flawed}, which differs visibly from ${answer}.`,
      createdAt,
    );
  });
}
