import bcrypt from 'bcrypt';
import { query, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from '../services/auditService.js';
import { getProductManufacturingSteps, saveProductManufacturingSteps } from '../services/manufacturingRouteService.js';
import { createProductImageUploadToken } from '../services/productImageService.js';
import { hasPermission, isSuperAdmin } from '../services/permissionService.js';
import { normalizeMeasurementUnitCode } from '../services/measurementUnitService.js';
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
    const paginated = String(req.query.paginated || '').toLowerCase() === 'true';
    if (paginated) {
      const pageValue = Number.parseInt(req.query.page, 10);
      const limitValue = Number.parseInt(req.query.limit, 10);
      const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
      const limit = Math.min(100, Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 20);
      const search = String(req.query.search || '').trim().slice(0, 160);
      const reviewStatus = String(req.query.review_status || '').trim();
      const productType = String(req.query.product_type || '').trim();
      const sectorId = String(req.query.sector_id || '').trim();
      const allowedReviewStatuses = new Set(['', 'pending_review', 'approved']);
      if (!allowedReviewStatuses.has(reviewStatus)) {
        throw httpError(400, 'Filtro de revisão inválido.', { code: 'PRODUCT_REVIEW_FILTER_INVALID', field: 'review_status' });
      }
      if (sectorId && sectorId !== 'without-sector' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sectorId)) {
        throw httpError(400, 'Filtro de setor inválido.', { code: 'PRODUCT_SECTOR_FILTER_INVALID', field: 'sector_id' });
      }

      const params = [];
      const filters = ['COALESCE(p.is_active, TRUE) = TRUE'];
      if (search) {
        params.push(`%${search}%`);
        filters.push(`(p.name ILIKE $${params.length} OR p.internal_code ILIKE $${params.length})`);
      }
      if (reviewStatus) {
        params.push(reviewStatus);
        filters.push(`p.review_status = $${params.length}`);
      }
      if (productType) {
        params.push(productType);
        filters.push(`p.type = $${params.length}`);
      }
      if (sectorId === 'without-sector') {
        filters.push('p.sector_id IS NULL');
      } else if (sectorId) {
        params.push(sectorId);
        filters.push(`p.sector_id = $${params.length}`);
      }

      const where = filters.join(' AND ');
      const countParams = [...params];
      params.push(limit, (page - 1) * limit);
      const [itemsResult, countResult] = await Promise.all([
        query(
          `SELECT p.*,
            s.name AS sector_name,
            pt.id AS product_type_id,
            pt.name AS type_name,
            pt.is_system AS type_is_system,
            CASE
              WHEN pt.id IS NULL THEN NULL
              ELSE json_build_object('id', pt.id, 'code', pt.code, 'name', pt.name, 'is_system', pt.is_system, 'is_active', pt.is_active)
            END AS product_type,
            creator.name AS preliminary_created_by_name,
            EXISTS(SELECT 1 FROM product_images image WHERE image.product_id = p.id) AS has_photo
           FROM products p
           LEFT JOIN sectors s ON s.id = p.sector_id
           LEFT JOIN product_types pt ON pt.code = p.type
           LEFT JOIN users creator ON creator.id = p.preliminary_created_by
           WHERE ${where}
           ORDER BY p.created_at DESC NULLS LAST, p.updated_at DESC NULLS LAST, p.id DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        ),
        query(`SELECT COUNT(*)::int AS total FROM products p WHERE ${where}`, countParams),
      ]);
      const total = countResult.rows[0]?.total || 0;
      return res.json({
        items: itemsResult.rows,
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      });
    }

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
       ,creator.name AS preliminary_created_by_name,EXISTS(SELECT 1 FROM product_images image WHERE image.product_id=p.id) AS has_photo
       FROM products p
       LEFT JOIN sectors s ON s.id = p.sector_id
       LEFT JOIN product_types pt ON pt.code = p.type
       LEFT JOIN users creator ON creator.id=p.preliminary_created_by
       WHERE COALESCE(p.is_active, TRUE) = TRUE
       ORDER BY p.name`,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function searchProducts(req, res, next) {
  try {
    const includeSpareParts = String(req.query.include_spare_parts || 'false') === 'true';
    const componentCandidates = String(req.query.component_candidates || 'false') === 'true';
    const search = String(req.query.q || '').trim();
    const explicitTypes = req.query.type ? String(req.query.type).split(',').filter(Boolean) : null;
    const params = [];
    const filters = ['p.is_active = TRUE'];

    if (explicitTypes) {
      params.push(explicitTypes);
      filters.push(`p.type = ANY($${params.length})`);
    } else if (!includeSpareParts && !componentCandidates) {
      filters.push("p.type <> 'material_prima'");
    }

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(p.name ILIKE $${params.length} OR p.internal_code ILIKE $${params.length} OR pt.name ILIKE $${params.length})`);
    }

    const result = await query(
      `SELECT p.*,
        s.name AS sector_name,
        EXISTS(SELECT 1 FROM product_images image WHERE image.product_id=p.id) AS has_photo,
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
        EXISTS(SELECT 1 FROM product_images image WHERE image.product_id=p.id) AS has_photo,
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
      `SELECT pc.*, s.name AS sector_name, mp.name AS material_product_name,
        mp.type AS material_product_type, mp.is_active AS material_product_is_active,
        mpt.name AS material_product_type_name
       FROM product_components pc
       LEFT JOIN sectors s ON s.id = pc.sector_id
       LEFT JOIN products mp ON mp.id = pc.material_product_id
       LEFT JOIN product_types mpt ON mpt.code = mp.type
       WHERE product_id = $1 ORDER BY pc.created_at`,
      [req.params.id],
    );
    const manufacturingSteps = await getProductManufacturingSteps({ query }, req.params.id);
    res.json({ ...product.rows[0], components: components.rows, manufacturing_steps: manufacturingSteps });
  } catch (error) { next(error); }
}

async function validateProductComponents(client, productId, components, existingComponents) {
  const existingById = new Map(existingComponents.map((component) => [component.id, component]));
  const seenComponentIds = new Set();
  const seenProductIds = new Set();
  const newTargetIds = [];

  for (const component of components) {
    if (!String(component.component_name || '').trim()) throw httpError(400, 'Informe o nome do componente.');
    if (!component.sector_id) throw httpError(400, 'Informe o setor responsável do componente.');
    if (!Number.isInteger(Number(component.quantity)) || Number(component.quantity) < 1) {
      throw httpError(400, 'A quantidade do componente deve ser maior que zero.', { code: 'PRODUCT_COMPONENT_QUANTITY_INVALID', field: 'quantity' });
    }

    const sector = await client.query('SELECT id FROM sectors WHERE id = $1 AND is_active = TRUE', [component.sector_id]);
    if (!sector.rows[0]) throw httpError(400, 'Setor responsável inválido.');

    let existing = null;
    if (component.id) {
      if (seenComponentIds.has(component.id)) {
        throw httpError(409, 'A relação de componente está duplicada.', { code: 'PRODUCT_COMPONENT_DUPLICATE' });
      }
      seenComponentIds.add(component.id);
      existing = existingById.get(component.id);
      if (!existing) throw httpError(400, 'Relação de componente inválida.', { code: 'PRODUCT_COMPONENT_RELATION_INVALID' });
    }

    if (!component.material_product_id) continue;
    if (productId && component.material_product_id === productId) {
      throw httpError(409, 'Um Produto não pode ser componente dele mesmo.', { code: 'PRODUCT_COMPONENT_SELF_REFERENCE' });
    }
    if (seenProductIds.has(component.material_product_id)) {
      throw httpError(409, 'Este Produto já foi adicionado como componente.', { code: 'PRODUCT_COMPONENT_DUPLICATE' });
    }
    seenProductIds.add(component.material_product_id);

    const target = (await client.query(
      'SELECT id, type, sector_id, is_active FROM products WHERE id = $1',
      [component.material_product_id],
    )).rows[0];
    if (!target) throw httpError(400, 'Produto componente inválido.', { code: 'PRODUCT_COMPONENT_INVALID', field: 'material_product_id' });

    const unchangedHistoricalRelation = existing?.material_product_id === target.id;
    if (target.is_active !== true && !unchangedHistoricalRelation) {
      throw httpError(400, 'Somente Produtos ativos podem ser adicionados como componentes.', { code: 'PRODUCT_COMPONENT_INACTIVE', field: 'material_product_id' });
    }
    if (!target.sector_id) {
      throw httpError(400, 'O Produto selecionado não possui setor responsável cadastrado. Edite o Produto antes de adicioná-lo como componente.', {
        code: 'PRODUCT_COMPONENT_WITHOUT_SECTOR',
        field: 'material_product_id',
      });
    }
    if (!unchangedHistoricalRelation) newTargetIds.push(target.id);
  }

  if (productId && newTargetIds.length) {
    const circular = await client.query(
      `WITH RECURSIVE descendants(id, path) AS (
         SELECT candidate_id, ARRAY[candidate_id]
         FROM unnest($1::uuid[]) AS candidate_id
         UNION ALL
         SELECT pc.material_product_id, descendants.path || pc.material_product_id
         FROM descendants
         JOIN product_components pc ON pc.product_id = descendants.id
         WHERE pc.material_product_id IS NOT NULL
           AND NOT pc.material_product_id = ANY(descendants.path)
       )
       SELECT 1 FROM descendants WHERE id = $2 LIMIT 1`,
      [newTargetIds, productId],
    );
    if (circular.rows[0]) {
      throw httpError(409, 'A relação criaria uma dependência circular entre Produtos.', { code: 'PRODUCT_COMPONENT_CYCLE' });
    }
  }
}

async function syncProductComponents(client, productId, components, existingComponents) {
  const existingById = new Map(existingComponents.map((component) => [component.id, component]));
  const keptIds = [];
  for (const component of components) {
    const values = [
      component.material_product_id || null,
      String(component.component_name).trim(),
      component.sector_id,
      Number(component.quantity),
      component.is_required ?? true,
    ];
    if (component.id && existingById.has(component.id)) {
      await client.query(
        `UPDATE product_components
         SET material_product_id=$1, component_name=$2, sector_id=$3, quantity=$4, is_required=$5, updated_at=NOW()
         WHERE id=$6 AND product_id=$7`,
        [...values, component.id, productId],
      );
      keptIds.push(component.id);
    } else {
      const inserted = await client.query(
        `INSERT INTO product_components (product_id, material_product_id, component_name, sector_id, quantity, is_required)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [productId, ...values],
      );
      keptIds.push(inserted.rows[0].id);
    }
  }
  if (existingComponents.length) {
    await client.query(
      'DELETE FROM product_components WHERE product_id=$1 AND NOT (id = ANY($2::uuid[]))',
      [productId, keptIds],
    );
  }
}

export async function saveProduct(req, res, next) {
  try {
    const result = await transaction(async (client) => {
      const measurementUnitCode = await normalizeMeasurementUnitCode(req.body.measurement_unit_code, client);
      const typeResult = await client.query('SELECT * FROM product_types WHERE code = $1 AND is_active = TRUE', [req.body.type]);
      if (!typeResult.rows[0]) throw httpError(400, 'Tipo de produto inválido ou inativo.', { code: 'PRODUCT_TYPE_NOT_FOUND', field: 'type' });

      const sectorId = req.body.sector_id || null;
      if (!sectorId) throw httpError(400, 'Informe o setor responsável do produto.');
      const sector = await client.query('SELECT id FROM sectors WHERE id = $1 AND is_active = TRUE', [sectorId]);
      if (!sector.rows[0]) throw httpError(400, 'Setor responsável inválido.');

      const previous=req.params.id?(await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0]:null;
      if (req.params.id && !previous) throw httpError(404, 'Produto não encontrado.');
      const existingManufacturingSteps = req.params.id
        ? (await client.query('SELECT id FROM product_manufacturing_steps WHERE product_id=$1 FOR UPDATE', [req.params.id])).rows
        : [];
      if (req.body.type === 'resale' && previous?.type !== 'resale' && existingManufacturingSteps.length) {
        throw httpError(409, 'Remova e salve o roteiro de fabricação antes de alterar o tipo para Revenda.', {
          code: 'PRODUCT_RESALE_HAS_MANUFACTURING_ROUTE',
          field: 'type',
        });
      }
      if (!previous && req.body.type === 'resale' && Array.isArray(req.body.manufacturing_steps) && req.body.manufacturing_steps.length) {
        throw httpError(400, 'Produto de Revenda não aceita roteiro de fabricação no cadastro normal.', {
          code: 'PRODUCT_RESALE_MANUFACTURING_ROUTE_NOT_ALLOWED',
          field: 'manufacturing_steps',
        });
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext('product_components_graph'))");
      const existingComponents = req.params.id
        ? (await client.query('SELECT * FROM product_components WHERE product_id=$1 FOR UPDATE', [req.params.id])).rows
        : [];
      const components = Array.isArray(req.body.components)
        ? req.body.components
        : existingComponents;
      await validateProductComponents(client, req.params.id || null, components, existingComponents);
      const reviewStatus=previous?.review_status==='pending_review'&&req.body.review_status!=='approved'?'pending_review':'approved';
      const product = req.params.id
        ? await client.query(
          `UPDATE products SET name = $1, type = $2, sector_id = $3, default_volume_quantity = $4, default_total_weight_kg = $5, is_active = $6, measurement_unit_code=$7,review_status=$8::varchar(30),reviewed_by=CASE WHEN review_status='pending_review' AND $8::varchar(30)='approved' THEN $9 ELSE reviewed_by END,reviewed_at=CASE WHEN review_status='pending_review' AND $8::varchar(30)='approved' THEN NOW() ELSE reviewed_at END,updated_at = NOW()
           WHERE id = $10 RETURNING *`,
          [req.body.name, req.body.type, sectorId, req.body.default_volume_quantity, req.body.default_total_weight_kg, req.body.is_active ?? true,measurementUnitCode,reviewStatus,req.user?.id,req.params.id],
        )
        : await client.query(
          `INSERT INTO products (name, type, sector_id, default_volume_quantity, default_total_weight_kg,measurement_unit_code,review_status,creation_origin)
           VALUES ($1, $2, $3, $4, $5,$6,'approved','manual') RETURNING *`,
          [req.body.name, req.body.type, sectorId, req.body.default_volume_quantity, req.body.default_total_weight_kg,measurementUnitCode],
        );
      if (!product.rows[0]) throw httpError(404, 'Produto não encontrado.');
      await syncProductComponents(client, product.rows[0].id, components, existingComponents);
      if (req.body.type !== 'resale' && Array.isArray(req.body.manufacturing_steps)) {
        await saveProductManufacturingSteps(client, product.rows[0].id, req.body.manufacturing_steps);
      }
      await logAudit(client, { entityType: 'product', entityId: product.rows[0].id, action: previous?.review_status==='pending_review'&&reviewStatus==='approved'?'preliminary_reviewed':req.params.id?'update':'create', previousValue:previous, newValue: product.rows[0], userId: req.user?.id });
      if(previous&&previous.measurement_unit_code!==measurementUnitCode)await logAudit(client,{entityType:'product',entityId:product.rows[0].id,action:'measurement_unit_changed',previousValue:{measurement_unit_code:previous.measurement_unit_code},newValue:{measurement_unit_code:measurementUnitCode},userId:req.user?.id});
      return product.rows[0];
    });
    res.status(req.params.id ? 200 : 201).json(req.params.id ? result : {
      ...result,
      photo_upload_token: createProductImageUploadToken(result.id, req.user),
    });
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
