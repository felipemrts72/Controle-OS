export const routeCandidates = [
  { path: '/dashboard', permission: 'dashboard.view' },
  { path: '/os', permission: 'orders.view' },
  { path: '/fila-etiquetas', permission: 'labels.view' },
  { path: '/expedicao', permission: 'shipping.view' },
  { path: '/servicos', permission: 'services.view' },
  { path: '/produtos', permission: 'products.view' },
  { path: '/funcionarios', permission: 'employees.view' },
  { path: '/premios', permission: 'awards.view' },
  { path: '/configuracoes/empresa', permission: 'company_settings.view' },
  { path: '/vales/relatorios', permission: 'advances.reports.view' },
  { path: '/vales', permission: 'advances.view' },
  { path: '/tv', permission: 'tv.view' },
  { path: '/usuarios', permission: 'users.view' },
  { path: '/roles', permission: 'roles.view' },
];

export const legacyRolePermissions = {
  admin: ['*'],
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
  return user?.is_super_admin || user?.username === 'admin' || user?.role_slug === 'admin' || user?.role === 'admin';
}

export function getDefaultRoute(user) {
  if (!user) return '/entrar';
  const route = routeCandidates.find((candidate) => canAccessPermission(user, candidate.permission));
  return route?.path || '/acesso-negado';
}

export function canAccess(_user, _roles) {
  return false;
}

export function canAccessPermission(user, permission) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  if (Array.isArray(user.permissions)) return user.permissions.includes(permission);
  const fallback = legacyRolePermissions[user.role] || [];
  return fallback.includes('*') || fallback.includes(permission);
}

export function rolesForPermission(permission) {
  return Object.entries(legacyRolePermissions)
    .filter(([, permissions]) => permissions.includes('*') || permissions.includes(permission))
    .map(([role]) => role);
}
