INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('advances.edit', 'Editar vales individuais', 'Corrigir vales individuais no ciclo aberto.', 'Vales'),
  ('advances.delete', 'Cancelar vales individuais', 'Cancelar vales individuais no ciclo aberto.', 'Vales')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, group_name = EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions source ON source.id = rp.permission_id AND source.code = 'advances.create_individual'
CROSS JOIN permissions target
WHERE target.code IN ('advances.edit', 'advances.delete')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.slug = 'admin' AND p.code IN ('advances.edit', 'advances.delete')
ON CONFLICT DO NOTHING;
