-- Recorded work is not held out, even if an imported submission carries a
-- future-dated submitted_at value. The row's existence before the lock is the
-- decisive fact; timestamp-based invalidation remains for rows attached later.
CREATE TRIGGER predictions_reject_any_preexisting_answer
BEFORE INSERT ON predictions
WHEN EXISTS (
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
)
BEGIN
  SELECT RAISE(ABORT, 'prediction target already has recorded work for this student');
END;
