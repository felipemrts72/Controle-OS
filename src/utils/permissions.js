export const defaultRouteByRole = {
  admin: '/dashboard',
  manager: '/dashboard',
  shipping: '/fila-etiquetas',
  viewer: '/tv',
};

export function getDefaultRoute(user) {
  return defaultRouteByRole[user?.role] || '/entrar';
}

export function canAccess(user, roles) {
  return Boolean(user && roles.includes(user.role));
}
