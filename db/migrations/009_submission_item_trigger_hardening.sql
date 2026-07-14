-- SQLite's ordinary inequality operator returns NULL when one side is NULL.
-- Use NULL-safe identity checks so the assignment target cannot be cleared by
-- an UPDATE after the insert-time scope check has run.
DROP TRIGGER submission_assignment_item_is_immutable;

CREATE TRIGGER submission_assignment_item_is_immutable
BEFORE UPDATE OF assignment_item_id, assignment_id, class_id ON submissions
BEGIN
  SELECT CASE WHEN
    NEW.assignment_item_id IS NOT OLD.assignment_item_id
    OR NEW.assignment_id IS NOT OLD.assignment_id
    OR NEW.class_id IS NOT OLD.class_id
  THEN RAISE(ABORT, 'submission assignment context is immutable') END;
END;
