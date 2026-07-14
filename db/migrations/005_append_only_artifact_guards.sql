-- Generated rows are immutable snapshots. Insert-only scope validation would
-- otherwise be bypassable by changing their foreign keys after creation.
CREATE TRIGGER worksheet_items_are_immutable
BEFORE UPDATE ON worksheet_items
BEGIN
  SELECT RAISE(ABORT, 'worksheet items are immutable; generate a new worksheet');
END;

CREATE TRIGGER teaching_brief_evidence_is_immutable
BEFORE UPDATE ON teaching_brief_evidence
BEGIN
  SELECT RAISE(ABORT, 'teaching brief evidence is immutable');
END;

-- Preserve immutable supersession history while permitting SQLite's
-- FK-driven ON DELETE SET NULL cleanup after a predecessor has been removed.
DROP TRIGGER worksheets_preserve_provenance;

CREATE TRIGGER worksheets_preserve_provenance
BEFORE UPDATE ON worksheets
WHEN NOT (
  (
    NEW.id IS OLD.id
    AND NEW.class_id IS OLD.class_id
    AND NEW.membership_id IS OLD.membership_id
    AND NEW.student_model_version_id IS OLD.student_model_version_id
    AND NEW.assignment_id IS OLD.assignment_id
    AND NEW.title IS OLD.title
    AND NEW.rationale IS OLD.rationale
    AND NEW.supersedes_worksheet_id IS OLD.supersedes_worksheet_id
    AND NEW.ai_run_id IS OLD.ai_run_id
    AND NEW.model_name IS OLD.model_name
    AND NEW.prompt_version IS OLD.prompt_version
    AND NEW.schema_version IS OLD.schema_version
    AND NEW.created_at IS OLD.created_at
    AND (
      NEW.status IS OLD.status
      OR (OLD.status = 'GENERATING' AND NEW.status IN ('READY', 'FAILED'))
    )
  )
  OR
  (
    OLD.supersedes_worksheet_id IS NOT NULL
    AND NEW.supersedes_worksheet_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM worksheets WHERE id = OLD.supersedes_worksheet_id
    )
    AND NEW.id IS OLD.id
    AND NEW.class_id IS OLD.class_id
    AND NEW.membership_id IS OLD.membership_id
    AND NEW.student_model_version_id IS OLD.student_model_version_id
    AND NEW.assignment_id IS OLD.assignment_id
    AND NEW.title IS OLD.title
    AND NEW.rationale IS OLD.rationale
    AND NEW.status IS OLD.status
    AND NEW.ai_run_id IS OLD.ai_run_id
    AND NEW.model_name IS OLD.model_name
    AND NEW.prompt_version IS OLD.prompt_version
    AND NEW.schema_version IS OLD.schema_version
    AND NEW.created_at IS OLD.created_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'worksheet provenance is immutable after creation');
END;

DROP TRIGGER teaching_briefs_are_immutable;

CREATE TRIGGER teaching_briefs_are_immutable
BEFORE UPDATE ON teaching_briefs
WHEN NOT (
  OLD.supersedes_brief_id IS NOT NULL
  AND NEW.supersedes_brief_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM teaching_briefs WHERE id = OLD.supersedes_brief_id
  )
  AND NEW.id IS OLD.id
  AND NEW.class_id IS OLD.class_id
  AND NEW.assignment_id IS OLD.assignment_id
  AND NEW.taxonomy_version IS OLD.taxonomy_version
  AND NEW.misconception_id IS OLD.misconception_id
  AND NEW.paragraph IS OLD.paragraph
  AND NEW.cluster_student_count IS OLD.cluster_student_count
  AND NEW.diagnosed_student_count IS OLD.diagnosed_student_count
  AND NEW.evidence_cutoff_at IS OLD.evidence_cutoff_at
  AND NEW.worked_example_problem_id IS OLD.worked_example_problem_id
  AND NEW.ai_run_id IS OLD.ai_run_id
  AND NEW.model_name IS OLD.model_name
  AND NEW.prompt_version IS OLD.prompt_version
  AND NEW.schema_version IS OLD.schema_version
  AND NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'teaching briefs are immutable; insert a superseding brief');
END;

-- Live evidence timestamps are server events, not caller-authored history.
-- Synthetic demo classes may intentionally use deterministic past dates.
CREATE TRIGGER classes_preserve_demo_identity
BEFORE UPDATE ON classes
WHEN NEW.id IS NOT OLD.id OR NEW.is_demo IS NOT OLD.is_demo
BEGIN
  SELECT RAISE(ABORT, 'class identity and demo status are immutable');
END;

CREATE TRIGGER live_diagnosis_timestamp_is_current
BEFORE INSERT ON diagnoses
WHEN EXISTS (
  SELECT 1
  FROM answer_versions AS answer_version
  JOIN submission_answers AS answer
    ON answer.id = answer_version.submission_answer_id
  JOIN submissions AS submission ON submission.id = answer.submission_id
  JOIN classes AS class_record ON class_record.id = submission.class_id
  WHERE answer_version.id = NEW.answer_version_id
    AND class_record.is_demo = 0
    AND (
      julianday(NEW.created_at) IS NULL
      OR abs(julianday(NEW.created_at) - julianday('now')) * 86400.0 > 60
    )
)
BEGIN
  SELECT RAISE(ABORT, 'live diagnoses must use a current server timestamp');
END;

CREATE TRIGGER live_student_model_timestamp_is_current
BEFORE INSERT ON student_model_versions
WHEN EXISTS (
  SELECT 1
  FROM student_model_hypotheses AS hypothesis
  JOIN classes AS class_record ON class_record.id = hypothesis.class_id
  WHERE hypothesis.id = NEW.hypothesis_id
    AND class_record.is_demo = 0
    AND (
      julianday(NEW.created_at) IS NULL
      OR abs(julianday(NEW.created_at) - julianday('now')) * 86400.0 > 60
    )
)
BEGIN
  SELECT RAISE(ABORT, 'live student models must use a current server timestamp');
END;

CREATE TRIGGER live_student_model_evidence_timestamp_is_current
BEFORE INSERT ON student_model_evidence
WHEN EXISTS (
  SELECT 1
  FROM student_model_versions AS model_version
  JOIN student_model_hypotheses AS hypothesis
    ON hypothesis.id = model_version.hypothesis_id
  JOIN classes AS class_record ON class_record.id = hypothesis.class_id
  WHERE model_version.id = NEW.student_model_version_id
    AND class_record.is_demo = 0
    AND (
      julianday(NEW.created_at) IS NULL
      OR abs(julianday(NEW.created_at) - julianday('now')) * 86400.0 > 60
    )
)
BEGIN
  SELECT RAISE(ABORT, 'live model evidence must use a current server timestamp');
END;

CREATE TRIGGER student_model_finalization_has_temporal_integrity
BEFORE INSERT ON student_model_finalizations
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM student_model_evidence AS evidence
    WHERE evidence.student_model_version_id = NEW.student_model_version_id
      AND julianday(evidence.created_at) > julianday(NEW.finalized_at)
  ) THEN RAISE(ABORT, 'model finalization cannot predate its evidence') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM student_model_versions AS model_version
    JOIN student_model_hypotheses AS hypothesis
      ON hypothesis.id = model_version.hypothesis_id
    JOIN classes AS class_record ON class_record.id = hypothesis.class_id
    WHERE model_version.id = NEW.student_model_version_id
      AND class_record.is_demo = 0
      AND (
        julianday(NEW.finalized_at) IS NULL
        OR abs(julianday(NEW.finalized_at) - julianday('now')) * 86400.0 > 60
      )
  ) THEN RAISE(ABORT, 'live model finalizations must use a current server timestamp') END;
END;

CREATE TRIGGER live_prediction_lock_is_current
BEFORE INSERT ON predictions
WHEN EXISTS (
  SELECT 1
  FROM classes AS class_record
  WHERE class_record.id = NEW.class_id
    AND class_record.is_demo = 0
    AND (
      julianday(NEW.locked_at) IS NULL
      OR abs(julianday(NEW.locked_at) - julianday('now')) * 86400.0 > 60
    )
)
BEGIN
  SELECT RAISE(ABORT, 'live prediction locks must use a current server timestamp');
END;

-- Structurally varied support and accuracy trials must not count semantic
-- clones stored under different problem IDs.
CREATE TRIGGER supported_models_require_distinct_problem_content
BEFORE INSERT ON student_model_finalizations
WHEN NEW.final_status = 'SUPPORTED' AND 2 > (
  SELECT count(DISTINCT problem.content_hash)
  FROM student_model_evidence AS evidence
  JOIN diagnoses AS diagnosis ON diagnosis.id = evidence.diagnosis_id
  JOIN answer_versions AS answer_version
    ON answer_version.id = diagnosis.answer_version_id
  JOIN submission_answers AS answer
    ON answer.id = answer_version.submission_answer_id
  JOIN assignment_items AS assignment_item
    ON assignment_item.id = answer.assignment_item_id
  JOIN problems AS problem ON problem.id = assignment_item.problem_id
  WHERE evidence.student_model_version_id = NEW.student_model_version_id
    AND evidence.role = 'SUPPORTS'
    AND problem.content_hash IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'supported models require two distinct problem content hashes');
END;

CREATE TRIGGER predictions_reject_duplicate_problem_content
BEFORE INSERT ON predictions
WHEN EXISTS (
  SELECT 1
  FROM predictions AS existing
  JOIN problems AS existing_problem ON existing_problem.id = existing.problem_id
  JOIN problems AS next_problem ON next_problem.id = NEW.problem_id
  WHERE existing.membership_id = NEW.membership_id
    AND existing_problem.content_hash IS NOT NULL
    AND existing_problem.content_hash = next_problem.content_hash
)
BEGIN
  SELECT RAISE(ABORT, 'a student can have only one prediction per problem content');
END;

-- Failed trials and evaluations are append-only. Parent privacy deletions are
-- still allowed because SQLite removes the parent before cascading children.
CREATE TRIGGER predictions_cannot_be_deleted_directly
BEFORE DELETE ON predictions
WHEN EXISTS (
  SELECT 1 FROM class_memberships WHERE id = OLD.membership_id
)
BEGIN
  SELECT RAISE(ABORT, 'predictions are append-only; invalidate instead');
END;

CREATE TRIGGER prediction_outcomes_cannot_be_deleted_directly
BEFORE DELETE ON prediction_outcome_versions
WHEN EXISTS (
  SELECT 1 FROM predictions WHERE id = OLD.prediction_id
)
BEGIN
  SELECT RAISE(ABORT, 'prediction outcomes are append-only');
END;

-- Remove the membership roots first so append-only children are deleted only
-- by privacy cascades, then remove any now-unreferenced AI run records.
DROP TRIGGER classes_delete_immutable_graph_in_order;

CREATE TRIGGER classes_delete_immutable_graph_in_order
BEFORE DELETE ON classes
BEGIN
  DELETE FROM teaching_briefs WHERE class_id = OLD.id;
  DELETE FROM class_memberships WHERE class_id = OLD.id;
  DELETE FROM ai_runs WHERE class_id = OLD.id;
END;
