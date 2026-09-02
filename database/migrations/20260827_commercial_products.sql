-- Produto Comercial como raiz do domínio Comercial/Catálogo.
-- Migration aditiva: preserva products, product_commercial_profiles,
-- product_catalogs.product_id e todos os snapshots históricos.

CREATE TABLE IF NOT EXISTS commercial_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(220) NOT NULL,
  commercial_code VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  commercial_description TEXT,
  operational_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  source_system VARCHAR(80),
  source_id VARCHAR(180),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (btrim(name) <> ''),
  CHECK ((source_system IS NULL) = (source_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_commercial_products_search
  ON commercial_products USING gin (
    to_tsvector('portuguese', coalesce(name, '') || ' ' || coalesce(commercial_code, ''))
  );
CREATE INDEX IF NOT EXISTS idx_commercial_products_operational
  ON commercial_products(operational_product_id) WHERE operational_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commercial_products_active_name
  ON commercial_products(is_active, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_products_source_identity
  ON commercial_products(source_system, source_id)
  WHERE source_system IS NOT NULL AND source_id IS NOT NULL;

ALTER TABLE product_catalogs
  ADD COLUMN IF NOT EXISTS commercial_product_id UUID REFERENCES commercial_products(id) ON DELETE RESTRICT;

-- Cada Catálogo legado recebe uma raiz comercial própria. O product_id antigo
-- continua preenchido para compatibilidade e rastreabilidade histórica.
INSERT INTO commercial_products (
  name, commercial_code, is_active, commercial_description,
  operational_product_id, source_system, source_id,
  created_by, updated_by, created_at, updated_at
)
SELECT
  COALESCE(NULLIF(v.commercial_title, ''), p.name),
  p.internal_code,
  COALESCE(p.is_active, TRUE),
  c.commercial_description,
  p.id,
  'OLIMEN_LEGACY_CATALOG',
  c.id::text,
  c.created_by,
  c.updated_by,
  c.created_at,
  c.updated_at
FROM product_catalogs c
JOIN products p ON p.id = c.product_id
LEFT JOIN product_catalog_versions v ON v.id = c.active_version_id
WHERE c.commercial_product_id IS NULL
ON CONFLICT (source_system, source_id)
  WHERE source_system IS NOT NULL AND source_id IS NOT NULL
DO NOTHING;

UPDATE product_catalogs c
SET commercial_product_id = cp.id
FROM commercial_products cp
WHERE c.commercial_product_id IS NULL
  AND cp.source_system = 'OLIMEN_LEGACY_CATALOG'
  AND cp.source_id = c.id::text;

ALTER TABLE product_catalogs
  ALTER COLUMN product_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_catalogs_commercial_product
  ON product_catalogs(commercial_product_id)
  WHERE commercial_product_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'product_catalogs'::regclass
      AND conname = 'product_catalogs_owner_check'
  ) THEN
    ALTER TABLE product_catalogs
      ADD CONSTRAINT product_catalogs_owner_check
      CHECK (commercial_product_id IS NOT NULL OR product_id IS NOT NULL);
  END IF;
END $$;

ALTER TABLE commercial_quote_items
  ADD COLUMN IF NOT EXISTS commercial_product_id UUID REFERENCES commercial_products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS commercial_product_code_snapshot VARCHAR(80),
  ADD COLUMN IF NOT EXISTS commercial_product_name_snapshot VARCHAR(220),
  ADD COLUMN IF NOT EXISTS commercial_description_snapshot TEXT;

-- Enriquece apenas itens que já apontavam para um Catálogo migrado. Os demais
-- snapshots antigos permanecem exatamente como estavam.
UPDATE commercial_quote_items qi
SET commercial_product_id = c.commercial_product_id,
    commercial_product_code_snapshot = COALESCE(qi.commercial_product_code_snapshot, qi.product_code_snapshot),
    commercial_product_name_snapshot = COALESCE(qi.commercial_product_name_snapshot, qi.product_name_snapshot),
    commercial_description_snapshot = COALESCE(qi.commercial_description_snapshot, qi.description_snapshot)
FROM product_catalogs c
WHERE qi.commercial_product_id IS NULL
  AND qi.product_catalog_id = c.id
  AND c.commercial_product_id IS NOT NULL;

ALTER TABLE commercial_quote_items
  DROP CONSTRAINT IF EXISTS commercial_quote_items_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'commercial_quote_items'::regclass
      AND conname = 'commercial_quote_items_origin_check'
  ) THEN
    ALTER TABLE commercial_quote_items
      ADD CONSTRAINT commercial_quote_items_origin_check CHECK (
        (item_type = 'product' AND (commercial_product_id IS NOT NULL OR product_id IS NOT NULL))
        OR (item_type = 'manual' AND commercial_product_id IS NULL AND product_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_commercial_quote_items_commercial_product
  ON commercial_quote_items(commercial_product_id)
  WHERE commercial_product_id IS NOT NULL;

COMMENT ON TABLE commercial_products IS
  'Produtos apresentados e vendidos pelo Comercial; independentes dos Produtos operacionais.';
COMMENT ON COLUMN commercial_products.operational_product_id IS
  'Referência administrativa opcional. Não representa BOM nem configuração industrial.';
COMMENT ON COLUMN product_catalogs.product_id IS
  'Vínculo operacional legado preservado durante a transição para commercial_product_id.';
COMMENT ON COLUMN commercial_quote_items.commercial_product_name_snapshot IS
  'Nome comercial congelado no momento do Orçamento; prevalece no PDF quando disponível.';
