-- Correction covers the complete exam. The researched misconception taxonomy
-- remains an explicit, immutable property of each assignment item.
ALTER TABLE assignment_items
ADD COLUMN in_taxonomy_scope INTEGER NOT NULL DEFAULT 1
CHECK (in_taxonomy_scope IN (0, 1));

ALTER TABLE diagnoses
ADD COLUMN correction_verdict TEXT
CHECK (correction_verdict IS NULL OR correction_verdict IN ('CORRECT', 'INCORRECT', 'NEEDS_REVIEW'));

-- Earlier hierarchical confirmation preserved exercise shells but deliberately
-- omitted questions outside the algebra/fractions selection. Restore those
-- immutable printed questions from the checksummed extraction payload. New
-- positions are appended so already diagnosed item numbers never change.
INSERT INTO problems (
  id, class_id, domain, prompt, answer_format, correct_answer,
  canonical_correct_answer, origin, content_hash
)
SELECT
  'general-problem:' || source.id || ':' || exercise.key || ':' || question.key,
  assignment.class_id,
  CASE
    WHEN json_extract(question.value, '$.domain') IN ('ALGEBRA', 'FRACTIONS')
      THEN json_extract(question.value, '$.domain')
    WHEN assignment.domain = 'FRACTIONS' THEN 'FRACTIONS'
    ELSE 'ALGEBRA'
  END,
  json_extract(question.value, '$.problemStatement'),
  json_extract(question.value, '$.answerKind'),
  json_extract(question.value, '$.expectedAnswer'),
  trim(json_extract(question.value, '$.expectedAnswer')),
  'WORKSHEET',
  NULL
FROM assignment_sources AS source
JOIN assignments AS assignment ON assignment.id = source.assignment_id
JOIN assignment_source_extractions AS extraction ON extraction.source_id = source.id
JOIN json_each(extraction.exercises_json) AS exercise
JOIN json_each(json_extract(exercise.value, '$.questions')) AS question
JOIN exercises AS stored_exercise
  ON stored_exercise.assignment_id = assignment.id
 AND stored_exercise.position = CAST(exercise.key AS INTEGER) + 1
WHERE source.status = 'CONFIRMED'
  AND NOT EXISTS (
    SELECT 1 FROM assignment_items AS existing
    WHERE existing.exercise_id = stored_exercise.id
      AND existing.question_label = json_extract(question.value, '$.questionLabel')
  );

INSERT INTO assignment_items (
  id, class_id, assignment_id, problem_id, position, points, is_required,
  exercise_id, question_label, in_taxonomy_scope
)
SELECT
  'general-item:' || source.id || ':' || exercise.key || ':' || question.key,
  assignment.class_id,
  assignment.id,
  'general-problem:' || source.id || ':' || exercise.key || ':' || question.key,
  COALESCE((SELECT max(position) FROM assignment_items WHERE assignment_id = assignment.id), 0)
    + row_number() OVER (
        PARTITION BY assignment.id
        ORDER BY CAST(exercise.key AS INTEGER), CAST(question.key AS INTEGER)
      ),
  1,
  1,
  stored_exercise.id,
  json_extract(question.value, '$.questionLabel'),
  0
FROM assignment_sources AS source
JOIN assignments AS assignment ON assignment.id = source.assignment_id
JOIN assignment_source_extractions AS extraction ON extraction.source_id = source.id
JOIN json_each(extraction.exercises_json) AS exercise
JOIN json_each(json_extract(exercise.value, '$.questions')) AS question
JOIN exercises AS stored_exercise
  ON stored_exercise.assignment_id = assignment.id
 AND stored_exercise.position = CAST(exercise.key AS INTEGER) + 1
WHERE source.status = 'CONFIRMED'
  AND EXISTS (
    SELECT 1 FROM problems AS problem
    WHERE problem.id = 'general-problem:' || source.id || ':' || exercise.key || ':' || question.key
  );

CREATE TRIGGER assignment_item_taxonomy_scope_is_immutable
BEFORE UPDATE OF in_taxonomy_scope ON assignment_items
WHEN NEW.in_taxonomy_scope IS NOT OLD.in_taxonomy_scope
BEGIN
  SELECT RAISE(ABORT, 'assignment item taxonomy scope is immutable after confirmation');
END;

CREATE TRIGGER out_of_scope_diagnoses_cannot_claim_taxonomy
BEFORE INSERT ON diagnoses
WHEN NEW.outcome = 'MISCONCEPTION' OR NEW.taxonomy_version IS NOT NULL OR NEW.misconception_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM answer_versions AS answer_version
    JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id
    JOIN assignment_items AS item ON item.id = answer.assignment_item_id
    WHERE answer_version.id = NEW.answer_version_id
      AND item.in_taxonomy_scope = 0
  ) THEN RAISE(ABORT, 'correction-only items cannot claim a taxonomy misconception') END;
END;

CREATE TRIGGER out_of_scope_diagnoses_cannot_have_candidates
BEFORE INSERT ON diagnosis_candidates
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM diagnoses AS diagnosis
    JOIN answer_versions AS answer_version ON answer_version.id = diagnosis.answer_version_id
    JOIN submission_answers AS answer ON answer.id = answer_version.submission_answer_id
    JOIN assignment_items AS item ON item.id = answer.assignment_item_id
    WHERE diagnosis.id = NEW.diagnosis_id
      AND item.in_taxonomy_scope = 0
  ) THEN RAISE(ABORT, 'correction-only items cannot have taxonomy candidates') END;
END;

CREATE TRIGGER predictions_require_taxonomy_scope
BEFORE INSERT ON predictions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assignment_items AS item
    WHERE item.id = NEW.target_assignment_item_id
      AND item.in_taxonomy_scope = 1
  ) THEN RAISE(ABORT, 'Prediction Lab targets must remain inside taxonomy scope') END;
END;
