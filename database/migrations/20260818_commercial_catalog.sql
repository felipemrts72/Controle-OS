-- Consolidação Produto operacional x Catálogo Comercial.
-- Migration aditiva: preserva products, product_commercial_profiles e todos os fluxos operacionais.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS operational_cost NUMERIC(14,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_operational_cost_nonnegative') THEN
    ALTER TABLE products ADD CONSTRAINT products_operational_cost_nonnegative
      CHECK (operational_cost IS NULL OR operational_cost >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS product_catalogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE RESTRICT,
  reference_price NUMERIC(14,2) CHECK (reference_price IS NULL OR reference_price >= 0),
  commercial_description TEXT,
  sop_discount_type VARCHAR(20) CHECK (sop_discount_type IS NULL OR sop_discount_type IN ('amount', 'percentage')),
  sop_discount_value NUMERIC(14,4) CHECK (sop_discount_value IS NULL OR sop_discount_value >= 0),
  active_version_id UUID,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((sop_discount_type IS NULL) = (sop_discount_value IS NULL)),
  CHECK (sop_discount_type <> 'percentage' OR sop_discount_value <= 100),
  CHECK (sop_discount_type IS NULL OR reference_price IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS product_catalog_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_catalog_id UUID NOT NULL REFERENCES product_catalogs(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  commercial_title VARCHAR(220) NOT NULL,
  subtitle TEXT,
  presentation_text TEXT,
  applications_text TEXT,
  additional_text TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_catalog_id, version_number),
  CHECK ((status = 'draft' AND published_at IS NULL) OR (status <> 'draft' AND published_at IS NOT NULL))
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_catalogs_active_version_fk') THEN
    ALTER TABLE product_catalogs ADD CONSTRAINT product_catalogs_active_version_fk
      FOREIGN KEY (active_version_id) REFERENCES product_catalog_versions(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS product_catalog_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_catalog_version_id UUID NOT NULL REFERENCES product_catalog_versions(id) ON DELETE RESTRICT,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  caption TEXT,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_catalog_specifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_catalog_version_id UUID NOT NULL REFERENCES product_catalog_versions(id) ON DELETE RESTRICT,
  name VARCHAR(180) NOT NULL,
  value TEXT NOT NULL,
  unit VARCHAR(40),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_catalog_included_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_catalog_version_id UUID NOT NULL REFERENCES product_catalog_versions(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) CHECK (quantity IS NULL OR quantity > 0),
  unit VARCHAR(40),
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Preserva e promove os perfis comerciais já usados pelos Orçamentos.
INSERT INTO product_catalogs (product_id, reference_price, commercial_description, updated_by, created_at, updated_at)
SELECT product_id, reference_price, commercial_description, updated_by, created_at, updated_at
FROM product_commercial_profiles
ON CONFLICT (product_id) DO NOTHING;

ALTER TABLE commercial_quote_items
  ADD COLUMN IF NOT EXISTS product_catalog_id UUID REFERENCES product_catalogs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS product_catalog_version_id UUID REFERENCES product_catalog_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reference_price_snapshot NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS sop_discount_type_snapshot VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sop_discount_value_snapshot NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS sop_minimum_price_snapshot NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS effective_unit_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS is_outside_sop BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commercial_quote_items_sop_type_check') THEN
    ALTER TABLE commercial_quote_items ADD CONSTRAINT commercial_quote_items_sop_type_check
      CHECK (sop_discount_type_snapshot IS NULL OR sop_discount_type_snapshot IN ('amount', 'percentage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commercial_quote_items_reference_price_check') THEN
    ALTER TABLE commercial_quote_items ADD CONSTRAINT commercial_quote_items_reference_price_check
      CHECK (reference_price_snapshot IS NULL OR reference_price_snapshot >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_catalog_versions_catalog
  ON product_catalog_versions(product_catalog_id, version_number DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_catalog_images_primary
  ON product_catalog_images(product_catalog_version_id) WHERE is_primary = TRUE;
CREATE INDEX IF NOT EXISTS idx_product_catalog_images_order
  ON product_catalog_images(product_catalog_version_id, position, id);
CREATE INDEX IF NOT EXISTS idx_product_catalog_images_storage
  ON product_catalog_images(stored_name);
CREATE INDEX IF NOT EXISTS idx_product_catalog_specs_order
  ON product_catalog_specifications(product_catalog_version_id, position, id);
CREATE INDEX IF NOT EXISTS idx_product_catalog_included_order
  ON product_catalog_included_items(product_catalog_version_id, position, id);
CREATE INDEX IF NOT EXISTS idx_commercial_quote_items_catalog_version
  ON commercial_quote_items(product_catalog_version_id) WHERE product_catalog_version_id IS NOT NULL;

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('products.cost.view', 'Ver custo de Produtos', 'Permite visualizar o custo operacional dos Produtos.', 'Estoque'),
  ('products.cost.edit', 'Editar custo de Produtos', 'Permite informar e alterar o custo operacional dos Produtos.', 'Estoque'),
  ('commercial.catalog.view', 'Ver Catálogo Comercial', 'Permite visualizar cadastros e versões do Catálogo Comercial.', 'Comercial'),
  ('commercial.catalog.create', 'Criar Catálogo Comercial', 'Permite vincular um Catálogo Comercial a um Produto existente.', 'Comercial'),
  ('commercial.catalog.edit', 'Editar Catálogo Comercial', 'Permite editar dados comerciais e versões em rascunho.', 'Comercial'),
  ('commercial.catalog.sop.view', 'Ver SOP Comercial', 'Permite visualizar limites internos de desconto do Catálogo.', 'Comercial'),
  ('commercial.catalog.sop.edit', 'Editar SOP Comercial', 'Permite alterar os limites internos de desconto do Catálogo.', 'Comercial'),
  ('commercial.catalog.publish', 'Publicar Catálogo Comercial', 'Permite publicar uma versão e torná-la ativa para novos Orçamentos.', 'Comercial')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

-- Novas permissões sensíveis ficam inicialmente apenas com o Administrador.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'products.cost.view', 'products.cost.edit',
  'commercial.catalog.view', 'commercial.catalog.create', 'commercial.catalog.edit',
  'commercial.catalog.sop.view', 'commercial.catalog.sop.edit', 'commercial.catalog.publish'
)
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;
