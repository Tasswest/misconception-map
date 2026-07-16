-- A teacher can clear a flagged diagnosis (or an unmatched submission) from
-- the results triage without changing the immutable AI diagnosis. Reviews are
-- append-only so the optional note remains an auditable teacher decision.
CREATE TABLE teacher_item_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL,
  diagnosis_id TEXT,
  note TEXT CHECK (note IS NULL OR length(trim(note)) > 0),
  reviewer_type TEXT NOT NULL DEFAULT 'TEACHER'
    CHECK (reviewer_type = 'TEACHER'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (diagnosis_id) REFERENCES diagnoses(id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX one_teacher_review_per_diagnosis
ON teacher_item_reviews(diagnosis_id)
WHERE diagnosis_id IS NOT NULL;

CREATE UNIQUE INDEX one_teacher_review_per_unmatched_submission
ON teacher_item_reviews(submission_id)
WHERE diagnosis_id IS NULL;

CREATE TRIGGER teacher_item_reviews_are_immutable
BEFORE UPDATE ON teacher_item_reviews
BEGIN
  SELECT RAISE(ABORT, 'teacher item reviews are append-only');
END;
