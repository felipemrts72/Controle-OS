import bcrypt from 'bcrypt';
import { query, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from '../services/auditService.js';
import { getProductManufacturingSteps, saveProductManufacturingSteps } from '../services/manufacturingRouteService.js';
import { hasPermission, isSuperAdmin } from '../services/permissionService.js';
import {
  createSector as createSectorRecord,
  listSectors as listSectorRecords,
  setSectorActive,
  updateSector as updateSectorRecord,
} from '../services/sectorService.js';

const LEGACY_ROLES = ['admin', 'manager', 'shipping', 'viewer'];

async function getRoleAssignment(client, roleId, fallbackRole = 'viewer') {
  if (!roleId) return { roleId: null, legacyRole: fallbackRole };
  const role = await client.query('SELECT id, slug, name FROM roles WHERE id = $1 AND is_active = TRUE', [roleId]);
  if (!role.rows[0]) throw httpError(400, 'Perfil inválido ou inativo.');
  return {
    roleId: role.rows[0].id,
    legacyRole: LEGACY_ROLES.includes(role.rows[0].slug) ? role.rows[0].slug : fallbackRole,
    role: role.rows[0],
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
    const result = await query(
      `UPDATE users
       SET approval_status = 'approved', is_active = TRUE, approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, username, role, is_active, approval_status, approved_by, approved_at, created_at`,
      [req.user.id, req.params.id],
    );
    if (!result.rows[0]) throw httpError(404, 'Usuário não encontrado.');
    res.json(result.rows[0]);
  } catch (error) { next(error); }
}

export async function rejectUser(req, res, next) {
  try {
    const result = await query(
      `UPDATE users
       SET approval_status = 'rejected', is_active = FALSE, approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, username, role, is_active, approval_status, approved_by, approved_at, created_at`,
      [req.user.id, req.params.id],
    );
    if (!result.rows[0]) throw httpError(404, 'Usuário não encontrado.');
    res.json(result.rows[0]);
  } catch (error) { next(error); }
}

export async function updateUserRole(req, res, next) {
  try {
    const roles = ['admin', 'manager', 'shipping', 'viewer'];
    if (!roles.includes(req.body.role)) throw httpError(400, 'Perfil inválido.');

    const result = await query(
      `UPDATE users SET role = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, username, role, is_active, approval_status, approved_by, approved_at, created_at`,
      [req.body.role, req.params.id],
    );
    if (!result.rows[0]) throw httpError(404, 'Usuário não encontrado.');
    res.json(result.rows[0]);
  } catch (error) { next(error); }
}

export async function toggleUserActive(req, res, next) {
  try {
    const result = await query(
      `UPDATE users SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, username, role, is_active, approval_status, approved_by, approved_at, created_at`,
      [req.params.id],
    );
    if (!result.rows[0]) throw httpError(404, 'Usuário não encontrado.');
    res.json(result.rows[0]);
  } catch (error) { next(error); }
}

export async function listSectors(req, res, next) {
  try {
    res.json(await listSectorRecords(req.query.search));
  } catch (error) { next(error); }
}

export async function createSector(req, res, next) {
  try {
    res.status(201).json(await createSectorRecord(req.body, req.user));
  } catch (error) {
    if (error.code === '23505') return next(httpError(409, 'Já existe um setor com este nome.', { code: 'SECTOR_NAME_ALREADY_EXISTS', field: 'name' }));
    return next(error);
  }
}

export async function updateSector(req, res, next) {
  try {
    res.json(await updateSectorRecord(req.params.id, req.body, req.user));
  } catch (error) {
    if (error.code === '23505') return next(httpError(409, 'Já existe um setor com este nome.', { code: 'SECTOR_NAME_ALREADY_EXISTS', field: 'name' }));
    return next(error);
  }
}

export async function deactivateSector(req, res, next) {
  try {
    res.json(await setSectorActive(req.params.id, false, req.user));
  } catch (error) { next(error); }
}

export async function reactivateSector(req, res, next) {
  try {
    res.json(await setSectorActive(req.params.id, true, req.user));
  } catch (error) { next(error); }
}

export async function listProducts(req, res, next) {
  try {
    const result = await query(
      `SELECT p.*,
        s.name AS sector_name,
        pt.id AS product_type_id,
        pt.name AS type_name,
        pt.is_system AS type_is_system,
        CASE
          WHEN pt.id IS NULL THEN NULL
          ELSE json_build_object('id', pt.id, 'code', pt.code, 'name', pt.name, 'is_system', pt.is_system, 'is_active', pt.is_active)
        END AS product_type
       FROM products p
       LEFT JOIN sectors s ON s.id = p.sector_id
       LEFT JOIN product_types pt ON pt.code = p.type
       WHERE COALESCE(p.is_active, TRUE) = TRUE
       ORDER BY p.name`,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function searchProducts(req, res, next) {
  try {
    const includeSpareParts = String(req.query.include_spare_parts || 'false') === 'true';
    const search = String(req.query.q || '').trim();
    const explicitTypes = req.query.type ? String(req.query.type).split(',').filter(Boolean) : null;
    const params = [];
    const filters = ['p.is_active = TRUE'];

    if (explicitTypes) {
      params.push(explicitTypes);
      filters.push(`p.type = ANY($${params.length})`);
    } else if (!includeSpareParts) {
      filters.push("p.type <> 'material_prima'");
    }

    if (search) {
      params.push(`%${search}%`);
      filters.push(`p.name ILIKE $${params.length}`);
    }

    const result = await query(
      `SELECT p.*,
        s.name AS sector_name,
        pt.id AS product_type_id,
        pt.name AS type_name,
        CASE
          WHEN pt.id IS NULL THEN NULL
          ELSE json_build_object('id', pt.id, 'code', pt.code, 'name', pt.name, 'is_system', pt.is_system, 'is_active', pt.is_active)
        END AS product_type
       FROM products p
       LEFT JOIN sectors s ON s.id = p.sector_id
       LEFT JOIN product_types pt ON pt.code = p.type
       WHERE ${filters.join(' AND ')}
       ORDER BY p.name
       LIMIT 40`,
      params,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function listProductTypes(_req, res, next) {
  try {
    const result = await query('SELECT * FROM product_types ORDER BY is_system DESC, name ASC');
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function saveProductType(req, res, next) {
  try {
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!name) throw httpError(400, 'Informe o nome do tipo de produto.', { code: 'PRODUCT_TYPE_NAME_REQUIRED', field: 'name' });
    if (!req.params.id && !code) throw httpError(400, 'Informe o código do tipo de produto.', { code: 'PRODUCT_TYPE_CODE_REQUIRED', field: 'code' });

    const result = req.params.id
      ? await query(
        `UPDATE product_types
         SET name = $1, is_active = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [name, req.body.is_active ?? true, req.params.id],
      )
      : await query(
        `INSERT INTO product_types (code, name, is_system, is_active)
         VALUES ($1, $2, FALSE, TRUE)
         RETURNING *`,
        [code, name],
      );

    if (!result.rows[0]) throw httpError(404, 'Tipo de produto não encontrado.', { code: 'PRODUCT_TYPE_NOT_FOUND' });
    res.status(req.params.id ? 200 : 201).json(result.rows[0]);
  } catch (error) { next(error); }
}

export async function getProduct(req, res, next) {
  try {
    const product = await query(
      `SELECT p.*,
        s.name AS sector_name,
        pt.id AS product_type_id,
        pt.name AS type_name,
        CASE
          WHEN pt.id IS NULL THEN NULL
          ELSE json_build_object('id', pt.id, 'code', pt.code, 'name', pt.name, 'is_system', pt.is_system, 'is_active', pt.is_active)
        END AS product_type
       FROM products p
       LEFT JOIN sectors s ON s.id = p.sector_id
       LEFT JOIN product_types pt ON pt.code = p.type
       WHERE p.id = $1`,
      [req.params.id],
    );
    if (!product.rows[0]) throw httpError(404, 'Produto não encontrado.');
    const components = await query(
      `SELECT pc.*, s.name AS sector_name, mp.name AS material_product_name FROM product_components pc
       LEFT JOIN sectors s ON s.id = pc.sector_id
       LEFT JOIN products mp ON mp.id = pc.material_product_id
       WHERE product_id = $1 ORDER BY pc.created_at`,
      [req.params.id],
    );
    const manufacturingSteps = await getProductManufacturingSteps({ query }, req.params.id);
    res.json({ ...product.rows[0], components: components.rows, manufacturing_steps: manufacturingSteps });
  } catch (error) { next(error); }
}

export async function saveProduct(req, res, next) {
  try {
    const result = await transaction(async (client) => {
      const typeResult = await client.query('SELECT * FROM product_types WHERE code = $1 AND is_active = TRUE', [req.body.type]);
      if (!typeResult.rows[0]) throw httpError(400, 'Tipo de produto inválido ou inativo.', { code: 'PRODUCT_TYPE_NOT_FOUND', field: 'type' });

      let sectorId = req.body.sector_id || null;
      if (req.body.type === 'resale') {
        const shippingSector = await client.query("SELECT id FROM sectors WHERE slug = 'expedicao' AND is_active = TRUE");
        if (!shippingSector.rows[0]) throw httpError(400, 'Setor Expedição não encontrado.');
        sectorId = shippingSector.rows[0].id;
      } else {
        if (!sectorId) throw httpError(400, 'Informe o setor responsável do produto.');
        const sector = await client.query('SELECT id FROM sectors WHERE id = $1 AND is_active = TRUE', [sectorId]);
        if (!sector.rows[0]) throw httpError(400, 'Setor responsável inválido.');
      }

      const components = req.body.components || [];
      for (const component of components) {
        if (!component.component_name) throw httpError(400, 'Informe o nome do componente.');
        if (!component.sector_id) throw httpError(400, 'Informe o setor responsável do componente.');
        const sector = await client.query('SELECT id FROM sectors WHERE id = $1 AND is_active = TRUE', [component.sector_id]);
        if (!sector.rows[0]) throw httpError(400, 'Setor responsável inválido.');
        if (component.material_product_id) {
          const material = await client.query('SELECT id, sector_id FROM products WHERE id = $1 AND type = $2 AND is_active = TRUE', [component.material_product_id, 'material_prima']);
          if (!material.rows[0]) throw httpError(400, 'Produto matéria-prima inválido.');
          if (!material.rows[0].sector_id) {
            throw httpError(400, 'A matéria-prima selecionada não possui setor responsável cadastrado. Edite o produto antes de adicioná-lo como componente.', {
              code: 'MATERIAL_WITHOUT_SECTOR',
              field: 'material_product_id',
            });
          }
        }
      }

      const product = req.params.id
        ? await client.query(
          `UPDATE products SET name = $1, type = $2, sector_id = $3, default_volume_quantity = $4, default_total_weight_kg = $5, is_active = $6, updated_at = NOW()
           WHERE id = $7 RETURNING *`,
          [req.body.name, req.body.type, sectorId, req.body.default_volume_quantity, req.body.default_total_weight_kg, req.body.is_active ?? true, req.params.id],
        )
        : await client.query(
          `INSERT INTO products (name, type, sector_id, default_volume_quantity, default_total_weight_kg)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [req.body.name, req.body.type, sectorId, req.body.default_volume_quantity, req.body.default_total_weight_kg],
        );
      if (!product.rows[0]) throw httpError(404, 'Produto não encontrado.');
      await client.query('DELETE FROM product_components WHERE product_id = $1', [product.rows[0].id]);
      for (const component of components) {
        await client.query(
          `INSERT INTO product_components (product_id, material_product_id, component_name, sector_id, quantity, is_required)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [product.rows[0].id, component.material_product_id || null, component.component_name, component.sector_id, component.quantity || 1, component.is_required ?? true],
        );
      }
      await saveProductManufacturingSteps(client, product.rows[0].id, req.body.manufacturing_steps || []);
      await logAudit(client, { entityType: 'product', entityId: product.rows[0].id, action: req.params.id ? 'update' : 'create', newValue: req.body, userId: req.user?.id });
      return product.rows[0];
    });
    res.status(req.params.id ? 200 : 201).json(result);
  } catch (error) { next(error); }
}

export async function deleteProduct(req, res, next) {
  try {
    await transaction(async (client) => {
      const current = await client.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
      if (!current.rows[0]) throw httpError(404, 'Produto não encontrado.');
      if (current.rows[0].is_active === false) return;

      const updated = await client.query(
        `UPDATE products
         SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [req.params.id],
      );

      await logAudit(client, {
        entityType: 'product',
        entityId: req.params.id,
        action: 'soft_delete',
        previousValue: current.rows[0],
        newValue: updated.rows[0],
        userId: req.user.id,
      });
    });
    res.status(204).send();
  } catch (error) { next(error); }
}
