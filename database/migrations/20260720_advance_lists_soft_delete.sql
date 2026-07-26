ALTER TABLE advance_lists
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_advance_lists_deleted_at ON advance_lists(deleted_at);

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('advances.lists.delete', 'Excluir listas de vales', NULL, 'Vales')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'advances.lists.delete'
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;
