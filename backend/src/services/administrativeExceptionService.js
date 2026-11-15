import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import pg from 'pg';
import { query, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';
import { hasPermission, isSuperAdmin } from './permissionService.js';

const attemptsPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, allowExitOnIdle: true });

export const exceptionRules = Object.freeze({
  historicalVacationStart: { id: 'VACATION_HISTORICAL_START', classification: 'authorizable', module: 'vacations', operation: 'register_historical' },
  historicalVacationCorrection: { id: 'VACATION_HISTORICAL_CORRECTION_START', classification: 'authorizable', module: 'vacations', operation: 'correct_historical' },
  futureVacationStart: { id: 'VACATION_FUTURE_START', classification: 'authorizable', module: 'vacations', operation: 'schedule' },
  futureVacationCorrection: { id: 'VACATION_FUTURE_CORRECTION_START', classification: 'authorizable', module: 'vacations', operation: 'edit_schedule' },
});

export function canManageMaster(user) {
  return isSuperAdmin(user) || (user?.role_slug === 'admin' && hasPermission(user, 'roles.manage'));
}

function assertManager(user) {
  if (!canManageMaster(user)) throw httpError(403, 'Acesso administrativo obrigatório.');
}

function validPassword(password, minimum = 1) {
  return typeof password === 'string' && password.length >= minimum && Buffer.byteLength(password) <= 72;
}

async function verify(password, hash) {
  if (!validPassword(password)) throw httpError(400, 'Informe uma senha válida.');
  const result = await attemptsPool.query(`
    UPDATE administrative_master_attempts SET
      attempts = CASE WHEN window_started_at <= NOW() - INTERVAL '15 minutes' THEN 1 ELSE attempts + 1 END,
      window_started_at = CASE WHEN window_started_at <= NOW() - INTERVAL '15 minutes' THEN NOW() ELSE window_started_at END
    WHERE singleton AND (attempts < 5 OR window_started_at <= NOW() - INTERVAL '15 minutes')
    RETURNING attempts`);
  if (!result.rowCount) throw httpError(429, 'Limite de tentativas atingido. Aguarde até 15 minutos.');
  if (!await bcrypt.compare(password, hash)) throw httpError(403, 'Senha mestre incorreta.');
}

export async function masterStatus(user) {
  assertManager(user);
  const result = await query('SELECT password_hash IS NOT NULL AS configured FROM administrative_master_secret WHERE singleton');
  return result.rows[0];
}

export async function configureMaster(user, { current_password, new_password, deactivate }) {
  assertManager(user);
  if (deactivate !== true && !validPassword(new_password, 12)) {
    throw httpError(400, 'Use pelo menos 12 caracteres e no máximo 72 bytes.');
  }
  return transaction(async (client) => {
    const { rows: [secret] } = await client.query('SELECT password_hash FROM administrative_master_secret WHERE singleton FOR UPDATE');
    if (secret.password_hash) await verify(current_password, secret.password_hash);
    else if (deactivate === true) return { configured: false };
    if (deactivate !== true) {
      const { rows: [login] } = await client.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [user.id],
      );
      if (!login?.password_hash || await bcrypt.compare(new_password, login.password_hash.replace(/^\$2y\$/, '$2b$'))) throw httpError(400, 'Use uma senha diferente da senha de login.');
    }
    const hash = deactivate === true ? null : await bcrypt.hash(new_password, 12);
    await client.query('UPDATE administrative_master_secret SET password_hash=$1 WHERE singleton', [hash]);
    await logAudit(client, {
      entityType: 'administrative_master_secret', entityId: user.id, action: hash ? 'master_configured' : 'master_disabled', userId: user.id,
    });
    return { configured: Boolean(hash) };
  });
}

export async function authorizeException(client, rule, user, credentials, reason, operationData, displayDetails = {}) {
  if (rule.classification === 'warning') return null;
  if (rule.classification !== 'authorizable' || !Object.values(exceptionRules).includes(rule)) throw httpError(400, reason);
  assertManager(user);
  const { rows: [secret] } = await client.query('SELECT password_hash FROM administrative_master_secret WHERE singleton FOR SHARE');
  if (!secret.password_hash) throw httpError(409, 'Cadastre a senha mestre em Configurações da empresa → Segurança.');
  const scope = createHash('sha256').update(JSON.stringify([rule.id, user.id, reason, operationData])).digest('hex');
  const key = createHash('sha256').update('administrative-exception:').update(secret.password_hash).digest();
  if (!credentials) {
    const challenge = jwt.sign({ scope }, key, { jwtid: randomUUID(), expiresIn: '3m' });
    throw httpError(409, reason, { code: 'ADMIN_EXCEPTION_REQUIRED', details: { ...displayDetails, rule: rule.id, challenge } });
  }
  let challenge;
  try {
    challenge = jwt.verify(credentials.challenge, key, { algorithms: ['HS256'] });
    if (challenge.scope !== scope) throw new Error();
  } catch {
    throw httpError(409, 'Autorização vencida ou incompatível. Cancele e tente salvar novamente.');
  }
  const justification = typeof credentials.justification === 'string' ? credentials.justification.trim() : '';
  if (!justification || justification.length > 2000) throw httpError(400, 'Informe uma justificativa de até 2000 caracteres.');
  await verify(credentials.password, secret.password_hash);
  const consumed = await client.query(
    'INSERT INTO administrative_exception_uses (id, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT DO NOTHING',
    [challenge.jti, challenge.exp],
  );
  if (!consumed.rowCount) throw httpError(409, 'Esta autorização já foi utilizada.');
  return justification;
}

export function auditException(client, rule, user, recordId, justification, reason, context = {}) {
  return logAudit(client, {
    entityType: 'administrative_exception', entityId: recordId, action: rule.id, userId: user.id,
    newValue: { module: rule.module, operation: rule.operation, justification, reason, ...context, result: 'saved' },
  });
}

export async function listExceptions(user, before) {
  assertManager(user);
  const result = await query(`SELECT id, entity_id, action, new_value, user_id, created_at FROM audit_logs
    WHERE entity_type='administrative_exception' AND ($1::timestamp IS NULL OR created_at < $1)
    ORDER BY created_at DESC, id DESC LIMIT 50`, [before || null]);
  return result.rows;
}
