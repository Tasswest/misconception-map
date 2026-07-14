-- Bind every diagnosis run to the exact submission whose evidence was sent to
-- the model. Class-only run scoping is insufficient because a class can have
-- many simultaneously processing student submissions.
CREATE TABLE diagnosis_run_targets (
  ai_run_id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX diagnosis_run_targets_by_submission
ON diagnosis_run_targets(submission_id, created_at);

-- Upgrade any evidence created before this edge existed. The primary key makes
-- migration fail rather than silently bless a run already used across students.
INSERT INTO diagnosis_run_targets (ai_run_id, submission_id, created_at)
SELECT
  diagnosis.ai_run_id,
  answer.submission_id,
  MIN(diagnosis.created_at)
FROM diagnoses AS diagnosis
JOIN answer_versions AS answer_version
  ON answer_version.id = diagnosis.answer_version_id
JOIN submission_answers AS answer
  ON answer.id = answer_version.submission_answer_id
WHERE diagnosis.ai_run_id IS NOT NULL
GROUP BY diagnosis.ai_run_id, answer.submission_id;

CREATE TRIGGER diagnosis_run_targets_are_scoped
BEFORE INSERT ON diagnosis_run_targets
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM ai_runs AS run
    JOIN submissions AS submission
      ON submission.id = NEW.submission_id
      AND submission.class_id = run.class_id
    WHERE run.id = NEW.ai_run_id
      AND run.purpose = 'DIAGNOSIS'
      AND run.status IN ('QUEUED', 'RUNNING')
  ) THEN RAISE(ABORT, 'diagnosis run target must bind an active diagnosis run to a same-class submission') END;
END;

CREATE TRIGGER diagnosis_run_targets_are_immutable
BEFORE UPDATE ON diagnosis_run_targets
BEGIN
  SELECT RAISE(ABORT, 'diagnosis run targets are immutable');
END;

-- A direct delete would let a caller rebind the same run. Privacy cascades are
-- still allowed because SQLite removes the parent before cascading children.
CREATE TRIGGER diagnosis_run_targets_cannot_be_deleted_directly
BEFORE DELETE ON diagnosis_run_targets
WHEN
  EXISTS (SELECT 1 FROM ai_runs WHERE id = OLD.ai_run_id)
  AND EXISTS (SELECT 1 FROM submissions WHERE id = OLD.submission_id)
BEGIN
  SELECT RAISE(ABORT, 'diagnosis run targets cannot be deleted directly');
END;

-- Prevent a targeted run from being removed while its submission still owns
-- the binding. Class privacy cleanup removes memberships/submissions first.
CREATE TRIGGER targeted_diagnosis_runs_cannot_be_deleted_directly
BEFORE DELETE ON ai_runs
WHEN EXISTS (
  SELECT 1 FROM diagnosis_run_targets AS target
  WHERE target.ai_run_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'targeted diagnosis runs cannot be deleted directly');
END;

-- Keep the exact target edge in the database trust boundary. A same-class run
-- must not be reusable for another student's immutable answer evidence.
CREATE TRIGGER diagnoses_match_run_target
BEFORE INSERT ON diagnoses
WHEN NEW.source = 'AI' OR NEW.ai_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM diagnosis_run_targets AS target
    JOIN answer_versions AS answer_version
      ON answer_version.id = NEW.answer_version_id
    JOIN submission_answers AS answer
      ON answer.id = answer_version.submission_answer_id
    WHERE target.ai_run_id = NEW.ai_run_id
      AND target.submission_id = answer.submission_id
  ) THEN RAISE(ABORT, 'AI diagnosis run must target the exact submission answer') END;
END;
