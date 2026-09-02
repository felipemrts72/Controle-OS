import jwt from 'jsonwebtoken';
import { query } from '../database/pool.js';
import { buildAuthUser, hasPermission, isSuperAdmin } from '../services/permissionService.js';
import { httpError } from '../utils/httpError.js';

export async function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  if (!header) return next(httpError(401, 'Login obrigatório.'));

  const [, token] = header.split(' ');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    const result = await query(
      `SELECT u.id, u.name, u.username, u.role, u.role_id, u.is_active, u.approval_status,
        r.slug AS role_slug, r.name AS role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [payload.id],
    );
    const user = result.rows[0];
    if (!user || !user.is_active || user.approval_status !== 'approved') {
      return next(httpError(401, 'Sessão inválida.'));
    }

    req.user = await buildAuthUser(user);
    return next();
  } catch (error) {
    if (error.status) return next(error);
    return next(httpError(401, 'Sessão inválida.'));
  }
}

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(httpError(403, 'Acesso não autorizado.'));
    }
    return next();
  };
}

export function requirePermission(permissionCode) {
  return (req, _res, next) => {
    if (!hasPermission(req.user, permissionCode)) {
      return next(httpError(403, 'Acesso não autorizado.'));
    }
    return next();
  };
}

export function requirePermissionOrAdmin(permissionCode, message = 'Acesso não autorizado.') {
  return (req, _res, next) => {
    if (isSuperAdmin(req.user) || hasPermission(req.user, permissionCode)) {
      return next();
    }
    return next(httpError(403, message));
  };
}

export function requireAnyPermission(...permissionCodes) {
  return (req, _res, next) => {
    if (!permissionCodes.some((permissionCode) => hasPermission(req.user, permissionCode))) {
      return next(httpError(403, 'Acesso não autorizado.'));
    }
    return next();
  };
}
