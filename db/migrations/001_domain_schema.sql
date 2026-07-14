CREATE TABLE taxonomy_versions (
  version TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  activated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE taxonomy_sources (
  taxonomy_version TEXT NOT NULL,
  source_id TEXT NOT NULL,
  citation_json TEXT NOT NULL CHECK (json_valid(citation_json)),
  PRIMARY KEY (taxonomy_version, source_id),
  FOREIGN KEY (taxonomy_version) REFERENCES taxonomy_versions(version) ON DELETE RESTRICT
) STRICT;

CREATE TABLE taxonomy_terms (
  taxonomy_version TEXT NOT NULL,
  misconception_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('ALGEBRA', 'FRACTIONS')),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  definition TEXT NOT NULL CHECK (length(trim(definition)) > 0),
  citation_note TEXT NOT NULL CHECK (length(trim(citation_note)) > 0),
  term_json TEXT NOT NULL CHECK (json_valid(term_json)),
  PRIMARY KEY (taxonomy_version, misconception_id),
  FOREIGN KEY (taxonomy_version) REFERENCES taxonomy_versions(version) ON DELETE RESTRICT
) STRICT;

CREATE TABLE taxonomy_term_sources (
  taxonomy_version TEXT NOT NULL,
  misconception_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (taxonomy_version, misconception_id, source_id),
  FOREIGN KEY (taxonomy_version, misconception_id)
    REFERENCES taxonomy_terms(taxonomy_version, misconception_id) ON DELETE RESTRICT,
  FOREIGN KEY (taxonomy_version, source_id)
    REFERENCES taxonomy_sources(taxonomy_version, source_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE classes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  grade_band TEXT NOT NULL CHECK (
    grade_band IN ('GRADE_5', 'GRADE_6', 'GRADE_7', 'GRADE_8', 'MIXED_5_8')
  ),
  school_year TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE students (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  external_ref TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE class_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  roster_code TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  archived_at TEXT,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (class_id, student_id),
  UNIQUE (id, class_id),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE problems (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('ALGEBRA', 'FRACTIONS')),
  prompt TEXT NOT NULL CHECK (length(trim(prompt)) > 0),
  answer_format TEXT NOT NULL CHECK (
    answer_format IN ('EXPRESSION', 'NUMBER', 'FRACTION', 'MULTIPLE_CHOICE', 'SHORT_TEXT')
  ),
  correct_answer TEXT NOT NULL CHECK (length(trim(correct_answer)) > 0),
  canonical_correct_answer TEXT,
  origin TEXT NOT NULL CHECK (
    origin IN ('TEACHER', 'ASSIGNMENT', 'WORKSHEET', 'PREDICTION', 'SEED')
  ),
  content_hash TEXT CHECK (content_hash IS NULL OR length(content_hash) = 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, class_id),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE assignments (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  domain TEXT NOT NULL CHECK (domain IN ('ALGEBRA', 'FRACTIONS', 'MIXED')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'ARCHIVED')),
  assigned_at TEXT,
  due_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, class_id),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE assignment_items (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  points REAL NOT NULL DEFAULT 1 CHECK (points > 0),
  is_required INTEGER NOT NULL DEFAULT 1 CHECK (is_required IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (assignment_id, position),
  UNIQUE (assignment_id, problem_id),
  UNIQUE (id, assignment_id, class_id),
  FOREIGN KEY (assignment_id, class_id)
    REFERENCES assignments(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (problem_id, class_id)
    REFERENCES problems(id, class_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('DIAGNOSIS', 'STUDENT_MODEL', 'PREDICTION', 'PRACTICE', 'TEACHING_BRIEF')
  ),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  input_hash TEXT CHECK (input_hash IS NULL OR length(input_hash) = 64),
  output_hash TEXT CHECK (output_hash IS NULL OR length(output_hash) = 64),
  openai_response_id TEXT,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  error_code TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE upload_batches (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (
    status IN ('QUEUED', 'PROCESSING', 'COMPLETE', 'PARTIAL', 'FAILED')
  ),
  total_files INTEGER NOT NULL CHECK (total_files >= 0),
  processed_files INTEGER NOT NULL DEFAULT 0 CHECK (processed_files >= 0),
  failed_files INTEGER NOT NULL DEFAULT 0 CHECK (failed_files >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE (id, assignment_id, class_id),
  CHECK (processed_files + failed_files <= total_files),
  FOREIGN KEY (assignment_id, class_id)
    REFERENCES assignments(id, class_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE submissions (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  upload_batch_id TEXT,
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  input_kind TEXT NOT NULL CHECK (input_kind IN ('IMAGE', 'TYPED', 'CSV', 'DEMO')),
  status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (
    status IN ('UPLOADED', 'PROCESSING', 'DIAGNOSED', 'NEEDS_REVIEW', 'FAILED')
  ),
  sanitized_error_code TEXT,
  sanitized_error_message TEXT,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (assignment_id, membership_id, attempt_number),
  UNIQUE (id, assignment_id, class_id),
  FOREIGN KEY (assignment_id, class_id)
    REFERENCES assignments(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, class_id)
    REFERENCES class_memberships(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (upload_batch_id, assignment_id, class_id)
    REFERENCES upload_batches(id, assignment_id, class_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE submission_assets (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL,
  page_position INTEGER NOT NULL CHECK (page_position > 0),
  storage_key TEXT,
  original_filename TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (submission_id, page_position),
  UNIQUE (storage_key),
  CHECK (
    (purged_at IS NULL AND storage_key IS NOT NULL AND original_filename IS NOT NULL AND length(sha256) = 64)
    OR
    (purged_at IS NOT NULL AND storage_key IS NULL AND original_filename IS NULL AND sha256 IS NULL)
  ),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE submission_answers (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  assignment_item_id TEXT,
  position INTEGER NOT NULL CHECK (position > 0),
  observed_prompt TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (submission_id, position),
  UNIQUE (id, submission_id),
  CHECK (assignment_item_id IS NOT NULL OR length(trim(observed_prompt)) > 0),
  FOREIGN KEY (submission_id, assignment_id, class_id)
    REFERENCES submissions(id, assignment_id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (assignment_item_id, assignment_id, class_id)
    REFERENCES assignment_items(id, assignment_id, class_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE answer_versions (
  id TEXT PRIMARY KEY NOT NULL,
  submission_answer_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  response_text TEXT NOT NULL,
  normalized_answer TEXT,
  source TEXT NOT NULL CHECK (
    source IN ('IMAGE_TRANSCRIPTION', 'TYPED', 'CSV', 'TEACHER_CORRECTION', 'SEED')
  ),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  creator_type TEXT NOT NULL CHECK (creator_type IN ('AI', 'TEACHER', 'SYSTEM', 'IMPORT')),
  change_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (submission_answer_id, version),
  UNIQUE (id, submission_answer_id),
  FOREIGN KEY (submission_answer_id) REFERENCES submission_answers(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE diagnoses (
  id TEXT PRIMARY KEY NOT NULL,
  answer_version_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  source TEXT NOT NULL CHECK (source IN ('AI', 'TEACHER', 'SEED')),
  ai_run_id TEXT,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('CORRECT', 'MISCONCEPTION', 'NEEDS_REVIEW', 'INSUFFICIENT_EVIDENCE', 'MULTIPLE_PLAUSIBLE')
  ),
  taxonomy_version TEXT,
  misconception_id TEXT,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  severity INTEGER NOT NULL CHECK (severity >= 0 AND severity <= 3),
  transcription TEXT NOT NULL,
  observed_transformation TEXT,
  strategy_variant TEXT,
  evidence_quote TEXT,
  transcription_confidence REAL NOT NULL CHECK (
    transcription_confidence >= 0 AND transcription_confidence <= 1
  ),
  reasoning_confidence REAL NOT NULL CHECK (
    reasoning_confidence >= 0 AND reasoning_confidence <= 1
  ),
  image_quality TEXT NOT NULL CHECK (
    image_quality IN ('GOOD', 'USABLE', 'POOR', 'NOT_APPLICABLE')
  ),
  review_reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(review_reasons_json)),
  model_name TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  openai_response_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (answer_version_id, version),
  CHECK (
    (outcome = 'CORRECT' AND taxonomy_version IS NULL AND misconception_id IS NULL AND severity = 0)
    OR
    (outcome = 'MISCONCEPTION' AND taxonomy_version IS NOT NULL AND misconception_id IS NOT NULL AND severity BETWEEN 1 AND 3)
    OR
    (outcome IN ('NEEDS_REVIEW', 'INSUFFICIENT_EVIDENCE', 'MULTIPLE_PLAUSIBLE') AND taxonomy_version IS NULL AND misconception_id IS NULL)
  ),
  FOREIGN KEY (answer_version_id) REFERENCES answer_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (taxonomy_version, misconception_id)
    REFERENCES taxonomy_terms(taxonomy_version, misconception_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE diagnosis_steps (
  id TEXT PRIMARY KEY NOT NULL,
  diagnosis_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  step_text TEXT NOT NULL CHECK (length(trim(step_text)) > 0),
  normalized_math TEXT,
  correctness TEXT NOT NULL CHECK (correctness IN ('CORRECT', 'INCORRECT', 'UNCLEAR')),
  error_note TEXT,
  evidence_quote TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (diagnosis_id, position),
  FOREIGN KEY (diagnosis_id) REFERENCES diagnoses(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE diagnosis_candidates (
  diagnosis_id TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  taxonomy_version TEXT NOT NULL,
  misconception_id TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_note TEXT,
  PRIMARY KEY (diagnosis_id, rank),
  UNIQUE (diagnosis_id, taxonomy_version, misconception_id),
  FOREIGN KEY (diagnosis_id) REFERENCES diagnoses(id) ON DELETE CASCADE,
  FOREIGN KEY (taxonomy_version, misconception_id)
    REFERENCES taxonomy_terms(taxonomy_version, misconception_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE diagnosis_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  diagnosis_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('CONFIRM', 'RECLASSIFY', 'MARK_CORRECT', 'ABSTAIN', 'EDIT_TRANSCRIPTION', 'COMMENT')
  ),
  selected_taxonomy_version TEXT,
  selected_misconception_id TEXT,
  selected_severity INTEGER CHECK (selected_severity IS NULL OR selected_severity BETWEEN 0 AND 3),
  corrected_transcription TEXT,
  note TEXT,
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('TEACHER', 'SYSTEM')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    action <> 'RECLASSIFY'
    OR (selected_taxonomy_version IS NOT NULL AND selected_misconception_id IS NOT NULL)
  ),
  FOREIGN KEY (diagnosis_id) REFERENCES diagnoses(id) ON DELETE CASCADE,
  FOREIGN KEY (selected_taxonomy_version, selected_misconception_id)
    REFERENCES taxonomy_terms(taxonomy_version, misconception_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE student_model_hypotheses (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('ALGEBRA', 'FRACTIONS')),
  scope_key TEXT NOT NULL CHECK (length(trim(scope_key)) > 0),
  taxonomy_version TEXT NOT NULL,
  misconception_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  retired_at TEXT,
  UNIQUE (membership_id, scope_key, taxonomy_version, misconception_id),
  UNIQUE (id, membership_id, class_id),
  FOREIGN KEY (membership_id, class_id)
    REFERENCES class_memberships(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (taxonomy_version, misconception_id)
    REFERENCES taxonomy_terms(taxonomy_version, misconception_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE student_model_versions (
  id TEXT PRIMARY KEY NOT NULL,
  hypothesis_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (
    status IN ('PROVISIONAL', 'SUPPORTED', 'CONTRADICTED', 'INSUFFICIENT_EVIDENCE', 'RETIRED')
  ),
  rule_statement TEXT NOT NULL CHECK (length(trim(rule_statement)) > 0),
  formal_pattern_json TEXT NOT NULL CHECK (json_valid(formal_pattern_json)),
  scope_limits_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_limits_json)),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  support_count INTEGER NOT NULL DEFAULT 0 CHECK (support_count >= 0),
  contradiction_count INTEGER NOT NULL DEFAULT 0 CHECK (contradiction_count >= 0),
  ai_run_id TEXT,
  model_name TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  superseded_at TEXT,
  UNIQUE (hypothesis_id, version),
  FOREIGN KEY (hypothesis_id) REFERENCES student_model_hypotheses(id) ON DELETE CASCADE,
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL
) STRICT;

CREATE TABLE student_model_evidence (
  student_model_version_id TEXT NOT NULL,
  diagnosis_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SUPPORTS', 'CONTRADICTS', 'AMBIGUOUS')),
  weight REAL NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 1),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (student_model_version_id, diagnosis_id),
  FOREIGN KEY (student_model_version_id) REFERENCES student_model_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (diagnosis_id) REFERENCES diagnoses(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE student_model_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  student_model_version_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CONFIRM', 'REJECT', 'COMMENT')),
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('TEACHER', 'SYSTEM')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (student_model_version_id) REFERENCES student_model_versions(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE predictions (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  student_model_version_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  rule_applied INTEGER NOT NULL CHECK (rule_applied IN (0, 1)),
  predicted_answer TEXT,
  canonical_predicted_answer TEXT,
  correct_answer_snapshot TEXT NOT NULL CHECK (length(trim(correct_answer_snapshot)) > 0),
  canonical_correct_answer TEXT,
  trace_json TEXT NOT NULL CHECK (json_valid(trace_json)),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  abstention_reason TEXT,
  ai_run_id TEXT,
  model_name TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  locked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (rule_applied = 1 AND predicted_answer IS NOT NULL AND abstention_reason IS NULL)
    OR
    (rule_applied = 0 AND predicted_answer IS NULL AND length(trim(abstention_reason)) > 0)
  ),
  FOREIGN KEY (membership_id, class_id)
    REFERENCES class_memberships(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (student_model_version_id) REFERENCES student_model_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (problem_id, class_id) REFERENCES problems(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL
) STRICT;

CREATE TABLE prediction_outcome_versions (
  id TEXT PRIMARY KEY NOT NULL,
  prediction_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  answer_version_id TEXT,
  actual_answer_snapshot TEXT NOT NULL CHECK (length(trim(actual_answer_snapshot)) > 0),
  canonical_actual_answer TEXT,
  match_state TEXT NOT NULL CHECK (
    match_state IN ('MATCH', 'MISMATCH', 'AMBIGUOUS', 'UNEVALUABLE')
  ),
  evaluation_method TEXT NOT NULL CHECK (
    evaluation_method IN ('DETERMINISTIC', 'AI_REVIEW', 'TEACHER')
  ),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  note TEXT,
  observed_at TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (prediction_id, version),
  FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
  FOREIGN KEY (answer_version_id) REFERENCES answer_versions(id) ON DELETE SET NULL
) STRICT;

CREATE TABLE worksheets (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  student_model_version_id TEXT NOT NULL,
  assignment_id TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  status TEXT NOT NULL CHECK (status IN ('GENERATING', 'READY', 'FAILED')),
  supersedes_worksheet_id TEXT,
  ai_run_id TEXT,
  model_name TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, class_id),
  FOREIGN KEY (membership_id, class_id)
    REFERENCES class_memberships(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (student_model_version_id) REFERENCES student_model_versions(id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, class_id) REFERENCES assignments(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes_worksheet_id) REFERENCES worksheets(id) ON DELETE SET NULL,
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL
) STRICT;

CREATE TABLE worksheet_items (
  id TEXT PRIMARY KEY NOT NULL,
  worksheet_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  taxonomy_version TEXT NOT NULL,
  misconception_id TEXT NOT NULL,
  misconception_predicted_answer TEXT NOT NULL,
  hint TEXT NOT NULL,
  explanation TEXT NOT NULL,
  discrepant_event_rationale TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (worksheet_id, position),
  UNIQUE (worksheet_id, problem_id),
  FOREIGN KEY (worksheet_id, class_id) REFERENCES worksheets(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (problem_id, class_id) REFERENCES problems(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (taxonomy_version, misconception_id)
    REFERENCES taxonomy_terms(taxonomy_version, misconception_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE teaching_briefs (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  misconception_id TEXT NOT NULL,
  paragraph TEXT NOT NULL CHECK (length(trim(paragraph)) > 0),
  cluster_student_count INTEGER NOT NULL CHECK (cluster_student_count > 0),
  diagnosed_student_count INTEGER NOT NULL CHECK (diagnosed_student_count > 0),
  evidence_cutoff_at TEXT NOT NULL,
  worked_example_problem_id TEXT,
  supersedes_brief_id TEXT,
  ai_run_id TEXT,
  model_name TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (cluster_student_count <= diagnosed_student_count),
  FOREIGN KEY (assignment_id, class_id)
    REFERENCES assignments(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (taxonomy_version, misconception_id)
    REFERENCES taxonomy_terms(taxonomy_version, misconception_id) ON DELETE RESTRICT,
  FOREIGN KEY (worked_example_problem_id, class_id)
    REFERENCES problems(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes_brief_id) REFERENCES teaching_briefs(id) ON DELETE SET NULL,
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL
) STRICT;

CREATE TABLE teaching_brief_evidence (
  teaching_brief_id TEXT NOT NULL,
  diagnosis_id TEXT NOT NULL,
  PRIMARY KEY (teaching_brief_id, diagnosis_id),
  FOREIGN KEY (teaching_brief_id) REFERENCES teaching_briefs(id) ON DELETE CASCADE,
  FOREIGN KEY (diagnosis_id) REFERENCES diagnoses(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('TEACHER', 'SYSTEM', 'AI')),
  action TEXT NOT NULL CHECK (length(trim(action)) > 0),
  entity_type TEXT NOT NULL CHECK (length(trim(entity_type)) > 0),
  entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) > 0),
  correlation_id TEXT,
  redacted_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(redacted_metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX one_current_student_model_version
  ON student_model_versions(hypothesis_id)
  WHERE superseded_at IS NULL;

CREATE INDEX class_memberships_roster
  ON class_memberships(class_id, archived_at, sort_order);
CREATE INDEX class_memberships_student ON class_memberships(student_id);
CREATE INDEX problems_class_domain ON problems(class_id, domain);
CREATE INDEX assignments_class_status_created
  ON assignments(class_id, status, created_at DESC);
CREATE INDEX submissions_assignment_status_created
  ON submissions(assignment_id, status, created_at DESC);
CREATE INDEX submissions_membership_created
  ON submissions(membership_id, created_at DESC);
CREATE INDEX submission_answers_assignment_item ON submission_answers(assignment_item_id);
CREATE INDEX answer_versions_latest
  ON answer_versions(submission_answer_id, version DESC);
CREATE INDEX diagnoses_latest ON diagnoses(answer_version_id, version DESC);
CREATE INDEX diagnoses_cluster
  ON diagnoses(taxonomy_version, misconception_id, outcome, severity);
CREATE INDEX diagnosis_steps_ordered ON diagnosis_steps(diagnosis_id, position);
CREATE INDEX diagnosis_candidates_term
  ON diagnosis_candidates(taxonomy_version, misconception_id);
CREATE INDEX student_model_versions_latest
  ON student_model_versions(hypothesis_id, version DESC);
CREATE INDEX student_model_evidence_diagnosis ON student_model_evidence(diagnosis_id);
CREATE INDEX predictions_model_locked
  ON predictions(student_model_version_id, locked_at DESC);
CREATE INDEX predictions_membership_locked
  ON predictions(membership_id, locked_at DESC);
CREATE INDEX predictions_problem ON predictions(problem_id);
CREATE INDEX prediction_outcomes_latest
  ON prediction_outcome_versions(prediction_id, version DESC);
CREATE INDEX worksheets_membership_created
  ON worksheets(membership_id, created_at DESC);
CREATE INDEX teaching_briefs_assignment_created
  ON teaching_briefs(assignment_id, created_at DESC);
CREATE INDEX ai_runs_class_purpose_created
  ON ai_runs(class_id, purpose, created_at DESC);
CREATE INDEX audit_events_class_created ON audit_events(class_id, created_at DESC);
CREATE INDEX audit_events_entity ON audit_events(entity_type, entity_id);

CREATE TRIGGER answer_versions_are_immutable
BEFORE UPDATE ON answer_versions
BEGIN
  SELECT RAISE(ABORT, 'answer versions are immutable; insert a new version');
END;

CREATE TRIGGER diagnoses_are_immutable
BEFORE UPDATE ON diagnoses
BEGIN
  SELECT RAISE(ABORT, 'diagnoses are immutable; insert a new version or review');
END;

CREATE TRIGGER diagnosis_reviews_are_immutable
BEFORE UPDATE ON diagnosis_reviews
BEGIN
  SELECT RAISE(ABORT, 'diagnosis reviews are append-only');
END;

CREATE TRIGGER student_model_evidence_matches_student
BEFORE INSERT ON student_model_evidence
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM student_model_versions model_version
    JOIN student_model_hypotheses hypothesis
      ON hypothesis.id = model_version.hypothesis_id
    JOIN diagnoses diagnosis
      ON diagnosis.id = NEW.diagnosis_id
    JOIN answer_versions answer_version
      ON answer_version.id = diagnosis.answer_version_id
    JOIN submission_answers answer
      ON answer.id = answer_version.submission_answer_id
    JOIN submissions submission
      ON submission.id = answer.submission_id
    WHERE model_version.id = NEW.student_model_version_id
      AND hypothesis.membership_id = submission.membership_id
      AND diagnosis.created_at <= model_version.created_at
  ) THEN RAISE(ABORT, 'model evidence must belong to the same student and predate the model version') END;
END;

CREATE TRIGGER predictions_match_model_student
BEFORE INSERT ON predictions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM student_model_versions model_version
    JOIN student_model_hypotheses hypothesis
      ON hypothesis.id = model_version.hypothesis_id
    WHERE model_version.id = NEW.student_model_version_id
      AND hypothesis.membership_id = NEW.membership_id
      AND hypothesis.class_id = NEW.class_id
  ) THEN RAISE(ABORT, 'prediction must use a model version for the same student') END;
END;

CREATE TRIGGER predictions_are_immutable
BEFORE UPDATE ON predictions
BEGIN
  SELECT RAISE(ABORT, 'predictions are immutable after lock');
END;

CREATE TRIGGER prediction_outcomes_match_locked_prediction
BEFORE INSERT ON prediction_outcome_versions
WHEN NEW.answer_version_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM predictions prediction
    JOIN answer_versions answer_version
      ON answer_version.id = NEW.answer_version_id
    JOIN submission_answers answer
      ON answer.id = answer_version.submission_answer_id
    JOIN submissions submission
      ON submission.id = answer.submission_id
    JOIN assignment_items assignment_item
      ON assignment_item.id = answer.assignment_item_id
    WHERE prediction.id = NEW.prediction_id
      AND prediction.membership_id = submission.membership_id
      AND prediction.problem_id = assignment_item.problem_id
      AND answer_version.created_at >= prediction.locked_at
  ) THEN RAISE(ABORT, 'outcome answer must be later work from the same student on the predicted problem') END;
END;

CREATE TRIGGER prediction_outcomes_are_immutable
BEFORE UPDATE ON prediction_outcome_versions
BEGIN
  SELECT RAISE(ABORT, 'prediction outcomes are immutable; insert a new version');
END;

CREATE VIEW current_student_model_versions AS
SELECT
  hypothesis.class_id,
  hypothesis.membership_id,
  hypothesis.domain,
  hypothesis.scope_key,
  hypothesis.taxonomy_version,
  hypothesis.misconception_id,
  model_version.*
FROM student_model_versions AS model_version
JOIN student_model_hypotheses AS hypothesis
  ON hypothesis.id = model_version.hypothesis_id
WHERE model_version.superseded_at IS NULL
  AND model_version.status <> 'RETIRED';

CREATE VIEW student_prediction_metrics AS
WITH latest_outcomes AS (
  SELECT outcome.*
  FROM prediction_outcome_versions AS outcome
  WHERE outcome.version = (
    SELECT max(candidate.version)
    FROM prediction_outcome_versions AS candidate
    WHERE candidate.prediction_id = outcome.prediction_id
  )
)
SELECT
  prediction.membership_id,
  count(*) AS total_predictions,
  sum(prediction.rule_applied) AS attempted_predictions,
  sum(CASE WHEN outcome.id IS NOT NULL THEN 1 ELSE 0 END) AS observed_predictions,
  sum(CASE WHEN outcome.match_state IN ('MATCH', 'MISMATCH') THEN 1 ELSE 0 END) AS scorable_predictions,
  sum(CASE WHEN outcome.match_state = 'MATCH' THEN 1 ELSE 0 END) AS matched_predictions,
  CASE
    WHEN sum(CASE WHEN outcome.match_state IN ('MATCH', 'MISMATCH') THEN 1 ELSE 0 END) = 0
      THEN NULL
    ELSE 1.0 * sum(CASE WHEN outcome.match_state = 'MATCH' THEN 1 ELSE 0 END)
      / sum(CASE WHEN outcome.match_state IN ('MATCH', 'MISMATCH') THEN 1 ELSE 0 END)
  END AS prediction_accuracy
FROM predictions AS prediction
LEFT JOIN latest_outcomes AS outcome
  ON outcome.prediction_id = prediction.id
GROUP BY prediction.membership_id;
