-- Extraction attempts exist independently from successful assignment sources,
-- so a provider failure or an intentionally rejected oversized PDF remains
-- diagnosable even when no extraction payload can be persisted.
CREATE TABLE worksheet_extraction_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('TYPED', 'IMAGE', 'PDF')),
  original_filename TEXT,
  page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0, 1)),
  error_code TEXT,
  error_message TEXT,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  CHECK (
    (status = 'RUNNING' AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'SUCCEEDED' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'FAILED' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  ),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX worksheet_extraction_attempts_recent
ON worksheet_extraction_attempts(created_at DESC, id DESC);

CREATE INDEX worksheet_extraction_attempts_by_assignment
ON worksheet_extraction_attempts(assignment_id, created_at DESC);
