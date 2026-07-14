-- Every piece of student work targets one extracted assignment problem. This
-- keeps the prompt/answer context assignment-owned instead of teacher-retyped.
ALTER TABLE submissions ADD COLUMN assignment_item_id TEXT;

UPDATE submissions
SET assignment_item_id = (
  SELECT item.id
  FROM assignment_items AS item
  WHERE item.assignment_id = submissions.assignment_id
    AND item.class_id = submissions.class_id
  ORDER BY item.position
  LIMIT 1
)
WHERE assignment_item_id IS NULL;

CREATE TRIGGER submissions_require_scoped_assignment_item
BEFORE INSERT ON submissions
BEGIN
  SELECT CASE WHEN NEW.assignment_item_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM assignment_items AS item
    WHERE item.id = NEW.assignment_item_id
      AND item.assignment_id = NEW.assignment_id
      AND item.class_id = NEW.class_id
  ) THEN RAISE(ABORT, 'submission assignment item must belong to its assignment and class') END;
END;

CREATE TRIGGER submission_assignment_item_is_immutable
BEFORE UPDATE OF assignment_item_id, assignment_id, class_id ON submissions
BEGIN
  SELECT CASE WHEN
    NEW.assignment_item_id <> OLD.assignment_item_id
    OR NEW.assignment_id <> OLD.assignment_id
    OR NEW.class_id <> OLD.class_id
  THEN RAISE(ABORT, 'submission assignment context is immutable') END;
END;

-- Preserve preprocessing provenance so a diagnosis can be reproduced and the
-- app can prove that small equals-sign strokes were not downscaled away.
ALTER TABLE submission_assets ADD COLUMN source_width INTEGER CHECK (source_width IS NULL OR source_width > 0);
ALTER TABLE submission_assets ADD COLUMN source_height INTEGER CHECK (source_height IS NULL OR source_height > 0);
ALTER TABLE submission_assets ADD COLUMN crop_left INTEGER CHECK (crop_left IS NULL OR crop_left >= 0);
ALTER TABLE submission_assets ADD COLUMN crop_top INTEGER CHECK (crop_top IS NULL OR crop_top >= 0);
ALTER TABLE submission_assets ADD COLUMN crop_width INTEGER CHECK (crop_width IS NULL OR crop_width > 0);
ALTER TABLE submission_assets ADD COLUMN crop_height INTEGER CHECK (crop_height IS NULL OR crop_height > 0);
ALTER TABLE submission_assets ADD COLUMN preprocessing_version TEXT;

-- Parsing metadata makes the transcription guard auditable in persisted work.
ALTER TABLE diagnosis_steps ADD COLUMN step_kind TEXT NOT NULL DEFAULT 'EXPRESSION'
  CHECK (step_kind IN ('EQUATION', 'EXPRESSION', 'ANSWER', 'ANNOTATION', 'UNPARSEABLE'));
ALTER TABLE diagnosis_steps ADD COLUMN parse_issue TEXT;

-- An assignment owns one typed or photographed worksheet source. The source is
-- stored locally; only deidentified mathematical content is sent for extraction.
CREATE TABLE assignment_sources (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('TYPED', 'IMAGE')),
  source_text TEXT,
  source_bytes BLOB,
  original_filename TEXT,
  media_type TEXT CHECK (media_type IS NULL OR media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  preprocessing_version TEXT,
  status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (
    status IN ('UPLOADED', 'EXTRACTED', 'NEEDS_REVIEW', 'FAILED', 'CONFIRMED')
  ),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, assignment_id, class_id),
  CHECK (
    (source_kind = 'TYPED' AND source_text IS NOT NULL AND source_bytes IS NULL AND media_type IS NULL)
    OR
    (source_kind = 'IMAGE' AND source_text IS NULL AND source_bytes IS NOT NULL AND media_type IS NOT NULL AND length(sha256) = 64)
  ),
  FOREIGN KEY (assignment_id, class_id)
    REFERENCES assignments(id, class_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE assignment_source_extractions (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL UNIQUE,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  openai_response_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  output_hash TEXT NOT NULL CHECK (length(output_hash) = 64),
  overall_confidence REAL NOT NULL CHECK (overall_confidence >= 0 AND overall_confidence <= 1),
  problems_json TEXT NOT NULL CHECK (json_valid(problems_json)),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (source_id) REFERENCES assignment_sources(id) ON DELETE CASCADE
) STRICT;

CREATE TRIGGER confirmed_assignment_sources_are_immutable
BEFORE UPDATE ON assignment_sources
WHEN OLD.status = 'CONFIRMED'
BEGIN
  SELECT RAISE(ABORT, 'confirmed assignment source is immutable');
END;

CREATE TRIGGER assignment_source_extractions_are_immutable
BEFORE UPDATE ON assignment_source_extractions
BEGIN
  SELECT RAISE(ABORT, 'assignment source extraction is immutable');
END;

CREATE INDEX submissions_by_assignment_item
ON submissions(assignment_id, assignment_item_id, membership_id, created_at);
