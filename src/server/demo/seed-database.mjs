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
const DEMO_SCHOOL_NAME = "Riverside Middle School · Synthetic Demo";
const DEMO_STUDENT_NAMES = [
  "Camille Laurent",
  "Lucas Moreau",
  "Inès Bernard",
  "Hugo Petit",
  "Léa Dubois",
  "Nathan Girard",
  "Chloé Rousseau",
  "Adam Fontaine",
  "Manon Lefèvre",
  "Yanis Mercier",
  "Jade Bonnet",
  "Théo Lambert",
  "Sarah Vidal",
  "Enzo Faure",
  "Louna Garnier",
  "Rayan Chevalier",
  "Emma Robin",
  "Noah Blanchard",
  "Zoé Marchand",
  "Malik Henry",
];

/** @typedef {import("better-sqlite3").Database} Database */
/**
 * @typedef {{
 *   exerciseLabel: string;
 *   questionLabel: string;
 *   sharedContext: string | null;
 *   prompt: string;
 *   correct: string;
 * }} DemoProblem
 */
/** @typedef {"baseline" | "followup"} DemoPhase */
/**
 * @typedef {{
 *   outcome: "CORRECT" | "MISCONCEPTION" | "NEEDS_REVIEW";
 *   misconceptionId: string | null;
 *   response: string;
 *   severity: number;
 *   confidence: number;
 *   reviewReasons?: string[];
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
  { exerciseLabel: "Exercice 1 — Développer", questionLabel: "1.1", sharedContext: "Développer chaque expression en appliquant le facteur à tous les termes.", prompt: "Développer −(x + 6).", correct: "−x − 6" },
  { exerciseLabel: "Exercice 1 — Développer", questionLabel: "1.2", sharedContext: "Développer chaque expression en appliquant le facteur à tous les termes.", prompt: "Développer −2(y + 5).", correct: "−2y − 10" },
  { exerciseLabel: "Exercice 1 — Développer", questionLabel: "1.3", sharedContext: "Développer chaque expression en appliquant le facteur à tous les termes.", prompt: "Développer 3(a + 4).", correct: "3a + 12" },
  { exerciseLabel: "Exercice 1 — Développer", questionLabel: "1.4", sharedContext: "Développer chaque expression en appliquant le facteur à tous les termes.", prompt: "Développer −3(b + 2).", correct: "−3b − 6" },
  { exerciseLabel: "Exercice 1 — Développer", questionLabel: "1.5", sharedContext: "Développer chaque expression en appliquant le facteur à tous les termes.", prompt: "Développer −4(c − 3).", correct: "−4c + 12" },
  { exerciseLabel: "Exercice 1 — Développer", questionLabel: "1.6", sharedContext: "Développer chaque expression en appliquant le facteur à tous les termes.", prompt: "Développer −5(d + 1).", correct: "−5d − 5" },
  { exerciseLabel: "Exercice 2 — Équation", questionLabel: "2.1", sharedContext: null, prompt: "Résoudre x + 7 = 12.", correct: "x = 5" },
  { exerciseLabel: "Exercice 3 — Réduire", questionLabel: "3.1", sharedContext: null, prompt: "Réduire 2x + 3 + x.", correct: "3x + 3" },
];

const followupProblems = [
  { exerciseLabel: "Exercice 1 — Signe et parenthèses", questionLabel: "1.1", sharedContext: "Développer puis réduire les expressions suivantes.", prompt: "Développer puis réduire −3(x + 4).", correct: "−3x − 12" },
  { exerciseLabel: "Exercice 1 — Signe et parenthèses", questionLabel: "1.2", sharedContext: "Développer puis réduire les expressions suivantes.", prompt: "Développer puis réduire −(2y − 5).", correct: "−2y + 5" },
  { exerciseLabel: "Exercice 2 — Distribution", questionLabel: "2.1", sharedContext: "Développer en faisant apparaître chaque produit.", prompt: "Développer −2(a + 7) en faisant apparaître chaque produit.", correct: "−2a − 14" },
  { exerciseLabel: "Exercice 2 — Distribution", questionLabel: "2.2", sharedContext: "Développer en faisant apparaître chaque produit.", prompt: "Développer −4(m − 3) en faisant apparaître chaque produit.", correct: "−4m + 12" },
  { exerciseLabel: "Exercice 3 — Équation", questionLabel: "3.1", sharedContext: null, prompt: "Résoudre 2x + 5 = 17.", correct: "x = 6" },
];

const predictedAnswers = [
  { kind: "FLAWED_RULE_APPLIES", answer: "−3x + 12", canonical: "-3x+12" },
  { kind: "FLAWED_RULE_APPLIES", answer: "−2y − 5", canonical: "-2y-5" },
  { kind: "FLAWED_RULE_APPLIES", answer: "−2a + 14", canonical: "-2a+14" },
  { kind: "FLAWED_RULE_APPLIES", answer: "−4m − 12", canonical: "-4m-12" },
  { kind: "MASTERY", answer: "x = 6", canonical: "x=6" },
];

/** @param {number} number */
function id(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

/** @param {Database} database */
function ensureDemoGradebook(database) {
  database
    .prepare(
      "UPDATE assignment_items SET points = CASE assignment_id WHEN ? THEN 2.5 WHEN ? THEN 4 ELSE points END WHERE class_id = ? AND assignment_id IN (?, ?)",
    )
    .run(
      DEMO_BASELINE_ASSIGNMENT_ID,
      DEMO_FOLLOWUP_ASSIGNMENT_ID,
      DEMO_CLASS_ID,
      DEMO_BASELINE_ASSIGNMENT_ID,
      DEMO_FOLLOWUP_ASSIGNMENT_ID,
    );
  database
    .prepare(
      "UPDATE classes SET school_name = ?, updated_at = ? WHERE id = ? AND school_name IS NULL",
    )
    .run(
      DEMO_SCHOOL_NAME,
      "2026-01-22T08:00:00.000Z",
      DEMO_CLASS_ID,
    );

  const updateLegacyName = database.prepare(
    "UPDATE students SET display_name = ?, updated_at = ? WHERE id = ? AND is_demo = 1 AND display_name GLOB 'Demo learner *'",
  );
  DEMO_STUDENT_NAMES.forEach((displayName, index) => {
    updateLegacyName.run(
      displayName,
      "2026-01-22T08:00:00.000Z",
      id(1001 + index),
    );
  });

  const insertGrade = database.prepare(
    [
      "INSERT INTO exam_grades",
      "(id, class_id, assignment_id, membership_id, score, max_score, graded_at, created_at, updated_at)",
      "VALUES (?, ?, ?, ?, ?, 20, ?, ?, ?)",
      "ON CONFLICT (assignment_id, membership_id) DO NOTHING",
    ].join(" "),
  );
  const assignments = [
    {
      id: DEMO_BASELINE_ASSIGNMENT_ID,
      gradedStudentCount: 20,
      gradeIdStart: 90_000,
      timestampDay: "22",
      score: (studentIndex) => 8 + ((studentIndex * 7) % 12),
    },
    {
      id: DEMO_FOLLOWUP_ASSIGNMENT_ID,
      gradedStudentCount: 16,
      gradeIdStart: 90_100,
      timestampDay: "23",
      score: (studentIndex) => 9 + ((studentIndex * 5) % 11),
    },
  ];
  for (const assignment of assignments) {
    for (
      let studentIndex = 1;
      studentIndex <= assignment.gradedStudentCount;
      studentIndex += 1
    ) {
      const timestamp = `2026-01-${assignment.timestampDay}T08:${String(studentIndex).padStart(2, "0")}:00.000Z`;
      insertGrade.run(
        id(assignment.gradeIdStart + studentIndex),
        DEMO_CLASS_ID,
        assignment.id,
        id(2000 + studentIndex),
        assignment.score(studentIndex),
        timestamp,
        timestamp,
        timestamp,
      );
    }
  }
  ensureDemoGradingProposals(database);
}

/** @param {Database} database */
function ensureDemoGradingProposals(database) {
  const existingCount = database
    .prepare(
      "SELECT count(*) FROM exam_grade_proposals WHERE assignment_id = ? AND membership_id IN (?, ?)",
    )
    .pluck()
    .get(DEMO_FOLLOWUP_ASSIGNMENT_ID, id(2016), id(2020));
  if (existingCount === 2) return;

  const questionRows = database
    .prepare(
      [
        "SELECT item.id AS assignment_item_id, item.position, item.points, item.question_label,",
        "exercise.position AS exercise_position, diagnosis.id AS diagnosis_id,",
        "COALESCE(diagnosis.correction_verdict, diagnosis.outcome) AS outcome,",
        "diagnosis.evidence_quote",
        "FROM assignment_items AS item",
        "JOIN exercises AS exercise ON exercise.id = item.exercise_id",
        "JOIN submissions AS submission ON submission.assignment_item_id = item.id AND submission.membership_id = ?",
        "JOIN submission_answers AS answer ON answer.submission_id = submission.id",
        "JOIN answer_versions AS answer_version ON answer_version.submission_answer_id = answer.id",
        "JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = answer_version.id",
        "WHERE item.assignment_id = ? ORDER BY item.position",
      ].join(" "),
    );
  const insertProposal = database.prepare(
    [
      "INSERT INTO exam_grade_proposals",
      "(id, class_id, assignment_id, membership_id, version, status, model_name, prompt_version, schema_version,",
      "input_hash, output_hash, proposed_total, max_score, incomplete, manual_item_count, latency_ms, created_at, validated_at)",
      "VALUES (?, ?, ?, ?, 1, ?, 'gpt-5.6', 'demo-grading-v1', '1.0.0', ?, ?, ?, 20, ?, ?, 0, ?, ?)",
    ].join(" "),
  );
  const insertItem = database.prepare(
    [
      "INSERT INTO exam_grade_proposal_items",
      "(id, proposal_id, assignment_item_id, diagnosis_id, position, question_reference, max_points, proposed_score, final_score,",
      "credit_basis, evidence_quote, justification, manual_reason, created_at, validated_at)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join(" "),
  );
  const insertAudit = database.prepare(
    [
      "INSERT INTO exam_grade_validation_audit",
      "(id, proposal_id, assignment_item_id, ai_proposed_score, teacher_final_score, max_points, validated_at)",
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
    ].join(" "),
  );

  for (const fixture of [
    {
      membershipId: id(2016),
      proposalId: id(93_016),
      status: "VALIDATED",
      timestamp: "2026-01-23T09:16:00.000Z",
      teacherTotal: 12,
    },
    {
      membershipId: id(2020),
      proposalId: id(93_020),
      status: "PROPOSED",
      timestamp: "2026-01-23T09:17:00.000Z",
      teacherTotal: null,
    },
  ]) {
    if (
      database
        .prepare("SELECT 1 FROM exam_grade_proposals WHERE id = ?")
        .get(fixture.proposalId)
    ) {
      continue;
    }
    const rows = questionRows.all(
      fixture.membershipId,
      DEMO_FOLLOWUP_ASSIGNMENT_ID,
    );
    const proposedItems = rows.map((row) => {
      if (row.outcome === "NEEDS_REVIEW") {
        return {
          ...row,
          proposedScore: null,
          creditBasis: "MANUAL_REQUIRED",
          evidenceQuote: null,
          justification: null,
          manualReason: "NEEDS_REVIEW",
        };
      }
      if (row.outcome === "CORRECT") {
        return {
          ...row,
          proposedScore: row.points,
          creditBasis: "FULL_CORRECT_REASONING",
          evidenceQuote: row.evidence_quote,
          justification:
            "Le raisonnement visible aboutit à la réponse attendue ; tous les points sont proposés.",
          manualReason: null,
        };
      }
      return {
        ...row,
        proposedScore: row.points / 2,
        creditBasis: "PARTIAL_CORRECT_PREFIX",
        evidenceQuote: row.evidence_quote,
        justification:
          "La mise en place de l’expression est correcte avant l’erreur de signe ; cette étape correcte justifie un crédit partiel.",
        manualReason: null,
      };
    });
    const proposedTotal = proposedItems.reduce(
      (sum, item) => sum + (item.proposedScore ?? 0),
      0,
    );
    const manualItemCount = proposedItems.filter(
      (item) => item.proposedScore === null,
    ).length;
    const inputHash = createHash("sha256")
      .update(`demo-grade-input:${fixture.membershipId}`)
      .digest("hex");
    const outputHash = createHash("sha256")
      .update(JSON.stringify(proposedItems))
      .digest("hex");
    insertProposal.run(
      fixture.proposalId,
      DEMO_CLASS_ID,
      DEMO_FOLLOWUP_ASSIGNMENT_ID,
      fixture.membershipId,
      fixture.status,
      inputHash,
      outputHash,
      proposedTotal,
      manualItemCount > 0 ? 1 : 0,
      manualItemCount,
      fixture.timestamp,
      fixture.status === "VALIDATED" ? fixture.timestamp : null,
    );

    let remainingTeacherPoints = fixture.teacherTotal;
    proposedItems.forEach((item, index) => {
      const finalScore =
        remainingTeacherPoints === null
          ? null
          : Math.min(item.points, remainingTeacherPoints);
      if (remainingTeacherPoints !== null) {
        remainingTeacherPoints -= finalScore ?? 0;
      }
      const questionReference = `Ex. ${item.exercise_position} · Q${item.question_label}`;
      insertItem.run(
        id(94_000 + (fixture.membershipId === id(2016) ? 0 : 100) + index + 1),
        fixture.proposalId,
        item.assignment_item_id,
        item.diagnosis_id,
        item.position,
        questionReference,
        item.points,
        item.proposedScore,
        finalScore,
        item.creditBasis,
        item.evidenceQuote,
        item.justification,
        item.manualReason,
        fixture.timestamp,
        finalScore === null ? null : fixture.timestamp,
      );
      if (finalScore !== null) {
        insertAudit.run(
          id(95_000 + index + 1),
          fixture.proposalId,
          item.assignment_item_id,
          item.proposedScore,
          finalScore,
          item.points,
          fixture.timestamp,
        );
      }
    });
    if (fixture.status === "VALIDATED") {
      database
        .prepare(
          "UPDATE exam_grades SET validated_proposal_id = ? WHERE assignment_id = ? AND membership_id = ?",
        )
        .run(
          fixture.proposalId,
          DEMO_FOLLOWUP_ASSIGNMENT_ID,
          fixture.membershipId,
        );
    }
  }
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
    if (studentIndex === 1 && problemIndex === 3) {
      return misconception("SIGN_ERROR_DISTRIBUTION", "−3b + 6", 3);
    }
    if (studentIndex === 1 && problemIndex === 4) {
      return misconception("SIGN_ERROR_DISTRIBUTION", "−4c − 12", 3);
    }
    if (studentIndex >= 9 && studentIndex <= 12 && problemIndex === 2) {
      return misconception("DISTRIBUTION_ONE_TERM_ONLY", "3a + 4", 2);
    }
    if (studentIndex >= 13 && studentIndex <= 15 && problemIndex === 6) {
      return misconception("INVERSE_OPERATION_CONFUSION", "x = 19", 2);
    }
    if (studentIndex >= 16 && studentIndex <= 18 && problemIndex === 7) {
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
  if (studentIndex === 19 && problemIndex === 4) {
    return outOfScope("Diagram response without an algebraic answer");
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
    reviewReasons: [
      "LOW_TRANSCRIPTION_CONFIDENCE",
      "IMPLAUSIBLE_TRANSCRIPTION_STEP",
    ],
  };
}

/** @param {string} response @returns {DemoOutcome} */
function outOfScope(response) {
  return {
    outcome: "NEEDS_REVIEW",
    misconceptionId: null,
    response,
    severity: 0,
    confidence: 0.36,
    reviewReasons: ["NO_TAXONOMY_MATCH"],
  };
}

/** @param {Database} database */
export function seedDemoDatabase(database) {
  const existing = database
    .prepare("SELECT id, archived_at FROM classes WHERE id = ?")
    .get(DEMO_CLASS_ID);
  if (existing) {
    const core = database
      .prepare(
        [
          "SELECT",
          "(SELECT count(*) FROM class_memberships WHERE class_id = ?) AS membership_count,",
          "(SELECT count(*) FROM assignments WHERE id IN (?, ?) AND class_id = ?) AS assignment_count",
        ].join(" "),
      )
      .get(
        DEMO_CLASS_ID,
        DEMO_BASELINE_ASSIGNMENT_ID,
        DEMO_FOLLOWUP_ASSIGNMENT_ID,
        DEMO_CLASS_ID,
      );
    if (core.membership_count >= 20 && core.assignment_count === 2) {
      database.transaction(() => {
        database
          .prepare(
            "UPDATE classes SET archived_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
          )
          .run(DEMO_CLASS_ID);
        database
          .prepare(
            "UPDATE assignments SET status = 'READY', archived_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id IN (?, ?) AND class_id = ?",
          )
          .run(
            DEMO_BASELINE_ASSIGNMENT_ID,
            DEMO_FOLLOWUP_ASSIGNMENT_ID,
            DEMO_CLASS_ID,
          );
        ensureDemoGradebook(database);
      })();
      return {
        classId: DEMO_CLASS_ID,
        assignmentId: DEMO_FOLLOWUP_ASSIGNMENT_ID,
        created: false,
      };
    }

    database.transaction(() => {
      database
        .prepare("DELETE FROM classes WHERE id = ?")
        .run(DEMO_CLASS_ID);
      database
        .prepare(
          "DELETE FROM students WHERE is_demo = 1 AND NOT EXISTS (SELECT 1 FROM class_memberships WHERE student_id = students.id)",
        )
        .run();
    })();
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
      const displayName = DEMO_STUDENT_NAMES[studentIndex - 1];
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
        "INSERT INTO student_model_versions (id, hypothesis_id, version, status, rule_statement, formal_pattern_json, scope_limits_json, confidence, support_count, contradiction_count, observed_application_count, observed_opportunity_count, observed_application_rate, mastery_evidence_count, model_name, prompt_version, schema_version, created_at) VALUES (?, ?, 1, 'PROVISIONAL', ?, ?, ?, 0.93, 0, 0, 4, 5, 0.8, 2, 'gpt-5.6', 'demo-seed-v2', 'student-model-v1.1', ?)",
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
    const insertOpportunity = database.prepare(
      "INSERT INTO student_model_opportunities (student_model_version_id, diagnosis_id, application_state, rationale, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    [1, 2, 4, 5].forEach((questionNumber, index) => {
      insertOpportunity.run(
        modelId,
        diagnosisIds.get(`baseline:1:${questionNumber}`),
        "APPLIED_RULE",
        "The synthetic learner applied the signed-distribution rule on this observed opportunity.",
        `2026-01-15T08:0${index + 1}:30.000Z`,
      );
    });
    insertOpportunity.run(
      modelId,
      diagnosisIds.get("baseline:1:6"),
      "DID_NOT_APPLY",
      "The same structure offered an opportunity, but the synthetic learner distributed the sign correctly.",
      "2026-01-15T08:04:30.000Z",
    );
    const insertMastery = database.prepare(
      "INSERT INTO student_model_mastery_evidence (student_model_version_id, diagnosis_id, skill_key, rationale, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertMastery.run(
      modelId,
      diagnosisIds.get("baseline:1:6"),
      "DISTRIBUTION",
      "Demonstrated correct signed distribution on a related problem.",
      "2026-01-15T08:04:31.000Z",
    );
    insertMastery.run(
      modelId,
      diagnosisIds.get("baseline:1:7"),
      "EQUATION_SOLVING",
      "Demonstrated correct one-step equation solving before the held-out check.",
      "2026-01-15T08:04:32.000Z",
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
    insertRevisionSuggestion(database, modelId, diagnosisIds);
    insertTeachingBrief(database, diagnosisIds);
    insertDemoWorksheet(database, modelId);
    ensureDemoGradebook(database);
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
  const insertExercise = database.prepare(
    "INSERT INTO exercises (id, class_id, assignment_id, position, exercise_label, shared_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertItem = database.prepare(
    "INSERT INTO assignment_items (id, class_id, assignment_id, problem_id, position, points, is_required, created_at, exercise_id, question_label) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)",
  );
  const exerciseIds = new Map();
  input.problems.forEach((problem, index) => {
    let exerciseId = exerciseIds.get(problem.exerciseLabel);
    if (!exerciseId) {
      exerciseId = id(input.itemIdStart + 80 + exerciseIds.size + 1);
      exerciseIds.set(problem.exerciseLabel, exerciseId);
      insertExercise.run(
        exerciseId,
        DEMO_CLASS_ID,
        input.id,
        exerciseIds.size,
        problem.exerciseLabel,
        problem.sharedContext,
        input.createdAt,
      );
    }
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
      exerciseId,
      problem.questionLabel,
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
          ? JSON.stringify(
              result.reviewReasons ?? [
                "LOW_CONFIDENCE",
                "MODEL_REQUESTED_REVIEW",
              ],
            )
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
          `Cette réponse est équivalente au résultat attendu ${problem.correct}.`,
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
          "L’énoncé a été recopié et l’opération demandée a été correctement identifiée.",
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
          "Les traces ne permettent pas de distinguer avec certitude un signe égal d’un signe moins.",
          null,
          input.diagnosedAt,
          "UNPARSEABLE",
          "Aucune équation plausible ne peut être confirmée à partir de la dernière ligne.",
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
      "Le facteur négatif doit multiplier chaque terme, y compris la constante.",
    DISTRIBUTION_ONE_TERM_ONLY:
      "Le facteur extérieur doit multiplier chaque terme entre parenthèses.",
    INVERSE_OPERATION_CONFUSION:
      "Il faut annuler l’addition avant de diviser afin de conserver l’équilibre de l’équation.",
    UNLIKE_TERMS_CONJOINED:
      "Une constante et un terme avec une variable ne peuvent pas être réduits en un seul terme.",
    EQUALITY_AS_OPERATOR:
      "Le signe égal indique que les deux membres ont la même valeur ; il ne demande pas de recopier le membre de droite.",
  };
  const explanation = misconceptionId
    ? notes[misconceptionId]
    : undefined;
  return `${explanation ?? "La règle observée ne conserve pas l’équivalence."} La réponse attendue est ${correctAnswer}.`;
}

/** @param {Database} database @param {string} modelId */
function insertPredictions(database, modelId) {
  const insert = database.prepare(
    "INSERT INTO predictions (id, class_id, membership_id, student_model_version_id, problem_id, target_assignment_item_id, rule_applied, predicted_answer, canonical_predicted_answer, correct_answer_snapshot, canonical_correct_answer, trace_json, confidence, abstention_reason, model_name, prompt_version, schema_version, locked_at, created_at, prediction_kind, consistency_snapshot, mastery_evidence_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gpt-5.6', 'demo-seed-v2', 'prediction-v2', ?, ?, ?, 0.8, ?)",
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
      prediction.kind === "ABSTAIN" ? 0 : 1,
      prediction.answer,
      prediction.canonical,
      problem.correct,
      canonical(problem.correct),
      JSON.stringify({
        inputFormMatched:
          prediction.kind === "FLAWED_RULE_APPLIES"
            ? "A negative factor multiplies a two-term grouped expression."
            : "A one-step equation matches demonstrated equation-solving evidence.",
        appliedTransformation:
          prediction.kind === "FLAWED_RULE_APPLIES"
            ? "Change the first sign and preserve the later sign."
            : "Use the demonstrated inverse-operation strategy.",
        predictedResult: prediction.answer,
        scopeCheck:
          prediction.kind === "FLAWED_RULE_APPLIES"
            ? "Inside the supported flawed-rule scope."
            : "Outside the flawed-rule scope but supported by matching mastery evidence.",
      }),
      prediction.kind === "FLAWED_RULE_APPLIES" ? 0.8 : 0.92,
      null,
      PREDICTION_LOCKED,
      PREDICTION_LOCKED,
      prediction.kind,
      prediction.kind === "MASTERY"
        ? "Correct equation solving was demonstrated on Ex. 2 · Q2.1 in the baseline assignment."
        : null,
    );
  });
}

/** @param {Database} database */
function insertPredictionOutcomes(database) {
  const insert = database.prepare(
    "INSERT INTO prediction_outcome_versions (id, prediction_id, version, answer_version_id, actual_answer_snapshot, canonical_actual_answer, match_state, evaluation_method, confidence, note, observed_at, evaluated_at, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, 'DETERMINISTIC', 1, ?, ?, ?, ?)",
  );
  for (let problemIndex = 0; problemIndex < 5; problemIndex += 1) {
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

/** @param {Database} database @param {string} modelId @param {Map<string, string>} diagnosisIds */
function insertRevisionSuggestion(database, modelId, diagnosisIds) {
  database
    .prepare(
      [
        "INSERT INTO student_model_revision_suggestions",
        "(id, class_id, membership_id, student_model_version_id, prediction_id, contradicting_diagnosis_id,",
        "suggestion_kind, proposed_rule_statement, proposed_formal_pattern_json, proposed_scope_limits_json, proposed_application_rate,",
        "rationale, evidence_connection, model_name, prompt_version, schema_version, created_at)",
        "VALUES (?, ?, ?, ?, ?, ?, 'DOWNGRADE_CONSISTENCY', NULL, NULL, NULL, ?, ?, ?, 'gpt-5.6', 'demo-seed-v2', 'model-revision-v1', ?)",
      ].join(" "),
    )
    .run(
      id(7501),
      DEMO_CLASS_ID,
      id(2001),
      modelId,
      id(6004),
      diagnosisIds.get("followup:1:4"),
      4 / 6,
      "Keep the observable signed-distribution rule, but lower its expected application rate after the later strategy differed.",
      "The locked answer was −4m − 12; the later response was 4m − 12, so this outcome becomes new evidence only if the teacher confirms it.",
      "2026-01-21T09:06:30.000Z",
    );
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
