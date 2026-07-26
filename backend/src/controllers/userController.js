import bcrypt from 'bcrypt';
import { query, transaction } from '../database/pool.js';
import { logAudit } from '../services/auditService.js';
import { hasPermission, isSuperAdmin } from '../services/permissionService.js';
import { httpError } from '../utils/httpError.js';

const LEGACY_ROLES = ['admin', 'manager', 'shipping', 'viewer'];

async function getRoleAssignment(client, roleId, fallbackRole = 'viewer') {
  if (!roleId) return { roleId: null, legacyRole: fallbackRole };
  const role = await client.query('SELECT id, slug, name FROM roles WHERE id = $1 AND is_active = TRUE', [roleId]);
  if (!role.rows[0]) throw httpError(400, 'Role inválida ou inativa.');
  return {
    roleId: role.rows[0].id,
    legacyRole: LEGACY_ROLES.includes(role.rows[0].slug) ? role.rows[0].slug : fallbackRole,
  };
}

function assertAdminCanBeChanged(user) {
  if (user?.username === 'admin') {
    throw httpError(400, 'O usuário admin principal não pode ser excluído ou desativado.');
  }
}

export async function listUsers(_req, res, next) {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.username, u.role, u.role_id, r.slug AS role_slug, r.name AS role_name,
        u.is_active, u.approval_status, u.approved_by, u.approved_at, u.created_at,
        approver.name AS approved_by_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN users approver ON approver.id = u.approved_by
       ORDER BY u.created_at DESC, u.name`,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function createUser(req, res, next) {
  try {
    const user = await transaction(async (client) => {
      const hash = await bcrypt.hash(req.body.password, 10);
      const assignment = await getRoleAssignment(client, req.body.role_id, LEGACY_ROLES.includes(req.body.role) ? req.body.role : 'viewer');
      const result = await client.query(
        `INSERT INTO users (name, username, password_hash, role, role_id, is_active, approval_status)
         VALUES ($1, $2, $3, $4, $5, TRUE, 'approved')
         RETURNING id, name, username, role, role_id, is_active, approval_status`,
        [req.body.name, req.body.username, hash, assignment.legacyRole, assignment.roleId],
      );
      await logAudit(client, {
        entityType: 'user',
        entityId: result.rows[0].id,
        action: 'create',
        newValue: result.rows[0],
        userId: req.user.id,
      });
      return result.rows[0];
    });
    res.status(201).json(user);
  } catch (error) {
    if (error.code === '23505') return next(httpError(409, 'Usuário já cadastrado.'));
    next(error);
  }
}

export async function approveUser(req, res, next) {
  try {
    const user = await transaction(async (client) => {
      const current = await client.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
      if (!current.rows[0]) throw httpError(404, 'Usuário não encontrado.');
      const assignment = req.body.role_id
        ? await getRoleAssignment(client, req.body.role_id, current.rows[0].role)
        : { roleId: current.rows[0].role_id, legacyRole: current.rows[0].role };
      const result = await client.query(
        `UPDATE users
         SET approval_status = 'approved', is_active = TRUE, role = $1, role_id = $2,
           approved_by = $3, approved_at = NOW(), updated_at = NOW()
         WHERE id = $4
         RETURNING id, name, username, role, role_id, is_active, approval_status, approved_by, approved_at, created_at`,
        [assignment.legacyRole, assignment.roleId, req.user.id, req.params.id],
      );
      await logAudit(client, {
        entityType: 'user',
        entityId: req.params.id,
        action: 'approve',
        previousValue: current.rows[0],
        newValue: result.rows[0],
        userId: req.user.id,
      });
      return result.rows[0];
    });
    res.json(user);
  } catch (error) { next(error); }
}

export async function rejectUser(req, res, next) {
  try {
    const user = await transaction(async (client) => {
      const current = await client.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
      if (!current.rows[0]) throw httpError(404, 'Usuário não encontrado.');
      assertAdminCanBeChanged(current.rows[0]);
      const result = await client.query(
        `UPDATE users
         SET approval_status = 'rejected', is_active = FALSE, approved_by = $1, approved_at = NOW(), updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, username, role, role_id, is_active, approval_status, approved_by, approved_at, created_at`,
        [req.user.id, req.params.id],
      );
      await logAudit(client, {
        entityType: 'user',
        entityId: req.params.id,
        action: 'reject',
        previousValue: current.rows[0],
        newValue: result.rows[0],
        userId: req.user.id,
      });
      return result.rows[0];
    });
    res.json(user);
  } catch (error) { next(error); }
}

export async function updateUserRole(req, res, next) {
  try {
    const user = await transaction(async (client) => {
      const current = await client.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
      if (!current.rows[0]) throw httpError(404, 'Usuário não encontrado.');
      if (current.rows[0].username === 'admin') {
        throw httpError(400, 'O usuário admin principal não pode ser rebaixado.');
      }

      const assignment = await getRoleAssignment(client, req.body.role_id, LEGACY_ROLES.includes(req.body.role) ? req.body.role : current.rows[0].role);
      const result = await client.query(
        `UPDATE users SET role = $1, role_id = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, name, username, role, role_id, is_active, approval_status, approved_by, approved_at, created_at`,
        [assignment.legacyRole, assignment.roleId, req.params.id],
      );
      await logAudit(client, {
        entityType: 'user',
        entityId: req.params.id,
        action: 'change_role',
        previousValue: { role: current.rows[0].role, role_id: current.rows[0].role_id },
        newValue: { role: result.rows[0].role, role_id: result.rows[0].role_id },
        userId: req.user.id,
      });
      return result.rows[0];
    });
    res.json(user);
  } catch (error) { next(error); }
}

export async function toggleUserActive(req, res, next) {
  try {
    const user = await transaction(async (client) => {
      const current = await client.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
      if (!current.rows[0]) throw httpError(404, 'Usuário não encontrado.');
      if (current.rows[0].is_active) assertAdminCanBeChanged(current.rows[0]);

      const result = await client.query(
        `UPDATE users SET is_active = NOT is_active, updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, username, role, role_id, is_active, approval_status, approved_by, approved_at, created_at`,
        [req.params.id],
      );
      await logAudit(client, {
        entityType: 'user',
        entityId: req.params.id,
        action: result.rows[0].is_active ? 'activate' : 'deactivate',
        previousValue: current.rows[0],
        newValue: result.rows[0],
        userId: req.user.id,
      });
      return result.rows[0];
    });
    res.json(user);
  } catch (error) { next(error); }
}

export async function changeUserPassword(req, res, next) {
  try {
    const { current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword } = req.body;
    if (!newPassword || !confirmPassword) throw httpError(400, 'Informe e confirme a nova senha.');
    if (newPassword !== confirmPassword) throw httpError(400, 'A nova senha e a confirmação precisam ser iguais.');

    await transaction(async (client) => {
      const targetResult = await client.query('SELECT id, username, password_hash FROM users WHERE id = $1', [req.params.id]);
      const target = targetResult.rows[0];
      if (!target) throw httpError(404, 'Usuário não encontrado.');

      const isSelf = target.id === req.user.id;
      if (isSelf) {
        if (!currentPassword) throw httpError(400, 'Informe a senha atual.');
        const pgCrypt = await client.query('SELECT $1 = crypt($2, $1) AS valid', [target.password_hash, currentPassword]);
        const bcryptValid = target.password_hash?.startsWith('$2') ? await bcrypt.compare(currentPassword, target.password_hash) : false;
        if (!bcryptValid && !pgCrypt.rows[0].valid) throw httpError(400, 'Senha atual inválida.');
      } else if (!isSuperAdmin(req.user) && !hasPermission(req.user, 'users.change_password')) {
        throw httpError(403, 'Acesso não autorizado.');
      }

      const hash = await bcrypt.hash(newPassword, 10);
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, target.id]);
      await logAudit(client, {
        entityType: 'user',
        entityId: target.id,
        action: 'change_password',
        newValue: { target_user_id: target.id, executor_user_id: req.user.id },
        userId: req.user.id,
      });
    });

    res.status(204).send();
  } catch (error) { next(error); }
}
