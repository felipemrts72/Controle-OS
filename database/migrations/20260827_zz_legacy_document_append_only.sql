-- Documentos históricos podem ser anexados posteriormente após validação humana,
-- mas nunca alterados ou removidos. O conteúdo do Orçamento continua bloqueado.

DROP TRIGGER IF EXISTS trg_protect_legacy_quote_documents ON commercial_legacy_quote_documents;

CREATE OR REPLACE FUNCTION protect_commercial_legacy_document_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Documento histórico é append-only' USING ERRCODE='55000';
END $$;

CREATE TRIGGER trg_protect_legacy_quote_documents
BEFORE UPDATE OR DELETE ON commercial_legacy_quote_documents
FOR EACH ROW EXECUTE FUNCTION protect_commercial_legacy_document_mutation();
