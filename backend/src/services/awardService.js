import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const minimumDescriptionLength = 10;
const maximumDescriptionLength = 10000;

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function validateUuid(value, field, message) {
  if (!uuidPattern.test(String(value || ''))) throw httpError(400, message, { field });
  return value;
}

function validateDate(value, field = 'award_date') {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, 'Informe uma data de prêmio válida.', { field });
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw httpError(400, 'Informe uma data de prêmio válida.', { field });
  }
  return text;
}

function validateAmount(value) {
  let normalized = value;
  if (typeof normalized === 'string') {
    normalized = normalized.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
    if (normalized.includes(',')) normalized = normalized.replace(/\./g, '').replace(',', '.');
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpError(400, 'O valor do prêmio deve ser maior que zero.', { field: 'amount' });
  }
  if (amount > 9999999999.99) throw httpError(400, 'O valor do prêmio excede o limite permitido.', { field: 'amount' });
  return amount.toFixed(2);
}

function validateDescription(value) {
  const description = cleanText(value);
  if (description.length < minimumDescriptionLength) {
    throw httpError(400, `Descreva o desempenho com pelo menos ${minimumDescriptionLength} caracteres.`, { field: 'performance_description' });
  }
  if (description.length > maximumDescriptionLength) {
    throw httpError(400, `A descrição deve ter no máximo ${maximumDescriptionLength} caracteres.`, { field: 'performance_description' });
  }
  return description;
}

async function fetchActiveEmployee(client, employeeId) {
  validateUuid(employeeId, 'employee_id', 'Selecione um funcionário válido.');
  const result = await client.query(
    `SELECT e.id, e.full_name, e.cpf, e.job_title, e.sector_id, s.name AS sector_name
     FROM employees e
     LEFT JOIN sectors s ON s.id = e.sector_id
     WHERE e.id = $1
       AND e.deleted_at IS NULL
       AND e.employment_status = 'ativo'`,
    [employeeId],
  );
  if (!result.rows[0]) throw httpError(400, 'O funcionário informado não existe ou não está ativo.', { field: 'employee_id' });
  return result.rows[0];
}

async function fetchCompanySnapshot(client) {
  const result = await client.query(
    `SELECT nome_fantasia, razao_social, cnpj, cidade, nome_representante, cargo_representante
     FROM company_settings
     WHERE singleton_key = TRUE
     LIMIT 1`,
  );
  const company = result.rows[0];
  if (!company) throw httpError(400, 'Cadastre as configurações da empresa antes de registrar um prêmio.', { code: 'COMPANY_SETTINGS_REQUIRED' });
  const companyName = cleanText(company.nome_fantasia) || cleanText(company.razao_social);
  if (!companyName) throw httpError(400, 'Informe o nome fantasia ou a razão social nas configurações da empresa.', { code: 'COMPANY_NAME_REQUIRED' });
  if (!cleanText(company.nome_representante)) throw httpError(400, 'Informe o representante nas configurações da empresa.', { code: 'COMPANY_REPRESENTATIVE_REQUIRED' });
  if (!cleanText(company.cargo_representante)) throw httpError(400, 'Informe o cargo do representante nas configurações da empresa.', { code: 'COMPANY_REPRESENTATIVE_JOB_REQUIRED' });
  return {
    company_name_snapshot: companyName,
    company_cnpj_snapshot: cleanText(company.cnpj) || null,
    company_city_snapshot: cleanText(company.cidade) || null,
    representative_name_snapshot: cleanText(company.nome_representante),
    representative_job_title_snapshot: cleanText(company.cargo_representante),
  };
}

function employeeSnapshot(employee) {
  return {
    employee_name_snapshot: cleanText(employee.full_name),
    employee_cpf_snapshot: cleanText(employee.cpf) || null,
    job_title_snapshot: cleanText(employee.job_title) || null,
    sector_name_snapshot: cleanText(employee.sector_name) || null,
  };
}

async function fetchAward(client, id, { includeDeleted = false, lock = false } = {}) {
  validateUuid(id, 'id', 'Prêmio inválido.');
  const result = await client.query(
    `SELECT a.*, TO_CHAR(a.award_date, 'YYYY-MM-DD') AS award_date,
       creator.name AS created_by_name, updater.name AS updated_by_name
     FROM employee_awards a
     JOIN users creator ON creator.id = a.created_by
     LEFT JOIN users updater ON updater.id = a.updated_by
     WHERE a.id = $1 ${includeDeleted ? '' : 'AND a.deleted_at IS NULL'}
     ${lock ? 'FOR UPDATE OF a' : ''}`,
    [id],
  );
  if (!result.rows[0]) throw httpError(404, 'Prêmio não encontrado.');
  return result.rows[0];
}

function auditValue(award) {
  return {
    id: award.id,
    employee_id: award.employee_id,
    employee_name: award.employee_name_snapshot,
    amount: award.amount,
    award_date: award.award_date,
    performance_description: award.performance_description,
    sector_name: award.sector_name_snapshot,
  };
}

export async function listAwards(filters = {}) {
  return transaction(async (client) => {
    const params = [];
    const conditions = ['a.deleted_at IS NULL'];
    const search = cleanText(filters.search);
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(a.employee_name_snapshot ILIKE $${params.length} OR a.performance_description ILIKE $${params.length})`);
    }
    if (filters.employee_id) {
      validateUuid(filters.employee_id, 'employee_id', 'Funcionário inválido.');
      params.push(filters.employee_id);
      conditions.push(`a.employee_id = $${params.length}`);
    }
    const sector = cleanText(filters.sector);
    if (sector) {
      params.push(sector);
      conditions.push(`a.sector_name_snapshot = $${params.length}`);
    }
    if (filters.from) {
      params.push(validateDate(filters.from, 'from'));
      conditions.push(`a.award_date >= $${params.length}`);
    }
    if (filters.to) {
      params.push(validateDate(filters.to, 'to'));
      conditions.push(`a.award_date <= $${params.length}`);
    }
    const result = await client.query(
      `SELECT a.*, TO_CHAR(a.award_date, 'YYYY-MM-DD') AS award_date,
         creator.name AS created_by_name, updater.name AS updated_by_name
       FROM employee_awards a
       JOIN users creator ON creator.id = a.created_by
       LEFT JOIN users updater ON updater.id = a.updated_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.award_date DESC, a.created_at DESC`,
      params,
    );
    return result.rows;
  });
}

export async function listAwardEmployees(search = '') {
  const term = cleanText(search);
  return transaction(async (client) => {
    const params = [];
    const conditions = ["e.deleted_at IS NULL", "e.employment_status = 'ativo'"];
    if (term) {
      params.push(`%${term}%`);
      conditions.push(`e.full_name ILIKE $${params.length}`);
    }
    params.push(50);
    const result = await client.query(
      `SELECT e.id, e.full_name, e.job_title, e.sector_id, s.name AS sector_name
       FROM employees e
       LEFT JOIN sectors s ON s.id = e.sector_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.full_name
       LIMIT $${params.length}`,
      params,
    );
    return result.rows;
  });
}

export async function getAward(id) {
  return transaction((client) => fetchAward(client, id));
}

export async function createAward(body, user) {
  return transaction(async (client) => {
    const employee = await fetchActiveEmployee(client, body.employee_id);
    const company = await fetchCompanySnapshot(client);
    const amount = validateAmount(body.amount);
    const awardDate = validateDate(body.award_date);
    const description = validateDescription(body.performance_description);
    const snapshot = { ...employeeSnapshot(employee), ...company };
    const result = await client.query(
      `INSERT INTO employee_awards (
        employee_id, amount, award_date, performance_description,
        employee_name_snapshot, employee_cpf_snapshot, job_title_snapshot, sector_name_snapshot,
        company_name_snapshot, company_cnpj_snapshot, company_city_snapshot,
        representative_name_snapshot, representative_job_title_snapshot, created_by
       ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       ) RETURNING *`,
      [
        employee.id, amount, awardDate, description,
        snapshot.employee_name_snapshot, snapshot.employee_cpf_snapshot, snapshot.job_title_snapshot, snapshot.sector_name_snapshot,
        snapshot.company_name_snapshot, snapshot.company_cnpj_snapshot, snapshot.company_city_snapshot,
        snapshot.representative_name_snapshot, snapshot.representative_job_title_snapshot, user.id,
      ],
    );
    const award = result.rows[0];
    await logAudit(client, {
      entityType: 'employee_award', entityId: award.id, action: 'create', newValue: auditValue(award), userId: user.id,
    });
    return fetchAward(client, award.id);
  });
}

export async function updateAward(id, body, user) {
  return transaction(async (client) => {
    const current = await fetchAward(client, id, { lock: true });
    const employeeId = body.employee_id === undefined ? current.employee_id : body.employee_id;
    const amount = body.amount === undefined ? current.amount : validateAmount(body.amount);
    const awardDate = body.award_date === undefined ? current.award_date : validateDate(body.award_date);
    const description = body.performance_description === undefined
      ? current.performance_description
      : validateDescription(body.performance_description);
    let snapshot = {};
    if (employeeId !== current.employee_id) snapshot = employeeSnapshot(await fetchActiveEmployee(client, employeeId));

    const result = await client.query(
      `UPDATE employee_awards SET
        employee_id = $1,
        amount = $2,
        award_date = $3,
        performance_description = $4,
        employee_name_snapshot = COALESCE($5, employee_name_snapshot),
        employee_cpf_snapshot = CASE WHEN $6::boolean THEN $7 ELSE employee_cpf_snapshot END,
        job_title_snapshot = CASE WHEN $6::boolean THEN $8 ELSE job_title_snapshot END,
        sector_name_snapshot = CASE WHEN $6::boolean THEN $9 ELSE sector_name_snapshot END,
        updated_by = $10,
        updated_at = NOW()
       WHERE id = $11 AND deleted_at IS NULL
       RETURNING *`,
      [
        employeeId, amount, awardDate, description,
        snapshot.employee_name_snapshot || null, Boolean(snapshot.employee_name_snapshot),
        snapshot.employee_cpf_snapshot ?? null, snapshot.job_title_snapshot ?? null, snapshot.sector_name_snapshot ?? null,
        user.id, id,
      ],
    );
    if (!result.rows[0]) throw httpError(404, 'Prêmio não encontrado.');
    const updated = result.rows[0];
    await logAudit(client, {
      entityType: 'employee_award', entityId: id, action: 'update',
      previousValue: auditValue(current), newValue: auditValue(updated), userId: user.id,
    });
    return fetchAward(client, id);
  });
}

export async function deleteAward(id, user) {
  return transaction(async (client) => {
    const current = await fetchAward(client, id, { lock: true });
    const result = await client.query(
      `UPDATE employee_awards
       SET deleted_at = NOW(), deleted_by = $1, updated_by = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [user.id, id],
    );
    if (!result.rows[0]) throw httpError(404, 'Prêmio não encontrado.');
    await logAudit(client, {
      entityType: 'employee_award', entityId: id, action: 'delete', previousValue: auditValue(current), userId: user.id,
    });
    return { id, deleted: true };
  });
}

export async function getAwardForPdf(id, user) {
  return transaction(async (client) => {
    const award = await fetchAward(client, id);
    await logAudit(client, {
      entityType: 'employee_award', entityId: id, action: 'pdf_generate',
      newValue: { employee_name: award.employee_name_snapshot, award_date: award.award_date }, userId: user.id,
    });
    return award;
  });
}
