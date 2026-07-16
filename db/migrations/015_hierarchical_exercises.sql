-- Exercises are presentation and matching structure around immutable problems.
-- The problem prompt remains self-contained for all downstream diagnosis work.
CREATE TABLE exercises (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  exercise_label TEXT NOT NULL CHECK (length(trim(exercise_label)) > 0),
  shared_context TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (assignment_id, position),
  UNIQUE (assignment_id, exercise_label),
  UNIQUE (id, assignment_id, class_id),
  FOREIGN KEY (assignment_id, class_id)
    REFERENCES assignments(id, class_id) ON DELETE CASCADE
) STRICT;

ALTER TABLE assignment_items ADD COLUMN exercise_id TEXT;
ALTER TABLE assignment_items ADD COLUMN question_label TEXT;

-- Every assignment that already contains flat problems receives one default
-- exercise. Existing positions become labels verbatim, so diagnosed work is
-- never reordered or renumbered.
INSERT INTO exercises (
  id, class_id, assignment_id, position, exercise_label, shared_context, created_at
)
SELECT
  assignment.id || ':legacy-exercise', assignment.class_id, assignment.id,
  1, '1', NULL, assignment.created_at
FROM assignments AS assignment
WHERE EXISTS (
  SELECT 1 FROM assignment_items AS item
  WHERE item.assignment_id = assignment.id AND item.class_id = assignment.class_id
);

UPDATE assignment_items
SET
  exercise_id = assignment_id || ':legacy-exercise',
  question_label = CAST(position AS TEXT)
WHERE exercise_id IS NULL;

CREATE UNIQUE INDEX assignment_question_labels_are_scoped
ON assignment_items(exercise_id, question_label);

-- Raw legacy integrations that still insert a flat item are grouped after the
-- insert. Hierarchical repository writes provide both fields explicitly.
CREATE TRIGGER flat_assignment_items_receive_default_exercise
AFTER INSERT ON assignment_items
WHEN NEW.exercise_id IS NULL OR NEW.question_label IS NULL
BEGIN
  INSERT OR IGNORE INTO exercises (
    id, class_id, assignment_id, position, exercise_label, shared_context, created_at
  ) VALUES (
    NEW.assignment_id || ':legacy-exercise', NEW.class_id, NEW.assignment_id,
    1, '1', NULL, NEW.created_at
  );
  UPDATE assignment_items
  SET
    exercise_id = NEW.assignment_id || ':legacy-exercise',
    question_label = CAST(NEW.position AS TEXT)
  WHERE id = NEW.id;
END;

CREATE TRIGGER assignment_item_exercise_is_scoped
BEFORE INSERT ON assignment_items
WHEN NEW.exercise_id IS NOT NULL OR NEW.question_label IS NOT NULL
BEGIN
  SELECT CASE WHEN
    NEW.exercise_id IS NULL
    OR NEW.question_label IS NULL
    OR length(trim(NEW.question_label)) = 0
    OR NOT EXISTS (
      SELECT 1 FROM exercises AS exercise
      WHERE exercise.id = NEW.exercise_id
        AND exercise.assignment_id = NEW.assignment_id
        AND exercise.class_id = NEW.class_id
    )
  THEN RAISE(ABORT, 'assignment item exercise must belong to its assignment and class') END;
END;

CREATE TRIGGER assignment_item_grouping_is_immutable
BEFORE UPDATE OF exercise_id, question_label ON assignment_items
WHEN
  (OLD.exercise_id IS NOT NULL OR OLD.question_label IS NOT NULL)
  AND (
    NEW.exercise_id IS NOT OLD.exercise_id
    OR NEW.question_label IS NOT OLD.question_label
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment item exercise grouping is immutable');
END;

CREATE TRIGGER exercises_are_immutable
BEFORE UPDATE ON exercises
BEGIN
  SELECT RAISE(ABORT, 'exercises are immutable after confirmation');
END;

-- Extraction provenance now stores the hierarchical structured output. Flat
-- historical payloads are wrapped in a default exercise and field-renamed.
DROP TRIGGER assignment_source_extractions_are_immutable;

CREATE TABLE assignment_source_extractions_hierarchical (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL UNIQUE,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  openai_response_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  output_hash TEXT NOT NULL CHECK (length(output_hash) = 64),
  overall_confidence REAL NOT NULL CHECK (
    overall_confidence >= 0 AND overall_confidence <= 1
  ),
  exercises_json TEXT NOT NULL CHECK (json_valid(exercises_json)),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (source_id) REFERENCES assignment_sources(id) ON DELETE CASCADE
) STRICT;

INSERT INTO assignment_source_extractions_hierarchical (
  id, source_id, model_name, prompt_version, schema_version,
  openai_response_id, input_hash, output_hash, overall_confidence,
  exercises_json, input_tokens, output_tokens, latency_ms, created_at
)
SELECT
  extraction.id,
  extraction.source_id,
  extraction.model_name,
  extraction.prompt_version,
  extraction.schema_version,
  extraction.openai_response_id,
  extraction.input_hash,
  extraction.output_hash,
  extraction.overall_confidence,
  json_array(
    json_object(
      'exerciseLabel', '1',
      'sharedContext', NULL,
      'questions', json(COALESCE((
        SELECT json_group_array(
          json_object(
            'questionLabel', CAST(json_extract(problem.value, '$.position') AS TEXT),
            'problemStatement', json_extract(problem.value, '$.prompt'),
            'expectedAnswer', json_extract(problem.value, '$.correctAnswer'),
            'answerKind', json_extract(problem.value, '$.answerFormat'),
            'domain', json_extract(problem.value, '$.domain'),
            'extractionConfidence', json_extract(problem.value, '$.extractionConfidence'),
            'answerConfidence', json_extract(problem.value, '$.answerConfidence'),
            'reviewNote', json_extract(problem.value, '$.reviewNote')
          )
        )
        FROM json_each(extraction.problems_json) AS problem
      ), '[]'))
    )
  ),
  extraction.input_tokens,
  extraction.output_tokens,
  extraction.latency_ms,
  extraction.created_at
FROM assignment_source_extractions AS extraction;

DROP TABLE assignment_source_extractions;
ALTER TABLE assignment_source_extractions_hierarchical
  RENAME TO assignment_source_extractions;

CREATE TRIGGER assignment_source_extractions_are_immutable
BEFORE UPDATE ON assignment_source_extractions
BEGIN
  SELECT RAISE(ABORT, 'assignment source extraction is immutable');
END;

CREATE INDEX exercises_by_assignment_position
ON exercises(assignment_id, position);
