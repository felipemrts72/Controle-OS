import { query } from '../database/pool.js';

export const PERMISSIONS = [
  { code: 'dashboard.view', name: 'Ver dashboard', group_name: 'Dashboard' },
  { code: 'orders.view', name: 'Ver OS', group_name: 'Ordens de Serviço' },
  { code: 'orders.create', name: 'Criar OS', group_name: 'Ordens de Serviço' },
  { code: 'orders.edit', name: 'Editar OS', group_name: 'Ordens de Serviço' },
  { code: 'orders.delete', name: 'Excluir OS', group_name: 'Ordens de Serviço' },
  { code: 'orders.history.view', name: 'Ver histórico de OS', group_name: 'Ordens de Serviço' },
  { code: 'products.view', name: 'Ver produtos', group_name: 'Produtos' },
  { code: 'products.create', name: 'Criar produtos', group_name: 'Produtos' },
  { code: 'products.edit', name: 'Editar produtos', group_name: 'Produtos' },
  { code: 'products.delete', name: 'Excluir produtos', group_name: 'Produtos' },
  { code: 'products.types.manage', name: 'Gerenciar tipos de produto', group_name: 'Produtos' },
  { code: 'sectors.view', name: 'Ver setores', group_name: 'Setores' },
  { code: 'sectors.manage', name: 'Gerenciar setores', group_name: 'Setores' },
  { code: 'services.view', name: 'Ver serviços', group_name: 'Serviços' },
  { code: 'services.complete', name: 'Concluir serviços', group_name: 'Serviços' },
  { code: 'labels.view', name: 'Ver fila de etiquetas', group_name: 'Fila de Etiquetas' },
  { code: 'labels.print', name: 'Imprimir etiquetas', group_name: 'Fila de Etiquetas' },
  { code: 'labels.reprint', name: 'Reimprimir etiquetas', group_name: 'Fila de Etiquetas' },
  { code: 'labels.mark_without_label', name: 'Marcar sem etiqueta', group_name: 'Fila de Etiquetas' },
  { code: 'shipping.view', name: 'Ver expedição', group_name: 'Expedição' },
  { code: 'shipping.confirm', name: 'Confirmar expedição', group_name: 'Expedição' },
  { code: 'shipping.ready_admin.view', name: 'Ver vendas prontas', group_name: 'Expedição' },
  { code: 'shipping.audit.view', name: 'Ver auditoria de expedições', group_name: 'Expedição' },
  { code: 'tv.view', name: 'Ver painel TV', group_name: 'Painel TV' },
  { code: 'users.view', name: 'Ver usuários', group_name: 'Usuários e permissões' },
  { code: 'users.approve', name: 'Aprovar usuários', group_name: 'Usuários e permissões' },
  { code: 'users.manage', name: 'Gerenciar usuários', group_name: 'Usuários e permissões' },
  { code: 'users.change_password', name: 'Alterar senhas', group_name: 'Usuários e permissões' },
  { code: 'roles.view', name: 'Ver roles', group_name: 'Usuários e permissões' },
  { code: 'roles.manage', name: 'Gerenciar roles', group_name: 'Usuários e permissões' },
  { code: 'suppliers.view', name: 'Ver fornecedores', group_name: 'Fornecedores' },
  { code: 'suppliers.manage', name: 'Gerenciar fornecedores', group_name: 'Fornecedores' },
  { code: 'purchase_quotes.view', name: 'Ver cotações', group_name: 'Compras' },
  { code: 'purchase_quotes.manage', name: 'Gerenciar cotações', group_name: 'Compras' },
  { code: 'suppliers.create', name: 'Criar fornecedores', group_name: 'Compras e fornecedores' },
  { code: 'suppliers.edit', name: 'Editar fornecedores', group_name: 'Compras e fornecedores' },
  { code: 'suppliers.deactivate', name: 'Desativar ou reativar fornecedores', group_name: 'Compras e fornecedores' },
  { code: 'supplier_groups.manage', name: 'Gerenciar grupos de materiais', group_name: 'Compras e fornecedores' },
  { code: 'purchases.view', name: 'Ver compras e solicitações', group_name: 'Compras e fornecedores' },
  { code: 'purchases.create_request', name: 'Criar solicitações de compra', group_name: 'Compras e fornecedores' },
  { code: 'purchases.edit_own_request', name: 'Editar solicitações próprias', group_name: 'Compras e fornecedores' },
  { code: 'purchases.approve', name: 'Aprovar solicitações de compra', group_name: 'Compras e fornecedores' },
  { code: 'purchases.create_preapproved', name: 'Criar solicitação pré-aprovada', group_name: 'Compras e fornecedores' },
  { code: 'purchases.create_direct', name: 'Criar compra direta', group_name: 'Compras e fornecedores' },
  { code: 'purchases.cancel', name: 'Cancelar solicitações e compras', group_name: 'Compras e fornecedores' },
  { code: 'purchases.receive', name: 'Registrar recebimentos', group_name: 'Compras e fornecedores' },
  { code: 'purchases.view_values', name: 'Ver valores de compras', group_name: 'Compras e fornecedores' },
  { code: 'purchase_quotes.create', name: 'Criar solicitações de cotação', group_name: 'Compras e fornecedores' },
  { code: 'purchase_quotes.send', name: 'Registrar envio de cotações', group_name: 'Compras e fornecedores' },
  { code: 'purchase_quotes.register_response', name: 'Registrar propostas de fornecedores', group_name: 'Compras e fornecedores' },
  { code: 'purchase_quotes.choose_supplier', name: 'Escolher fornecedores em cotações', group_name: 'Compras e fornecedores' },
  { code: 'purchase_quotes.pdf', name: 'Baixar PDFs de cotação', group_name: 'Compras e fornecedores' },
  { code: 'purchase_items.import', name: 'Importar itens de compras', group_name: 'Compras e fornecedores' },
  { code: 'supplier_catalog.manage', name: 'Gerenciar vínculos do catálogo de fornecedores', group_name: 'Compras e fornecedores' },
  { code: 'supplier_catalog.view', name: 'Visualizar catálogo vinculado', group_name: 'Compras e fornecedores' },
  { code: 'purchase_imports.create_product', name: 'Criar produto durante importação', group_name: 'Compras e fornecedores' },
  { code: 'supplier_prices.view', name: 'Visualizar histórico de preços de fornecedores', group_name: 'Compras e fornecedores' },
  { code: 'employees.view', name: 'Ver funcionários', group_name: 'Funcionários' },
  { code: 'employees.manage', name: 'Gerenciar funcionários', group_name: 'Funcionários' },
  { code: 'employees.create', name: 'Criar funcionários', group_name: 'Funcionários' },
  { code: 'employees.edit', name: 'Editar funcionários', group_name: 'Funcionários' },
  { code: 'employees.deactivate', name: 'Desativar funcionários', group_name: 'Funcionários' },
  { code: 'employees.salary.view', name: 'Ver salário de funcionários', group_name: 'Funcionários' },
  { code: 'employees.salary.manage', name: 'Gerenciar salário de funcionários', group_name: 'Funcionários' },
  { code: 'employees.meal_allowance.view', name: 'Ver vale alimentação', group_name: 'Funcionários' },
  { code: 'employees.meal_allowance.manage', name: 'Gerenciar vale alimentação', group_name: 'Funcionários' },
  { code: 'employees.documents.view', name: 'Ver documentos de funcionários', group_name: 'Funcionários' },
  { code: 'employees.documents.manage', name: 'Gerenciar documentos de funcionários', group_name: 'Funcionários' },
  { code: 'employees.dependents.view', name: 'Ver dependentes', group_name: 'Funcionários' },
  { code: 'employees.dependents.manage', name: 'Gerenciar dependentes', group_name: 'Funcionários' },
  { code: 'employees.profile.print', name: 'Imprimir ficha de funcionário', group_name: 'Funcionários' },
  { code: 'company_settings.view', name: 'Ver configurações da empresa', group_name: 'Configurações' },
  { code: 'company_settings.edit', name: 'Editar configurações da empresa', group_name: 'Configurações' },
  { code: 'awards.view', name: 'Ver prêmios', group_name: 'Prêmios' },
  { code: 'awards.create', name: 'Criar prêmios', group_name: 'Prêmios' },
  { code: 'awards.edit', name: 'Editar prêmios', group_name: 'Prêmios' },
  { code: 'awards.delete', name: 'Excluir prêmios', group_name: 'Prêmios' },
  { code: 'awards.pdf', name: 'Baixar termos de prêmios', group_name: 'Prêmios' },
  { code: 'advances.view', name: 'Ver vales', group_name: 'Vales' },
  { code: 'advances.manage', name: 'Gerenciar vales', group_name: 'Vales' },
  { code: 'advances.create', name: 'Criar listas de vales', group_name: 'Vales' },
  { code: 'advances.lists.delete', name: 'Excluir listas de vales', group_name: 'Vales' },
  { code: 'advances.edit_own_list', name: 'Editar própria lista de vales', group_name: 'Vales' },
  { code: 'advances.review', name: 'Revisar listas de vales', group_name: 'Vales' },
  { code: 'advances.approve', name: 'Aprovar listas de vales', group_name: 'Vales' },
  { code: 'advances.override_limits', name: 'Exceder limites de vales', group_name: 'Vales' },
  { code: 'advances.limit_lookup', name: 'Consultar limite de vales', group_name: 'Vales' },
  { code: 'advances.create_individual', name: 'Lançar vale individual', group_name: 'Vales' },
  { code: 'advances.installments.create', name: 'Criar parcelamentos de vales', group_name: 'Vales' },
  { code: 'advances.installments.convert', name: 'Parcelar vale existente', group_name: 'Vales' },
  { code: 'advances.installments.view', name: 'Ver parcelamentos de vales', group_name: 'Vales' },
  { code: 'advances.reports.view', name: 'Ver relatórios de vales', group_name: 'Vales' },
  { code: 'advances.reports.general', name: 'Ver relatório geral de vales', group_name: 'Vales' },
  { code: 'advances.reports.individual', name: 'Ver extrato individual de vales', group_name: 'Vales' },
  { code: 'advances.reports.cycles', name: 'Ver ciclos anteriores de vales', group_name: 'Vales' },
  { code: 'advances.audit.view', name: 'Ver auditoria de vales', group_name: 'Vales' },
  { code: 'advances.cycles.view', name: 'Ver ciclos de vales', group_name: 'Vales' },
  { code: 'advances.cycles.create', name: 'Iniciar ciclos de vales', group_name: 'Vales' },
  { code: 'advances.cycles.close', name: 'Fechar ciclos de vales', group_name: 'Vales' },
];

export const ALL_PERMISSION_CODES = PERMISSIONS.map((permission) => permission.code);

export const LEGACY_ROLE_PERMISSIONS = {
  admin: ALL_PERMISSION_CODES,
  manager: [
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
    'tv.view',
  ],
  shipping: [
    'labels.view',
    'labels.print',
    'labels.reprint',
    'shipping.view',
    'shipping.confirm',
    'services.view',
  ],
  viewer: ['tv.view'],
};

export function isSuperAdmin(user) {
  return user?.username === 'admin';
}

export async function getUserPermissions(userId) {
  const userResult = await query(
    `SELECT u.id, u.role, u.role_id, u.username, r.slug AS role_slug
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) return [];
  if (isSuperAdmin(user)) return ALL_PERMISSION_CODES;

  if (user.role_id) {
    const permissionResult = await query(
      `SELECT p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       JOIN roles r ON r.id = rp.role_id
       WHERE rp.role_id = $1 AND r.is_active = TRUE
       ORDER BY p.code`,
      [user.role_id],
    );
    return permissionResult.rows.map((row) => row.code);
  }

  return LEGACY_ROLE_PERMISSIONS[user.role] || [];
}

export async function buildAuthUser(userRow) {
  const permissions = isSuperAdmin(userRow) ? ALL_PERMISSION_CODES : await getUserPermissions(userRow.id);
  return {
    id: userRow.id,
    name: userRow.name,
    username: userRow.username,
    role: userRow.role,
    role_id: userRow.role_id || null,
    role_slug: userRow.role_slug || userRow.role || null,
    role_name: userRow.role_name || userRow.role || null,
    permissions,
    is_super_admin: isSuperAdmin(userRow),
  };
}

export function hasPermission(user, permissionCode) {
  if (isSuperAdmin(user)) return true;
  return Array.isArray(user?.permissions) && user.permissions.includes(permissionCode);
}
