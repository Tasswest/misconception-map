DROP TRIGGER prediction_outcomes_match_locked_prediction;

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
    JOIN assignment_items AS assignment_item
      ON assignment_item.id = answer.assignment_item_id
    WHERE prediction.id = NEW.prediction_id
      AND prediction.membership_id = submission.membership_id
      AND prediction.problem_id = assignment_item.problem_id
      AND submission.submitted_at > prediction.locked_at
      AND answer_version.created_at >= submission.submitted_at
  ) THEN RAISE(ABORT, 'outcome must use a genuinely post-lock submission from the same student on the predicted problem') END;
END;

CREATE TRIGGER submissions_preserve_observed_identity
BEFORE UPDATE ON submissions
WHEN
  NEW.id IS NOT OLD.id
  OR NEW.class_id IS NOT OLD.class_id
  OR NEW.assignment_id IS NOT OLD.assignment_id
  OR NEW.membership_id IS NOT OLD.membership_id
  OR NEW.upload_batch_id IS NOT OLD.upload_batch_id
  OR NEW.attempt_number IS NOT OLD.attempt_number
  OR NEW.input_kind IS NOT OLD.input_kind
  OR NEW.submitted_at IS NOT OLD.submitted_at
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'submission identity and observed timestamp are immutable');
END;

CREATE TRIGGER student_model_hypotheses_only_retire
BEFORE UPDATE ON student_model_hypotheses
WHEN
  OLD.retired_at IS NOT NULL
  OR NEW.retired_at IS NULL
  OR NEW.retired_at < OLD.created_at
  OR NEW.id IS NOT OLD.id
  OR NEW.class_id IS NOT OLD.class_id
  OR NEW.membership_id IS NOT OLD.membership_id
  OR NEW.domain IS NOT OLD.domain
  OR NEW.scope_key IS NOT OLD.scope_key
  OR NEW.taxonomy_version IS NOT OLD.taxonomy_version
  OR NEW.misconception_id IS NOT OLD.misconception_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'student model hypotheses are immutable except for one retire transition');
END;
