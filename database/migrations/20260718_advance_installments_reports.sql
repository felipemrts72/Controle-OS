CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS advance_installment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  original_individual_advance_id UUID NULL REFERENCES advance_list_items(id),
  original_amount NUMERIC(12,2) NOT NULL CHECK (original_amount > 0),
  installments_count INTEGER NOT NULL CHECK (installments_count BETWEEN 1 AND 10),
  status VARCHAR NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  cancelled_by UUID REFERENCES users(id),
  cancelled_at TIMESTAMP NULL,
  CONSTRAINT advance_installment_plans_status_check CHECK (status IN ('active', 'completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS advance_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES advance_installment_plans(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL CHECK (installment_number > 0),
  installment_amount NUMERIC(12,2) NOT NULL CHECK (installment_amount > 0),
  status VARCHAR NOT NULL DEFAULT 'pending',
  cycle_id UUID NULL REFERENCES advance_cycles(id),
  posted_advance_item_id UUID NULL REFERENCES advance_list_items(id),
  posted_at TIMESTAMP NULL,
  posted_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  cancelled_at TIMESTAMP NULL,
  CONSTRAINT advance_installments_status_check CHECK (status IN ('pending', 'posted', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_advance_installments_plan_number
  ON advance_installments(plan_id, installment_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_advance_installments_posted_item
  ON advance_installments(posted_advance_item_id)
  WHERE posted_advance_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_advance_installments_plan_cycle_posted
  ON advance_installments(plan_id, cycle_id)
  WHERE status = 'posted' AND cycle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_advance_installment_plans_employee ON advance_installment_plans(employee_id);
CREATE INDEX IF NOT EXISTS idx_advance_installment_plans_status ON advance_installment_plans(status);
CREATE INDEX IF NOT EXISTS idx_advance_installments_status ON advance_installments(status);
CREATE INDEX IF NOT EXISTS idx_advance_installments_cycle ON advance_installments(cycle_id);

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('advances.installments.create', 'Criar parcelamentos de vales', NULL, 'Vales'),
  ('advances.installments.convert', 'Parcelar vale existente', NULL, 'Vales'),
  ('advances.installments.view', 'Ver parcelamentos de vales', NULL, 'Vales'),
  ('advances.reports.view', 'Ver relatórios de vales', NULL, 'Vales'),
  ('advances.reports.general', 'Ver relatório geral de vales', NULL, 'Vales'),
  ('advances.reports.individual', 'Ver extrato individual de vales', NULL, 'Vales'),
  ('advances.reports.cycles', 'Ver ciclos anteriores de vales', NULL, 'Vales'),
  ('advances.audit.view', 'Ver auditoria de vales', NULL, 'Vales')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'admin'
  AND p.code LIKE 'advances.%'
ON CONFLICT DO NOTHING;
