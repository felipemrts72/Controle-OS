CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS employee_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  amount NUMERIC(12,2) NOT NULL,
  award_date DATE NOT NULL,
  performance_description TEXT NOT NULL,
  employee_name_snapshot VARCHAR NOT NULL,
  employee_cpf_snapshot VARCHAR,
  job_title_snapshot VARCHAR,
  sector_name_snapshot VARCHAR,
  company_name_snapshot VARCHAR NOT NULL,
  company_cnpj_snapshot VARCHAR,
  company_city_snapshot VARCHAR,
  representative_name_snapshot VARCHAR NOT NULL,
  representative_job_title_snapshot VARCHAR NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  deleted_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP NULL,
  CONSTRAINT employee_awards_amount_positive CHECK (amount > 0),
  CONSTRAINT employee_awards_description_not_blank CHECK (length(btrim(performance_description)) >= 10)
);

CREATE INDEX IF NOT EXISTS idx_employee_awards_employee_date
  ON employee_awards(employee_id, award_date DESC);
CREATE INDEX IF NOT EXISTS idx_employee_awards_award_date
  ON employee_awards(award_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_awards_created_by
  ON employee_awards(created_by);
CREATE INDEX IF NOT EXISTS idx_employee_awards_active
  ON employee_awards(award_date DESC, created_at DESC)
  WHERE deleted_at IS NULL;

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('awards.view', 'Ver prêmios', NULL, 'Prêmios'),
  ('awards.create', 'Criar prêmios', NULL, 'Prêmios'),
  ('awards.edit', 'Editar prêmios', NULL, 'Prêmios'),
  ('awards.delete', 'Excluir prêmios', NULL, 'Prêmios'),
  ('awards.pdf', 'Baixar termos de prêmios', NULL, 'Prêmios')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('awards.view', 'awards.create', 'awards.edit', 'awards.delete', 'awards.pdf')
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;
