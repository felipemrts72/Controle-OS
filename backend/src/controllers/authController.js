import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../database/pool.js';
import { buildAuthUser } from '../services/permissionService.js';
import { httpError } from '../utils/httpError.js';

export async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const result = await query(
      `SELECT u.*, r.slug AS role_slug, r.name AS role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.username = $1`,
      [username],
    );
    const user = result.rows[0];
    const pgCrypt = user ? await query('SELECT $1 = crypt($2, $1) AS valid', [user.password_hash, password]) : { rows: [{ valid: false }] };
    const bcryptValid = user?.password_hash?.startsWith('$2') ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !user.is_active || user.approval_status !== 'approved' || (!bcryptValid && !pgCrypt.rows[0].valid)) {
      throw httpError(401, 'Usuário ou senha inválidos.');
    }
    const authUser = await buildAuthUser(user);
    const token = jwt.sign(authUser, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '8h' });
    res.json({ token, user: authUser });
  } catch (error) {
    next(error);
  }
}

export async function register(req, res, next) {
  try {
    const { name, username, password } = req.body;
    if (!name || !username || !password) {
      throw httpError(400, 'Preencha nome, usuário e senha.');
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, username, password_hash, role, role_id, is_active, approval_status)
       VALUES ($1, $2, $3, 'viewer', (SELECT id FROM roles WHERE slug = 'viewer'), FALSE, 'pending')
       RETURNING id, name, username, role, role_id, is_active, approval_status`,
      [name, username, hash],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return next(httpError(409, 'Usuário já cadastrado.'));
    next(error);
  }
}

export function me(req, res) {
  res.json({ user: req.user });
}
