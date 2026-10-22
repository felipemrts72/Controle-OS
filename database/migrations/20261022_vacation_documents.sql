ALTER TABLE vacation_leaves ADD CONSTRAINT vacation_leaves_document_scope UNIQUE (id, employee_id, period_id);
CREATE TABLE vacation_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  period_id UUID NOT NULL,
  leave_id UUID NOT NULL,
  document_type VARCHAR(32) NOT NULL CHECK (document_type IN ('signed_receipt','notice','payment_proof','other')),
  original_name TEXT NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 CHAR(64) NOT NULL,
  stored_name UUID NOT NULL UNIQUE,
  description TEXT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by UUID REFERENCES users(id),
  FOREIGN KEY (period_id, employee_id) REFERENCES vacation_periods(id, employee_id),
  FOREIGN KEY (leave_id, employee_id, period_id) REFERENCES vacation_leaves(id, employee_id, period_id)
);
CREATE INDEX vacation_documents_leave_idx ON vacation_documents(leave_id, created_at) WHERE deleted_at IS NULL;
INSERT INTO permissions (code,name,description,group_name) VALUES
  ('vacations.documents.view','Ver documentos de férias','Consultar e baixar documentos de férias.','Administrativo'),
  ('vacations.documents.manage','Gerenciar documentos de férias','Anexar e arquivar documentos de férias.','Administrativo')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.slug='admin' AND p.code IN ('vacations.documents.view','vacations.documents.manage')
ON CONFLICT DO NOTHING;
