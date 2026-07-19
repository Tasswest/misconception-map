-- Gradebook layer. The misconception engine deliberately carries no marks;
-- teachers who also grade a paper now record that grade alongside the
-- diagnosis without altering any diagnostic record. Grades are teacher-owned
-- and independent of the AI outcome.

-- Optional class identity fields. Historical classes keep both NULL.
ALTER TABLE classes ADD COLUMN school_name TEXT;
ALTER TABLE classes ADD COLUMN photo_asset_path TEXT;

-- One teacher-entered grade per student per exam. The submission that was
-- diagnosed and the grade the teacher awarded are kept as separate facts:
-- deleting or re-uploading work never silently rewrites a recorded grade,
-- and a grade can exist for a paper graded entirely by hand.
CREATE TABLE exam_grades (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  score REAL NOT NULL CHECK (score >= 0),
  max_score REAL NOT NULL CHECK (max_score > 0),
  graded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (assignment_id, membership_id),
  FOREIGN KEY (assignment_id, class_id)
    REFERENCES assignments(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, class_id)
    REFERENCES class_memberships(id, class_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX exam_grades_by_assignment ON exam_grades (assignment_id);
CREATE INDEX exam_grades_by_membership ON exam_grades (membership_id);

-- A score can never exceed the paper's maximum, on insert or edit.
CREATE TRIGGER exam_grade_within_max_on_insert
BEFORE INSERT ON exam_grades
WHEN NEW.score > NEW.max_score
BEGIN
  SELECT RAISE(ABORT, 'exam grade score cannot exceed its maximum');
END;

CREATE TRIGGER exam_grade_within_max_on_update
BEFORE UPDATE OF score, max_score ON exam_grades
WHEN NEW.score > NEW.max_score
BEGIN
  SELECT RAISE(ABORT, 'exam grade score cannot exceed its maximum');
END;
