export const defaultRouteByRole = {
  admin: '/dashboard',
  manager: '/dashboard',
  shipping: '/fila-etiquetas',
  viewer: '/tv',
};

export const rolePermissions = {
  admin: [
    'dashboard',
    'orders',
    'order-create',
    'products',
    'sectors',
    'services',
    'labels',
    'shipping',
    'shipping-audit',
    'tv',
    'users',
    'order-history',
  ],
  manager: [
    'dashboard',
    'orders',
    'order-create',
    'products',
    'sectors',
    'services',
    'labels',
    'shipping',
    'shipping-audit',
    'tv',
  ],
  shipping: [
    'services',
    'labels',
    'shipping',
  ],
  viewer: [
    'tv',
  ],
};

export function getDefaultRoute(user) {
  return defaultRouteByRole[user?.role] || '/entrar';
}

export function canAccess(user, roles) {
  return Boolean(user && roles.includes(user.role));
}

export function canAccessPermission(user, permission) {
  return Boolean(user && rolePermissions[user.role]?.includes(permission));
}

export function rolesForPermission(permission) {
  return Object.entries(rolePermissions)
    .filter(([, permissions]) => permissions.includes(permission))
    .map(([role]) => role);
}
