import jwt from 'jsonwebtoken';
import { httpError } from '../utils/httpError.js';

export function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  if (!header) return next(httpError(401, 'Login obrigatório.'));

  const [, token] = header.split(' ');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    return next();
  } catch {
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
