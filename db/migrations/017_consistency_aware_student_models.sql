ALTER TABLE student_model_versions
  ADD COLUMN observed_application_count INTEGER
  CHECK (observed_application_count IS NULL OR observed_application_count >= 0);

ALTER TABLE student_model_versions
  ADD COLUMN observed_opportunity_count INTEGER
  CHECK (observed_opportunity_count IS NULL OR observed_opportunity_count >= 0);

ALTER TABLE student_model_versions
  ADD COLUMN observed_application_rate REAL
  CHECK (
    observed_application_rate IS NULL
    OR (observed_application_rate >= 0 AND observed_application_rate <= 1)
  );

ALTER TABLE student_model_versions
  ADD COLUMN mastery_evidence_count INTEGER
  CHECK (mastery_evidence_count IS NULL OR mastery_evidence_count >= 0);

ALTER TABLE predictions
  ADD COLUMN prediction_kind TEXT
  CHECK (
    prediction_kind IS NULL
    OR prediction_kind IN ('FLAWED_RULE_APPLIES', 'MASTERY', 'ABSTAIN')
  );

ALTER TABLE predictions
  ADD COLUMN consistency_snapshot REAL
  CHECK (
    consistency_snapshot IS NULL
    OR (consistency_snapshot >= 0 AND consistency_snapshot <= 1)
  );

ALTER TABLE predictions
  ADD COLUMN mastery_evidence_summary TEXT;

CREATE TABLE student_model_opportunities (
  student_model_version_id TEXT NOT NULL,
  diagnosis_id TEXT NOT NULL,
  application_state TEXT NOT NULL CHECK (
    application_state IN ('APPLIED_RULE', 'DID_NOT_APPLY')
  ),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (student_model_version_id, diagnosis_id),
  FOREIGN KEY (student_model_version_id)
    REFERENCES student_model_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (diagnosis_id) REFERENCES diagnoses(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE student_model_mastery_evidence (
  student_model_version_id TEXT NOT NULL,
  diagnosis_id TEXT NOT NULL,
  skill_key TEXT NOT NULL CHECK (length(trim(skill_key)) > 0),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (student_model_version_id, diagnosis_id),
  FOREIGN KEY (student_model_version_id)
    REFERENCES student_model_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (diagnosis_id) REFERENCES diagnoses(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE student_model_revision_suggestions (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  student_model_version_id TEXT NOT NULL,
  prediction_id TEXT NOT NULL UNIQUE,
  contradicting_diagnosis_id TEXT NOT NULL,
  suggestion_kind TEXT NOT NULL CHECK (
    suggestion_kind IN ('REVISE_RULE', 'DOWNGRADE_CONSISTENCY')
  ),
  proposed_rule_statement TEXT,
  proposed_formal_pattern_json TEXT CHECK (
    proposed_formal_pattern_json IS NULL OR json_valid(proposed_formal_pattern_json)
  ),
  proposed_scope_limits_json TEXT CHECK (
    proposed_scope_limits_json IS NULL OR json_valid(proposed_scope_limits_json)
  ),
  proposed_application_rate REAL CHECK (
    proposed_application_rate IS NULL
    OR (proposed_application_rate >= 0 AND proposed_application_rate <= 1)
  ),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  evidence_connection TEXT NOT NULL CHECK (length(trim(evidence_connection)) > 0),
  ai_run_id TEXT,
  model_name TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (suggestion_kind = 'REVISE_RULE'
      AND proposed_rule_statement IS NOT NULL
      AND json_type(proposed_formal_pattern_json) = 'object'
      AND json_type(proposed_scope_limits_json) = 'array')
    OR
    (suggestion_kind = 'DOWNGRADE_CONSISTENCY'
      AND proposed_application_rate IS NOT NULL)
  ),
  FOREIGN KEY (membership_id, class_id)
    REFERENCES class_memberships(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (student_model_version_id)
    REFERENCES student_model_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
  FOREIGN KEY (contradicting_diagnosis_id) REFERENCES diagnoses(id) ON DELETE CASCADE,
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL
) STRICT;

CREATE TABLE student_model_revision_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  suggestion_id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL CHECK (action IN ('CONFIRM', 'DISMISS')),
  note TEXT,
  resulting_model_version_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (action = 'CONFIRM' AND resulting_model_version_id IS NOT NULL)
    OR (action = 'DISMISS' AND resulting_model_version_id IS NULL)
  ),
  FOREIGN KEY (suggestion_id)
    REFERENCES student_model_revision_suggestions(id) ON DELETE CASCADE,
  FOREIGN KEY (resulting_model_version_id)
    REFERENCES student_model_versions(id) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER student_model_consistency_counts_are_valid
BEFORE INSERT ON student_model_versions
WHEN
  (NEW.observed_application_count IS NULL) <> (NEW.observed_opportunity_count IS NULL)
  OR (NEW.observed_application_count IS NULL) <> (NEW.observed_application_rate IS NULL)
  OR NEW.observed_application_count > NEW.observed_opportunity_count
  OR (
    NEW.observed_opportunity_count > 0
    AND abs(
      NEW.observed_application_rate
      - (1.0 * NEW.observed_application_count / NEW.observed_opportunity_count)
    ) > 0.000001
  )
  OR NEW.observed_opportunity_count = 0
BEGIN
  SELECT RAISE(ABORT, 'student model consistency must snapshot a positive, internally consistent opportunity count');
END;

CREATE TRIGGER student_model_opportunities_match_student
BEFORE INSERT ON student_model_opportunities
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM student_model_versions AS model
    JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id
    JOIN diagnoses AS diagnosis ON diagnosis.id = NEW.diagnosis_id
    JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id
    JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id
    JOIN submissions AS submission ON submission.id = answer.submission_id
    WHERE model.id = NEW.student_model_version_id
      AND model.status = 'PROVISIONAL'
      AND model.superseded_at IS NULL
      AND hypothesis.membership_id = submission.membership_id
      AND hypothesis.class_id = submission.class_id
      AND julianday(diagnosis.created_at) <= julianday(model.created_at)
      AND NOT EXISTS (
        SELECT 1 FROM student_model_finalizations AS finalization
        WHERE finalization.student_model_version_id = model.id
      )
  ) THEN RAISE(ABORT, 'model opportunities must be pre-version evidence from the same learner') END;
END;

CREATE TRIGGER student_model_mastery_evidence_matches_student
BEFORE INSERT ON student_model_mastery_evidence
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM student_model_versions AS model
    JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id
    JOIN diagnoses AS diagnosis ON diagnosis.id = NEW.diagnosis_id
    JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id
    JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id
    JOIN submissions AS submission ON submission.id = answer.submission_id
    WHERE model.id = NEW.student_model_version_id
      AND model.status = 'PROVISIONAL'
      AND model.superseded_at IS NULL
      AND hypothesis.membership_id = submission.membership_id
      AND hypothesis.class_id = submission.class_id
      AND diagnosis.outcome = 'CORRECT'
      AND julianday(diagnosis.created_at) <= julianday(model.created_at)
      AND NOT EXISTS (
        SELECT 1 FROM student_model_finalizations AS finalization
        WHERE finalization.student_model_version_id = model.id
      )
  ) THEN RAISE(ABORT, 'mastery evidence must be a pre-version correct diagnosis from the same learner') END;
END;

CREATE TRIGGER student_model_opportunities_are_immutable
BEFORE UPDATE ON student_model_opportunities
BEGIN
  SELECT RAISE(ABORT, 'student model opportunities are append-only');
END;

CREATE TRIGGER student_model_mastery_evidence_is_immutable
BEFORE UPDATE ON student_model_mastery_evidence
BEGIN
  SELECT RAISE(ABORT, 'student model mastery evidence is append-only');
END;

CREATE TRIGGER student_model_opportunities_cannot_be_deleted_directly
BEFORE DELETE ON student_model_opportunities
WHEN EXISTS (
  SELECT 1 FROM student_model_versions WHERE id = OLD.student_model_version_id
)
BEGIN
  SELECT RAISE(ABORT, 'student model opportunities are append-only');
END;

CREATE TRIGGER student_model_mastery_evidence_cannot_be_deleted_directly
BEFORE DELETE ON student_model_mastery_evidence
WHEN EXISTS (
  SELECT 1 FROM student_model_versions WHERE id = OLD.student_model_version_id
)
BEGIN
  SELECT RAISE(ABORT, 'student model mastery evidence is append-only');
END;

CREATE TRIGGER live_student_model_opportunity_timestamp_is_current
BEFORE INSERT ON student_model_opportunities
WHEN EXISTS (
  SELECT 1
  FROM student_model_versions AS model
  JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id
  JOIN classes AS class_record ON class_record.id = hypothesis.class_id
  WHERE model.id = NEW.student_model_version_id
    AND class_record.is_demo = 0
    AND (
      julianday(NEW.created_at) IS NULL
      OR abs(julianday(NEW.created_at) - julianday('now')) * 86400.0 > 60
    )
)
BEGIN
  SELECT RAISE(ABORT, 'live model opportunities must use a current server timestamp');
END;

CREATE TRIGGER live_student_model_mastery_timestamp_is_current
BEFORE INSERT ON student_model_mastery_evidence
WHEN EXISTS (
  SELECT 1
  FROM student_model_versions AS model
  JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id
  JOIN classes AS class_record ON class_record.id = hypothesis.class_id
  WHERE model.id = NEW.student_model_version_id
    AND class_record.is_demo = 0
    AND (
      julianday(NEW.created_at) IS NULL
      OR abs(julianday(NEW.created_at) - julianday('now')) * 86400.0 > 60
    )
)
BEGIN
  SELECT RAISE(ABORT, 'live mastery evidence must use a current server timestamp');
END;

CREATE TRIGGER prediction_kind_is_consistent
BEFORE INSERT ON predictions
WHEN
  (NEW.prediction_kind = 'ABSTAIN' AND NEW.rule_applied <> 0)
  OR (NEW.prediction_kind IN ('FLAWED_RULE_APPLIES', 'MASTERY') AND NEW.rule_applied <> 1)
  OR (
    NEW.prediction_kind = 'FLAWED_RULE_APPLIES'
    AND NEW.consistency_snapshot IS NOT NULL
    AND abs(NEW.confidence - NEW.consistency_snapshot) > 0.000001
  )
  OR (NEW.prediction_kind = 'MASTERY' AND length(trim(NEW.mastery_evidence_summary)) = 0)
  OR (NEW.prediction_kind <> 'MASTERY' AND NEW.mastery_evidence_summary IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'prediction kind, confidence, and evidence snapshot are inconsistent');
END;

CREATE TRIGGER student_model_revision_suggestion_is_scoped
BEFORE INSERT ON student_model_revision_suggestions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM predictions AS prediction
    JOIN student_model_versions AS model ON model.id = prediction.student_model_version_id
    JOIN student_model_hypotheses AS hypothesis ON hypothesis.id = model.hypothesis_id
    JOIN prediction_outcome_versions AS outcome ON outcome.prediction_id = prediction.id
    JOIN answer_versions AS outcome_answer_version ON outcome_answer_version.id = outcome.answer_version_id
    JOIN answer_versions AS diagnosed_answer_version
      ON diagnosed_answer_version.submission_answer_id = outcome_answer_version.submission_answer_id
    JOIN diagnoses AS diagnosis ON diagnosis.answer_version_id = diagnosed_answer_version.id
    WHERE prediction.id = NEW.prediction_id
      AND prediction.student_model_version_id = NEW.student_model_version_id
      AND prediction.class_id = NEW.class_id
      AND prediction.membership_id = NEW.membership_id
      AND hypothesis.class_id = NEW.class_id
      AND hypothesis.membership_id = NEW.membership_id
      AND outcome.match_state = 'MISMATCH'
      AND diagnosis.id = NEW.contradicting_diagnosis_id
      AND diagnosis.id = (
        SELECT latest_diagnosis.id
        FROM diagnoses AS latest_diagnosis
        JOIN answer_versions AS latest_answer_version
          ON latest_answer_version.id = latest_diagnosis.answer_version_id
        WHERE latest_answer_version.submission_answer_id = outcome_answer_version.submission_answer_id
        ORDER BY latest_diagnosis.created_at DESC, latest_diagnosis.version DESC, latest_diagnosis.id DESC
        LIMIT 1
      )
      AND outcome.version = (
        SELECT max(candidate.version)
        FROM prediction_outcome_versions AS candidate
        WHERE candidate.prediction_id = prediction.id
      )
  ) THEN RAISE(ABORT, 'revision suggestions require a mismatched locked outcome for the same learner and model') END;
END;

CREATE TRIGGER student_model_revision_ai_run_is_scoped
BEFORE INSERT ON student_model_revision_suggestions
WHEN NEW.ai_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM ai_runs AS run
    WHERE run.id = NEW.ai_run_id
      AND run.class_id = NEW.class_id
      AND run.purpose = 'STUDENT_MODEL'
      AND run.status = 'SUCCEEDED'
      AND NEW.model_name IS run.model_name
      AND NEW.prompt_version IS run.prompt_version
      AND NEW.schema_version IS run.schema_version
  ) THEN RAISE(ABORT, 'revision suggestions must reference their successful same-class synthesis run') END;
END;

CREATE TRIGGER student_model_revision_suggestions_are_immutable
BEFORE UPDATE ON student_model_revision_suggestions
BEGIN
  SELECT RAISE(ABORT, 'student model revision suggestions are append-only');
END;

CREATE TRIGGER student_model_revision_decisions_are_immutable
BEFORE UPDATE ON student_model_revision_decisions
BEGIN
  SELECT RAISE(ABORT, 'student model revision decisions are append-only');
END;

CREATE TRIGGER student_model_revision_suggestions_cannot_be_deleted_directly
BEFORE DELETE ON student_model_revision_suggestions
WHEN EXISTS (SELECT 1 FROM class_memberships WHERE id = OLD.membership_id)
BEGIN
  SELECT RAISE(ABORT, 'student model revision suggestions are append-only');
END;

CREATE TRIGGER student_model_revision_decisions_cannot_be_deleted_directly
BEFORE DELETE ON student_model_revision_decisions
WHEN EXISTS (
  SELECT 1
  FROM student_model_revision_suggestions AS suggestion
  JOIN class_memberships AS membership ON membership.id = suggestion.membership_id
  WHERE suggestion.id = OLD.suggestion_id
)
BEGIN
  SELECT RAISE(ABORT, 'student model revision decisions are append-only');
END;

DROP TRIGGER student_model_finalization_updates_status;

CREATE TRIGGER student_model_finalization_updates_status
AFTER INSERT ON student_model_finalizations
BEGIN
  UPDATE student_model_versions
  SET
    status = NEW.final_status,
    support_count = NEW.support_count,
    contradiction_count = NEW.contradiction_count,
    observed_application_count = CASE
      WHEN EXISTS (
        SELECT 1 FROM student_model_opportunities
        WHERE student_model_version_id = NEW.student_model_version_id
      ) THEN (
        SELECT count(*) FROM student_model_opportunities
        WHERE student_model_version_id = NEW.student_model_version_id
          AND application_state = 'APPLIED_RULE'
      )
      ELSE observed_application_count
    END,
    observed_opportunity_count = CASE
      WHEN EXISTS (
        SELECT 1 FROM student_model_opportunities
        WHERE student_model_version_id = NEW.student_model_version_id
      ) THEN (
        SELECT count(*) FROM student_model_opportunities
        WHERE student_model_version_id = NEW.student_model_version_id
      )
      ELSE observed_opportunity_count
    END,
    observed_application_rate = CASE
      WHEN EXISTS (
        SELECT 1 FROM student_model_opportunities
        WHERE student_model_version_id = NEW.student_model_version_id
      ) THEN 1.0 * (
        SELECT count(*) FROM student_model_opportunities
        WHERE student_model_version_id = NEW.student_model_version_id
          AND application_state = 'APPLIED_RULE'
      ) / (
        SELECT count(*) FROM student_model_opportunities
        WHERE student_model_version_id = NEW.student_model_version_id
      )
      ELSE observed_application_rate
    END,
    mastery_evidence_count = CASE
      WHEN EXISTS (
        SELECT 1 FROM student_model_mastery_evidence
        WHERE student_model_version_id = NEW.student_model_version_id
      ) THEN (
        SELECT count(*) FROM student_model_mastery_evidence
        WHERE student_model_version_id = NEW.student_model_version_id
      )
      ELSE mastery_evidence_count
    END
  WHERE id = NEW.student_model_version_id;
END;

DROP TRIGGER student_model_versions_only_controlled_transitions;

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
    AND NEW.observed_application_count IS OLD.observed_application_count
    AND NEW.observed_opportunity_count IS OLD.observed_opportunity_count
    AND NEW.observed_application_rate IS OLD.observed_application_rate
    AND NEW.mastery_evidence_count IS OLD.mastery_evidence_count
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
      SELECT 1 FROM student_model_finalizations AS finalization
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

DROP VIEW student_prediction_metrics;

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
      AND outcome.match_state IN ('MATCH', 'MISMATCH')
      THEN prediction.confidence ELSE 0
  END) AS expected_flawed_matches,
  sum(CASE
    WHEN invalidation.prediction_id IS NULL
      AND prediction.effective_prediction_kind = 'FLAWED_RULE_APPLIES'
      AND outcome.match_state IN ('MATCH', 'MISMATCH')
      THEN 1 ELSE 0
  END) AS flawed_scorable_predictions,
  sum(CASE
    WHEN invalidation.prediction_id IS NULL
      AND prediction.effective_prediction_kind = 'FLAWED_RULE_APPLIES'
      AND outcome.match_state = 'MATCH'
      THEN 1 ELSE 0
  END) AS flawed_matched_predictions
FROM typed_predictions AS prediction
LEFT JOIN latest_outcomes AS outcome ON outcome.prediction_id = prediction.id
LEFT JOIN prediction_invalidations AS invalidation ON invalidation.prediction_id = prediction.id
GROUP BY prediction.membership_id;
