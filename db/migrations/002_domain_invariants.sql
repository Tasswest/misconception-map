CREATE TRIGGER definitive_diagnoses_require_confidence
BEFORE INSERT ON diagnoses
WHEN NEW.outcome IN ('CORRECT', 'MISCONCEPTION') AND NEW.confidence < 0.72
BEGIN
  SELECT RAISE(ABORT, 'low-confidence work must use a review or abstention outcome');
END;

CREATE TRIGGER diagnosis_review_reasons_must_be_array
BEFORE INSERT ON diagnoses
WHEN json_type(NEW.review_reasons_json) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'diagnosis review reasons must be a JSON array');
END;

CREATE TRIGGER diagnosis_steps_are_immutable
BEFORE UPDATE ON diagnosis_steps
BEGIN
  SELECT RAISE(ABORT, 'diagnosis steps are immutable; insert a new diagnosis version');
END;

CREATE TRIGGER diagnosis_candidates_are_immutable
BEFORE UPDATE ON diagnosis_candidates
BEGIN
  SELECT RAISE(ABORT, 'diagnosis candidates are immutable; insert a new diagnosis version');
END;

CREATE TRIGGER student_model_hypothesis_domain_matches_taxonomy
BEFORE INSERT ON student_model_hypotheses
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM taxonomy_terms AS term
    WHERE term.taxonomy_version = NEW.taxonomy_version
      AND term.misconception_id = NEW.misconception_id
      AND term.domain = NEW.domain
  ) THEN RAISE(ABORT, 'student model domain must match its taxonomy term') END;
END;

CREATE TRIGGER student_model_status_requires_evidence_counts
BEFORE INSERT ON student_model_versions
WHEN
  (NEW.status = 'SUPPORTED' AND NEW.support_count < 2)
  OR
  (NEW.status = 'CONTRADICTED' AND NEW.contradiction_count < 1)
BEGIN
  SELECT RAISE(ABORT, 'student model status is inconsistent with its evidence counts');
END;

CREATE TRIGGER student_model_json_shapes
BEFORE INSERT ON student_model_versions
WHEN
  json_type(NEW.formal_pattern_json) <> 'object'
  OR json_type(NEW.scope_limits_json) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'student model pattern must be an object and scope limits must be an array');
END;

CREATE TRIGGER student_model_versions_only_supersede
BEFORE UPDATE ON student_model_versions
WHEN
  OLD.superseded_at IS NOT NULL
  OR NEW.superseded_at IS NULL
  OR NEW.superseded_at < OLD.created_at
  OR NEW.id IS NOT OLD.id
  OR NEW.hypothesis_id IS NOT OLD.hypothesis_id
  OR NEW.version IS NOT OLD.version
  OR NEW.status IS NOT OLD.status
  OR NEW.rule_statement IS NOT OLD.rule_statement
  OR NEW.formal_pattern_json IS NOT OLD.formal_pattern_json
  OR NEW.scope_limits_json IS NOT OLD.scope_limits_json
  OR NEW.confidence IS NOT OLD.confidence
  OR NEW.support_count IS NOT OLD.support_count
  OR NEW.contradiction_count IS NOT OLD.contradiction_count
  OR NEW.ai_run_id IS NOT OLD.ai_run_id
  OR NEW.model_name IS NOT OLD.model_name
  OR NEW.prompt_version IS NOT OLD.prompt_version
  OR NEW.schema_version IS NOT OLD.schema_version
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'student model versions are immutable except for one supersede transition');
END;

CREATE TRIGGER student_model_evidence_is_immutable
BEFORE UPDATE ON student_model_evidence
BEGIN
  SELECT RAISE(ABORT, 'student model evidence is immutable');
END;

CREATE TRIGGER student_model_reviews_are_immutable
BEFORE UPDATE ON student_model_reviews
BEGIN
  SELECT RAISE(ABORT, 'student model reviews are append-only');
END;

CREATE TRIGGER prediction_trace_must_be_object
BEFORE INSERT ON predictions
WHEN json_type(NEW.trace_json) <> 'object'
BEGIN
  SELECT RAISE(ABORT, 'prediction trace must be a JSON object');
END;

CREATE TRIGGER prediction_outcome_timeline_is_valid
BEFORE INSERT ON prediction_outcome_versions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM predictions AS prediction
    WHERE prediction.id = NEW.prediction_id
      AND NEW.observed_at >= prediction.locked_at
      AND NEW.evaluated_at >= NEW.observed_at
  ) THEN RAISE(ABORT, 'prediction outcomes must be observed after lock and evaluated after observation') END;

  SELECT CASE WHEN
    NEW.answer_version_id IS NULL
    AND NEW.evaluation_method <> 'TEACHER'
  THEN RAISE(ABORT, 'unlinked actual answers require teacher evaluation') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM predictions AS prediction
    WHERE prediction.id = NEW.prediction_id
      AND prediction.rule_applied = 0
      AND NEW.match_state IN ('MATCH', 'MISMATCH')
  ) THEN RAISE(ABORT, 'an abstained prediction cannot receive a scored outcome') END;
END;

CREATE TRIGGER problems_are_immutable
BEFORE UPDATE ON problems
BEGIN
  SELECT RAISE(ABORT, 'problems are immutable; create a replacement problem');
END;

CREATE TRIGGER upload_batches_delete_scoped_submissions
BEFORE DELETE ON upload_batches
BEGIN
  DELETE FROM submissions WHERE upload_batch_id = OLD.id;
END;

CREATE TRIGGER student_model_versions_delete_scoped_artifacts
BEFORE DELETE ON student_model_versions
BEGIN
  DELETE FROM worksheets WHERE student_model_version_id = OLD.id;
END;
