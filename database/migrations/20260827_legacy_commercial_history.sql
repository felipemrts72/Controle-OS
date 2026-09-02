-- Histórico Comercial imutável do ERP Universal.
-- Estruturas aditivas e isoladas de Produção, Estoque, Venda e numeração moderna.

CREATE TABLE IF NOT EXISTS integration_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system VARCHAR(80) NOT NULL,
  import_type VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('running','completed','failed')),
  source_snapshot_at TIMESTAMPTZ NOT NULL,
  source_payload_hash CHAR(64) NOT NULL CHECK (source_payload_hash ~ '^[0-9a-f]{64}$'),
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_import_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id UUID NOT NULL REFERENCES integration_import_runs(id) ON DELETE RESTRICT,
  source_system VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  source_id VARCHAR(180) NOT NULL,
  source_legacy_number BIGINT,
  destination_table VARCHAR(100),
  destination_id UUID,
  action VARCHAR(30) NOT NULL CHECK (action IN ('created','reused','deduplicated','skipped','warning')),
  fingerprint CHAR(64),
  canonical_source_id VARCHAR(180),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(import_run_id, source_system, entity_type, source_id)
);

ALTER TABLE commercial_products
  ADD COLUMN IF NOT EXISTS source_payload_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS import_run_id UUID REFERENCES integration_import_runs(id) ON DELETE SET NULL;

ALTER TABLE product_catalogs
  ADD COLUMN IF NOT EXISTS source_system VARCHAR(80),
  ADD COLUMN IF NOT EXISTS source_id VARCHAR(180),
  ADD COLUMN IF NOT EXISTS source_catalog_id VARCHAR(180),
  ADD COLUMN IF NOT EXISTS source_payload_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS import_run_id UUID REFERENCES integration_import_runs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_catalogs_source_identity
  ON product_catalogs(source_system,source_id)
  WHERE source_system IS NOT NULL AND source_id IS NOT NULL;

ALTER TABLE product_catalog_versions
  ADD COLUMN IF NOT EXISTS source_system VARCHAR(80),
  ADD COLUMN IF NOT EXISTS source_id VARCHAR(180),
  ADD COLUMN IF NOT EXISTS source_payload_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS import_run_id UUID REFERENCES integration_import_runs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_catalog_versions_source_identity
  ON product_catalog_versions(source_system,source_id)
  WHERE source_system IS NOT NULL AND source_id IS NOT NULL;

ALTER TABLE product_catalog_images
  ADD COLUMN IF NOT EXISTS source_system VARCHAR(80),
  ADD COLUMN IF NOT EXISTS source_id VARCHAR(180),
  ADD COLUMN IF NOT EXISTS source_path TEXT,
  ADD COLUMN IF NOT EXISTS sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS import_run_id UUID REFERENCES integration_import_runs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_catalog_images_source_identity
  ON product_catalog_images(source_system,source_id)
  WHERE source_system IS NOT NULL AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_catalog_images_sha256
  ON product_catalog_images(sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS commercial_legacy_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_number BIGINT NOT NULL UNIQUE CHECK (legacy_number BETWEEN 1 AND 249),
  source_system VARCHAR(80) NOT NULL,
  source_id VARCHAR(180) NOT NULL,
  source_legacy_number BIGINT NOT NULL,
  source_status VARCHAR(80),
  source_created_at TIMESTAMP,
  quote_date DATE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  source_customer_id VARCHAR(180),
  customer_name_snapshot VARCHAR(220) NOT NULL,
  customer_snapshot JSONB NOT NULL,
  notes_snapshot TEXT,
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  items_gross_total NUMERIC(16,2) NOT NULL CHECK (items_gross_total >= 0),
  items_discount_total NUMERIC(16,2) NOT NULL CHECK (items_discount_total >= 0),
  subtotal NUMERIC(16,2) NOT NULL CHECK (subtotal >= 0),
  general_discount_amount NUMERIC(16,2) NOT NULL CHECK (general_discount_amount >= 0),
  freight_amount NUMERIC(16,2),
  total NUMERIC(16,2) NOT NULL CHECK (total >= 0),
  payment_total NUMERIC(16,2),
  calculation_version VARCHAR(80) NOT NULL,
  total_provenance VARCHAR(80) NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  import_run_id UUID NOT NULL REFERENCES integration_import_runs(id) ON DELETE RESTRICT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  UNIQUE(source_system,source_id),
  CHECK (items_discount_total <= items_gross_total),
  CHECK (subtotal = items_gross_total - items_discount_total),
  CHECK (general_discount_amount <= subtotal),
  CHECK (freight_amount IS NULL),
  CHECK (total = subtotal - general_discount_amount)
);

CREATE TABLE IF NOT EXISTS commercial_legacy_quote_source_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_legacy_quote_id UUID NOT NULL REFERENCES commercial_legacy_quotes(id) ON DELETE RESTRICT,
  source_system VARCHAR(80) NOT NULL,
  source_id VARCHAR(180) NOT NULL,
  source_legacy_number BIGINT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  fingerprint CHAR(64) NOT NULL,
  import_run_id UUID NOT NULL REFERENCES integration_import_runs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_system,source_id),
  UNIQUE(source_system,source_legacy_number)
);

CREATE TABLE IF NOT EXISTS commercial_legacy_quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_legacy_quote_id UUID NOT NULL REFERENCES commercial_legacy_quotes(id) ON DELETE RESTRICT,
  source_item_id VARCHAR(180) NOT NULL,
  line_order INTEGER NOT NULL CHECK (line_order > 0),
  source_product_id VARCHAR(180),
  commercial_product_id UUID REFERENCES commercial_products(id) ON DELETE SET NULL,
  product_code_snapshot VARCHAR(100),
  product_name_snapshot TEXT NOT NULL,
  measurement_unit_snapshot VARCHAR(40),
  description_snapshot TEXT,
  quantity NUMERIC(16,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(16,2) NOT NULL CHECK (unit_price >= 0),
  unit_discount_amount NUMERIC(16,2) NOT NULL CHECK (unit_discount_amount >= 0),
  discount_percent NUMERIC(9,4) NOT NULL CHECK (discount_percent BETWEEN 0 AND 100),
  gross_subtotal NUMERIC(16,2) NOT NULL CHECK (gross_subtotal >= 0),
  discount_amount NUMERIC(16,2) NOT NULL CHECK (discount_amount >= 0),
  subtotal NUMERIC(16,2) NOT NULL CHECK (subtotal >= 0),
  legacy_include_catalog BOOLEAN NOT NULL DEFAULT FALSE,
  source_catalog_version_id VARCHAR(180),
  snapshot_provenance VARCHAR(80) NOT NULL DEFAULT 'ERP_UNIVERSAL',
  import_run_id UUID NOT NULL REFERENCES integration_import_runs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(commercial_legacy_quote_id,line_order),
  UNIQUE(commercial_legacy_quote_id,source_item_id),
  CHECK (discount_amount <= gross_subtotal),
  CHECK (subtotal = gross_subtotal - discount_amount)
);

CREATE TABLE IF NOT EXISTS commercial_legacy_quote_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_legacy_quote_id UUID NOT NULL REFERENCES commercial_legacy_quotes(id) ON DELETE RESTRICT,
  source_payment_id VARCHAR(180) NOT NULL,
  line_order INTEGER NOT NULL CHECK (line_order > 0),
  legacy_method VARCHAR(80) NOT NULL,
  method_type VARCHAR(30) NOT NULL,
  description VARCHAR(180) NOT NULL,
  amount NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  installment_count INTEGER NOT NULL CHECK (installment_count > 0),
  import_run_id UUID NOT NULL REFERENCES integration_import_runs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(commercial_legacy_quote_id,line_order),
  UNIQUE(commercial_legacy_quote_id,source_payment_id)
);

CREATE TABLE IF NOT EXISTS commercial_legacy_quote_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_payment_method_id UUID NOT NULL REFERENCES commercial_legacy_quote_payment_methods(id) ON DELETE RESTRICT,
  source_installment_id VARCHAR(180) NOT NULL,
  installment_number INTEGER NOT NULL CHECK (installment_number > 0),
  due_date DATE,
  amount NUMERIC(16,2) NOT NULL CHECK (amount >= 0),
  import_run_id UUID NOT NULL REFERENCES integration_import_runs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(legacy_payment_method_id,installment_number),
  UNIQUE(legacy_payment_method_id,source_installment_id)
);

CREATE TABLE IF NOT EXISTS commercial_legacy_quote_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_legacy_quote_id UUID NOT NULL REFERENCES commercial_legacy_quotes(id) ON DELETE RESTRICT,
  document_kind VARCHAR(30) NOT NULL CHECK (document_kind IN ('original_historical','reconstructed')),
  storage_key VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255),
  source_path TEXT,
  mime_type VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  import_run_id UUID REFERENCES integration_import_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(commercial_legacy_quote_id,document_kind,sha256)
);

CREATE INDEX IF NOT EXISTS idx_legacy_quotes_date_number ON commercial_legacy_quotes(quote_date DESC,legacy_number DESC);
CREATE INDEX IF NOT EXISTS idx_legacy_quotes_customer_search ON commercial_legacy_quotes(customer_name_snapshot);
CREATE INDEX IF NOT EXISTS idx_legacy_quote_items_quote ON commercial_legacy_quote_items(commercial_legacy_quote_id,line_order);
CREATE INDEX IF NOT EXISTS idx_legacy_quote_items_product ON commercial_legacy_quote_items(commercial_product_id) WHERE commercial_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_legacy_aliases_quote ON commercial_legacy_quote_source_aliases(commercial_legacy_quote_id);

CREATE OR REPLACE FUNCTION protect_locked_commercial_legacy_quote()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Orçamento histórico é imutável' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_protect_locked_commercial_legacy_quote ON commercial_legacy_quotes;
CREATE TRIGGER trg_protect_locked_commercial_legacy_quote
BEFORE UPDATE OR DELETE ON commercial_legacy_quotes
FOR EACH ROW EXECUTE FUNCTION protect_locked_commercial_legacy_quote();

CREATE OR REPLACE FUNCTION protect_commercial_legacy_child()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE quote_id UUID; quote_locked TIMESTAMPTZ;
BEGIN
  quote_id := CASE WHEN TG_OP='DELETE' THEN OLD.commercial_legacy_quote_id ELSE NEW.commercial_legacy_quote_id END;
  SELECT locked_at INTO quote_locked FROM commercial_legacy_quotes WHERE id=quote_id;
  IF quote_locked IS NOT NULL THEN
    RAISE EXCEPTION 'Itens e condições de Orçamento histórico são imutáveis' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_protect_legacy_quote_items ON commercial_legacy_quote_items;
CREATE TRIGGER trg_protect_legacy_quote_items BEFORE INSERT OR UPDATE OR DELETE ON commercial_legacy_quote_items
FOR EACH ROW EXECUTE FUNCTION protect_commercial_legacy_child();
DROP TRIGGER IF EXISTS trg_protect_legacy_quote_payments ON commercial_legacy_quote_payment_methods;
CREATE TRIGGER trg_protect_legacy_quote_payments BEFORE INSERT OR UPDATE OR DELETE ON commercial_legacy_quote_payment_methods
FOR EACH ROW EXECUTE FUNCTION protect_commercial_legacy_child();
DROP TRIGGER IF EXISTS trg_protect_legacy_quote_aliases ON commercial_legacy_quote_source_aliases;
CREATE TRIGGER trg_protect_legacy_quote_aliases BEFORE INSERT OR UPDATE OR DELETE ON commercial_legacy_quote_source_aliases
FOR EACH ROW EXECUTE FUNCTION protect_commercial_legacy_child();
DROP TRIGGER IF EXISTS trg_protect_legacy_quote_documents ON commercial_legacy_quote_documents;
CREATE TRIGGER trg_protect_legacy_quote_documents BEFORE INSERT OR UPDATE OR DELETE ON commercial_legacy_quote_documents
FOR EACH ROW EXECUTE FUNCTION protect_commercial_legacy_child();

CREATE OR REPLACE FUNCTION protect_commercial_legacy_installment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE payment_id UUID; quote_locked TIMESTAMPTZ;
BEGIN
  payment_id := CASE WHEN TG_OP='DELETE' THEN OLD.legacy_payment_method_id ELSE NEW.legacy_payment_method_id END;
  SELECT q.locked_at INTO quote_locked
  FROM commercial_legacy_quote_payment_methods p
  JOIN commercial_legacy_quotes q ON q.id=p.commercial_legacy_quote_id
  WHERE p.id=payment_id;
  IF quote_locked IS NOT NULL THEN
    RAISE EXCEPTION 'Parcelas de Orçamento histórico são imutáveis' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_protect_legacy_quote_installments ON commercial_legacy_quote_installments;
CREATE TRIGGER trg_protect_legacy_quote_installments
BEFORE INSERT OR UPDATE OR DELETE ON commercial_legacy_quote_installments
FOR EACH ROW EXECUTE FUNCTION protect_commercial_legacy_installment();

COMMENT ON TABLE commercial_legacy_quotes IS 'Fotografias imutáveis de Orçamentos comerciais externos; sem efeitos operacionais.';
COMMENT ON COLUMN commercial_legacy_quotes.legacy_number IS 'Sequência visual histórica OliMen 1-249, independente do número original ERP.';
COMMENT ON COLUMN commercial_legacy_quotes.source_legacy_number IS 'Número originalmente exibido pelo ERP Universal.';
COMMENT ON COLUMN commercial_legacy_quotes.total_provenance IS 'Origem do total histórico; ERP Universal usa reconstrução das linhas.';
