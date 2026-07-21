-- A follow-up evaluation is an AI-drafted retest of one corrected assignment.
-- Every generated question is pinned to an observed mistake (a taxonomy
-- misconception, an isolated slip, or an item the AI could not settle), and the
-- document mirrors the source exam's structure and language. It is a printable
-- teacher artifact: it never writes into assignments, submissions, or grades.
CREATE TABLE follow_up_evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  overview TEXT NOT NULL CHECK (length(trim(overview)) > 0),
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  openai_response_id TEXT,
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  output_hash TEXT NOT NULL CHECK (length(output_hash) = 64),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (assignment_id, version),
  FOREIGN KEY (assignment_id, class_id)
    REFERENCES assignments(id, class_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX follow_up_evaluations_by_assignment
ON follow_up_evaluations (assignment_id, created_at DESC);

CREATE INDEX follow_up_evaluations_by_input_hash
ON follow_up_evaluations (assignment_id, input_hash);

CREATE TABLE follow_up_evaluation_exercises (
  id TEXT PRIMARY KEY NOT NULL,
  evaluation_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  exercise_label TEXT NOT NULL CHECK (length(trim(exercise_label)) > 0),
  shared_context TEXT CHECK (shared_context IS NULL OR length(trim(shared_context)) > 0),
  UNIQUE (evaluation_id, position),
  FOREIGN KEY (evaluation_id)
    REFERENCES follow_up_evaluations(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE follow_up_evaluation_items (
  id TEXT PRIMARY KEY NOT NULL,
  evaluation_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  question_label TEXT NOT NULL CHECK (length(trim(question_label)) > 0),
  prompt TEXT NOT NULL CHECK (length(trim(prompt)) > 0),
  answer_format TEXT NOT NULL CHECK (
    answer_format IN ('EXPRESSION', 'NUMBER', 'FRACTION', 'MULTIPLE_CHOICE', 'SHORT_TEXT')
  ),
  expected_answer TEXT NOT NULL CHECK (length(trim(expected_answer)) > 0),
  points REAL NOT NULL CHECK (points > 0),
  target_kind TEXT NOT NULL CHECK (
    target_kind IN ('MISCONCEPTION', 'SLIP', 'UNCERTAIN_RETEST')
  ),
  target_misconception_id TEXT,
  taxonomy_version TEXT,
  source_question_reference TEXT NOT NULL CHECK (length(trim(source_question_reference)) > 0),
  affected_student_count INTEGER NOT NULL CHECK (affected_student_count >= 0),
  why_this_question TEXT NOT NULL CHECK (length(trim(why_this_question)) > 0),
  UNIQUE (exercise_id, position),
  FOREIGN KEY (evaluation_id)
    REFERENCES follow_up_evaluations(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id)
    REFERENCES follow_up_evaluation_exercises(id) ON DELETE CASCADE,
  -- A misconception retest names its taxonomy entry; slips and uncertain
  -- retests never carry one.
  CHECK ((target_kind = 'MISCONCEPTION') = (target_misconception_id IS NOT NULL)),
  CHECK ((target_misconception_id IS NULL) = (taxonomy_version IS NULL))
) STRICT;

CREATE INDEX follow_up_evaluation_items_by_evaluation
ON follow_up_evaluation_items (evaluation_id, exercise_id, position);

-- Generated evaluations are append-only provenance artifacts; a changed input
-- produces a new version instead of editing an existing one.
CREATE TRIGGER follow_up_evaluations_are_append_only
BEFORE UPDATE ON follow_up_evaluations
BEGIN
  SELECT RAISE(ABORT, 'follow-up evaluations are append-only');
END;

CREATE TRIGGER follow_up_evaluation_exercises_are_append_only
BEFORE UPDATE ON follow_up_evaluation_exercises
BEGIN
  SELECT RAISE(ABORT, 'follow-up evaluation exercises are append-only');
END;

CREATE TRIGGER follow_up_evaluation_items_are_append_only
BEFORE UPDATE ON follow_up_evaluation_items
BEGIN
  SELECT RAISE(ABORT, 'follow-up evaluation items are append-only');
END;
