CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  username VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  role VARCHAR NOT NULL CHECK (role IN ('admin', 'manager', 'shipping', 'viewer')),
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
  default_volume_quantity INTEGER NOT NULL CHECK (default_volume_quantity > 0),
  default_total_weight_kg NUMERIC(10,2) NOT NULL CHECK (default_total_weight_kg > 0),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE product_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
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
  customer_name VARCHAR NOT NULL,
  customer_phone VARCHAR,
  promised_date DATE NOT NULL,
  status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'ready_for_label', 'partially_shipped', 'shipped')),
  created_by UUID REFERENCES users(id),
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
  status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
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
CREATE INDEX idx_internal_orders_promised_date ON internal_orders(promised_date);
CREATE INDEX idx_sold_items_internal_order_id ON sold_items(internal_order_id);
CREATE INDEX idx_internal_tasks_sold_item_id ON internal_tasks(sold_item_id);
CREATE INDEX idx_internal_tasks_sector_id ON internal_tasks(sector_id);
CREATE INDEX idx_internal_tasks_status ON internal_tasks(status);
CREATE INDEX idx_shipment_volumes_sold_item_id ON shipment_volumes(sold_item_id);
CREATE INDEX idx_shipment_volumes_shipment_code ON shipment_volumes(shipment_code);
CREATE INDEX idx_shipment_volumes_label_status ON shipment_volumes(label_status);
CREATE INDEX idx_products_type ON products(type);
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
