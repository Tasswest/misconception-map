-- AI grading is advisory. A proposal is stored separately from exam_grades;
-- only a teacher validation may copy its final total into the gradebook.
CREATE TABLE exam_grade_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('PROPOSED', 'VALIDATED')),
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  openai_response_id TEXT,
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  output_hash TEXT NOT NULL CHECK (length(output_hash) = 64),
  proposed_total REAL NOT NULL CHECK (proposed_total >= 0),
  max_score REAL NOT NULL CHECK (max_score > 0),
  incomplete INTEGER NOT NULL CHECK (incomplete IN (0, 1)),
  manual_item_count INTEGER NOT NULL CHECK (manual_item_count >= 0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  validated_at TEXT,
  UNIQUE (assignment_id, membership_id, version),
  FOREIGN KEY (assignment_id, class_id)
    REFERENCES assignments(id, class_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, class_id)
    REFERENCES class_memberships(id, class_id) ON DELETE CASCADE,
  CHECK (
    (status = 'PROPOSED' AND validated_at IS NULL)
    OR (status = 'VALIDATED' AND validated_at IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX one_open_grade_proposal_per_copy
ON exam_grade_proposals (assignment_id, membership_id)
WHERE status = 'PROPOSED';

CREATE INDEX grade_proposals_by_assignment
ON exam_grade_proposals (assignment_id, status, created_at);

CREATE TABLE exam_grade_proposal_items (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT NOT NULL,
  assignment_item_id TEXT NOT NULL,
  diagnosis_id TEXT,
  position INTEGER NOT NULL CHECK (position > 0),
  question_reference TEXT NOT NULL,
  max_points REAL NOT NULL CHECK (max_points > 0),
  proposed_score REAL CHECK (
    proposed_score IS NULL OR (proposed_score >= 0 AND proposed_score <= max_points)
  ),
  final_score REAL CHECK (
    final_score IS NULL OR (final_score >= 0 AND final_score <= max_points)
  ),
  credit_basis TEXT NOT NULL CHECK (
    credit_basis IN (
      'FULL_CORRECT_REASONING',
      'PARTIAL_CORRECT_PREFIX',
      'ZERO_NO_CREDITABLE_WORK',
      'MANUAL_REQUIRED'
    )
  ),
  evidence_quote TEXT,
  justification TEXT,
  manual_reason TEXT CHECK (
    manual_reason IS NULL OR manual_reason IN (
      'NEEDS_REVIEW',
      'ABSTAINED',
      'CANNOT_CORRECT'
    )
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  validated_at TEXT,
  UNIQUE (proposal_id, assignment_item_id),
  FOREIGN KEY (proposal_id) REFERENCES exam_grade_proposals(id) ON DELETE CASCADE,
  FOREIGN KEY (assignment_item_id) REFERENCES assignment_items(id) ON DELETE RESTRICT,
  -- Diagnosis history is normally retained, but privacy deletion may remove it
  -- before the assignment-owned proposal cascade runs.
  CHECK (
    (
      manual_reason IS NOT NULL
      AND proposed_score IS NULL
      AND credit_basis = 'MANUAL_REQUIRED'
      AND evidence_quote IS NULL
      AND justification IS NULL
    )
    OR (
      manual_reason IS NULL
      AND proposed_score IS NOT NULL
      AND credit_basis <> 'MANUAL_REQUIRED'
      AND evidence_quote IS NOT NULL
      AND justification IS NOT NULL
    )
  ),
  CHECK (
    (final_score IS NULL AND validated_at IS NULL)
    OR (final_score IS NOT NULL AND validated_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX grade_proposal_items_by_proposal
ON exam_grade_proposal_items (proposal_id, position);

CREATE TABLE exam_grade_validation_audit (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT NOT NULL,
  assignment_item_id TEXT NOT NULL,
  ai_proposed_score REAL,
  teacher_final_score REAL NOT NULL CHECK (teacher_final_score >= 0),
  max_points REAL NOT NULL CHECK (max_points > 0),
  validated_at TEXT NOT NULL,
  UNIQUE (proposal_id, assignment_item_id),
  FOREIGN KEY (proposal_id) REFERENCES exam_grade_proposals(id) ON DELETE CASCADE,
  FOREIGN KEY (assignment_item_id) REFERENCES assignment_items(id) ON DELETE RESTRICT,
  CHECK (ai_proposed_score IS NULL OR ai_proposed_score >= 0),
  CHECK (teacher_final_score <= max_points),
  CHECK (ai_proposed_score IS NULL OR ai_proposed_score <= max_points)
) STRICT;

CREATE INDEX grade_validation_audit_by_proposal
ON exam_grade_validation_audit (proposal_id, assignment_item_id);

ALTER TABLE exam_grades
ADD COLUMN validated_proposal_id TEXT REFERENCES exam_grade_proposals(id);

CREATE INDEX exam_grades_by_validated_proposal
ON exam_grades (validated_proposal_id);

CREATE TRIGGER grade_proposal_ai_fields_are_immutable
BEFORE UPDATE OF
  class_id, assignment_id, membership_id, version, model_name, prompt_version,
  schema_version, openai_response_id, input_hash, output_hash, proposed_total,
  max_score, incomplete, manual_item_count, input_tokens, output_tokens,
  latency_ms, created_at
ON exam_grade_proposals
BEGIN
  SELECT RAISE(ABORT, 'AI grade proposal provenance is immutable');
END;

CREATE TRIGGER grade_proposal_status_moves_forward_once
BEFORE UPDATE OF status ON exam_grade_proposals
WHEN OLD.status <> 'PROPOSED'
  OR NEW.status <> 'VALIDATED'
  OR NEW.validated_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'grade proposal must move from PROPOSED to VALIDATED');
END;

CREATE TRIGGER grade_proposal_validation_time_moves_with_status
BEFORE UPDATE OF validated_at ON exam_grade_proposals
WHEN OLD.status <> 'PROPOSED'
  OR NEW.status <> 'VALIDATED'
  OR NEW.validated_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'grade proposal validation time requires validation');
END;

CREATE TRIGGER grade_proposal_item_ai_fields_are_immutable
BEFORE UPDATE OF
  proposal_id, assignment_item_id, diagnosis_id, position, question_reference,
  max_points, proposed_score, credit_basis, evidence_quote, justification,
  manual_reason, created_at
ON exam_grade_proposal_items
BEGIN
  SELECT RAISE(ABORT, 'AI per-question proposal fields are immutable');
END;

CREATE TRIGGER grade_proposal_item_teacher_fields_validate_once
BEFORE UPDATE OF final_score, validated_at ON exam_grade_proposal_items
WHEN OLD.final_score IS NOT NULL
  OR OLD.validated_at IS NOT NULL
  OR NEW.final_score IS NULL
  OR NEW.validated_at IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM exam_grade_proposals
    WHERE id = OLD.proposal_id AND status = 'PROPOSED'
  )
BEGIN
  SELECT RAISE(ABORT, 'question scores may be validated exactly once');
END;

CREATE TRIGGER grade_validation_audit_cannot_be_updated
BEFORE UPDATE ON exam_grade_validation_audit
BEGIN
  SELECT RAISE(ABORT, 'grade validation audit is append-only');
END;

CREATE TRIGGER validated_grade_requires_matching_proposal_on_insert
BEFORE INSERT ON exam_grades
WHEN NEW.validated_proposal_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM exam_grade_proposals AS proposal
    WHERE proposal.id = NEW.validated_proposal_id
      AND proposal.status = 'VALIDATED'
      AND proposal.class_id = NEW.class_id
      AND proposal.assignment_id = NEW.assignment_id
      AND proposal.membership_id = NEW.membership_id
      AND NOT EXISTS (
        SELECT 1 FROM exam_grade_proposal_items AS item
        WHERE item.proposal_id = proposal.id AND item.final_score IS NULL
      )
      AND abs((
        SELECT sum(item.final_score) FROM exam_grade_proposal_items AS item
        WHERE item.proposal_id = proposal.id
      ) - NEW.score) < 0.000001
      AND abs((
        SELECT sum(item.max_points) FROM exam_grade_proposal_items AS item
        WHERE item.proposal_id = proposal.id
      ) - NEW.max_score) < 0.000001
  )
BEGIN
  SELECT RAISE(ABORT, 'grade requires a matching validated proposal');
END;

CREATE TRIGGER validated_grade_requires_matching_proposal_on_update
BEFORE UPDATE OF
  class_id, assignment_id, membership_id, score, max_score,
  validated_proposal_id
ON exam_grades
WHEN NEW.validated_proposal_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM exam_grade_proposals AS proposal
    WHERE proposal.id = NEW.validated_proposal_id
      AND proposal.status = 'VALIDATED'
      AND proposal.class_id = NEW.class_id
      AND proposal.assignment_id = NEW.assignment_id
      AND proposal.membership_id = NEW.membership_id
      AND NOT EXISTS (
        SELECT 1 FROM exam_grade_proposal_items AS item
        WHERE item.proposal_id = proposal.id AND item.final_score IS NULL
      )
      AND abs((
        SELECT sum(item.final_score) FROM exam_grade_proposal_items AS item
        WHERE item.proposal_id = proposal.id
      ) - NEW.score) < 0.000001
      AND abs((
        SELECT sum(item.max_points) FROM exam_grade_proposal_items AS item
        WHERE item.proposal_id = proposal.id
      ) - NEW.max_score) < 0.000001
  )
BEGIN
  SELECT RAISE(ABORT, 'grade requires a matching validated proposal');
END;
