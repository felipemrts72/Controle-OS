import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';

export async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const result = await query('SELECT * FROM users WHERE username = $1 AND is_active = TRUE', [username]);
    const user = result.rows[0];
    const pgCrypt = user ? await query('SELECT $1 = crypt($2, $1) AS valid', [user.password_hash, password]) : { rows: [{ valid: false }] };
    const bcryptValid = user?.password_hash?.startsWith('$2') ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || (!bcryptValid && !pgCrypt.rows[0].valid)) {
      throw httpError(401, 'Usuário ou senha inválidos.');
    }
    const token = jwt.sign({ id: user.id, name: user.name, username: user.username, role: user.role }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role } });
  } catch (error) {
    next(error);
  }
}

export function me(req, res) {
  res.json({ user: req.user });
}
