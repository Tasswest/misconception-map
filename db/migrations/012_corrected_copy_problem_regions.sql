-- Optional normalized regions link full-page diagnoses back to the student's
-- own page. Historical answers remain valid with all four columns NULL.
ALTER TABLE submission_answers ADD COLUMN region_x REAL
  CHECK (region_x IS NULL OR region_x BETWEEN 0 AND 1);
ALTER TABLE submission_answers ADD COLUMN region_y REAL
  CHECK (region_y IS NULL OR region_y BETWEEN 0 AND 1);
ALTER TABLE submission_answers ADD COLUMN region_width REAL
  CHECK (region_width IS NULL OR (region_width > 0 AND region_width <= 1));
ALTER TABLE submission_answers ADD COLUMN region_height REAL
  CHECK (region_height IS NULL OR (region_height > 0 AND region_height <= 1));

CREATE TRIGGER submission_answer_region_is_valid_on_insert
BEFORE INSERT ON submission_answers
WHEN NOT (
  (
    NEW.region_x IS NULL
    AND NEW.region_y IS NULL
    AND NEW.region_width IS NULL
    AND NEW.region_height IS NULL
  )
  OR
  (
    NEW.region_x IS NOT NULL
    AND NEW.region_y IS NOT NULL
    AND NEW.region_width IS NOT NULL
    AND NEW.region_height IS NOT NULL
    AND NEW.region_x + NEW.region_width <= 1
    AND NEW.region_y + NEW.region_height <= 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'submission answer region must be complete and within normalized page bounds');
END;

CREATE TRIGGER submission_answer_region_is_valid_on_update
BEFORE UPDATE OF region_x, region_y, region_width, region_height ON submission_answers
WHEN NOT (
  (
    NEW.region_x IS NULL
    AND NEW.region_y IS NULL
    AND NEW.region_width IS NULL
    AND NEW.region_height IS NULL
  )
  OR
  (
    NEW.region_x IS NOT NULL
    AND NEW.region_y IS NOT NULL
    AND NEW.region_width IS NOT NULL
    AND NEW.region_height IS NOT NULL
    AND NEW.region_x + NEW.region_width <= 1
    AND NEW.region_y + NEW.region_height <= 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'submission answer region must be complete and within normalized page bounds');
END;
