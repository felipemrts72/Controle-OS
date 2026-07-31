import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalizedNameSql = "lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))";

function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw httpError(400, 'Informe um nome de setor com pelo menos 2 caracteres.', { field: 'name' });
  if (name.length > 100) throw httpError(400, 'O nome do setor deve ter no máximo 100 caracteres.', { field: 'name' });
  return name;
}

function slugBase(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'setor';
}

function validateId(id) {
  if (!uuidPattern.test(String(id || ''))) throw httpError(400, 'Setor inválido.', { field: 'id' });
  return id;
}

async function fetchSector(client, id, { lock = false } = {}) {
  validateId(id);
  const result = await client.query(`SELECT * FROM sectors WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!result.rows[0]) throw httpError(404, 'Setor não encontrado.');
  return result.rows[0];
}

async function assertUniqueName(client, name, exceptId = null) {
  const params = [name];
  let except = '';
  if (exceptId) {
    params.push(exceptId);
    except = `AND id <> $${params.length}`;
  }
  const result = await client.query(
    `SELECT id FROM sectors
     WHERE ${normalizedNameSql} = lower(regexp_replace(btrim($1), '[[:space:]]+', ' ', 'g'))
       ${except}
     LIMIT 1`,
    params,
  );
  if (result.rows[0]) throw httpError(409, 'Já existe um setor com este nome.', { code: 'SECTOR_NAME_ALREADY_EXISTS', field: 'name' });
}

async function createAvailableSlug(client, name) {
  const base = slugBase(name);
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base.slice(0, 75)}-${suffix}`;
    const existing = await client.query('SELECT id FROM sectors WHERE slug = $1', [candidate]);
    if (!existing.rows[0]) return candidate;
  }
  throw httpError(409, 'Não foi possível gerar um identificador único para o setor.');
}

export async function listSectors(search = '') {
  return transaction(async (client) => {
    const term = String(search || '').trim().replace(/\s+/g, ' ');
    const params = [];
    const where = [];
    if (term) {
      params.push(`%${term}%`);
      where.push(`s.name ILIKE $${params.length}`);
    }
    const result = await client.query(
      `SELECT s.*,
        COUNT(e.id) FILTER (WHERE e.deleted_at IS NULL)::int AS employee_count
       FROM sectors s
       LEFT JOIN employees e ON e.sector_id = s.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY s.id
       ORDER BY s.is_active DESC, s.name`,
      params,
    );
    return result.rows;
  });
}

export async function createSector(body, user) {
  return transaction(async (client) => {
    const name = normalizeName(body.name);
    await assertUniqueName(client, name);
    const slug = await createAvailableSlug(client, name);
    const result = await client.query(
      'INSERT INTO sectors (name, slug, is_active) VALUES ($1, $2, TRUE) RETURNING *',
      [name, slug],
    );
    const sector = result.rows[0];
    await logAudit(client, {
      entityType: 'sector', entityId: sector.id, action: 'create',
      newValue: { name: sector.name, slug: sector.slug, is_active: sector.is_active }, userId: user.id,
    });
    return { ...sector, employee_count: 0 };
  });
}

export async function updateSector(id, body, user) {
  return transaction(async (client) => {
    const current = await fetchSector(client, id, { lock: true });
    const name = normalizeName(body.name);
    await assertUniqueName(client, name, id);
    const result = await client.query(
      'UPDATE sectors SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [name, id],
    );
    const sector = result.rows[0];
    await logAudit(client, {
      entityType: 'sector', entityId: id, action: 'update',
      previousValue: { name: current.name, slug: current.slug, is_active: current.is_active },
      newValue: { name: sector.name, slug: sector.slug, is_active: sector.is_active }, userId: user.id,
    });
    return sector;
  });
}

export async function setSectorActive(id, isActive, user) {
  return transaction(async (client) => {
    const current = await fetchSector(client, id, { lock: true });
    if (current.is_active === isActive) return current;
    const result = await client.query(
      'UPDATE sectors SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [isActive, id],
    );
    const sector = result.rows[0];
    await logAudit(client, {
      entityType: 'sector', entityId: id, action: isActive ? 'reactivate' : 'deactivate',
      previousValue: { name: current.name, is_active: current.is_active },
      newValue: { name: sector.name, is_active: sector.is_active }, userId: user.id,
    });
    return sector;
  });
}
