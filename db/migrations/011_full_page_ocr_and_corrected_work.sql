-- A student image can now represent either one selected problem or a complete
-- page that GPT segments against the assignment-owned problem list.
ALTER TABLE submissions ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'SINGLE_PROBLEM'
  CHECK (scope_kind IN ('SINGLE_PROBLEM', 'FULL_PAGE'));

DROP TRIGGER submissions_require_scoped_assignment_item;
DROP TRIGGER submission_assignment_item_is_immutable;

CREATE TRIGGER submissions_require_scoped_assignment_item
BEFORE INSERT ON submissions
BEGIN
  SELECT CASE WHEN
    (NEW.scope_kind = 'SINGLE_PROBLEM' AND (
      NEW.assignment_item_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM assignment_items AS item
        WHERE item.id = NEW.assignment_item_id
          AND item.assignment_id = NEW.assignment_id
          AND item.class_id = NEW.class_id
      )
    ))
    OR
    (NEW.scope_kind = 'FULL_PAGE' AND (
      NEW.input_kind <> 'IMAGE'
      OR NEW.assignment_item_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM assignment_items AS item
        WHERE item.assignment_id = NEW.assignment_id
          AND item.class_id = NEW.class_id
      )
    ))
  THEN RAISE(ABORT, 'submission scope must match assignment context') END;
END;

CREATE TRIGGER submission_assignment_item_is_immutable
BEFORE UPDATE OF assignment_item_id, assignment_id, class_id, scope_kind ON submissions
BEGIN
  SELECT CASE WHEN
    NEW.assignment_item_id IS NOT OLD.assignment_item_id
    OR NEW.assignment_id IS NOT OLD.assignment_id
    OR NEW.class_id IS NOT OLD.class_id
    OR NEW.scope_kind IS NOT OLD.scope_kind
  THEN RAISE(ABORT, 'submission assignment context is immutable') END;
END;

-- Keep a full-frame, orientation-corrected rendition for one OCR retry when
-- normalized work is low-confidence. The fallback is local and deidentified.
ALTER TABLE submission_assets ADD COLUMN fallback_storage_key TEXT;
ALTER TABLE submission_assets ADD COLUMN fallback_media_type TEXT
  CHECK (fallback_media_type IS NULL OR fallback_media_type IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE submission_assets ADD COLUMN fallback_byte_size INTEGER
  CHECK (fallback_byte_size IS NULL OR fallback_byte_size > 0);
ALTER TABLE submission_assets ADD COLUMN fallback_sha256 TEXT
  CHECK (fallback_sha256 IS NULL OR length(fallback_sha256) = 64);
ALTER TABLE submission_assets ADD COLUMN fallback_width INTEGER
  CHECK (fallback_width IS NULL OR fallback_width > 0);
ALTER TABLE submission_assets ADD COLUMN fallback_height INTEGER
  CHECK (fallback_height IS NULL OR fallback_height > 0);
ALTER TABLE submission_assets ADD COLUMN fallback_preprocessing_version TEXT;

CREATE UNIQUE INDEX unique_submission_asset_fallback_storage_key
ON submission_assets(fallback_storage_key)
WHERE fallback_storage_key IS NOT NULL;

-- Corrected-exam pages explain both invalid and valid steps.
ALTER TABLE diagnosis_steps ADD COLUMN correct_note TEXT;

-- Attempts make the automatic original-rendition retry auditable without
-- weakening the immutable provenance of the parent AI run.
CREATE TABLE diagnosis_image_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  ai_run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal IN (1, 2)),
  rendition TEXT NOT NULL CHECK (rendition IN ('NORMALIZED', 'ORIGINAL_FALLBACK')),
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  output_hash TEXT NOT NULL CHECK (length(output_hash) = 64),
  openai_response_id TEXT NOT NULL,
  visible_problem_count INTEGER NOT NULL DEFAULT 1 CHECK (visible_problem_count >= 0),
  minimum_transcription_confidence REAL CHECK (
    minimum_transcription_confidence IS NULL
    OR minimum_transcription_confidence BETWEEN 0 AND 1
  ),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (ai_run_id, ordinal),
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX one_selected_diagnosis_image_attempt
ON diagnosis_image_attempts(ai_run_id)
WHERE selected = 1;

CREATE TRIGGER diagnosis_image_attempts_are_immutable
BEFORE UPDATE ON diagnosis_image_attempts
BEGIN
  SELECT RAISE(ABORT, 'diagnosis image attempts are immutable');
END;
