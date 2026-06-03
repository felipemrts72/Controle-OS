import bcrypt from 'bcrypt';
import { query, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from '../services/auditService.js';

export async function listUsers(_req, res, next) {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.username, u.role, u.is_active, u.approval_status, u.approved_by,
        u.approved_at, u.created_at, approver.name AS approved_by_name
       FROM users u
       LEFT JOIN users approver ON approver.id = u.approved_by
       ORDER BY u.created_at DESC, u.name`,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function createUser(req, res, next) {
  try {
    const hash = await bcrypt.hash(req.body.password, 10);
    const result = await query(
      `INSERT INTO users (name, username, password_hash, role, is_active, approval_status)
       VALUES ($1, $2, $3, $4, TRUE, 'approved')
       RETURNING id, name, username, role, is_active, approval_status`,
      [req.body.name, req.body.username, hash, req.body.role],
    );
    res.status(201).json(result.rows[0]);
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

export async function listSectors(_req, res, next) {
  try {
    const result = await query('SELECT * FROM sectors ORDER BY name');
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function createSector(req, res, next) {
  try {
    const result = await query('INSERT INTO sectors (name, slug) VALUES ($1, $2) RETURNING *', [req.body.name, req.body.slug]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
}

export async function updateSector(req, res, next) {
  try {
    const result = await query('UPDATE sectors SET name = $1, slug = $2, is_active = $3, updated_at = NOW() WHERE id = $4 RETURNING *', [req.body.name, req.body.slug, req.body.is_active, req.params.id]);
    if (!result.rows[0]) throw httpError(404, 'Setor não encontrado.');
    res.json(result.rows[0]);
  } catch (error) { next(error); }
}

export async function deactivateSector(req, res, next) {
  try {
    const result = await query('UPDATE sectors SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *', [req.params.id]);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
}

export async function listProducts(req, res, next) {
  try {
    const result = await query(
      `SELECT p.*, s.name AS sector_name
       FROM products p
       LEFT JOIN sectors s ON s.id = p.sector_id
       ORDER BY p.name`,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function searchProducts(req, res, next) {
  try {
    const types = String(req.query.type || 'manufactured,resale').split(',');
    const result = await query(
      `SELECT p.*, s.name AS sector_name
       FROM products p
       LEFT JOIN sectors s ON s.id = p.sector_id
       WHERE p.type = ANY($1) AND p.is_active = TRUE
       ORDER BY p.name`,
      [types],
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function getProduct(req, res, next) {
  try {
    const product = await query(
      `SELECT p.*, s.name AS sector_name
       FROM products p
       LEFT JOIN sectors s ON s.id = p.sector_id
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
    res.json({ ...product.rows[0], components: components.rows });
  } catch (error) { next(error); }
}

export async function saveProduct(req, res, next) {
  try {
    const result = await transaction(async (client) => {
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
          const material = await client.query('SELECT id FROM products WHERE id = $1 AND type = $2 AND is_active = TRUE', [component.material_product_id, 'material_prima']);
          if (!material.rows[0]) throw httpError(400, 'Produto matéria-prima inválido.');
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
      await logAudit(client, { entityType: 'product', entityId: product.rows[0].id, action: req.params.id ? 'update' : 'create', newValue: req.body, userId: req.user?.id });
      return product.rows[0];
    });
    res.status(req.params.id ? 200 : 201).json(result);
  } catch (error) { next(error); }
}
