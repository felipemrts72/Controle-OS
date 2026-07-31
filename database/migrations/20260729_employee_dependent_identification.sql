DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_dependents'
      AND column_name = 'cpf'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_dependents'
      AND column_name = 'identification_number'
  ) THEN
    ALTER TABLE employee_dependents RENAME COLUMN cpf TO identification_number;
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_dependents'
      AND column_name = 'cpf'
  ) THEN
    UPDATE employee_dependents
    SET identification_number = COALESCE(identification_number, cpf);

    ALTER TABLE employee_dependents DROP COLUMN cpf;
  END IF;
END $$;

ALTER TABLE employee_dependents
  ADD COLUMN IF NOT EXISTS identification_type VARCHAR(20);

UPDATE employee_dependents
SET identification_type = 'cpf'
WHERE identification_type IS NULL;

ALTER TABLE employee_dependents
  ALTER COLUMN identification_type SET DEFAULT 'cpf',
  ALTER COLUMN identification_type SET NOT NULL;

ALTER TABLE employee_dependents
  DROP CONSTRAINT IF EXISTS employee_dependents_identification_type_check;

ALTER TABLE employee_dependents
  ADD CONSTRAINT employee_dependents_identification_type_check
  CHECK (identification_type IN ('cpf', 'matricula'));
