CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR UNIQUE NOT NULL,
  name VARCHAR NOT NULL,
  description TEXT,
  group_name VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  username VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  role VARCHAR NOT NULL CHECK (role IN ('admin', 'manager', 'shipping', 'viewer')),
  role_id UUID REFERENCES roles(id),
  is_active BOOLEAN DEFAULT TRUE,
  approval_status VARCHAR DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  type VARCHAR NOT NULL CHECK (type IN ('manufactured', 'resale', 'material_prima')),
  sector_id UUID REFERENCES sectors(id),
  default_volume_quantity INTEGER NOT NULL CHECK (default_volume_quantity > 0),
  default_total_weight_kg NUMERIC(10,2) NOT NULL CHECK (default_total_weight_kg > 0),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  normalized_name VARCHAR NOT NULL UNIQUE,
  phone VARCHAR,
  location VARCHAR,
  carrier_name VARCHAR,
  destination_uf VARCHAR(2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  material_product_id UUID REFERENCES products(id),
  component_name VARCHAR NOT NULL,
  sector_id UUID REFERENCES sectors(id),
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
  is_required BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS internal_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number VARCHAR UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id),
  customer_name VARCHAR NOT NULL,
  customer_phone VARCHAR,
  promised_date DATE NOT NULL,
  delivery_type VARCHAR NOT NULL DEFAULT 'transportadora' CHECK (delivery_type IN ('transportadora', 'retirada', 'frota_propria')),
  carrier_name VARCHAR,
  destination_city VARCHAR,
  destination_uf VARCHAR(2),
  invoice_number VARCHAR,
  status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'ready_for_label', 'partially_shipped', 'shipped', 'deleted')),
  created_by UUID REFERENCES users(id),
  deleted_by UUID REFERENCES users(id),
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sold_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_order_id UUID REFERENCES internal_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name_snapshot VARCHAR NOT NULL,
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
  status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'ready_for_label', 'shipped')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS internal_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sold_item_id UUID REFERENCES sold_items(id) ON DELETE CASCADE,
  sector_id UUID REFERENCES sectors(id),
  task_name VARCHAR NOT NULL,
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
  status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  is_pinned BOOLEAN DEFAULT FALSE,
  pinned_at TIMESTAMP,
  completed_by UUID REFERENCES users(id),
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipment_volumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sold_item_id UUID REFERENCES sold_items(id) ON DELETE CASCADE,
  volume_number INTEGER NOT NULL CHECK (volume_number > 0),
  total_volumes INTEGER NOT NULL CHECK (total_volumes > 0),
  weight_kg NUMERIC(10,2) NOT NULL CHECK (weight_kg > 0),
  description VARCHAR,
  label_status VARCHAR DEFAULT 'waiting_tasks' CHECK (label_status IN ('waiting_tasks', 'released_for_label', 'label_generated', 'ready_without_label', 'shipped')),
  shipment_code VARCHAR(6) UNIQUE CHECK (shipment_code IS NULL OR shipment_code ~ '^[0-9]{6}$'),
  shipped_by UUID REFERENCES users(id),
  shipped_at TIMESTAMP,
  forced_shipping BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_orders_sale_number ON internal_orders(sale_number);
CREATE INDEX IF NOT EXISTS idx_internal_orders_promised_date ON internal_orders(promised_date);
CREATE INDEX IF NOT EXISTS idx_sold_items_internal_order_id ON sold_items(internal_order_id);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_sold_item_id ON internal_tasks(sold_item_id);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_sector_id ON internal_tasks(sector_id);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_status ON internal_tasks(status);
CREATE INDEX IF NOT EXISTS idx_shipment_volumes_sold_item_id ON shipment_volumes(sold_item_id);
CREATE INDEX IF NOT EXISTS idx_shipment_volumes_shipment_code ON shipment_volumes(shipment_code);
CREATE INDEX IF NOT EXISTS idx_shipment_volumes_label_status ON shipment_volumes(label_status);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
CREATE INDEX IF NOT EXISTS idx_sectors_slug ON sectors(slug);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs(entity_id);

CREATE TABLE IF NOT EXISTS product_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR UNIQUE NOT NULL,
  name VARCHAR NOT NULL,
  is_system BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_manufacturing_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  sector_id UUID NOT NULL REFERENCES sectors(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_step_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id UUID NOT NULL REFERENCES product_manufacturing_steps(id) ON DELETE CASCADE,
  depends_on_step_id UUID NOT NULL REFERENCES product_manufacturing_steps(id) ON DELETE RESTRICT,
  CONSTRAINT product_step_dependencies_no_self CHECK (step_id <> depends_on_step_id),
  CONSTRAINT product_step_dependencies_unique UNIQUE (step_id, depends_on_step_id)
);

CREATE TABLE IF NOT EXISTS internal_task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES internal_tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID NOT NULL REFERENCES internal_tasks(id) ON DELETE RESTRICT,
  CONSTRAINT internal_task_dependencies_no_self CHECK (task_id <> depends_on_task_id),
  CONSTRAINT internal_task_dependencies_unique UNIQUE (task_id, depends_on_task_id)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS normalized_name VARCHAR,
  ADD COLUMN IF NOT EXISTS phone VARCHAR,
  ADD COLUMN IF NOT EXISTS location VARCHAR,
  ADD COLUMN IF NOT EXISTS carrier_name VARCHAR,
  ADD COLUMN IF NOT EXISTS destination_uf VARCHAR(2),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

ALTER TABLE internal_orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS delivery_type VARCHAR NOT NULL DEFAULT 'transportadora',
  ADD COLUMN IF NOT EXISTS carrier_name VARCHAR,
  ADD COLUMN IF NOT EXISTS destination_city VARCHAR,
  ADD COLUMN IF NOT EXISTS destination_uf VARCHAR(2),
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR;

ALTER TABLE internal_tasks
  ADD COLUMN IF NOT EXISTS product_manufacturing_step_id UUID REFERENCES product_manufacturing_steps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_released BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE sold_items
  ADD COLUMN IF NOT EXISTS is_spare_part BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_roles_slug ON roles(slug);
CREATE INDEX IF NOT EXISTS idx_permissions_code ON permissions(code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_slug_unique ON roles(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_code_unique ON permissions(code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_normalized_name_unique ON customers(normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_types_code_unique ON product_types(code);
CREATE INDEX IF NOT EXISTS idx_internal_orders_customer_id ON internal_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_normalized_name ON customers(normalized_name);
CREATE INDEX IF NOT EXISTS idx_product_types_code ON product_types(code);
CREATE INDEX IF NOT EXISTS idx_product_types_active ON product_types(is_active);
CREATE INDEX IF NOT EXISTS idx_product_manufacturing_steps_product_id ON product_manufacturing_steps(product_id);
CREATE INDEX IF NOT EXISTS idx_product_manufacturing_steps_sector_id ON product_manufacturing_steps(sector_id);
CREATE INDEX IF NOT EXISTS idx_product_step_dependencies_step_id ON product_step_dependencies(step_id);
CREATE INDEX IF NOT EXISTS idx_product_step_dependencies_depends_on ON product_step_dependencies(depends_on_step_id);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_manufacturing_step_id ON internal_tasks(product_manufacturing_step_id);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_is_released ON internal_tasks(is_released);
CREATE INDEX IF NOT EXISTS idx_internal_task_dependencies_task_id ON internal_task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_internal_task_dependencies_depends_on ON internal_task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_sold_items_is_spare_part ON sold_items(is_spare_part);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'internal_orders_delivery_type_check'
      AND conrelid = 'internal_orders'::regclass
  ) THEN
    ALTER TABLE internal_orders
      ADD CONSTRAINT internal_orders_delivery_type_check
      CHECK (delivery_type IN ('transportadora', 'retirada', 'frota_propria'));
  END IF;
END $$;

ALTER TABLE customers
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customers WHERE name IS NULL) THEN
    ALTER TABLE customers ALTER COLUMN name SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customers WHERE normalized_name IS NULL) THEN
    ALTER TABLE customers ALTER COLUMN normalized_name SET NOT NULL;
  END IF;
END $$;

UPDATE internal_orders
SET delivery_type = 'transportadora'
WHERE delivery_type IS NULL;

UPDATE internal_tasks SET is_released = TRUE WHERE is_released IS NULL;
UPDATE sold_items SET is_spare_part = FALSE WHERE is_spare_part IS NULL;

INSERT INTO users (name, username, password_hash, role, is_active, approval_status)
VALUES ('Administrador', 'admin', crypt('admin123', gen_salt('bf')), 'admin', TRUE, 'approved')
ON CONFLICT (username) DO NOTHING;

INSERT INTO roles (name, slug, description, is_system, is_active)
VALUES
  ('Administrador', 'admin', 'Perfil administrativo legado do sistema.', TRUE, TRUE),
  ('Gerente', 'manager', 'Perfil gerencial legado do sistema.', TRUE, TRUE),
  ('Expedição', 'shipping', 'Perfil legado de expedição.', TRUE, TRUE),
  ('Visualização', 'viewer', 'Perfil legado de visualização.', TRUE, TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = COALESCE(roles.description, EXCLUDED.description),
  is_system = TRUE,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO product_types (code, name, is_system, is_active)
VALUES
  ('manufactured', 'Fabricado', TRUE, TRUE),
  ('resale', 'Revenda', TRUE, TRUE),
  ('material_prima', 'Matéria-prima', TRUE, TRUE)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    is_system = TRUE,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('dashboard.view', 'Ver dashboard', NULL, 'Dashboard'),
  ('orders.view', 'Ver OS', NULL, 'Ordens de Serviço'),
  ('orders.create', 'Criar OS', NULL, 'Ordens de Serviço'),
  ('orders.edit', 'Editar OS', NULL, 'Ordens de Serviço'),
  ('orders.delete', 'Excluir OS', NULL, 'Ordens de Serviço'),
  ('orders.history.view', 'Ver histórico de OS', NULL, 'Ordens de Serviço'),
  ('products.view', 'Ver produtos', NULL, 'Produtos'),
  ('products.create', 'Criar produtos', NULL, 'Produtos'),
  ('products.edit', 'Editar produtos', NULL, 'Produtos'),
  ('products.delete', 'Excluir produtos', NULL, 'Produtos'),
  ('products.types.manage', 'Gerenciar tipos de produto', NULL, 'Produtos'),
  ('sectors.view', 'Ver setores', NULL, 'Setores'),
  ('sectors.manage', 'Gerenciar setores', NULL, 'Setores'),
  ('services.view', 'Ver serviços', NULL, 'Serviços'),
  ('services.complete', 'Concluir serviços', NULL, 'Serviços'),
  ('labels.view', 'Ver fila de etiquetas', NULL, 'Fila de Etiquetas'),
  ('labels.print', 'Imprimir etiquetas', NULL, 'Fila de Etiquetas'),
  ('labels.reprint', 'Reimprimir etiquetas', NULL, 'Fila de Etiquetas'),
  ('labels.mark_without_label', 'Marcar sem etiqueta', NULL, 'Fila de Etiquetas'),
  ('shipping.view', 'Ver expedição', NULL, 'Expedição'),
  ('shipping.confirm', 'Confirmar expedição', NULL, 'Expedição'),
  ('shipping.ready_admin.view', 'Ver vendas prontas', NULL, 'Expedição'),
  ('shipping.audit.view', 'Ver auditoria de expedições', NULL, 'Expedição'),
  ('tv.view', 'Ver painel TV', NULL, 'Painel TV'),
  ('users.view', 'Ver usuários', NULL, 'Usuários e permissões'),
  ('users.approve', 'Aprovar usuários', NULL, 'Usuários e permissões'),
  ('users.manage', 'Gerenciar usuários', NULL, 'Usuários e permissões'),
  ('users.change_password', 'Alterar senhas', NULL, 'Usuários e permissões'),
  ('roles.view', 'Ver roles', NULL, 'Usuários e permissões'),
  ('roles.manage', 'Gerenciar roles', NULL, 'Usuários e permissões'),
  ('suppliers.view', 'Ver fornecedores', NULL, 'Fornecedores'),
  ('suppliers.manage', 'Gerenciar fornecedores', NULL, 'Fornecedores'),
  ('purchase_quotes.view', 'Ver cotações', NULL, 'Compras'),
  ('purchase_quotes.manage', 'Gerenciar cotações', NULL, 'Compras')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

INSERT INTO sectors (name, slug) VALUES
  ('Torno', 'torno'),
  ('Solda', 'solda'),
  ('Montagem', 'montagem'),
  ('Pintura', 'pintura'),
  ('Plasma', 'plasma'),
  ('Expedição', 'expedicao'),
  ('Compras', 'compras')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO products (name, type, default_volume_quantity, default_total_weight_kg) VALUES
  ('Moinho H10 Completo', 'manufactured', 1, 950),
  ('Motor', 'material_prima', 1, 80),
  ('Caixa do Moinho', 'material_prima', 1, 300),
  ('Base', 'material_prima', 1, 200),
  ('Baterias/Martelos', 'material_prima', 1, 80),
  ('Jogo de Martelos H10', 'manufactured', 4, 80),
  ('Par de Martelos H2', 'manufactured', 1, 16),
  ('Rolamento', 'resale', 1, 5)
ON CONFLICT DO NOTHING;

UPDATE products SET sector_id = sectors.id
FROM sectors
WHERE products.sector_id IS NULL
  AND sectors.slug = CASE
    WHEN products.name IN ('Baterias/Martelos', 'Jogo de Martelos H10', 'Par de Martelos H2') THEN 'torno'
    WHEN products.name IN ('Caixa do Moinho', 'Base') THEN 'solda'
    WHEN products.name = 'Motor' THEN 'montagem'
    WHEN products.type = 'resale' THEN 'expedicao'
    ELSE 'montagem'
  END;

INSERT INTO product_components (product_id, component_name, sector_id, quantity, is_required)
SELECT p.id, c.component_name, s.id, 1, TRUE
FROM products p
JOIN (
  VALUES
    ('Motor', 'montagem'),
    ('Caixa do Moinho', 'solda'),
    ('Base', 'solda'),
    ('Baterias/Martelos', 'torno'),
    ('Pintura Final', 'pintura')
) AS c(component_name, sector_slug) ON TRUE
JOIN sectors s ON s.slug = c.sector_slug
WHERE p.name = 'Moinho H10 Completo'
  AND NOT EXISTS (
    SELECT 1 FROM product_components pc
    WHERE pc.product_id = p.id AND pc.component_name = c.component_name
  );

INSERT INTO customers (name, normalized_name, phone, location, created_at, updated_at)
SELECT DISTINCT ON (normalized_name)
  customer_name,
  normalized_name,
  customer_phone,
  destination_city,
  COALESCE(created_at, NOW()),
  COALESCE(updated_at, created_at, NOW())
FROM (
  SELECT
    customer_name,
    LOWER(REGEXP_REPLACE(BTRIM(customer_name), '[[:space:]]+', ' ', 'g')) AS normalized_name,
    customer_phone,
    destination_city,
    created_at,
    updated_at
  FROM internal_orders
  WHERE customer_name IS NOT NULL
    AND BTRIM(customer_name) <> ''
) historical_orders
ORDER BY normalized_name, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
ON CONFLICT (normalized_name) DO UPDATE
  SET phone = COALESCE(NULLIF(EXCLUDED.phone, ''), customers.phone),
    location = COALESCE(NULLIF(EXCLUDED.location, ''), customers.location),
    updated_at = NOW();

UPDATE internal_orders io
SET customer_id = c.id
FROM customers c
WHERE io.customer_id IS NULL
  AND io.customer_name IS NOT NULL
  AND LOWER(REGEXP_REPLACE(BTRIM(io.customer_name), '[[:space:]]+', ' ', 'g')) = c.normalized_name;

UPDATE customers c
SET carrier_name = COALESCE(NULLIF(c.carrier_name, ''), latest_order.carrier_name),
  destination_uf = COALESCE(NULLIF(c.destination_uf, ''), latest_order.destination_uf),
  updated_at = NOW()
FROM (
  SELECT DISTINCT ON (customer_id)
    customer_id,
    NULLIF(carrier_name, '') AS carrier_name,
    NULLIF(destination_uf, '') AS destination_uf
  FROM internal_orders
  WHERE customer_id IS NOT NULL
    AND (NULLIF(carrier_name, '') IS NOT NULL OR NULLIF(destination_uf, '') IS NOT NULL)
  ORDER BY customer_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
) latest_order
WHERE c.id = latest_order.customer_id
  AND (
    (NULLIF(c.carrier_name, '') IS NULL AND latest_order.carrier_name IS NOT NULL)
    OR (NULLIF(c.destination_uf, '') IS NULL AND latest_order.destination_uf IS NOT NULL)
  );

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
  pix_key VARCHAR,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_cpf_active ON employees(cpf) WHERE cpf IS NOT NULL AND deleted_at IS NULL;
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

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pix_key VARCHAR;

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
  receipt_at TIMESTAMP NULL,
  source_bank VARCHAR NULL,
  entry_type VARCHAR NOT NULL DEFAULT 'list',
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

ALTER TABLE advance_list_items
  ADD COLUMN IF NOT EXISTS receipt_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS source_bank VARCHAR NULL,
  ADD COLUMN IF NOT EXISTS entry_type VARCHAR NOT NULL DEFAULT 'list';

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

ALTER TABLE advance_installment_plans
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS original_individual_advance_id UUID NULL REFERENCES advance_list_items(id),
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS installments_count INTEGER,
  ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL;

ALTER TABLE advance_installments
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES advance_installment_plans(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS installment_number INTEGER,
  ADD COLUMN IF NOT EXISTS installment_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS cycle_id UUID NULL REFERENCES advance_cycles(id),
  ADD COLUMN IF NOT EXISTS posted_advance_item_id UUID NULL REFERENCES advance_list_items(id),
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS posted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employees_registration_type_check'
      AND conrelid = 'employees'::regclass
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_registration_type_check
      CHECK (registration_type IN ('quick', 'complete'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employees_employment_status_check'
      AND conrelid = 'employees'::regclass
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_employment_status_check
      CHECK (employment_status IN ('ativo', 'afastado', 'desligado'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_cycles_status_check'
      AND conrelid = 'advance_cycles'::regclass
  ) THEN
    ALTER TABLE advance_cycles
      ADD CONSTRAINT advance_cycles_status_check
      CHECK (status IN ('open', 'closed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_cycles_closed_fields_check'
      AND conrelid = 'advance_cycles'::regclass
  ) THEN
    ALTER TABLE advance_cycles
      ADD CONSTRAINT advance_cycles_closed_fields_check
      CHECK (
        (status = 'open' AND closed_at IS NULL)
        OR
        (status = 'closed' AND closed_at IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_lists_status_check'
      AND conrelid = 'advance_lists'::regclass
  ) THEN
    ALTER TABLE advance_lists
      ADD CONSTRAINT advance_lists_status_check
      CHECK (status IN ('draft', 'pending_approval', 'approved', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_list_items_amount_check'
      AND conrelid = 'advance_list_items'::regclass
  ) THEN
    ALTER TABLE advance_list_items
      ADD CONSTRAINT advance_list_items_amount_check
      CHECK (amount > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_list_items_status_check'
      AND conrelid = 'advance_list_items'::regclass
  ) THEN
    ALTER TABLE advance_list_items
      ADD CONSTRAINT advance_list_items_status_check
      CHECK (status IN ('active', 'removed', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_installment_plans_status_check'
      AND conrelid = 'advance_installment_plans'::regclass
  ) THEN
    ALTER TABLE advance_installment_plans
      ADD CONSTRAINT advance_installment_plans_status_check
      CHECK (status IN ('active', 'completed', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_installment_plans_original_amount_check'
      AND conrelid = 'advance_installment_plans'::regclass
  ) THEN
    ALTER TABLE advance_installment_plans
      ADD CONSTRAINT advance_installment_plans_original_amount_check
      CHECK (original_amount > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_installment_plans_installments_count_check'
      AND conrelid = 'advance_installment_plans'::regclass
  ) THEN
    ALTER TABLE advance_installment_plans
      ADD CONSTRAINT advance_installment_plans_installments_count_check
      CHECK (installments_count BETWEEN 1 AND 10);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_installments_status_check'
      AND conrelid = 'advance_installments'::regclass
  ) THEN
    ALTER TABLE advance_installments
      ADD CONSTRAINT advance_installments_status_check
      CHECK (status IN ('pending', 'posted', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_installments_installment_number_check'
      AND conrelid = 'advance_installments'::regclass
  ) THEN
    ALTER TABLE advance_installments
      ADD CONSTRAINT advance_installments_installment_number_check
      CHECK (installment_number > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advance_installments_installment_amount_check'
      AND conrelid = 'advance_installments'::regclass
  ) THEN
    ALTER TABLE advance_installments
      ADD CONSTRAINT advance_installments_installment_amount_check
      CHECK (installment_amount > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_advance_installments_plan_number ON advance_installments(plan_id, installment_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_advance_installments_posted_item ON advance_installments(posted_advance_item_id) WHERE posted_advance_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_advance_installments_plan_cycle_posted ON advance_installments(plan_id, cycle_id) WHERE status = 'posted' AND cycle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_advance_installment_plans_employee ON advance_installment_plans(employee_id);
CREATE INDEX IF NOT EXISTS idx_advance_installment_plans_status ON advance_installment_plans(status);
CREATE INDEX IF NOT EXISTS idx_advance_installments_status ON advance_installments(status);
CREATE INDEX IF NOT EXISTS idx_advance_installments_cycle ON advance_installments(cycle_id);

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('advances.view', 'Ver vales', NULL, 'Vales'),
  ('advances.manage', 'Gerenciar vales', 'Compatibilidade com permissao antiga de vales.', 'Vales'),
  ('advances.create', 'Criar listas de vales', NULL, 'Vales'),
  ('advances.edit_own_list', 'Editar propria lista de vales', NULL, 'Vales'),
  ('advances.review', 'Revisar listas de vales', NULL, 'Vales'),
  ('advances.approve', 'Aprovar listas de vales', NULL, 'Vales'),
  ('advances.override_limits', 'Exceder limites de vales', NULL, 'Vales'),
  ('advances.limit_lookup', 'Consultar limite de vales', NULL, 'Vales'),
  ('advances.create_individual', 'Lançar vale individual', NULL, 'Vales'),
  ('advances.installments.create', 'Criar parcelamentos de vales', NULL, 'Vales'),
  ('advances.installments.convert', 'Parcelar vale existente', NULL, 'Vales'),
  ('advances.installments.view', 'Ver parcelamentos de vales', NULL, 'Vales'),
  ('advances.reports.view', 'Ver relatórios de vales', NULL, 'Vales'),
  ('advances.reports.general', 'Ver relatório geral de vales', NULL, 'Vales'),
  ('advances.reports.individual', 'Ver extrato individual de vales', NULL, 'Vales'),
  ('advances.reports.cycles', 'Ver ciclos anteriores de vales', NULL, 'Vales'),
  ('advances.audit.view', 'Ver auditoria de vales', NULL, 'Vales'),
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
  'dashboard.view',
  'orders.view',
  'orders.create',
  'orders.edit',
  'orders.delete',
  'orders.history.view',
  'products.view',
  'products.create',
  'products.edit',
  'products.delete',
  'products.types.manage',
  'sectors.view',
  'sectors.manage',
  'services.view',
  'services.complete',
  'labels.view',
  'labels.print',
  'labels.reprint',
  'labels.mark_without_label',
  'shipping.view',
  'shipping.confirm',
  'shipping.audit.view',
  'tv.view'
)
WHERE r.slug = 'manager'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'labels.view',
  'labels.print',
  'labels.reprint',
  'shipping.view',
  'shipping.confirm',
  'services.view'
)
WHERE r.slug = 'shipping'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('tv.view')
WHERE r.slug = 'viewer'
ON CONFLICT DO NOTHING;

UPDATE users u
SET role_id = r.id,
  updated_at = NOW()
FROM roles r
WHERE u.role_id IS NULL
  AND u.role = r.slug
  AND r.slug IN ('admin', 'manager', 'shipping', 'viewer');

UPDATE users
SET is_active = TRUE,
  approval_status = 'approved',
  updated_at = NOW()
WHERE username = 'admin';
