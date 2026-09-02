import { getNavigationItemsInOrder } from '../config/modulePresentation.js';

export const routeCandidates = getNavigationItemsInOrder()
  .map(({ to: path, permission }) => ({ path, permission }));

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
    'products.cost.view',
    'products.cost.edit',
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
  return user?.is_super_admin === true || user?.username === 'admin';
}

export function getDefaultRoute(user) {
  if (!user) return '/entrar';
  if (canAccessPermission(user, 'dashboard.view')) return '/dashboard';
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
