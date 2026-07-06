import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction } from '../database/pool.js';
import { logAudit } from './auditService.js';
import { hasPermission } from './permissionService.js';
import { httpError } from '../utils/httpError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');
const uploadRoot = path.resolve(process.env.EMPLOYEE_UPLOAD_DIR || path.join(projectRoot, 'uploads', 'employees'));
const maxUploadBytes = Number(process.env.EMPLOYEE_DOCUMENT_MAX_BYTES || 10 * 1024 * 1024);
const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const employeeFields = [
  'full_name', 'birth_date', 'cpf', 'rg', 'rg_issuer', 'rg_state', 'rg_issue_date', 'phone', 'alternate_phone',
  'email', 'marital_status', 'spouse_name', 'zip_code', 'street', 'address_number', 'complement', 'neighborhood',
  'city', 'state', 'admission_date', 'job_title', 'current_salary', 'meal_allowance', 'employment_status', 'notes',
  'ctps_number', 'ctps_series', 'ctps_state', 'pis_pasep', 'voter_registration', 'voter_zone', 'voter_section',
  'military_certificate', 'registration_type', 'profile_completed',
];

const quickRequired = ['full_name', 'cpf', 'zip_code', 'street', 'address_number', 'neighborhood', 'city', 'state', 'current_salary'];

export function normalizeCpf(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function moneyOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(String(value).replace(',', '.'));
  if (Number.isNaN(number)) throw httpError(400, 'Valor monetário inválido.');
  return number;
}

function cleanText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function buildEmployeePayload(body, { quick = false } = {}) {
  const payload = {};
  for (const field of employeeFields) {
    if (!(field in body)) continue;
    payload[field] = field === 'cpf'
      ? normalizeCpf(body[field])
      : ['current_salary', 'meal_allowance'].includes(field)
        ? moneyOrNull(body[field])
        : cleanText(body[field]);
  }

  if ('full_name' in payload && !payload.full_name) throw httpError(400, 'Informe o nome completo.');
  if ('cpf' in payload && payload.cpf && payload.cpf.length !== 11) throw httpError(400, 'CPF inválido.');
  if (payload.full_name) payload.normalized_name = normalizeName(payload.full_name);
  if (quick) {
    payload.registration_type = 'quick';
    payload.profile_completed = false;
    for (const field of quickRequired) {
      if (!payload[field]) throw httpError(400, 'Preencha nome, CPF, endereço e salário para o cadastro rápido.');
    }
    if (!payload.ctps_number && !payload.ctps_series && !payload.ctps_state) {
      throw httpError(400, 'Informe ao menos um dado da Carteira de Trabalho.');
    }
  }
  return payload;
}

function can(user, permission, manageFallback = false) {
  return hasPermission(user, permission) || (manageFallback && hasPermission(user, 'employees.manage'));
}

function redactEmployee(row, user) {
  if (!row) return row;
  const result = { ...row };
  if (!can(user, 'employees.salary.view')) result.current_salary = null;
  if (!can(user, 'employees.meal_allowance.view')) result.meal_allowance = null;
  return result;
}

async function fetchEmployee(client, id) {
  const result = await client.query('SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!result.rows[0]) throw httpError(404, 'Funcionário não encontrado.');
  return result.rows[0];
}

async function insertHistoryOnCreate(client, employee, userId) {
  if (employee.current_salary !== null && employee.current_salary !== undefined) {
    await client.query(
      `INSERT INTO employee_salary_history (employee_id, salary, effective_from, previous_salary, reason, created_by)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), NULL, $4, $5)`,
      [employee.id, employee.current_salary, employee.admission_date, 'Salário inicial', userId],
    );
  }
  if (employee.meal_allowance !== null && employee.meal_allowance !== undefined) {
    await client.query(
      `INSERT INTO employee_meal_allowance_history (employee_id, previous_amount, new_amount, effective_from, reason, created_by)
       VALUES ($1, NULL, $2, COALESCE($3, CURRENT_DATE), $4, $5)`,
      [employee.id, employee.meal_allowance, employee.admission_date, 'Vale alimentação inicial', userId],
    );
  }
}

export async function listEmployees({ user, query }) {
  return transaction(async (client) => {
    const params = [];
    const filters = ['deleted_at IS NULL'];
    if (query.search) {
      params.push(`%${normalizeName(query.search)}%`);
      filters.push(`normalized_name ILIKE $${params.length}`);
    }
    if (query.cpf) {
      params.push(`%${normalizeCpf(query.cpf) || ''}%`);
      filters.push(`cpf LIKE $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      filters.push(`employment_status = $${params.length}`);
    }
    if (query.job_title) {
      params.push(query.job_title);
      filters.push(`job_title = $${params.length}`);
    }
    const result = await client.query(
      `SELECT id, full_name, cpf, job_title, admission_date, employment_status, registration_type, profile_completed,
        current_salary, meal_allowance, created_at
       FROM employees
       WHERE ${filters.join(' AND ')}
       ORDER BY full_name`,
      params,
    );
    return result.rows.map((row) => redactEmployee(row, user));
  });
}

export async function getEmployee(id, user) {
  return transaction(async (client) => redactEmployee(await fetchEmployee(client, id), user));
}

export async function createEmployee(body, user, { quick = false } = {}) {
  return transaction(async (client) => {
    const payload = buildEmployeePayload(body, { quick });
    if (!quick) {
      payload.registration_type = payload.registration_type || 'complete';
      payload.profile_completed = Boolean(payload.profile_completed);
    }
    payload.created_by = user.id;
    payload.updated_by = user.id;
    const columns = Object.keys(payload);
    const values = Object.values(payload);
    const placeholders = values.map((_, index) => `$${index + 1}`);
    const inserted = await client.query(
      `INSERT INTO employees (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})
       RETURNING *`,
      values,
    );
    await insertHistoryOnCreate(client, inserted.rows[0], user.id);
    await logAudit(client, {
      entityType: 'employee',
      entityId: inserted.rows[0].id,
      action: quick ? 'quick_create' : 'create',
      newValue: { id: inserted.rows[0].id, full_name: inserted.rows[0].full_name, registration_type: inserted.rows[0].registration_type },
      userId: user.id,
    });
    return redactEmployee(inserted.rows[0], user);
  });
}

export async function updateEmployee(id, body, user) {
  return transaction(async (client) => {
    const current = await fetchEmployee(client, id);
    const payload = buildEmployeePayload(body);
    delete payload.current_salary;
    delete payload.meal_allowance;
    payload.updated_by = user.id;
    payload.updated_at = new Date();
    if (payload.profile_completed) payload.registration_type = 'complete';
    const columns = Object.keys(payload);
    if (!columns.length) return redactEmployee(current, user);
    const assignments = columns.map((column, index) => `${column} = $${index + 1}`);
    const updated = await client.query(
      `UPDATE employees SET ${assignments.join(', ')} WHERE id = $${columns.length + 1} RETURNING *`,
      [...Object.values(payload), id],
    );
    await logAudit(client, {
      entityType: 'employee',
      entityId: id,
      action: payload.profile_completed && !current.profile_completed ? 'complete_profile' : 'update',
      previousValue: { id, full_name: current.full_name },
      newValue: { id, full_name: updated.rows[0].full_name, profile_completed: updated.rows[0].profile_completed },
      userId: user.id,
    });
    return redactEmployee(updated.rows[0], user);
  });
}

export async function updateEmployeeStatus(id, status, user) {
  if (!['ativo', 'afastado', 'desligado'].includes(status)) throw httpError(400, 'Situação funcional inválida.');
  return transaction(async (client) => {
    const current = await fetchEmployee(client, id);
    const updated = await client.query(
      `UPDATE employees SET employment_status = $1, updated_by = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [status, user.id, id],
    );
    await logAudit(client, {
      entityType: 'employee',
      entityId: id,
      action: 'status_update',
      previousValue: { employment_status: current.employment_status },
      newValue: { employment_status: status },
      userId: user.id,
    });
    return redactEmployee(updated.rows[0], user);
  });
}

export async function updateSalary(id, body, user) {
  const salary = moneyOrNull(body.salary);
  if (salary === null) throw httpError(400, 'Informe o salário.');
  return transaction(async (client) => {
    const current = await fetchEmployee(client, id);
    const updated = await client.query(
      `UPDATE employees SET current_salary = $1, updated_by = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [salary, user.id, id],
    );
    await client.query(
      `INSERT INTO employee_salary_history (employee_id, salary, effective_from, previous_salary, reason, created_by)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6)`,
      [id, salary, body.effective_from || null, current.current_salary, body.reason || null, user.id],
    );
    await logAudit(client, {
      entityType: 'employee',
      entityId: id,
      action: 'salary_update',
      previousValue: { salary: current.current_salary },
      newValue: { salary },
      userId: user.id,
    });
    return redactEmployee(updated.rows[0], user);
  });
}

export async function updateMealAllowance(id, body, user) {
  const amount = moneyOrNull(body.amount);
  if (amount === null) throw httpError(400, 'Informe o valor do vale alimentação.');
  return transaction(async (client) => {
    const current = await fetchEmployee(client, id);
    const updated = await client.query(
      `UPDATE employees SET meal_allowance = $1, updated_by = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [amount, user.id, id],
    );
    await client.query(
      `INSERT INTO employee_meal_allowance_history (employee_id, previous_amount, new_amount, effective_from, reason, created_by)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6)`,
      [id, current.meal_allowance, amount, body.effective_from || null, body.reason || null, user.id],
    );
    await logAudit(client, {
      entityType: 'employee',
      entityId: id,
      action: 'meal_allowance_update',
      previousValue: { meal_allowance: current.meal_allowance },
      newValue: { meal_allowance: amount },
      userId: user.id,
    });
    return redactEmployee(updated.rows[0], user);
  });
}

export async function listSalaryHistory(id) {
  return transaction(async (client) => {
    await fetchEmployee(client, id);
    const result = await client.query('SELECT * FROM employee_salary_history WHERE employee_id = $1 ORDER BY effective_from DESC, created_at DESC', [id]);
    return result.rows;
  });
}

export async function listMealAllowanceHistory(id) {
  return transaction(async (client) => {
    await fetchEmployee(client, id);
    const result = await client.query('SELECT * FROM employee_meal_allowance_history WHERE employee_id = $1 ORDER BY effective_from DESC, created_at DESC', [id]);
    return result.rows;
  });
}

export async function listDependents(id) {
  return transaction(async (client) => {
    await fetchEmployee(client, id);
    const result = await client.query('SELECT * FROM employee_dependents WHERE employee_id = $1 AND is_active = TRUE ORDER BY full_name', [id]);
    return result.rows;
  });
}

export async function saveDependent(employeeId, dependentId, body, user) {
  return transaction(async (client) => {
    await fetchEmployee(client, employeeId);
    const payload = {
      full_name: cleanText(body.full_name),
      birth_date: cleanText(body.birth_date),
      cpf: normalizeCpf(body.cpf),
      relationship: cleanText(body.relationship),
      notes: cleanText(body.notes),
    };
    if (!payload.full_name) throw httpError(400, 'Informe o nome do dependente.');
    const result = dependentId
      ? await client.query(
        `UPDATE employee_dependents SET full_name = $1, birth_date = $2, cpf = $3, relationship = $4, notes = $5, updated_at = NOW()
         WHERE id = $6 AND employee_id = $7 RETURNING *`,
        [payload.full_name, payload.birth_date, payload.cpf, payload.relationship, payload.notes, dependentId, employeeId],
      )
      : await client.query(
        `INSERT INTO employee_dependents (employee_id, full_name, birth_date, cpf, relationship, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [employeeId, payload.full_name, payload.birth_date, payload.cpf, payload.relationship, payload.notes],
      );
    if (!result.rows[0]) throw httpError(404, 'Dependente não encontrado.');
    await logAudit(client, {
      entityType: 'employee',
      entityId: employeeId,
      action: dependentId ? 'dependent_update' : 'dependent_create',
      newValue: { dependent_id: result.rows[0].id, full_name: result.rows[0].full_name },
      userId: user.id,
    });
    return result.rows[0];
  });
}

export async function removeDependent(employeeId, dependentId, user) {
  return transaction(async (client) => {
    await fetchEmployee(client, employeeId);
    const result = await client.query(
      `UPDATE employee_dependents SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND employee_id = $2 RETURNING *`,
      [dependentId, employeeId],
    );
    if (!result.rows[0]) throw httpError(404, 'Dependente não encontrado.');
    await logAudit(client, {
      entityType: 'employee',
      entityId: employeeId,
      action: 'dependent_remove',
      newValue: { dependent_id: dependentId },
      userId: user.id,
    });
  });
}

function assertFile(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'Arquivo obrigatório.');
  if (buffer.length > maxUploadBytes) throw httpError(400, 'Arquivo acima do limite permitido.');
  if (!allowedMimeTypes.has(mimeType)) throw httpError(400, 'Tipo de arquivo não permitido.');
  if (mimeType === 'application/pdf' && buffer.subarray(0, 4).toString() !== '%PDF') throw httpError(400, 'PDF inválido.');
  if (mimeType === 'image/png' && buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw httpError(400, 'PNG inválido.');
  if (mimeType === 'image/jpeg' && !(buffer[0] === 0xff && buffer[1] === 0xd8)) throw httpError(400, 'JPEG inválido.');
}

export async function listDocuments(employeeId) {
  return transaction(async (client) => {
    await fetchEmployee(client, employeeId);
    const result = await client.query(
      `SELECT id, employee_id, dependent_id, document_type, original_name, mime_type, size_bytes, uploaded_by, created_at
       FROM employee_documents
       WHERE employee_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [employeeId],
    );
    return result.rows;
  });
}

export async function uploadDocument(employeeId, metadata, buffer, user) {
  const mimeType = metadata.mimeType;
  assertFile(buffer, mimeType);
  return transaction(async (client) => {
    await fetchEmployee(client, employeeId);
    if (metadata.dependentId) {
      const dependent = await client.query('SELECT id FROM employee_dependents WHERE id = $1 AND employee_id = $2 AND is_active = TRUE', [metadata.dependentId, employeeId]);
      if (!dependent.rows[0]) throw httpError(400, 'Dependente inválido para este funcionário.');
    }
    const docId = metadata.id || null;
    const idResult = docId ? { rows: [{ id: docId }] } : await client.query('SELECT gen_random_uuid() AS id');
    const documentId = idResult.rows[0].id;
    const extension = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : '.jpg';
    const storedName = `${documentId}-${Date.now()}${extension}`;
    const employeeDir = path.join(uploadRoot, employeeId);
    await fs.mkdir(employeeDir, { recursive: true });
    const fullPath = path.join(employeeDir, storedName);
    await fs.writeFile(fullPath, buffer, { mode: 0o600 });
    const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
    const inserted = await client.query(
      `INSERT INTO employee_documents (id, employee_id, dependent_id, document_type, original_name, stored_name, file_path, mime_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, employee_id, dependent_id, document_type, original_name, mime_type, size_bytes, uploaded_by, created_at`,
      [documentId, employeeId, metadata.dependentId || null, metadata.documentType, metadata.originalName, storedName, relativePath, mimeType, buffer.length, user.id],
    );
    await logAudit(client, {
      entityType: 'employee',
      entityId: employeeId,
      action: 'document_upload',
      newValue: { document_id: documentId, document_type: metadata.documentType, original_name: metadata.originalName },
      userId: user.id,
    });
    return inserted.rows[0];
  });
}

export async function getDocument(employeeId, documentId) {
  return transaction(async (client) => {
    await fetchEmployee(client, employeeId);
    const result = await client.query(
      `SELECT id, employee_id, document_type, original_name, file_path, mime_type
       FROM employee_documents
       WHERE id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
      [documentId, employeeId],
    );
    if (!result.rows[0]) throw httpError(404, 'Documento não encontrado.');
    const fullPath = path.resolve(projectRoot, result.rows[0].file_path);
    if (!fullPath.startsWith(uploadRoot)) throw httpError(400, 'Documento inválido.');
    return { ...result.rows[0], fullPath };
  });
}

export async function removeDocument(employeeId, documentId, user) {
  return transaction(async (client) => {
    await fetchEmployee(client, employeeId);
    const result = await client.query(
      `UPDATE employee_documents SET deleted_at = NOW(), deleted_by = $1
       WHERE id = $2 AND employee_id = $3 AND deleted_at IS NULL
       RETURNING id, document_type, original_name`,
      [user.id, documentId, employeeId],
    );
    if (!result.rows[0]) throw httpError(404, 'Documento não encontrado.');
    await logAudit(client, {
      entityType: 'employee',
      entityId: employeeId,
      action: 'document_remove',
      newValue: { document_id: documentId, document_type: result.rows[0].document_type },
      userId: user.id,
    });
  });
}

export async function getPrintData(employeeId, user) {
  return transaction(async (client) => {
    const employee = await fetchEmployee(client, employeeId);
    const dependents = await client.query('SELECT * FROM employee_dependents WHERE employee_id = $1 AND is_active = TRUE ORDER BY full_name', [employeeId]);
    await logAudit(client, {
      entityType: 'employee',
      entityId: employeeId,
      action: 'profile_print',
      newValue: { printed: true },
      userId: user.id,
    });
    return { employee: redactEmployee(employee, user), dependents: dependents.rows };
  });
}

export async function listEmployeeAudit(employeeId) {
  return transaction(async (client) => {
    await fetchEmployee(client, employeeId);
    const result = await client.query(
      `SELECT a.*, u.name AS user_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity_type = 'employee' AND a.entity_id = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [employeeId],
    );
    return result.rows;
  });
}
