CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS advance_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR NOT NULL DEFAULT 'open',
  opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
  opened_by UUID REFERENCES users(id),
  closed_at TIMESTAMP NULL,
  closed_by UUID REFERENCES users(id),
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT advance_cycles_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT advance_cycles_closed_fields_check CHECK (
    (status = 'open' AND closed_at IS NULL)
    OR
    (status = 'closed' AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_advance_cycles_single_open
  ON advance_cycles (status)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_advance_cycles_status ON advance_cycles(status);
CREATE INDEX IF NOT EXISTS idx_advance_cycles_opened_at ON advance_cycles(opened_at DESC);

CREATE TABLE IF NOT EXISTS advance_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES advance_cycles(id),
  list_date DATE NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT advance_lists_status_check CHECK (status IN ('draft', 'pending_approval', 'approved', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_advance_lists_cycle ON advance_lists(cycle_id);
CREATE INDEX IF NOT EXISTS idx_advance_lists_status ON advance_lists(status);
CREATE INDEX IF NOT EXISTS idx_advance_lists_date ON advance_lists(list_date DESC);

CREATE TABLE IF NOT EXISTS advance_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES advance_lists(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  amount NUMERIC(12,2) NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'active',
  confirmed BOOLEAN DEFAULT FALSE,
  threshold_warning_confirmed BOOLEAN DEFAULT FALSE,
  override_used BOOLEAN DEFAULT FALSE,
  override_by UUID REFERENCES users(id),
  salary_at_confirmation NUMERIC(12,2),
  accumulated_before NUMERIC(12,2),
  accumulated_after NUMERIC(12,2),
  warning_percentage NUMERIC(5,2),
  maximum_percentage NUMERIC(5,2),
  projected_percentage NUMERIC(7,2),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  removed_at TIMESTAMP NULL,
  removed_by UUID REFERENCES users(id),
  CONSTRAINT advance_list_items_amount_check CHECK (amount > 0),
  CONSTRAINT advance_list_items_status_check CHECK (status IN ('active', 'removed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_advance_items_unique_active_employee
  ON advance_list_items (list_id, employee_id)
  WHERE removed_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_advance_items_list ON advance_list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_advance_items_employee ON advance_list_items(employee_id);
CREATE INDEX IF NOT EXISTS idx_advance_items_active ON advance_list_items(employee_id, status) WHERE removed_at IS NULL;

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('advances.view', 'Ver vales', NULL, 'Vales'),
  ('advances.manage', 'Gerenciar vales', 'Compatibilidade com permissao antiga de vales.', 'Vales'),
  ('advances.create', 'Criar listas de vales', NULL, 'Vales'),
  ('advances.edit_own_list', 'Editar propria lista de vales', NULL, 'Vales'),
  ('advances.review', 'Revisar listas de vales', NULL, 'Vales'),
  ('advances.approve', 'Aprovar listas de vales', NULL, 'Vales'),
  ('advances.override_limits', 'Exceder limites de vales', NULL, 'Vales'),
  ('advances.cycles.view', 'Ver ciclos de vales', NULL, 'Vales'),
  ('advances.cycles.create', 'Iniciar ciclos de vales', NULL, 'Vales'),
  ('advances.cycles.close', 'Fechar ciclos de vales', NULL, 'Vales')
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
