ALTER TABLE advance_list_items
  ADD COLUMN IF NOT EXISTS receipt_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS source_bank VARCHAR NULL,
  ADD COLUMN IF NOT EXISTS entry_type VARCHAR NOT NULL DEFAULT 'list';

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('advances.limit_lookup', 'Consultar limite de vales', NULL, 'Vales'),
  ('advances.create_individual', 'Lançar vale individual', NULL, 'Vales')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('advances.limit_lookup', 'advances.create_individual')
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;
