-- PDF reconstruído do histórico comercial. O snapshot legado permanece imutável;
-- o documento é append-only e nunca é classificado como original do ERP.
ALTER TABLE commercial_legacy_quote_documents
  ADD COLUMN IF NOT EXISTS provenance_classification VARCHAR(30),
  ADD COLUMN IF NOT EXISTS pdf_data BYTEA,
  ADD COLUMN IF NOT EXISTS document_data_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS company_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS company_logo_snapshot BYTEA,
  ADD COLUMN IF NOT EXISTS renderer_version VARCHAR(80),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE commercial_legacy_quote_documents
  DROP CONSTRAINT IF EXISTS commercial_legacy_quote_documents_provenance_classification_check;

ALTER TABLE commercial_legacy_quote_documents
  ADD CONSTRAINT commercial_legacy_quote_documents_provenance_classification_check
  CHECK (provenance_classification IS NULL OR provenance_classification IN ('RECONSTRUCTED','ORIGINAL_ERP'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_legacy_quote_reconstructed_document
  ON commercial_legacy_quote_documents(commercial_legacy_quote_id, provenance_classification)
  WHERE provenance_classification = 'RECONSTRUCTED';

ALTER TABLE commercial_legacy_quote_documents
  ADD CONSTRAINT commercial_legacy_quote_documents_reconstructed_payload_check
  CHECK (
    provenance_classification <> 'RECONSTRUCTED'
    OR (
      document_kind = 'reconstructed'
      AND pdf_data IS NOT NULL
      AND document_data_snapshot IS NOT NULL
      AND renderer_version IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE commercial_legacy_quote_documents
  VALIDATE CONSTRAINT commercial_legacy_quote_documents_reconstructed_payload_check;
