CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key BOOLEAN NOT NULL DEFAULT TRUE UNIQUE,
  nome_fantasia VARCHAR,
  razao_social VARCHAR,
  cnpj VARCHAR,
  telefone VARCHAR,
  email VARCHAR,
  endereco VARCHAR,
  numero VARCHAR,
  complemento VARCHAR,
  bairro VARCHAR,
  cidade VARCHAR,
  estado VARCHAR(2),
  cep VARCHAR,
  nome_representante VARCHAR,
  cpf_representante VARCHAR,
  cargo_representante VARCHAR,
  logo_path VARCHAR,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT company_settings_singleton_check CHECK (singleton_key = TRUE)
);

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS sector_id UUID NULL REFERENCES sectors(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employees_sector_id_fkey'
      AND conrelid = 'employees'::regclass
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_sector_id_fkey
      FOREIGN KEY (sector_id) REFERENCES sectors(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employees_sector_id ON employees(sector_id);

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('company_settings.view', 'Ver configurações da empresa', NULL, 'Configurações'),
  ('company_settings.edit', 'Editar configurações da empresa', NULL, 'Configurações')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('company_settings.view', 'company_settings.edit')
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;
