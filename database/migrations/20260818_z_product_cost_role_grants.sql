-- Custo é dado operacional: perfis que já editam Produtos precisam conseguir
-- informá-lo no cadastro e na regularização. Nenhuma permissão Comercial é incluída.
INSERT INTO role_permissions (role_id, permission_id)
SELECT editor_roles.role_id, cost_permissions.id
FROM (
  SELECT DISTINCT rp.role_id
  FROM role_permissions rp
  JOIN permissions p ON p.id = rp.permission_id
  WHERE p.code = 'products.edit'
) editor_roles
CROSS JOIN permissions cost_permissions
WHERE cost_permissions.code IN ('products.cost.view', 'products.cost.edit')
ON CONFLICT DO NOTHING;
