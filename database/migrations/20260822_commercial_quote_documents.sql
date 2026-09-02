-- Finaliza o ciclo documental de Orçamentos sem acoplamento com Venda ou Produção.

ALTER TABLE commercial_quotes
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE commercial_quotes
  ADD COLUMN IF NOT EXISTS company_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS company_snapshot_version INTEGER NOT NULL DEFAULT 1
    CHECK (company_snapshot_version > 0),
  ADD COLUMN IF NOT EXISTS company_logo_snapshot BYTEA;

UPDATE commercial_quotes q
SET company_snapshot = jsonb_strip_nulls(jsonb_build_object(
  'schema_version', 1,
  'nome_fantasia', s.nome_fantasia,
  'razao_social', s.razao_social,
  'cnpj', s.cnpj,
  'telefone', s.telefone,
  'email', s.email,
  'endereco', s.endereco,
  'numero', s.numero,
  'complemento', s.complemento,
  'bairro', s.bairro,
  'cidade', s.cidade,
  'estado', s.estado,
  'cep', s.cep,
  'nome_representante', s.nome_representante,
  'cargo_representante', s.cargo_representante
))
FROM company_settings s
WHERE s.singleton_key = TRUE
  AND q.company_snapshot = '{}'::jsonb;

ALTER TABLE commercial_quote_items
  ADD COLUMN IF NOT EXISTS save_product_requested BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS commercial_quote_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_quote_id UUID NOT NULL REFERENCES commercial_quotes(id) ON DELETE RESTRICT,
  document_version INTEGER NOT NULL CHECK (document_version > 0),
  quote_status VARCHAR(20) NOT NULL
    CHECK (quote_status IN ('sent', 'approved', 'rejected', 'cancelled')),
  filename VARCHAR(180) NOT NULL,
  mime_type VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
  pdf_data BYTEA NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  document_data_snapshot JSONB NOT NULL,
  company_snapshot JSONB NOT NULL,
  company_logo_snapshot BYTEA,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commercial_quote_id, document_version)
);

CREATE INDEX IF NOT EXISTS idx_commercial_quote_documents_quote_created
  ON commercial_quote_documents(commercial_quote_id, document_version DESC);

COMMENT ON COLUMN commercial_quote_items.save_product_requested IS
  'Intenção comercial para futura persistência; não cria Produto operacional automaticamente.';
COMMENT ON TABLE commercial_quote_documents IS
  'Versões oficiais imutáveis do PDF do Orçamento, armazenadas com snapshot e SHA-256.';
