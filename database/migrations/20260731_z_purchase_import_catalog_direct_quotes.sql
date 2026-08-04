ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS purchase_response_email VARCHAR(180),
  ADD COLUMN IF NOT EXISTS purchase_response_whatsapp VARCHAR(20),
  ADD COLUMN IF NOT EXISTS purchase_responsible_name VARCHAR(160);

ALTER TABLE products ADD COLUMN IF NOT EXISTS internal_code VARCHAR(80);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_internal_code_unique
  ON products (lower(internal_code)) WHERE internal_code IS NOT NULL;

ALTER TABLE purchase_quote_requests
  ALTER COLUMN purchase_request_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS quote_type VARCHAR(20) NOT NULL DEFAULT 'request',
  ADD COLUMN IF NOT EXISTS contact_responsible_name VARCHAR(160);
ALTER TABLE purchase_quote_requests
  ADD CONSTRAINT purchase_quote_requests_type_check CHECK (quote_type IN ('request', 'direct')),
  ADD CONSTRAINT purchase_quote_requests_origin_check CHECK (
    (quote_type = 'request' AND purchase_request_id IS NOT NULL)
    OR (quote_type = 'direct' AND purchase_request_id IS NULL)
  );

ALTER TABLE purchase_quote_items DROP CONSTRAINT purchase_quote_items_pkey;
ALTER TABLE purchase_quote_items
  ALTER COLUMN request_item_id DROP NOT NULL,
  ADD COLUMN id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN description VARCHAR(240),
  ADD COLUMN material_group_id UUID REFERENCES material_groups(id),
  ADD COLUMN unit VARCHAR(30),
  ADD COLUMN quantity NUMERIC(14,3),
  ADD COLUMN technical_specification TEXT,
  ADD COLUMN preferred_brand VARCHAR(120),
  ADD COLUMN brand_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN reference_code VARCHAR(120),
  ADD COLUMN notes TEXT,
  ADD COLUMN allows_equivalent BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN internal_product_id UUID REFERENCES products(id),
  ADD COLUMN supplier_item_code VARCHAR(120);
UPDATE purchase_quote_items qi SET
  description = pri.description,
  material_group_id = pri.material_group_id,
  unit = pri.unit,
  quantity = pri.quantity,
  technical_specification = pri.technical_specification,
  preferred_brand = pri.preferred_brand,
  brand_required = pri.brand_required,
  reference_code = pri.reference_code,
  notes = pri.notes,
  allows_equivalent = pri.allows_equivalent,
  internal_product_id = pri.product_id
FROM purchase_request_items pri WHERE pri.id = qi.request_item_id;
ALTER TABLE purchase_quote_items
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN description SET NOT NULL,
  ALTER COLUMN unit SET NOT NULL,
  ALTER COLUMN quantity SET NOT NULL,
  ADD PRIMARY KEY (id),
  ADD CONSTRAINT purchase_quote_items_quantity_check CHECK (quantity > 0);
CREATE UNIQUE INDEX idx_quote_items_request_item_unique
  ON purchase_quote_items (quote_request_id, request_item_id) WHERE request_item_id IS NOT NULL;
CREATE INDEX idx_quote_items_quote ON purchase_quote_items (quote_request_id);

ALTER TABLE supplier_proposal_items
  ALTER COLUMN request_item_id DROP NOT NULL,
  ADD COLUMN quote_item_id UUID REFERENCES purchase_quote_items(id),
  ADD COLUMN supplier_item_code VARCHAR(120),
  ADD COLUMN supplier_item_description VARCHAR(240),
  ADD COLUMN internal_product_id UUID REFERENCES products(id),
  ADD COLUMN unit VARCHAR(30);
UPDATE supplier_proposal_items spi SET quote_item_id = qi.id
FROM supplier_proposals sp, purchase_quote_items qi
WHERE sp.id = spi.proposal_id
  AND qi.quote_request_id = sp.quote_request_id
  AND qi.request_item_id = spi.request_item_id;
ALTER TABLE supplier_proposal_items ALTER COLUMN quote_item_id SET NOT NULL;
CREATE UNIQUE INDEX idx_proposal_items_quote_item_unique ON supplier_proposal_items (proposal_id, quote_item_id);

ALTER TABLE purchase_quote_selections
  ALTER COLUMN request_item_id DROP NOT NULL,
  ADD COLUMN quote_item_id UUID REFERENCES purchase_quote_items(id);
UPDATE purchase_quote_selections sel SET quote_item_id = qi.id
FROM purchase_quote_items qi
WHERE qi.quote_request_id = sel.quote_request_id
  AND qi.request_item_id = sel.request_item_id;
ALTER TABLE purchase_quote_selections ALTER COLUMN quote_item_id SET NOT NULL;
CREATE UNIQUE INDEX idx_quote_selections_quote_item_unique ON purchase_quote_selections (quote_request_id, quote_item_id);

ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS quote_item_id UUID REFERENCES purchase_quote_items(id),
  ADD COLUMN IF NOT EXISTS internal_product_id UUID REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS supplier_item_code VARCHAR(120);

CREATE TABLE supplier_item_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  supplier_item_code VARCHAR(120),
  supplier_item_description VARCHAR(240) NOT NULL,
  normalized_description VARCHAR(240) NOT NULL,
  internal_product_id UUID REFERENCES products(id),
  material_group_id UUID REFERENCES material_groups(id),
  brand VARCHAR(120),
  last_unit VARCHAR(30),
  last_price NUMERIC(14,4) CHECK (last_price IS NULL OR last_price >= 0),
  last_seen_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_supplier_mapping_active_code
  ON supplier_item_mappings (supplier_id, lower(supplier_item_code))
  WHERE supplier_item_code IS NOT NULL AND is_active = TRUE;
CREATE UNIQUE INDEX idx_supplier_mapping_active_description
  ON supplier_item_mappings (supplier_id, normalized_description)
  WHERE supplier_item_code IS NULL AND is_active = TRUE;
CREATE INDEX idx_supplier_mappings_product ON supplier_item_mappings (internal_product_id);
CREATE INDEX idx_supplier_mappings_search ON supplier_item_mappings (supplier_id, is_active, normalized_description);

CREATE TABLE supplier_item_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  mapping_id UUID REFERENCES supplier_item_mappings(id),
  internal_product_id UUID REFERENCES products(id),
  supplier_item_code VARCHAR(120),
  supplier_item_description VARCHAR(240) NOT NULL,
  observed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source VARCHAR(30) NOT NULL CHECK (source IN ('proposal','quote','direct_purchase','order','manual_import')),
  source_entity_id UUID,
  currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
  unit VARCHAR(30),
  unit_price NUMERIC(14,4) NOT NULL CHECK (unit_price >= 0),
  quantity NUMERIC(14,3) CHECK (quantity IS NULL OR quantity > 0),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_supplier_prices_mapping_date ON supplier_item_price_history (mapping_id, observed_at DESC);
CREATE INDEX idx_supplier_prices_supplier_date ON supplier_item_price_history (supplier_id, observed_at DESC);
CREATE INDEX idx_supplier_prices_product_date ON supplier_item_price_history (internal_product_id, observed_at DESC);

CREATE TABLE purchase_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context VARCHAR(30) NOT NULL CHECK (context IN ('direct_quote','proposal','direct_purchase','purchase_request','supplier_catalog')),
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('text','csv')),
  supplier_id UUID REFERENCES suppliers(id),
  source_entity_id UUID,
  valid_lines INTEGER NOT NULL DEFAULT 0,
  warning_lines INTEGER NOT NULL DEFAULT 0,
  invalid_lines INTEGER NOT NULL DEFAULT 0,
  confirmed_by UUID NOT NULL REFERENCES users(id),
  confirmed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES purchase_import_batches(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  supplier_item_code VARCHAR(120),
  description VARCHAR(240) NOT NULL,
  quantity NUMERIC(14,3),
  unit VARCHAR(30),
  unit_price NUMERIC(14,4),
  total_price NUMERIC(14,4),
  brand VARCHAR(120),
  notes TEXT,
  internal_product_id UUID REFERENCES products(id),
  mapping_id UUID REFERENCES supplier_item_mappings(id),
  link_action VARCHAR(30) NOT NULL DEFAULT 'unlinked' CHECK (link_action IN ('automatic','selected','created','unlinked')),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO permissions (code, name, description, group_name) VALUES
  ('purchase_items.import', 'Importar itens de compras', NULL, 'Compras e fornecedores'),
  ('supplier_catalog.manage', 'Gerenciar vínculos do catálogo de fornecedores', NULL, 'Compras e fornecedores'),
  ('supplier_catalog.view', 'Visualizar catálogo vinculado', NULL, 'Compras e fornecedores'),
  ('purchase_imports.create_product', 'Criar produto durante importação', NULL, 'Compras e fornecedores'),
  ('supplier_prices.view', 'Visualizar histórico de preços de fornecedores', NULL, 'Compras e fornecedores')
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, group_name=EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.slug='admin' AND p.code IN (
  'purchase_items.import','supplier_catalog.manage','supplier_catalog.view',
  'purchase_imports.create_product','supplier_prices.view'
) ON CONFLICT DO NOTHING;
