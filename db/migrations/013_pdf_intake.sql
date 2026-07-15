-- Teacher worksheet PDFs are stored locally as immutable assignment sources.
-- Student PDFs are protected submission assets and are sent to GPT as direct
-- PDF file inputs, preserving text plus page-image context without a renderer.

DROP TRIGGER confirmed_assignment_sources_are_immutable;
DROP TRIGGER assignment_source_extractions_are_immutable;

CREATE TABLE assignment_sources_pdf (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('TYPED', 'IMAGE', 'PDF')),
  source_text TEXT,
  source_bytes BLOB,
  original_filename TEXT,
  media_type TEXT CHECK (
    media_type IS NULL
    OR media_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
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
    (
      source_kind = 'TYPED'
      AND source_text IS NOT NULL
      AND source_bytes IS NULL
      AND media_type IS NULL
    )
    OR
    (
      source_kind = 'IMAGE'
      AND source_text IS NULL
      AND source_bytes IS NOT NULL
      AND media_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND length(sha256) = 64
      AND width IS NOT NULL
      AND height IS NOT NULL
    )
    OR
    (
      source_kind = 'PDF'
      AND source_text IS NULL
      AND source_bytes IS NOT NULL
      AND media_type = 'application/pdf'
      AND length(sha256) = 64
      AND width IS NULL
      AND height IS NULL
    )
  ),
  FOREIGN KEY (assignment_id, class_id)
    REFERENCES assignments(id, class_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE assignment_source_extractions_pdf (
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
  problems_json TEXT NOT NULL CHECK (json_valid(problems_json)),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (source_id)
    REFERENCES assignment_sources_pdf(id) ON DELETE CASCADE
) STRICT;

INSERT INTO assignment_sources_pdf (
  id, class_id, assignment_id, source_kind, source_text, source_bytes,
  original_filename, media_type, sha256, width, height,
  preprocessing_version, status, error_code, created_at, updated_at
)
SELECT
  id, class_id, assignment_id, source_kind, source_text, source_bytes,
  original_filename, media_type, sha256, width, height,
  preprocessing_version, status, error_code, created_at, updated_at
FROM assignment_sources;

INSERT INTO assignment_source_extractions_pdf (
  id, source_id, model_name, prompt_version, schema_version,
  openai_response_id, input_hash, output_hash, overall_confidence,
  problems_json, input_tokens, output_tokens, latency_ms, created_at
)
SELECT
  id, source_id, model_name, prompt_version, schema_version,
  openai_response_id, input_hash, output_hash, overall_confidence,
  problems_json, input_tokens, output_tokens, latency_ms, created_at
FROM assignment_source_extractions;

DROP TABLE assignment_source_extractions;
DROP TABLE assignment_sources;
ALTER TABLE assignment_sources_pdf RENAME TO assignment_sources;
ALTER TABLE assignment_source_extractions_pdf
  RENAME TO assignment_source_extractions;

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

CREATE TABLE submission_assets_pdf (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL,
  page_position INTEGER NOT NULL CHECK (page_position > 0),
  storage_key TEXT,
  original_filename TEXT,
  media_type TEXT NOT NULL CHECK (
    media_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source_width INTEGER CHECK (source_width IS NULL OR source_width > 0),
  source_height INTEGER CHECK (source_height IS NULL OR source_height > 0),
  crop_left INTEGER CHECK (crop_left IS NULL OR crop_left >= 0),
  crop_top INTEGER CHECK (crop_top IS NULL OR crop_top >= 0),
  crop_width INTEGER CHECK (crop_width IS NULL OR crop_width > 0),
  crop_height INTEGER CHECK (crop_height IS NULL OR crop_height > 0),
  preprocessing_version TEXT,
  fallback_storage_key TEXT,
  fallback_media_type TEXT CHECK (
    fallback_media_type IS NULL
    OR fallback_media_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  fallback_byte_size INTEGER CHECK (
    fallback_byte_size IS NULL OR fallback_byte_size > 0
  ),
  fallback_sha256 TEXT CHECK (
    fallback_sha256 IS NULL OR length(fallback_sha256) = 64
  ),
  fallback_width INTEGER CHECK (
    fallback_width IS NULL OR fallback_width > 0
  ),
  fallback_height INTEGER CHECK (
    fallback_height IS NULL OR fallback_height > 0
  ),
  fallback_preprocessing_version TEXT,
  UNIQUE (submission_id, page_position),
  UNIQUE (storage_key),
  CHECK (
    (
      purged_at IS NULL
      AND storage_key IS NOT NULL
      AND original_filename IS NOT NULL
      AND length(sha256) = 64
    )
    OR
    (
      purged_at IS NOT NULL
      AND storage_key IS NULL
      AND original_filename IS NULL
      AND sha256 IS NULL
    )
  ),
  CHECK (
    media_type <> 'application/pdf'
    OR (
      width IS NULL
      AND height IS NULL
      AND source_width IS NULL
      AND source_height IS NULL
      AND crop_left IS NULL
      AND crop_top IS NULL
      AND crop_width IS NULL
      AND crop_height IS NULL
      AND fallback_storage_key IS NULL
      AND fallback_media_type IS NULL
    )
  ),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
) STRICT;

INSERT INTO submission_assets_pdf (
  id, submission_id, page_position, storage_key, original_filename,
  media_type, byte_size, sha256, width, height, purged_at, created_at,
  source_width, source_height, crop_left, crop_top, crop_width, crop_height,
  preprocessing_version, fallback_storage_key, fallback_media_type,
  fallback_byte_size, fallback_sha256, fallback_width, fallback_height,
  fallback_preprocessing_version
)
SELECT
  id, submission_id, page_position, storage_key, original_filename,
  media_type, byte_size, sha256, width, height, purged_at, created_at,
  source_width, source_height, crop_left, crop_top, crop_width, crop_height,
  preprocessing_version, fallback_storage_key, fallback_media_type,
  fallback_byte_size, fallback_sha256, fallback_width, fallback_height,
  fallback_preprocessing_version
FROM submission_assets;

DROP TABLE submission_assets;
ALTER TABLE submission_assets_pdf RENAME TO submission_assets;

CREATE UNIQUE INDEX unique_submission_asset_fallback_storage_key
ON submission_assets(fallback_storage_key)
WHERE fallback_storage_key IS NOT NULL;
