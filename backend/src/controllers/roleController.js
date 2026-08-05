import { transaction } from '../database/pool.js';
import { logAudit } from '../services/auditService.js';
import { httpError } from '../utils/httpError.js';

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function listPermissions(_req, res, next) {
  try {
    const result = await transaction((client) => client.query('SELECT * FROM permissions ORDER BY group_name, name'));
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function listRoles(_req, res, next) {
  try {
    const result = await transaction((client) => client.query(
      `SELECT r.*,
        COALESCE(
          json_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL),
          '[]'::json
        ) AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       GROUP BY r.id
       ORDER BY r.is_system DESC, r.name`,
    ));
    res.json(result.rows);
  } catch (error) { next(error); }
}

async function replaceRolePermissions(client, roleId, permissionCodes) {
  const previous = await client.query(
    `SELECT p.code
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1
     ORDER BY p.code`,
    [roleId],
  );

  await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
  if (permissionCodes?.length) {
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id
       FROM permissions
       WHERE code = ANY($2::varchar[])
       ON CONFLICT DO NOTHING`,
      [roleId, permissionCodes],
    );
  }

  const current = await client.query(
    `SELECT p.code
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1
     ORDER BY p.code`,
    [roleId],
  );

  return {
    previous: previous.rows.map((row) => row.code),
    current: current.rows.map((row) => row.code),
  };
}

export async function createRole(req, res, next) {
  try {
    const role = await transaction(async (client) => {
      const name = String(req.body.name || '').trim();
      const slug = slugify(req.body.slug || name);
      if (!name || !slug) throw httpError(400, 'Informe nome e identificador do perfil.');

      const created = await client.query(
        `INSERT INTO roles (name, slug, description, is_system, is_active)
         VALUES ($1, $2, $3, FALSE, TRUE)
         RETURNING *`,
        [name, slug, req.body.description || null],
      );

      const permissionCodes = Array.isArray(req.body.permission_codes) ? req.body.permission_codes : [];
      const permissionChange = await replaceRolePermissions(client, created.rows[0].id, permissionCodes);
      await logAudit(client, {
        entityType: 'role',
        entityId: created.rows[0].id,
        action: 'create',
        newValue: { ...created.rows[0], permissions: permissionChange.current },
        userId: req.user.id,
      });
      return { ...created.rows[0], permissions: permissionChange.current };
    });
    res.status(201).json(role);
  } catch (error) {
    if (error.code === '23505') return next(httpError(409, 'Já existe um perfil com esse identificador.'));
    next(error);
  }
}

export async function updateRole(req, res, next) {
  try {
    const role = await transaction(async (client) => {
      const current = await client.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
      if (!current.rows[0]) throw httpError(404, 'Perfil não encontrado.');

      const nextIsActive = req.body.is_active ?? current.rows[0].is_active;
      if (current.rows[0].is_system && nextIsActive === false) {
        throw httpError(400, 'Perfis de sistema não podem ser desativados.');
      }

      const name = String(req.body.name || current.rows[0].name).trim();
      const description = req.body.description ?? current.rows[0].description;
      const updated = await client.query(
        `UPDATE roles
         SET name = $1, description = $2, is_active = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [name, description, nextIsActive, req.params.id],
      );

      let permissions = null;
      if (Array.isArray(req.body.permission_codes)) {
        permissions = await replaceRolePermissions(client, req.params.id, req.body.permission_codes);
        await logAudit(client, {
          entityType: 'role',
          entityId: req.params.id,
          action: 'update_permissions',
          previousValue: { permissions: permissions.previous },
          newValue: { permissions: permissions.current },
          userId: req.user.id,
        });
      }

      await logAudit(client, {
        entityType: 'role',
        entityId: req.params.id,
        action: current.rows[0].is_active !== nextIsActive ? (nextIsActive ? 'activate' : 'deactivate') : 'update',
        previousValue: current.rows[0],
        newValue: updated.rows[0],
        userId: req.user.id,
      });
      return { ...updated.rows[0], permissions: permissions?.current ?? undefined };
    });
    res.json(role);
  } catch (error) {
    if (error.code === '23505') return next(httpError(409, 'Já existe um perfil com esse identificador.'));
    next(error);
  }
}
