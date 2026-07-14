DROP TRIGGER student_model_status_requires_evidence_counts;
DROP TRIGGER student_model_versions_only_supersede;
DROP TRIGGER prediction_outcomes_match_locked_prediction;
DROP VIEW current_student_model_versions;
DROP VIEW student_prediction_metrics;

-- This migration adds a required held-out target. Refuse to invent provenance
-- for legacy predictions; this project had none before the column was added.
CREATE TABLE _migration_004_prediction_guard (
  violations INTEGER NOT NULL CHECK (violations = 0)
) STRICT;

INSERT INTO _migration_004_prediction_guard
SELECT count(*) FROM predictions;

DROP TABLE _migration_004_prediction_guard;

ALTER TABLE predictions
ADD COLUMN target_assignment_item_id TEXT
  REFERENCES assignment_items(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX one_prediction_per_student_problem
  ON predictions(membership_id, problem_id);

CREATE UNIQUE INDEX one_prediction_per_student_target
  ON predictions(membership_id, target_assignment_item_id)
  WHERE target_assignment_item_id IS NOT NULL;

CREATE TABLE student_model_finalizations (
  student_model_version_id TEXT PRIMARY KEY NOT NULL,
  final_status TEXT NOT NULL CHECK (
    final_status IN ('SUPPORTED', 'CONTRADICTED', 'INSUFFICIENT_EVIDENCE')
  ),
  support_count INTEGER NOT NULL CHECK (support_count >= 0),
  contradiction_count INTEGER NOT NULL CHECK (contradiction_count >= 0),
  ambiguous_count INTEGER NOT NULL CHECK (ambiguous_count >= 0),
  finalizer_type TEXT NOT NULL CHECK (finalizer_type IN ('TEACHER', 'SYSTEM')),
  note TEXT,
  finalized_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (julianday(finalized_at) IS NOT NULL),
  FOREIGN KEY (student_model_version_id)
    REFERENCES student_model_versions(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE prediction_invalidations (
  prediction_id TEXT PRIMARY KEY NOT NULL,
  submission_answer_id TEXT,
  reason TEXT NOT NULL CHECK (
    reason IN ('PRIOR_WORK_DISCOVERED', 'TARGET_WITHDRAWN', 'TEACHER_INVALIDATED')
  ),
  note TEXT,
  invalidated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (julianday(invalidated_at) IS NOT NULL),
  FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
  FOREIGN KEY (submission_answer_id) REFERENCES submission_answers(id) ON DELETE SET NULL
) STRICT;

-- Taxonomy snapshots are historical evidence records. Publish a new version
-- rather than changing the meaning or sources of an existing diagnosis.
CREATE TRIGGER taxonomy_versions_are_immutable
BEFORE UPDATE ON taxonomy_versions
BEGIN
  SELECT RAISE(ABORT, 'taxonomy versions are immutable; publish a new version');
END;

CREATE TRIGGER taxonomy_versions_cannot_be_deleted
BEFORE DELETE ON taxonomy_versions
BEGIN
  SELECT RAISE(ABORT, 'taxonomy versions cannot be deleted');
END;

CREATE TRIGGER taxonomy_sources_are_immutable
BEFORE UPDATE ON taxonomy_sources
BEGIN
  SELECT RAISE(ABORT, 'taxonomy sources are immutable; publish a new version');
END;

CREATE TRIGGER taxonomy_sources_cannot_be_deleted
BEFORE DELETE ON taxonomy_sources
BEGIN
  SELECT RAISE(ABORT, 'taxonomy sources cannot be deleted');
END;

CREATE TRIGGER taxonomy_terms_are_immutable
BEFORE UPDATE ON taxonomy_terms
BEGIN
  SELECT RAISE(ABORT, 'taxonomy terms are immutable; publish a new version');
END;

CREATE TRIGGER taxonomy_terms_cannot_be_deleted
BEFORE DELETE ON taxonomy_terms
BEGIN
  SELECT RAISE(ABORT, 'taxonomy terms cannot be deleted');
END;

CREATE TRIGGER taxonomy_term_sources_are_immutable
BEFORE UPDATE ON taxonomy_term_sources
BEGIN
  SELECT RAISE(ABORT, 'taxonomy term links are immutable; publish a new version');
END;

CREATE TRIGGER taxonomy_term_sources_cannot_be_deleted
BEFORE DELETE ON taxonomy_term_sources
BEGIN
  SELECT RAISE(ABORT, 'taxonomy term links cannot be deleted');
END;

-- Freeze the identity edges that prove whose work answered which problem.
CREATE TRIGGER class_membership_identity_is_immutable
BEFORE UPDATE ON class_memberships
WHEN
  NEW.id IS NOT OLD.id
  OR NEW.class_id IS NOT OLD.class_id
  OR NEW.student_id IS NOT OLD.student_id
  OR NEW.joined_at IS NOT OLD.joined_at
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'class membership identity is immutable');
END;

CREATE TRIGGER assignment_item_provenance_is_immutable
BEFORE UPDATE ON assignment_items
WHEN
  NEW.id IS NOT OLD.id
  OR NEW.class_id IS NOT OLD.class_id
  OR NEW.assignment_id IS NOT OLD.assignment_id
  OR NEW.problem_id IS NOT OLD.problem_id
  OR NEW.position IS NOT OLD.position
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'assignment item provenance is immutable');
END;

CREATE TRIGGER submission_answers_are_immutable
BEFORE UPDATE ON submission_answers
BEGIN
  SELECT RAISE(ABORT, 'submission answer provenance is immutable; insert an answer version');
END;

CREATE TRIGGER ai_run_provenance_is_immutable
BEFORE UPDATE ON ai_runs
WHEN
  NEW.id IS NOT OLD.id
  OR NEW.class_id IS NOT OLD.class_id
  OR NEW.purpose IS NOT OLD.purpose
  OR NEW.model_name IS NOT OLD.model_name
  OR NEW.prompt_version IS NOT OLD.prompt_version
  OR NEW.schema_version IS NOT OLD.schema_version
  OR NEW.input_hash IS NOT OLD.input_hash
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'AI run provenance is immutable');
END;

CREATE TRIGGER audit_events_are_immutable
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

-- Delete immutable generated records before their AI-run foreign keys would
-- attempt ON DELETE SET NULL updates. Remaining roster/submission rows then
-- follow the declared class cascades.
CREATE TRIGGER classes_delete_immutable_graph_in_order
BEFORE DELETE ON classes
BEGIN
  DELETE FROM teaching_briefs WHERE class_id = OLD.id;
  DELETE FROM worksheets WHERE class_id = OLD.id;
  DELETE FROM predictions WHERE class_id = OLD.id;
  DELETE FROM student_model_hypotheses WHERE class_id = OLD.id;
  DELETE FROM diagnoses
  WHERE answer_version_id IN (
    SELECT answer_version.id
    FROM answer_versions AS answer_version
    JOIN submission_answers AS answer
      ON answer.id = answer_version.submission_answer_id
    JOIN submissions AS submission ON submission.id = answer.submission_id
    WHERE submission.class_id = OLD.id
  );
  DELETE FROM ai_runs WHERE class_id = OLD.id;
END;

-- Model versions begin as candidates. A separate append-only finalization
-- snapshots the linked evidence and is the only way to change model status.
CREATE TRIGGER student_model_versions_start_provisional
BEFORE INSERT ON student_model_versions
WHEN
  NEW.status <> 'PROVISIONAL'
  OR NEW.support_count <> 0
  OR NEW.contradiction_count <> 0
BEGIN
  SELECT RAISE(ABORT, 'student model versions must start provisional with zero evidence counts');
END;

CREATE TRIGGER student_model_evidence_requires_open_candidate
BEFORE INSERT ON student_model_evidence
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM student_model_versions AS model_version
    JOIN student_model_hypotheses AS hypothesis
      ON hypothesis.id = model_version.hypothesis_id
    WHERE model_version.id = NEW.student_model_version_id
      AND model_version.status = 'PROVISIONAL'
      AND model_version.superseded_at IS NULL
      AND hypothesis.retired_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM student_model_finalizations AS finalization
        WHERE finalization.student_model_version_id = model_version.id
      )
  ) THEN RAISE(ABORT, 'evidence can only be attached to an active provisional model') END;

  SELECT CASE WHEN
    NEW.role = 'SUPPORTS'
    AND NOT EXISTS (
      SELECT 1
      FROM student_model_versions AS model_version
      JOIN student_model_hypotheses AS hypothesis
        ON hypothesis.id = model_version.hypothesis_id
      JOIN diagnoses AS diagnosis
        ON diagnosis.id = NEW.diagnosis_id
      WHERE model_version.id = NEW.student_model_version_id
        AND diagnosis.outcome = 'MISCONCEPTION'
        AND diagnosis.taxonomy_version = hypothesis.taxonomy_version
        AND diagnosis.misconception_id = hypothesis.misconception_id
    )
  THEN RAISE(ABORT, 'supporting evidence must diagnose the model taxonomy term') END;
END;

CREATE TRIGGER student_model_evidence_cannot_be_deleted_directly
BEFORE DELETE ON student_model_evidence
WHEN EXISTS (
  SELECT 1
  FROM student_model_versions
  WHERE id = OLD.student_model_version_id
)
BEGIN
  SELECT RAISE(ABORT, 'student model evidence is append-only');
END;

CREATE TRIGGER student_model_finalization_is_evidence_backed
BEFORE INSERT ON student_model_finalizations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM student_model_versions AS model_version
    JOIN student_model_hypotheses AS hypothesis
      ON hypothesis.id = model_version.hypothesis_id
    WHERE model_version.id = NEW.student_model_version_id
      AND model_version.status = 'PROVISIONAL'
      AND model_version.superseded_at IS NULL
      AND hypothesis.retired_at IS NULL
      AND julianday(model_version.created_at) <= julianday(NEW.finalized_at)
  ) THEN RAISE(ABORT, 'only an active provisional model can be finalized') END;

  SELECT CASE WHEN NEW.support_count <> (
    SELECT count(DISTINCT answer_version.submission_answer_id)
    FROM student_model_evidence AS evidence
    JOIN diagnoses AS diagnosis ON diagnosis.id = evidence.diagnosis_id
    JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id
    WHERE evidence.student_model_version_id = NEW.student_model_version_id
      AND evidence.role = 'SUPPORTS'
  ) OR NEW.contradiction_count <> (
    SELECT count(DISTINCT answer_version.submission_answer_id)
    FROM student_model_evidence AS evidence
    JOIN diagnoses AS diagnosis ON diagnosis.id = evidence.diagnosis_id
    JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id
    WHERE evidence.student_model_version_id = NEW.student_model_version_id
      AND evidence.role = 'CONTRADICTS'
  ) OR NEW.ambiguous_count <> (
    SELECT count(DISTINCT answer_version.submission_answer_id)
    FROM student_model_evidence AS evidence
    JOIN diagnoses AS diagnosis ON diagnosis.id = evidence.diagnosis_id
    JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id
    WHERE evidence.student_model_version_id = NEW.student_model_version_id
      AND evidence.role = 'AMBIGUOUS'
  ) THEN RAISE(ABORT, 'model finalization counts must equal distinct linked responses') END;

  SELECT CASE WHEN NEW.final_status = 'SUPPORTED' AND (
    NEW.support_count < 2
    OR NEW.contradiction_count <> 0
    OR 2 > (
      SELECT count(DISTINCT problem.id)
      FROM student_model_evidence AS evidence
      JOIN diagnoses AS diagnosis ON diagnosis.id = evidence.diagnosis_id
      JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id
      JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id
      JOIN assignment_items AS assignment_item ON assignment_item.id = answer.assignment_item_id
      JOIN problems AS problem ON problem.id = assignment_item.problem_id
      WHERE evidence.student_model_version_id = NEW.student_model_version_id
        AND evidence.role = 'SUPPORTS'
    )
  ) THEN RAISE(ABORT, 'supported models require two distinct problems and no contradictory evidence') END;

  SELECT CASE WHEN
    NEW.final_status = 'CONTRADICTED'
    AND NEW.contradiction_count < 1
  THEN RAISE(ABORT, 'contradicted models require contradictory evidence') END;

  SELECT CASE WHEN
    NEW.final_status = 'INSUFFICIENT_EVIDENCE'
    AND (
      NEW.contradiction_count <> 0
      OR (
        NEW.support_count >= 2
        AND 2 <= (
          SELECT count(DISTINCT assignment_item.problem_id)
          FROM student_model_evidence AS evidence
          JOIN diagnoses AS diagnosis ON diagnosis.id = evidence.diagnosis_id
          JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id
          JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id
          JOIN assignment_items AS assignment_item ON assignment_item.id = answer.assignment_item_id
          WHERE evidence.student_model_version_id = NEW.student_model_version_id
            AND evidence.role = 'SUPPORTS'
        )
      )
    )
  THEN RAISE(ABORT, 'insufficient-evidence status must reflect the linked evidence') END;
END;

CREATE TRIGGER student_model_finalization_updates_status
AFTER INSERT ON student_model_finalizations
BEGIN
  UPDATE student_model_versions
  SET
    status = NEW.final_status,
    support_count = NEW.support_count,
    contradiction_count = NEW.contradiction_count
  WHERE id = NEW.student_model_version_id;
END;

CREATE TRIGGER student_model_finalizations_are_immutable
BEFORE UPDATE ON student_model_finalizations
BEGIN
  SELECT RAISE(ABORT, 'student model finalizations are append-only');
END;

CREATE TRIGGER student_model_finalizations_cannot_be_deleted_directly
BEFORE DELETE ON student_model_finalizations
WHEN EXISTS (
  SELECT 1
  FROM student_model_versions
  WHERE id = OLD.student_model_version_id
)
BEGIN
  SELECT RAISE(ABORT, 'student model finalizations are append-only');
END;

CREATE TRIGGER student_model_versions_only_controlled_transitions
BEFORE UPDATE ON student_model_versions
WHEN NOT (
  (
    OLD.superseded_at IS NULL
    AND NEW.superseded_at IS NOT NULL
    AND julianday(NEW.superseded_at) >= julianday(OLD.created_at)
    AND NEW.id IS OLD.id
    AND NEW.hypothesis_id IS OLD.hypothesis_id
    AND NEW.version IS OLD.version
    AND NEW.status IS OLD.status
    AND NEW.rule_statement IS OLD.rule_statement
    AND NEW.formal_pattern_json IS OLD.formal_pattern_json
    AND NEW.scope_limits_json IS OLD.scope_limits_json
    AND NEW.confidence IS OLD.confidence
    AND NEW.support_count IS OLD.support_count
    AND NEW.contradiction_count IS OLD.contradiction_count
    AND NEW.ai_run_id IS OLD.ai_run_id
    AND NEW.model_name IS OLD.model_name
    AND NEW.prompt_version IS OLD.prompt_version
    AND NEW.schema_version IS OLD.schema_version
    AND NEW.created_at IS OLD.created_at
  )
  OR
  (
    OLD.status = 'PROVISIONAL'
    AND NEW.status IN ('SUPPORTED', 'CONTRADICTED', 'INSUFFICIENT_EVIDENCE')
    AND NEW.id IS OLD.id
    AND NEW.hypothesis_id IS OLD.hypothesis_id
    AND NEW.version IS OLD.version
    AND NEW.rule_statement IS OLD.rule_statement
    AND NEW.formal_pattern_json IS OLD.formal_pattern_json
    AND NEW.scope_limits_json IS OLD.scope_limits_json
    AND NEW.confidence IS OLD.confidence
    AND NEW.ai_run_id IS OLD.ai_run_id
    AND NEW.model_name IS OLD.model_name
    AND NEW.prompt_version IS OLD.prompt_version
    AND NEW.schema_version IS OLD.schema_version
    AND NEW.created_at IS OLD.created_at
    AND NEW.superseded_at IS OLD.superseded_at
    AND EXISTS (
      SELECT 1
      FROM student_model_finalizations AS finalization
      WHERE finalization.student_model_version_id = OLD.id
        AND finalization.final_status = NEW.status
        AND finalization.support_count = NEW.support_count
        AND finalization.contradiction_count = NEW.contradiction_count
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'student model versions allow only finalization or one supersede transition');
END;

-- AI-generated records must snapshot a successful same-class run of the
-- expected purpose. Seed and teacher-authored records may omit ai_run_id.
CREATE TRIGGER diagnoses_ai_run_is_scoped
BEFORE INSERT ON diagnoses
WHEN NEW.source = 'AI' OR NEW.ai_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM ai_runs AS run
    JOIN answer_versions AS answer_version ON answer_version.id = NEW.answer_version_id
    JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id
    JOIN submissions AS submission ON submission.id = answer.submission_id
    WHERE run.id = NEW.ai_run_id
      AND run.class_id = submission.class_id
      AND run.purpose = 'DIAGNOSIS'
      AND run.status = 'SUCCEEDED'
      AND NEW.model_name IS run.model_name
      AND NEW.prompt_version IS run.prompt_version
      AND NEW.schema_version IS run.schema_version
  ) THEN RAISE(ABORT, 'AI diagnosis must reference its successful same-class diagnosis run') END;
END;

CREATE TRIGGER student_model_ai_run_is_scoped
BEFORE INSERT ON student_model_versions
WHEN NEW.ai_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM ai_runs AS run
    JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = NEW.hypothesis_id
    WHERE run.id = NEW.ai_run_id
      AND run.class_id = hypothesis.class_id
      AND run.purpose = 'STUDENT_MODEL'
      AND run.status = 'SUCCEEDED'
      AND NEW.model_name IS run.model_name
      AND NEW.prompt_version IS run.prompt_version
      AND NEW.schema_version IS run.schema_version
  ) THEN RAISE(ABORT, 'student model must reference its successful same-class model run') END;
END;

-- A prediction is a held-out claim: exact future target, finalized model,
-- immutable answer snapshot, and no matching prior work by this student.
CREATE TRIGGER predictions_are_held_out_and_truthful
BEFORE INSERT ON predictions
BEGIN
  SELECT CASE WHEN
    NEW.target_assignment_item_id IS NULL
    OR NEW.locked_at IS NOT NEW.created_at
    OR julianday(NEW.locked_at) IS NULL
    OR julianday(NEW.locked_at) > julianday('now', '+5 seconds')
  THEN RAISE(ABORT, 'prediction lock and target must be created server-side before administration') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM assignment_items AS target
    JOIN problems AS problem ON problem.id = target.problem_id
    JOIN student_model_versions AS model_version
      ON model_version.id = NEW.student_model_version_id
    JOIN student_model_hypotheses AS hypothesis
      ON hypothesis.id = model_version.hypothesis_id
    JOIN student_model_finalizations AS finalization
      ON finalization.student_model_version_id = model_version.id
    WHERE target.id = NEW.target_assignment_item_id
      AND target.class_id = NEW.class_id
      AND target.problem_id = NEW.problem_id
      AND problem.class_id = NEW.class_id
      AND problem.domain = hypothesis.domain
      AND problem.content_hash IS NOT NULL
      AND problem.correct_answer = NEW.correct_answer_snapshot
      AND problem.canonical_correct_answer IS NEW.canonical_correct_answer
      AND hypothesis.class_id = NEW.class_id
      AND hypothesis.membership_id = NEW.membership_id
      AND (hypothesis.retired_at IS NULL OR julianday(hypothesis.retired_at) > julianday(NEW.locked_at))
      AND (model_version.superseded_at IS NULL OR julianday(model_version.superseded_at) > julianday(NEW.locked_at))
      AND finalization.final_status = 'SUPPORTED'
      AND julianday(problem.created_at) <= julianday(NEW.locked_at)
      AND julianday(target.created_at) <= julianday(NEW.locked_at)
      AND julianday(model_version.created_at) <= julianday(NEW.locked_at)
      AND julianday(finalization.finalized_at) <= julianday(NEW.locked_at)
  ) THEN RAISE(ABORT, 'prediction must snapshot a supported model and exact future problem target') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM problems AS target_problem
    JOIN assignment_items AS answered_item
      ON answered_item.problem_id IN (
        SELECT candidate.id
        FROM problems AS candidate
        WHERE candidate.class_id = NEW.class_id
          AND (
            candidate.id = NEW.problem_id
            OR (
              candidate.content_hash IS NOT NULL
              AND candidate.content_hash = target_problem.content_hash
            )
          )
      )
    JOIN submission_answers AS answer
      ON answer.assignment_item_id = answered_item.id
    JOIN submissions AS submission ON submission.id = answer.submission_id
    WHERE target_problem.id = NEW.problem_id
      AND submission.membership_id = NEW.membership_id
      AND julianday(submission.submitted_at) <= julianday(NEW.locked_at)
  ) THEN RAISE(ABORT, 'prediction target must be unseen by the student at lock time') END;
END;

CREATE TRIGGER prediction_ai_run_is_scoped
BEFORE INSERT ON predictions
WHEN NEW.ai_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM ai_runs AS run
    WHERE run.id = NEW.ai_run_id
      AND run.class_id = NEW.class_id
      AND run.purpose = 'PREDICTION'
      AND run.status = 'SUCCEEDED'
      AND NEW.model_name IS run.model_name
      AND NEW.prompt_version IS run.prompt_version
      AND NEW.schema_version IS run.schema_version
  ) THEN RAISE(ABORT, 'prediction must reference its successful same-class prediction run') END;
END;

-- If pre-lock work is imported after the prediction was made, preserve the
-- submission and append an invalidation so it cannot inflate accuracy.
CREATE TRIGGER late_prior_work_invalidates_prediction
AFTER INSERT ON submission_answers
WHEN NEW.assignment_item_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO prediction_invalidations (
    prediction_id,
    submission_answer_id,
    reason,
    note,
    invalidated_at
  )
  SELECT
    prediction.id,
    NEW.id,
    'PRIOR_WORK_DISCOVERED',
    'Work submitted before the prediction lock was attached after the lock.',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM predictions AS prediction
  JOIN assignment_items AS observed_item ON observed_item.id = NEW.assignment_item_id
  JOIN problems AS observed_problem ON observed_problem.id = observed_item.problem_id
  JOIN problems AS target_problem ON target_problem.id = prediction.problem_id
  JOIN submissions AS submission ON submission.id = NEW.submission_id
  WHERE prediction.membership_id = submission.membership_id
    AND julianday(submission.submitted_at) <= julianday(prediction.locked_at)
    AND (
      observed_problem.id = target_problem.id
      OR (
        observed_problem.content_hash IS NOT NULL
        AND observed_problem.content_hash = target_problem.content_hash
      )
    );
END;

CREATE TRIGGER prediction_invalidations_are_immutable
BEFORE UPDATE ON prediction_invalidations
BEGIN
  SELECT RAISE(ABORT, 'prediction invalidations are append-only');
END;

CREATE TRIGGER prediction_invalidations_cannot_be_deleted_directly
BEFORE DELETE ON prediction_invalidations
WHEN EXISTS (
  SELECT 1 FROM predictions WHERE id = OLD.prediction_id
)
BEGIN
  SELECT RAISE(ABORT, 'prediction invalidations are append-only');
END;

CREATE TRIGGER prediction_answer_not_reused_across_predictions
BEFORE INSERT ON prediction_outcome_versions
WHEN NEW.answer_version_id IS NOT NULL AND EXISTS (
  SELECT 1
  FROM prediction_outcome_versions AS existing
  WHERE existing.answer_version_id = NEW.answer_version_id
    AND existing.prediction_id <> NEW.prediction_id
)
BEGIN
  SELECT RAISE(ABORT, 'one answer version cannot score different predictions');
END;

CREATE TRIGGER prediction_outcomes_match_locked_prediction
BEFORE INSERT ON prediction_outcome_versions
WHEN NEW.answer_version_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM predictions AS prediction
    JOIN answer_versions AS answer_version
      ON answer_version.id = NEW.answer_version_id
    JOIN submission_answers AS answer
      ON answer.id = answer_version.submission_answer_id
    JOIN submissions AS submission
      ON submission.id = answer.submission_id
    WHERE prediction.id = NEW.prediction_id
      AND prediction.membership_id = submission.membership_id
      AND prediction.target_assignment_item_id = answer.assignment_item_id
      AND julianday(submission.submitted_at) > julianday(prediction.locked_at)
      AND NEW.actual_answer_snapshot = answer_version.response_text
      AND NEW.canonical_actual_answer IS answer_version.normalized_answer
      AND NEW.observed_at = submission.submitted_at
      AND julianday(answer_version.created_at) <= julianday(NEW.evaluated_at)
      AND julianday(NEW.evaluated_at) <= julianday(NEW.created_at)
      AND NOT EXISTS (
        SELECT 1
        FROM prediction_invalidations AS invalidation
        WHERE invalidation.prediction_id = prediction.id
      )
  ) THEN RAISE(ABORT, 'outcome must exactly snapshot valid post-lock work on the prediction target') END;

  SELECT CASE WHEN NEW.evaluation_method = 'DETERMINISTIC' AND NOT EXISTS (
    SELECT 1
    FROM predictions AS prediction
    WHERE prediction.id = NEW.prediction_id
      AND prediction.rule_applied = 1
      AND prediction.canonical_predicted_answer IS NOT NULL
      AND NEW.canonical_actual_answer IS NOT NULL
      AND NEW.confidence = 1
      AND NEW.match_state = CASE
        WHEN prediction.canonical_predicted_answer = NEW.canonical_actual_answer
          THEN 'MATCH'
        ELSE 'MISMATCH'
      END
  ) THEN RAISE(ABORT, 'deterministic match state must equal the canonical answer comparison') END;
END;

CREATE TRIGGER prediction_outcomes_reject_unaudited_ai_review
BEFORE INSERT ON prediction_outcome_versions
WHEN NEW.evaluation_method = 'AI_REVIEW'
BEGIN
  SELECT RAISE(ABORT, 'AI-reviewed outcomes require auditable run provenance before they can be enabled');
END;

-- Generated artifacts remain scoped to the Student Model and evidence cluster
-- that produced them, including any supersession chain.
CREATE TRIGGER worksheets_match_model_scope
BEFORE INSERT ON worksheets
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM student_model_versions AS model_version
    JOIN student_model_hypotheses AS hypothesis
      ON hypothesis.id = model_version.hypothesis_id
    WHERE model_version.id = NEW.student_model_version_id
      AND hypothesis.class_id = NEW.class_id
      AND hypothesis.membership_id = NEW.membership_id
  ) THEN RAISE(ABORT, 'worksheet must use a model for the same class and student') END;
END;

CREATE TRIGGER worksheet_ai_run_is_scoped
BEFORE INSERT ON worksheets
WHEN NEW.ai_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM ai_runs AS run
    WHERE run.id = NEW.ai_run_id
      AND run.class_id = NEW.class_id
      AND run.purpose = 'PRACTICE'
      AND run.status = 'SUCCEEDED'
      AND NEW.model_name IS run.model_name
      AND NEW.prompt_version IS run.prompt_version
      AND NEW.schema_version IS run.schema_version
  ) THEN RAISE(ABORT, 'worksheet must reference its successful same-class practice run') END;
END;

CREATE TRIGGER worksheet_supersession_is_scoped
BEFORE INSERT ON worksheets
WHEN NEW.supersedes_worksheet_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.supersedes_worksheet_id = NEW.id OR NOT EXISTS (
    SELECT 1
    FROM worksheets AS predecessor
    JOIN student_model_versions AS predecessor_version
      ON predecessor_version.id = predecessor.student_model_version_id
    JOIN student_model_versions AS next_version
      ON next_version.id = NEW.student_model_version_id
    WHERE predecessor.id = NEW.supersedes_worksheet_id
      AND predecessor.class_id = NEW.class_id
      AND predecessor.membership_id = NEW.membership_id
      AND predecessor.assignment_id IS NEW.assignment_id
      AND predecessor_version.hypothesis_id = next_version.hypothesis_id
  ) THEN RAISE(ABORT, 'worksheet supersession must stay in one student, assignment, and model lineage') END;
END;

CREATE TRIGGER worksheets_preserve_provenance
BEFORE UPDATE ON worksheets
WHEN
  NEW.id IS NOT OLD.id
  OR NEW.class_id IS NOT OLD.class_id
  OR NEW.membership_id IS NOT OLD.membership_id
  OR NEW.student_model_version_id IS NOT OLD.student_model_version_id
  OR NEW.assignment_id IS NOT OLD.assignment_id
  OR NEW.title IS NOT OLD.title
  OR NEW.rationale IS NOT OLD.rationale
  OR NEW.supersedes_worksheet_id IS NOT OLD.supersedes_worksheet_id
  OR NEW.ai_run_id IS NOT OLD.ai_run_id
  OR NEW.model_name IS NOT OLD.model_name
  OR NEW.prompt_version IS NOT OLD.prompt_version
  OR NEW.schema_version IS NOT OLD.schema_version
  OR NEW.created_at IS NOT OLD.created_at
  OR NOT (
    NEW.status IS OLD.status
    OR (OLD.status = 'GENERATING' AND NEW.status IN ('READY', 'FAILED'))
  )
BEGIN
  SELECT RAISE(ABORT, 'worksheet provenance is immutable after creation');
END;

CREATE TRIGGER worksheet_items_match_model_term
BEFORE INSERT ON worksheet_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM worksheets AS worksheet
    JOIN student_model_versions AS model_version
      ON model_version.id = worksheet.student_model_version_id
    JOIN student_model_hypotheses AS hypothesis
      ON hypothesis.id = model_version.hypothesis_id
    WHERE worksheet.id = NEW.worksheet_id
      AND hypothesis.taxonomy_version = NEW.taxonomy_version
      AND hypothesis.misconception_id = NEW.misconception_id
  ) THEN RAISE(ABORT, 'worksheet item must target the worksheet model taxonomy term') END;
END;

CREATE TRIGGER teaching_brief_ai_run_is_scoped
BEFORE INSERT ON teaching_briefs
WHEN NEW.ai_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM ai_runs AS run
    WHERE run.id = NEW.ai_run_id
      AND run.class_id = NEW.class_id
      AND run.purpose = 'TEACHING_BRIEF'
      AND run.status = 'SUCCEEDED'
      AND NEW.model_name IS run.model_name
      AND NEW.prompt_version IS run.prompt_version
      AND NEW.schema_version IS run.schema_version
  ) THEN RAISE(ABORT, 'teaching brief must reference its successful same-class brief run') END;
END;

CREATE TRIGGER teaching_brief_supersession_is_scoped
BEFORE INSERT ON teaching_briefs
WHEN NEW.supersedes_brief_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.supersedes_brief_id = NEW.id OR NOT EXISTS (
    SELECT 1
    FROM teaching_briefs AS predecessor
    WHERE predecessor.id = NEW.supersedes_brief_id
      AND predecessor.class_id = NEW.class_id
      AND predecessor.assignment_id = NEW.assignment_id
      AND predecessor.taxonomy_version = NEW.taxonomy_version
      AND predecessor.misconception_id = NEW.misconception_id
  ) THEN RAISE(ABORT, 'teaching brief supersession must stay in one assignment and cluster') END;
END;

CREATE TRIGGER teaching_brief_evidence_is_scoped
BEFORE INSERT ON teaching_brief_evidence
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM teaching_briefs AS brief
    JOIN diagnoses AS diagnosis ON diagnosis.id = NEW.diagnosis_id
    JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id
    JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id
    JOIN submissions AS submission ON submission.id = answer.submission_id
    WHERE brief.id = NEW.teaching_brief_id
      AND submission.class_id = brief.class_id
      AND submission.assignment_id = brief.assignment_id
      AND diagnosis.outcome = 'MISCONCEPTION'
      AND diagnosis.taxonomy_version = brief.taxonomy_version
      AND diagnosis.misconception_id = brief.misconception_id
  ) THEN RAISE(ABORT, 'teaching brief evidence must belong to its assignment and misconception cluster') END;
END;

CREATE TRIGGER teaching_briefs_are_immutable
BEFORE UPDATE ON teaching_briefs
BEGIN
  SELECT RAISE(ABORT, 'teaching briefs are immutable; insert a superseding brief');
END;

CREATE VIEW current_student_model_versions AS
SELECT
  hypothesis.class_id,
  hypothesis.membership_id,
  hypothesis.domain,
  hypothesis.scope_key,
  hypothesis.taxonomy_version,
  hypothesis.misconception_id,
  model_version.*
FROM student_model_versions AS model_version
JOIN student_model_hypotheses AS hypothesis
  ON hypothesis.id = model_version.hypothesis_id
WHERE model_version.superseded_at IS NULL
  AND model_version.status <> 'RETIRED'
  AND hypothesis.retired_at IS NULL;

CREATE VIEW student_prediction_metrics AS
WITH latest_outcomes AS (
  SELECT outcome.*
  FROM prediction_outcome_versions AS outcome
  WHERE outcome.version = (
    SELECT max(candidate.version)
    FROM prediction_outcome_versions AS candidate
    WHERE candidate.prediction_id = outcome.prediction_id
  )
)
SELECT
  prediction.membership_id,
  count(*) AS total_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NULL THEN 1 ELSE 0 END) AS valid_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NOT NULL THEN 1 ELSE 0 END) AS invalidated_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NULL THEN prediction.rule_applied ELSE 0 END) AS attempted_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NULL AND outcome.id IS NOT NULL THEN 1 ELSE 0 END) AS observed_predictions,
  sum(CASE
    WHEN invalidation.prediction_id IS NULL AND outcome.match_state IN ('MATCH', 'MISMATCH')
      THEN 1 ELSE 0
  END) AS scorable_predictions,
  sum(CASE
    WHEN invalidation.prediction_id IS NULL AND outcome.match_state = 'MATCH'
      THEN 1 ELSE 0
  END) AS matched_predictions,
  CASE
    WHEN sum(CASE
      WHEN invalidation.prediction_id IS NULL AND outcome.match_state IN ('MATCH', 'MISMATCH')
        THEN 1 ELSE 0
    END) = 0 THEN NULL
    ELSE 1.0 * sum(CASE
      WHEN invalidation.prediction_id IS NULL AND outcome.match_state = 'MATCH'
        THEN 1 ELSE 0
    END) / sum(CASE
      WHEN invalidation.prediction_id IS NULL AND outcome.match_state IN ('MATCH', 'MISMATCH')
        THEN 1 ELSE 0
    END)
  END AS prediction_accuracy
FROM predictions AS prediction
LEFT JOIN latest_outcomes AS outcome ON outcome.prediction_id = prediction.id
LEFT JOIN prediction_invalidations AS invalidation
  ON invalidation.prediction_id = prediction.id
GROUP BY prediction.membership_id;
