import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value, maxLength, field) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (maxLength && text.length > maxLength) {
    throw httpError(400, `O campo ${field} excede ${maxLength} caracteres.`, { field });
  }
  return text;
}

export function normalizeCustomerName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeCustomerDocument(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

function hasRepeatedDigits(value) {
  return /^(\d)\1+$/.test(value);
}

export function isValidCpf(value) {
  const digits = normalizeCustomerDocument(value);
  if (!digits || digits.length !== 11 || hasRepeatedDigits(digits)) return false;
  const checkDigit = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return checkDigit(9) === Number(digits[9]) && checkDigit(10) === Number(digits[10]);
}

export function isValidCnpj(value) {
  const digits = normalizeCustomerDocument(value);
  if (!digits || digits.length !== 14 || hasRepeatedDigits(digits)) return false;
  const calculate = (length) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(digits[12]) && calculate(13) === Number(digits[13]);
}

export function buildCustomerPayload(body) {
  const name = cleanText(body.name, 180, 'name');
  if (!name) throw httpError(400, 'Informe a razão social ou o nome do cliente.', { field: 'name' });

  const personType = cleanText(body.person_type, 20, 'person_type');
  if (personType && !['individual', 'legal'].includes(personType)) {
    throw httpError(400, 'Tipo de pessoa inválido.', { field: 'person_type' });
  }

  const taxId = normalizeCustomerDocument(body.tax_id);
  if (taxId) {
    const valid = personType === 'individual' ? isValidCpf(taxId) : personType === 'legal' ? isValidCnpj(taxId) : false;
    if (!valid) {
      throw httpError(400, personType ? 'CPF/CNPJ inválido.' : 'Informe PF ou PJ para validar o CPF/CNPJ.', { field: 'tax_id' });
    }
  }

  const email = cleanText(body.email, 180, 'email')?.toLowerCase() || null;
  if (email && !emailPattern.test(email)) throw httpError(400, 'E-mail inválido.', { field: 'email' });

  const zipCode = normalizeCustomerDocument(body.zip_code);
  if (zipCode && zipCode.length !== 8) throw httpError(400, 'CEP inválido.', { field: 'zip_code' });

  const state = cleanText(body.state, 2, 'state')?.toUpperCase() || null;
  if (state && !/^[A-Z]{2}$/.test(state)) throw httpError(400, 'UF inválida.', { field: 'state' });

  return {
    name,
    normalized_name: normalizeCustomerName(name),
    person_type: personType,
    trade_name: cleanText(body.trade_name, 180, 'trade_name'),
    tax_id: taxId,
    phone: cleanText(body.phone, 20, 'phone'),
    whatsapp: cleanText(body.whatsapp, 20, 'whatsapp'),
    email,
    zip_code: zipCode,
    address: cleanText(body.address, 180, 'address'),
    address_number: cleanText(body.address_number, 30, 'address_number'),
    complement: cleanText(body.complement, 120, 'complement'),
    neighborhood: cleanText(body.neighborhood, 120, 'neighborhood'),
    city: cleanText(body.city, 120, 'city'),
    state,
    notes: cleanText(body.notes, null, 'notes'),
  };
}

function assertUuid(id) {
  if (!uuidPattern.test(id || '')) throw httpError(400, 'Cliente inválido.', { field: 'id' });
}

async function findCustomer(client, id) {
  assertUuid(id);
  const result = await client.query(
    `SELECT c.*,
      (SELECT COUNT(*)::int FROM internal_orders io WHERE io.customer_id = c.id) AS production_order_count
     FROM customers c
     WHERE c.id = $1`,
    [id],
  );
  if (!result.rows[0]) throw httpError(404, 'Cliente não encontrado.');
  return result.rows[0];
}

async function assertCustomerIdentityAvailable(client, payload, currentId = null) {
  const nameParams = currentId ? [payload.normalized_name, currentId] : [payload.normalized_name];
  const nameResult = await client.query(
    `SELECT id FROM customers WHERE normalized_name = $1${currentId ? ' AND id <> $2' : ''} LIMIT 1`,
    nameParams,
  );
  if (nameResult.rows[0]) {
    throw httpError(409, 'Já existe um cliente com este nome. Abra o cadastro existente para evitar duplicidade.', {
      code: 'CUSTOMER_NAME_ALREADY_EXISTS', field: 'name', details: { customer_id: nameResult.rows[0].id },
    });
  }

  if (!payload.tax_id) return;
  const taxParams = currentId ? [payload.tax_id, currentId] : [payload.tax_id];
  const taxResult = await client.query(
    `SELECT id FROM customers WHERE tax_id = $1${currentId ? ' AND id <> $2' : ''} LIMIT 1`,
    taxParams,
  );
  if (taxResult.rows[0]) {
    throw httpError(409, 'Já existe um cliente com este CPF/CNPJ.', {
      code: 'CUSTOMER_TAX_ID_ALREADY_EXISTS', field: 'tax_id', details: { customer_id: taxResult.rows[0].id },
    });
  }
}

export async function listCustomers({ search, status, page, limit }) {
  return transaction(async (client) => {
    const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
    const filters = [];
    const params = [];

    if (search) {
      const normalizedSearch = normalizeCustomerName(search);
      const documentSearch = normalizeCustomerDocument(search) || '';
      params.push(`%${normalizedSearch}%`);
      const textParameter = params.length;
      const predicates = [
        `c.normalized_name LIKE $${textParameter}`,
        `LOWER(COALESCE(c.trade_name, '')) LIKE $${textParameter}`,
        `LOWER(COALESCE(c.email, '')) LIKE $${textParameter}`,
        `LOWER(COALESCE(c.city, c.location, '')) LIKE $${textParameter}`,
      ];
      if (documentSearch) {
        params.push(`%${documentSearch}%`);
        predicates.push(`COALESCE(c.tax_id, '') LIKE $${params.length}`);
      }
      filters.push(`(${predicates.join(' OR ')})`);
    }
    if (status === 'active' || status === 'inactive') {
      params.push(status === 'active');
      filters.push(`c.is_active = $${params.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await client.query(`SELECT COUNT(*)::int AS total FROM customers c ${where}`, params);
    params.push(pageSize, (currentPage - 1) * pageSize);
    const result = await client.query(
      `SELECT c.id, c.name, c.trade_name, c.person_type, c.tax_id, c.phone, c.whatsapp,
        c.email, c.city, c.state, c.is_active, c.created_at, c.updated_at,
        (SELECT COUNT(*)::int FROM internal_orders io WHERE io.customer_id = c.id) AS production_order_count
       FROM customers c
       ${where}
       ORDER BY c.is_active DESC, c.name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const total = countResult.rows[0].total;
    return {
      items: result.rows,
      pagination: { page: currentPage, limit: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  });
}

export async function getCustomer(id) {
  return transaction((client) => findCustomer(client, id));
}

export async function createCustomer(body, userId) {
  return transaction(async (client) => {
    const payload = buildCustomerPayload(body);
    await assertCustomerIdentityAvailable(client, payload);
    const result = await client.query(
      `INSERT INTO customers (
        name, normalized_name, person_type, trade_name, tax_id, phone, whatsapp, email,
        zip_code, address, address_number, complement, neighborhood, city, state, notes,
        location, destination_uf, is_active
       ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $14, $15, TRUE
       ) RETURNING *`,
      Object.values(payload),
    );
    const customer = result.rows[0];
    await logAudit(client, {
      entityType: 'customer', entityId: customer.id, action: 'commercial_create', newValue: customer, userId,
    });
    return customer;
  });
}

export async function updateCustomer(id, body, userId) {
  return transaction(async (client) => {
    const current = await findCustomer(client, id);
    const payload = buildCustomerPayload(body);
    await assertCustomerIdentityAvailable(client, payload, id);
    const result = await client.query(
      `UPDATE customers
       SET name = $1,
        normalized_name = $2,
        person_type = $3,
        trade_name = $4,
        tax_id = $5,
        phone = $6,
        whatsapp = $7,
        email = $8,
        zip_code = $9,
        address = $10,
        address_number = $11,
        complement = $12,
        neighborhood = $13,
        city = $14,
        state = $15,
        notes = $16,
        location = COALESCE($14, location),
        destination_uf = COALESCE($15, destination_uf),
        updated_at = NOW()
       WHERE id = $17
       RETURNING *`,
      [...Object.values(payload), id],
    );
    const customer = result.rows[0];
    await logAudit(client, {
      entityType: 'customer', entityId: id, action: 'commercial_update', previousValue: current, newValue: customer, userId,
    });
    return customer;
  });
}

export async function setCustomerActive(id, isActive, userId) {
  if (typeof isActive !== 'boolean') throw httpError(400, 'Informe o estado ativo do cliente.', { field: 'is_active' });
  return transaction(async (client) => {
    const current = await findCustomer(client, id);
    if (current.is_active === isActive) return current;
    const result = await client.query(
      'UPDATE customers SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [isActive, id],
    );
    await logAudit(client, {
      entityType: 'customer', entityId: id, action: isActive ? 'commercial_activate' : 'commercial_deactivate',
      previousValue: { is_active: current.is_active }, newValue: { is_active: isActive }, userId,
    });
    return result.rows[0];
  });
}
