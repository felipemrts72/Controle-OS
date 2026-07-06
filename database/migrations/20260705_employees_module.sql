CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR NOT NULL,
  normalized_name VARCHAR,
  birth_date DATE,
  cpf VARCHAR,
  rg VARCHAR,
  rg_issuer VARCHAR,
  rg_state VARCHAR(2),
  rg_issue_date DATE,
  phone VARCHAR,
  alternate_phone VARCHAR,
  email VARCHAR,
  marital_status VARCHAR,
  spouse_name VARCHAR,
  zip_code VARCHAR,
  street VARCHAR,
  address_number VARCHAR,
  complement VARCHAR,
  neighborhood VARCHAR,
  city VARCHAR,
  state VARCHAR(2),
  admission_date DATE,
  job_title VARCHAR,
  current_salary NUMERIC(12,2),
  meal_allowance NUMERIC(12,2),
  employment_status VARCHAR DEFAULT 'ativo',
  notes TEXT,
  ctps_number VARCHAR,
  ctps_series VARCHAR,
  ctps_state VARCHAR(2),
  pis_pasep VARCHAR,
  voter_registration VARCHAR,
  voter_zone VARCHAR,
  voter_section VARCHAR,
  military_certificate VARCHAR,
  registration_type VARCHAR DEFAULT 'quick',
  profile_completed BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL,
  CONSTRAINT employees_registration_type_check CHECK (registration_type IN ('quick', 'complete')),
  CONSTRAINT employees_employment_status_check CHECK (employment_status IN ('ativo', 'afastado', 'desligado'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_cpf_active
  ON employees (cpf)
  WHERE cpf IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employees_normalized_name ON employees(normalized_name);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(employment_status);
CREATE INDEX IF NOT EXISTS idx_employees_job_title ON employees(job_title);

CREATE TABLE IF NOT EXISTS employee_salary_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  salary NUMERIC(12,2) NOT NULL,
  effective_from DATE NOT NULL,
  previous_salary NUMERIC(12,2),
  reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_salary_history_employee ON employee_salary_history(employee_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS employee_meal_allowance_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  previous_amount NUMERIC(12,2),
  new_amount NUMERIC(12,2) NOT NULL,
  effective_from DATE NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_meal_allowance_history_employee ON employee_meal_allowance_history(employee_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS employee_dependents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  full_name VARCHAR NOT NULL,
  birth_date DATE,
  cpf VARCHAR,
  relationship VARCHAR,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_dependents_employee ON employee_dependents(employee_id);

CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  dependent_id UUID REFERENCES employee_dependents(id),
  document_type VARCHAR NOT NULL,
  original_name VARCHAR NOT NULL,
  stored_name VARCHAR NOT NULL,
  file_path VARCHAR NOT NULL,
  mime_type VARCHAR NOT NULL,
  size_bytes BIGINT NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  deleted_at TIMESTAMP,
  deleted_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_dependent ON employee_documents(dependent_id);

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('employees.view', 'Ver funcionários', NULL, 'Funcionários'),
  ('employees.create', 'Criar funcionários', NULL, 'Funcionários'),
  ('employees.edit', 'Editar funcionários', NULL, 'Funcionários'),
  ('employees.deactivate', 'Desativar funcionários', NULL, 'Funcionários'),
  ('employees.salary.view', 'Ver salário de funcionários', NULL, 'Funcionários'),
  ('employees.salary.manage', 'Gerenciar salário de funcionários', NULL, 'Funcionários'),
  ('employees.meal_allowance.view', 'Ver vale alimentação', NULL, 'Funcionários'),
  ('employees.meal_allowance.manage', 'Gerenciar vale alimentação', NULL, 'Funcionários'),
  ('employees.documents.view', 'Ver documentos de funcionários', NULL, 'Funcionários'),
  ('employees.documents.manage', 'Gerenciar documentos de funcionários', NULL, 'Funcionários'),
  ('employees.dependents.view', 'Ver dependentes', NULL, 'Funcionários'),
  ('employees.dependents.manage', 'Gerenciar dependentes', NULL, 'Funcionários'),
  ('employees.profile.print', 'Imprimir ficha de funcionário', NULL, 'Funcionários')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'employees.view',
  'employees.create',
  'employees.edit',
  'employees.deactivate',
  'employees.salary.view',
  'employees.salary.manage',
  'employees.meal_allowance.view',
  'employees.meal_allowance.manage',
  'employees.documents.view',
  'employees.documents.manage',
  'employees.dependents.view',
  'employees.dependents.manage',
  'employees.profile.print'
)
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;
