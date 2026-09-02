import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { query, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');
const logoUploadRoot = path.resolve(process.env.COMPANY_LOGO_UPLOAD_DIR || path.join(projectRoot, 'uploads', 'company'));
const maxLogoBytes = Number(process.env.COMPANY_LOGO_MAX_BYTES || 5 * 1024 * 1024);
const allowedLogoMimeTypes = new Set(['image/png', 'image/jpeg']);
const editableFields = [
  'nome_fantasia', 'razao_social', 'cnpj', 'telefone', 'email', 'endereco', 'numero', 'complemento',
  'bairro', 'cidade', 'estado', 'cep', 'nome_representante', 'cpf_representante', 'cargo_representante',
  'delivery_address', 'purchase_response_email', 'purchase_response_whatsapp', 'purchase_responsible_name',
];

function cleanText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function digitsOrNull(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

function hasValidDocumentCheckDigits(value) {
  if (!value || /^(\d)\1+$/.test(value)) return false;
  if (value.length === 11) {
    const calculate = (length) => {
      let sum = 0;
      for (let index = 0; index < length; index += 1) sum += Number(value[index]) * (length + 1 - index);
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return calculate(9) === Number(value[9]) && calculate(10) === Number(value[10]);
  }
  if (value.length === 14) {
    const calculate = (length) => {
      const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
      const remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };
    return calculate(12) === Number(value[12]) && calculate(13) === Number(value[13]);
  }
  return false;
}

function validateAndNormalize(body) {
  const payload = {};
  for (const field of editableFields) {
    if (!(field in body)) continue;
    payload[field] = ['cnpj', 'cpf_representante', 'cep', 'telefone', 'purchase_response_whatsapp'].includes(field)
      ? digitsOrNull(body[field])
      : cleanText(body[field]);
  }

  if (payload.cnpj && (payload.cnpj.length !== 14 || !hasValidDocumentCheckDigits(payload.cnpj))) {
    throw httpError(400, 'CNPJ inválido.', { field: 'cnpj' });
  }
  if (payload.cpf_representante && (payload.cpf_representante.length !== 11 || !hasValidDocumentCheckDigits(payload.cpf_representante))) {
    throw httpError(400, 'CPF do representante inválido.', { field: 'cpf_representante' });
  }
  if (payload.cep && payload.cep.length !== 8) throw httpError(400, 'CEP inválido.', { field: 'cep' });
  if (payload.telefone && ![10, 11].includes(payload.telefone.length)) throw httpError(400, 'Telefone inválido.', { field: 'telefone' });
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) throw httpError(400, 'E-mail inválido.', { field: 'email' });
  if (payload.purchase_response_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.purchase_response_email)) throw httpError(400, 'E-mail de resposta de compras inválido.', { field: 'purchase_response_email' });
  if (payload.purchase_response_whatsapp && ![10, 11].includes(payload.purchase_response_whatsapp.length)) throw httpError(400, 'WhatsApp de resposta inválido.', { field: 'purchase_response_whatsapp' });
  if (payload.estado) {
    payload.estado = payload.estado.toUpperCase();
    if (!/^[A-Z]{2}$/.test(payload.estado)) throw httpError(400, 'Estado inválido.', { field: 'estado' });
  }
  return payload;
}

function publicSettings(row) {
  const settings = Object.fromEntries(editableFields.map((field) => [field, row?.[field] ?? null]));
  return {
    ...settings,
    logo_url: row?.logo_path ? '/company-settings/logo' : null,
    created_at: row?.created_at ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

function resolveStoredLogoPath(storedPath) {
  if (!storedPath || path.basename(storedPath) !== storedPath || storedPath.includes('..')) {
    throw httpError(400, 'Caminho de logo inválido.');
  }
  const fullPath = path.resolve(logoUploadRoot, storedPath);
  const relative = path.relative(logoUploadRoot, fullPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw httpError(400, 'Caminho de logo inválido.');
  return fullPath;
}

function assertLogo(buffer, mimeType, originalName) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'Selecione uma imagem para a logo.');
  if (buffer.length > maxLogoBytes) throw httpError(400, 'A logo está acima do limite permitido.');
  if (!allowedLogoMimeTypes.has(mimeType)) throw httpError(400, 'Formato de logo não permitido. Use PNG ou JPEG.');
  const normalizedName = String(originalName || '').trim();
  if (!normalizedName || normalizedName !== path.basename(normalizedName) || /[\\/]/.test(normalizedName) || normalizedName.includes('..')) {
    throw httpError(400, 'Nome de arquivo inválido.');
  }
  const extension = path.extname(normalizedName).toLowerCase();
  const allowedExtensions = mimeType === 'image/png' ? ['.png'] : ['.jpg', '.jpeg'];
  if (!allowedExtensions.includes(extension)) throw httpError(400, 'A extensão do arquivo não corresponde ao formato da imagem.');
  if (mimeType === 'image/png' && buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw httpError(400, 'Arquivo PNG inválido.');
  if (mimeType === 'image/jpeg' && !(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) throw httpError(400, 'Arquivo JPEG inválido.');
}

async function fetchRow(client = { query }) {
  const result = await client.query('SELECT * FROM company_settings WHERE singleton_key = TRUE LIMIT 1');
  return result.rows[0] || null;
}

export async function getCompanySettings() {
  return publicSettings(await fetchRow());
}

export async function updateCompanySettings(body, user) {
  const payload = validateAndNormalize(body);
  return transaction(async (client) => {
    const current = await fetchRow(client);
    let row;
    if (!current) {
      const columns = Object.keys(payload);
      const placeholders = columns.map((_, index) => `$${index + 1}`);
      const inserted = columns.length
        ? await client.query(`INSERT INTO company_settings (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`, Object.values(payload))
        : await client.query('INSERT INTO company_settings DEFAULT VALUES RETURNING *');
      row = inserted.rows[0];
    } else if (Object.keys(payload).length) {
      const columns = Object.keys(payload);
      const assignments = columns.map((column, index) => `${column} = $${index + 1}`);
      const updated = await client.query(
        `UPDATE company_settings SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = $${columns.length + 1} RETURNING *`,
        [...Object.values(payload), current.id],
      );
      row = updated.rows[0];
    } else {
      row = current;
    }
    await logAudit(client, {
      entityType: 'company_settings',
      entityId: row.id,
      action: current ? 'update' : 'create',
      previousValue: current ? publicSettings(current) : null,
      newValue: publicSettings(row),
      userId: user.id,
    });
    return publicSettings(row);
  });
}

export async function uploadCompanyLogo({ originalName, mimeType }, buffer, user) {
  assertLogo(buffer, mimeType, originalName);
  const extension = mimeType === 'image/png' ? '.png' : '.jpg';
  const storedName = `logo-${randomUUID()}${extension}`;
  await fs.mkdir(logoUploadRoot, { recursive: true });
  const fullPath = resolveStoredLogoPath(storedName);
  await fs.writeFile(fullPath, buffer, { mode: 0o600, flag: 'wx' });

  let previousPath = null;
  try {
    await transaction(async (client) => {
      const current = await fetchRow(client);
      previousPath = current?.logo_path || null;
      const saved = current
        ? await client.query('UPDATE company_settings SET logo_path = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [storedName, current.id])
        : await client.query('INSERT INTO company_settings (logo_path) VALUES ($1) RETURNING *', [storedName]);
      await logAudit(client, {
        entityType: 'company_settings',
        entityId: saved.rows[0].id,
        action: 'logo_update',
        previousValue: { has_logo: Boolean(previousPath) },
        newValue: { has_logo: true },
        userId: user.id,
      });
    });
  } catch (error) {
    await fs.unlink(fullPath).catch(() => {});
    throw error;
  }

  if (previousPath && previousPath !== storedName) {
    await fs.unlink(resolveStoredLogoPath(previousPath)).catch((error) => {
      if (error.code !== 'ENOENT') console.error('Não foi possível remover a logo substituída:', error.message);
    });
  }
  return getCompanySettings();
}

export async function removeCompanyLogo(user) {
  let previousPath = null;
  const settings = await transaction(async (client) => {
    const current = await fetchRow(client);
    if (!current?.logo_path) return publicSettings(current);
    previousPath = current.logo_path;
    const updated = await client.query('UPDATE company_settings SET logo_path = NULL, updated_at = NOW() WHERE id = $1 RETURNING *', [current.id]);
    await logAudit(client, {
      entityType: 'company_settings', entityId: current.id, action: 'logo_remove',
      previousValue: { has_logo: true }, newValue: { has_logo: false }, userId: user.id,
    });
    return publicSettings(updated.rows[0]);
  });
  if (previousPath) await fs.unlink(resolveStoredLogoPath(previousPath)).catch((error) => {
    if (error.code !== 'ENOENT') console.error('Não foi possível remover o arquivo da logo:', error.message);
  });
  return settings;
}

export async function getCompanyLogo() {
  const row = await fetchRow();
  if (!row?.logo_path) throw httpError(404, 'Logo não cadastrada.');
  const fullPath = resolveStoredLogoPath(row.logo_path);
  let buffer;
  try {
    buffer = await fs.readFile(fullPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw httpError(404, 'Arquivo da logo não encontrado.');
    throw error;
  }
  return { buffer, mimeType: path.extname(row.logo_path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg' };
}

export async function getCompanyPdfData(database = { query }) {
  const row = await fetchRow(database);
  if (!row) return { ...publicSettings(null), logo: null };
  let logo = null;
  if (row.logo_path) {
    try {
      logo = await fs.readFile(resolveStoredLogoPath(row.logo_path));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { ...publicSettings(row), logo };
}
