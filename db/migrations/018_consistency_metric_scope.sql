DROP VIEW student_prediction_metrics;

CREATE TRIGGER student_model_revision_suggestion_null_shape
BEFORE INSERT ON student_model_revision_suggestions
WHEN
  (
    NEW.suggestion_kind = 'REVISE_RULE'
    AND NEW.proposed_application_rate IS NOT NULL
  )
  OR
  (
    NEW.suggestion_kind = 'DOWNGRADE_CONSISTENCY'
    AND (
      NEW.proposed_rule_statement IS NOT NULL
      OR NEW.proposed_formal_pattern_json IS NOT NULL
      OR NEW.proposed_scope_limits_json IS NOT NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'revision suggestions must use the strict null-based shape for their kind');
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
), typed_predictions AS (
  SELECT
    prediction.*,
    CASE
      WHEN prediction.prediction_kind IS NOT NULL THEN prediction.prediction_kind
      WHEN prediction.rule_applied = 1 THEN 'FLAWED_RULE_APPLIES'
      ELSE 'ABSTAIN'
    END AS effective_prediction_kind
  FROM predictions AS prediction
)
SELECT
  prediction.membership_id,
  count(*) AS total_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NULL THEN 1 ELSE 0 END) AS valid_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NOT NULL THEN 1 ELSE 0 END) AS invalidated_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NULL AND prediction.effective_prediction_kind <> 'ABSTAIN' THEN 1 ELSE 0 END) AS attempted_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NULL AND outcome.id IS NOT NULL THEN 1 ELSE 0 END) AS observed_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NULL AND outcome.match_state IN ('MATCH', 'MISMATCH') THEN 1 ELSE 0 END) AS scorable_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NULL AND outcome.match_state = 'MATCH' THEN 1 ELSE 0 END) AS matched_predictions,
  CASE
    WHEN sum(CASE WHEN invalidation.prediction_id IS NULL AND outcome.match_state IN ('MATCH', 'MISMATCH') THEN 1 ELSE 0 END) = 0 THEN NULL
    ELSE 1.0 * sum(CASE WHEN invalidation.prediction_id IS NULL AND outcome.match_state = 'MATCH' THEN 1 ELSE 0 END)
      / sum(CASE WHEN invalidation.prediction_id IS NULL AND outcome.match_state IN ('MATCH', 'MISMATCH') THEN 1 ELSE 0 END)
  END AS prediction_accuracy,
  sum(CASE WHEN invalidation.prediction_id IS NULL AND prediction.effective_prediction_kind = 'FLAWED_RULE_APPLIES' THEN 1 ELSE 0 END) AS flawed_rule_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NULL AND prediction.effective_prediction_kind = 'MASTERY' THEN 1 ELSE 0 END) AS mastery_predictions,
  sum(CASE WHEN invalidation.prediction_id IS NULL AND prediction.effective_prediction_kind = 'ABSTAIN' THEN 1 ELSE 0 END) AS abstentions,
  sum(CASE
    WHEN invalidation.prediction_id IS NULL
      AND prediction.effective_prediction_kind = 'FLAWED_RULE_APPLIES'
      AND prediction.consistency_snapshot IS NOT NULL
      AND outcome.match_state IN ('MATCH', 'MISMATCH')
      THEN prediction.confidence ELSE 0
  END) AS expected_flawed_matches,
  sum(CASE
    WHEN invalidation.prediction_id IS NULL
      AND prediction.effective_prediction_kind = 'FLAWED_RULE_APPLIES'
      AND prediction.consistency_snapshot IS NOT NULL
      AND outcome.match_state IN ('MATCH', 'MISMATCH')
      THEN 1 ELSE 0
  END) AS flawed_scorable_predictions,
  sum(CASE
    WHEN invalidation.prediction_id IS NULL
      AND prediction.effective_prediction_kind = 'FLAWED_RULE_APPLIES'
      AND prediction.consistency_snapshot IS NOT NULL
      AND outcome.match_state = 'MATCH'
      THEN 1 ELSE 0
  END) AS flawed_matched_predictions
FROM typed_predictions AS prediction
LEFT JOIN latest_outcomes AS outcome ON outcome.prediction_id = prediction.id
LEFT JOIN prediction_invalidations AS invalidation ON invalidation.prediction_id = prediction.id
GROUP BY prediction.membership_id;
