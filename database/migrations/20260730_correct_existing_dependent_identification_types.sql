-- Os números cadastrados antes da introdução do tipo de identificação eram matrículas.
-- O corte temporal impede que uma repetição da migration altere CPFs cadastrados depois.
UPDATE employee_dependents
SET identification_type = 'matricula'
WHERE identification_number IS NOT NULL
  AND created_at < TIMESTAMP '2026-07-29 00:00:00'
  AND identification_type IS DISTINCT FROM 'matricula';
