ALTER TABLE vacation_documents DROP CONSTRAINT IF EXISTS vacation_documents_document_type_check;
ALTER TABLE vacation_documents ADD CONSTRAINT vacation_documents_document_type_check
  CHECK (document_type IN ('signed_receipt','notice','bonus_request','payment_proof','other'));
