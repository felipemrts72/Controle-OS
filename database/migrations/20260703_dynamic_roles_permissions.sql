CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR UNIQUE NOT NULL,
  name VARCHAR NOT NULL,
  description TEXT,
  group_name VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id);

INSERT INTO roles (name, slug, description, is_system, is_active)
VALUES
  ('Administrador', 'admin', 'Perfil administrativo legado do sistema.', TRUE, TRUE),
  ('Gerente', 'manager', 'Perfil gerencial legado do sistema.', TRUE, TRUE),
  ('Expedição', 'shipping', 'Perfil legado de expedição.', TRUE, TRUE),
  ('Visualização', 'viewer', 'Perfil legado de visualização.', TRUE, TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = COALESCE(roles.description, EXCLUDED.description),
  is_system = TRUE,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('dashboard.view', 'Ver dashboard', NULL, 'Dashboard'),
  ('orders.view', 'Ver OS', NULL, 'Ordens de Serviço'),
  ('orders.create', 'Criar OS', NULL, 'Ordens de Serviço'),
  ('orders.edit', 'Editar OS', NULL, 'Ordens de Serviço'),
  ('orders.delete', 'Excluir OS', NULL, 'Ordens de Serviço'),
  ('orders.history.view', 'Ver histórico de OS', NULL, 'Ordens de Serviço'),
  ('products.view', 'Ver produtos', NULL, 'Produtos'),
  ('products.create', 'Criar produtos', NULL, 'Produtos'),
  ('products.edit', 'Editar produtos', NULL, 'Produtos'),
  ('products.delete', 'Excluir produtos', NULL, 'Produtos'),
  ('products.types.manage', 'Gerenciar tipos de produto', NULL, 'Produtos'),
  ('sectors.view', 'Ver setores', NULL, 'Setores'),
  ('sectors.manage', 'Gerenciar setores', NULL, 'Setores'),
  ('services.view', 'Ver serviços', NULL, 'Serviços'),
  ('services.complete', 'Concluir serviços', NULL, 'Serviços'),
  ('labels.view', 'Ver fila de etiquetas', NULL, 'Fila de Etiquetas'),
  ('labels.print', 'Imprimir etiquetas', NULL, 'Fila de Etiquetas'),
  ('labels.reprint', 'Reimprimir etiquetas', NULL, 'Fila de Etiquetas'),
  ('labels.mark_without_label', 'Marcar sem etiqueta', NULL, 'Fila de Etiquetas'),
  ('shipping.view', 'Ver expedição', NULL, 'Expedição'),
  ('shipping.confirm', 'Confirmar expedição', NULL, 'Expedição'),
  ('shipping.ready_admin.view', 'Ver vendas prontas', NULL, 'Expedição'),
  ('shipping.audit.view', 'Ver auditoria de expedições', NULL, 'Expedição'),
  ('tv.view', 'Ver painel TV', NULL, 'Painel TV'),
  ('users.view', 'Ver usuários', NULL, 'Usuários e permissões'),
  ('users.approve', 'Aprovar usuários', NULL, 'Usuários e permissões'),
  ('users.manage', 'Gerenciar usuários', NULL, 'Usuários e permissões'),
  ('users.change_password', 'Alterar senhas', NULL, 'Usuários e permissões'),
  ('roles.view', 'Ver roles', NULL, 'Usuários e permissões'),
  ('roles.manage', 'Gerenciar roles', NULL, 'Usuários e permissões'),
  ('suppliers.view', 'Ver fornecedores', NULL, 'Fornecedores'),
  ('suppliers.manage', 'Gerenciar fornecedores', NULL, 'Fornecedores'),
  ('purchase_quotes.view', 'Ver cotações', NULL, 'Compras'),
  ('purchase_quotes.manage', 'Gerenciar cotações', NULL, 'Compras'),
  ('employees.view', 'Ver funcionários', NULL, 'Funcionários'),
  ('employees.manage', 'Gerenciar funcionários', NULL, 'Funcionários'),
  ('advances.view', 'Ver vales', NULL, 'Vales'),
  ('advances.manage', 'Gerenciar vales', NULL, 'Vales')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'dashboard.view',
  'orders.view',
  'orders.create',
  'orders.edit',
  'orders.delete',
  'orders.history.view',
  'products.view',
  'products.create',
  'products.edit',
  'products.delete',
  'products.types.manage',
  'sectors.view',
  'sectors.manage',
  'services.view',
  'services.complete',
  'labels.view',
  'labels.print',
  'labels.reprint',
  'labels.mark_without_label',
  'shipping.view',
  'shipping.confirm',
  'shipping.audit.view',
  'tv.view'
)
WHERE r.slug = 'manager'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'labels.view',
  'labels.print',
  'labels.reprint',
  'shipping.view',
  'shipping.confirm',
  'services.view'
)
WHERE r.slug = 'shipping'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('tv.view')
WHERE r.slug = 'viewer'
ON CONFLICT DO NOTHING;

UPDATE users u
SET role_id = r.id,
  updated_at = NOW()
FROM roles r
WHERE u.role_id IS NULL
  AND u.role = r.slug
  AND r.slug IN ('admin', 'manager', 'shipping', 'viewer');

UPDATE users
SET is_active = TRUE,
  approval_status = 'approved',
  updated_at = NOW()
WHERE username = 'admin';

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_roles_slug ON roles(slug);
CREATE INDEX IF NOT EXISTS idx_permissions_code ON permissions(code);
