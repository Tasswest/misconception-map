ALTER TABLE assignment_source_extractions
ADD COLUMN source_summary TEXT NOT NULL DEFAULT 'Previously extracted worksheet.';

ALTER TABLE assignment_source_extractions
ADD COLUMN cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0, 1));

CREATE INDEX assignment_source_extractions_input_cache
ON assignment_source_extractions(input_hash, created_at DESC);
