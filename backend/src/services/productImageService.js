import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { query, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';
import { hasPermission } from './permissionService.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const uploadRoot = path.resolve(process.env.PRODUCT_IMAGE_UPLOAD_DIR || path.join(projectRoot, 'uploads', 'products'));
const maxBytes = Number(process.env.PRODUCT_IMAGE_MAX_BYTES || 5 * 1024 * 1024);
const allowed = new Set(['image/png', 'image/jpeg']);

function resolveStoredPath(storedName) {
  if (!storedName || path.basename(storedName) !== storedName || storedName.includes('..')) {
    throw httpError(400, 'Caminho de foto inválido.');
  }
  const fullPath = path.resolve(uploadRoot, storedName);
  const relative = path.relative(uploadRoot, fullPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw httpError(400, 'Caminho de foto inválido.');
  }
  return fullPath;
}

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function restoreFile(filePath, contents) {
  if (!contents) return;
  await fs.mkdir(uploadRoot, { recursive: true });
  await fs.writeFile(filePath, contents, { mode: 0o600 });
}

export function canManageProductImage(product, user) {
  if (!product || !user) return false;
  if (user.is_super_admin || hasPermission(user, 'products.edit')) return true;
  return product.creation_origin === 'purchases'
    && product.review_status === 'pending_review'
    && String(product.preliminary_created_by || '') === String(user.id || '')
    && hasPermission(user, 'purchase_imports.create_product');
}

export function createProductImageUploadToken(productId, user) {
  return jwt.sign(
    { product_id: String(productId), user_id: String(user.id), scope: 'product-image:create' },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: '15m' },
  );
}

export function canUploadInitialProductImage(product, user, token) {
  if (!product || product.creation_origin !== 'manual' || !user || !token || !hasPermission(user, 'products.create')) return false;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    return payload.scope === 'product-image:create'
      && String(payload.product_id) === String(product.id)
      && String(payload.user_id) === String(user.id);
  } catch {
    return false;
  }
}

export function getProductImageAuditAction(hasPreviousImage) {
  return hasPreviousImage ? 'preliminary_photo_replaced' : 'preliminary_photo_added';
}

export function validateProductImage(buffer, mimeType, originalName) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw httpError(400, 'Selecione uma foto do Produto.');
  if (buffer.length > maxBytes) throw httpError(400, 'A foto está acima do limite de 5 MB.');
  if (!allowed.has(mimeType)) throw httpError(400, 'Formato não permitido. Use PNG ou JPEG.');

  const name = String(originalName || '').trim();
  if (!name || name !== path.basename(name) || /[\\/]/.test(name) || name.includes('..')) {
    throw httpError(400, 'Nome de arquivo inválido.');
  }
  const extension = path.extname(name).toLowerCase();
  if (mimeType === 'image/png' && extension !== '.png') throw httpError(400, 'A extensão não corresponde ao formato PNG.');
  if (mimeType === 'image/jpeg' && !['.jpg', '.jpeg'].includes(extension)) throw httpError(400, 'A extensão não corresponde ao formato JPEG.');
  if (mimeType === 'image/png' && buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw httpError(400, 'Arquivo PNG inválido.');
  if (mimeType === 'image/jpeg' && !(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) throw httpError(400, 'Arquivo JPEG inválido.');
}

async function getActiveProduct(productId) {
  const product = (await query(
    `SELECT id, review_status, creation_origin, preliminary_created_by
     FROM products
     WHERE id = $1 AND is_active = TRUE`,
    [productId],
  )).rows[0];
  if (!product) throw httpError(404, 'Produto não encontrado.');
  return product;
}

function assertCanManage(product, user, creationToken) {
  if (canManageProductImage(product, user) || canUploadInitialProductImage(product, user, creationToken)) return;
  if (product.review_status !== 'pending_review' && hasPermission(user, 'purchase_imports.create_product')) {
    throw httpError(403, 'Após a revisão, a foto só pode ser alterada por quem possui permissão para editar Produtos.');
  }
  throw httpError(403, 'Você não possui permissão para alterar a foto deste Produto.');
}

export async function saveProductImage(productId, { originalName, mimeType, creationToken }, buffer, user) {
  validateProductImage(buffer, mimeType, originalName);
  const product = await getActiveProduct(productId);
  assertCanManage(product, user, creationToken);
  const hasGeneralEditAccess = canManageProductImage(product, user);

  const extension = mimeType === 'image/png' ? '.png' : '.jpg';
  const storedName = `product-${productId}-${randomUUID()}${extension}`;
  await fs.mkdir(uploadRoot, { recursive: true });
  const fullPath = resolveStoredPath(storedName);
  await fs.writeFile(fullPath, buffer, { mode: 0o600, flag: 'wx' });

  let previous = null;
  let previousPath = null;
  let previousContents = null;
  try {
    await transaction(async (client) => {
      previous = (await client.query(
        'SELECT * FROM product_images WHERE product_id = $1 FOR UPDATE',
        [productId],
      )).rows[0] || null;
      if (previous && !hasGeneralEditAccess) {
        throw httpError(403, 'A autorização de criação permite somente o envio da foto inicial. Para substituir, é necessário editar Produtos.');
      }
      if (previous?.stored_name) {
        previousPath = resolveStoredPath(previous.stored_name);
        previousContents = await readIfExists(previousPath);
      }

      await client.query(
        `INSERT INTO product_images(product_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
         VALUES($1, $2, $3, $4, $5, $6)
         ON CONFLICT(product_id) DO UPDATE SET
           original_name = EXCLUDED.original_name,
           stored_name = EXCLUDED.stored_name,
           mime_type = EXCLUDED.mime_type,
           size_bytes = EXCLUDED.size_bytes,
           uploaded_by = EXCLUDED.uploaded_by,
           updated_at = NOW()`,
        [productId, originalName, storedName, mimeType, buffer.length, user.id],
      );
      await logAudit(client, {
        entityType: 'product',
        entityId: productId,
        action: getProductImageAuditAction(Boolean(previous)),
        previousValue: previous ? { has_photo: true, mime_type: previous.mime_type, size_bytes: previous.size_bytes } : { has_photo: false },
        newValue: { has_photo: true, mime_type: mimeType, size_bytes: buffer.length },
        userId: user.id,
      });
      if (previousPath) await unlinkIfExists(previousPath);
    });
  } catch (error) {
    await unlinkIfExists(fullPath).catch(() => {});
    if (previousPath && previousContents) await restoreFile(previousPath, previousContents);
    throw error;
  }

  return {
    product_id: productId,
    has_photo: true,
    mime_type: mimeType,
    size_bytes: buffer.length,
    action: getProductImageAuditAction(Boolean(previous)),
  };
}

export async function removeProductImage(productId, user) {
  const product = await getActiveProduct(productId);
  assertCanManage(product, user);

  let previous = null;
  let previousPath = null;
  let previousContents = null;
  try {
    await transaction(async (client) => {
      previous = (await client.query(
        'SELECT * FROM product_images WHERE product_id = $1 FOR UPDATE',
        [productId],
      )).rows[0] || null;
      if (!previous) throw httpError(404, 'Foto do Produto não encontrada.');

      previousPath = resolveStoredPath(previous.stored_name);
      previousContents = await readIfExists(previousPath);
      await client.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
      await logAudit(client, {
        entityType: 'product',
        entityId: productId,
        action: 'preliminary_photo_removed',
        previousValue: { has_photo: true, mime_type: previous.mime_type, size_bytes: previous.size_bytes },
        newValue: { has_photo: false },
        userId: user.id,
      });
      await unlinkIfExists(previousPath);
    });
  } catch (error) {
    if (previousPath && previousContents) await restoreFile(previousPath, previousContents);
    throw error;
  }

  return { product_id: productId, has_photo: false, action: 'preliminary_photo_removed' };
}

export async function getProductImage(productId) {
  const row = (await query(
    'SELECT stored_name, mime_type, size_bytes FROM product_images WHERE product_id = $1',
    [productId],
  )).rows[0];
  if (!row) throw httpError(404, 'Foto do Produto não encontrada.');
  return {
    buffer: await fs.readFile(resolveStoredPath(row.stored_name)),
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  };
}
