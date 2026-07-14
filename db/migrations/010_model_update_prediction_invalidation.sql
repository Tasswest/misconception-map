-- Preserve locked predictions when their exact Student Model version is
-- superseded, but exclude them from later accuracy calculations. This keeps
-- the original falsifiable claim visible while preventing a revised model
-- from inheriting an older version's trials.
DROP TRIGGER prediction_invalidations_are_immutable;
DROP TRIGGER prediction_invalidations_cannot_be_deleted_directly;
DROP TRIGGER late_prior_work_invalidates_prediction;
DROP TRIGGER prediction_outcomes_match_locked_prediction;
DROP VIEW student_prediction_metrics;

CREATE TABLE prediction_invalidations_next (
  prediction_id TEXT PRIMARY KEY NOT NULL,
  submission_answer_id TEXT,
  reason TEXT NOT NULL CHECK (
    reason IN (
      'PRIOR_WORK_DISCOVERED',
      'TARGET_WITHDRAWN',
      'TEACHER_INVALIDATED',
      'MODEL_UPDATED'
    )
  ),
  note TEXT,
  invalidated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (julianday(invalidated_at) IS NOT NULL),
  FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
  FOREIGN KEY (submission_answer_id) REFERENCES submission_answers(id) ON DELETE SET NULL
) STRICT;

INSERT INTO prediction_invalidations_next (
  prediction_id,
  submission_answer_id,
  reason,
  note,
  invalidated_at
)
SELECT
  prediction_id,
  submission_answer_id,
  reason,
  note,
  invalidated_at
FROM prediction_invalidations;

DROP TABLE prediction_invalidations;
ALTER TABLE prediction_invalidations_next RENAME TO prediction_invalidations;

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

CREATE TRIGGER model_supersession_invalidates_predictions
AFTER UPDATE OF superseded_at ON student_model_versions
WHEN OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO prediction_invalidations (
    prediction_id,
    reason,
    note,
    invalidated_at
  )
  SELECT
    prediction.id,
    'MODEL_UPDATED',
    'The locked Student Model version was superseded by a newer hypothesis version.',
    NEW.superseded_at
  FROM predictions AS prediction
  WHERE prediction.student_model_version_id = NEW.id;
END;

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
