CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR UNIQUE NOT NULL,
  name VARCHAR NOT NULL,
  description TEXT,
  group_name VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE role_permissions (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
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

CREATE TABLE sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE products (
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

CREATE TABLE customers (
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

CREATE TABLE product_components (
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

CREATE TABLE internal_orders (
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

CREATE TABLE sold_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_order_id UUID REFERENCES internal_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name_snapshot VARCHAR NOT NULL,
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
  status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'ready_for_label', 'shipped')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE internal_tasks (
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

CREATE TABLE shipment_volumes (
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

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_internal_orders_sale_number ON internal_orders(sale_number);
CREATE INDEX idx_internal_orders_customer_id ON internal_orders(customer_id);
CREATE INDEX idx_internal_orders_promised_date ON internal_orders(promised_date);
CREATE INDEX idx_sold_items_internal_order_id ON sold_items(internal_order_id);
CREATE INDEX idx_internal_tasks_sold_item_id ON internal_tasks(sold_item_id);
CREATE INDEX idx_internal_tasks_sector_id ON internal_tasks(sector_id);
CREATE INDEX idx_internal_tasks_status ON internal_tasks(status);
CREATE INDEX idx_shipment_volumes_sold_item_id ON shipment_volumes(sold_item_id);
CREATE INDEX idx_shipment_volumes_shipment_code ON shipment_volumes(shipment_code);
CREATE INDEX idx_shipment_volumes_label_status ON shipment_volumes(label_status);
CREATE INDEX idx_products_type ON products(type);
CREATE INDEX idx_customers_normalized_name ON customers(normalized_name);
CREATE INDEX idx_sectors_slug ON sectors(slug);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);

INSERT INTO users (name, username, password_hash, role, is_active, approval_status)
VALUES ('Administrador', 'admin', crypt('admin123', gen_salt('bf')), 'admin', TRUE, 'approved')
ON CONFLICT (username) DO NOTHING;

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
