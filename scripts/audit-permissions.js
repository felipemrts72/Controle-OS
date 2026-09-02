import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { PERMISSIONS } from '../backend/src/services/permissionService.js';
import { PERMISSION_PRESENTATION } from '../src/config/modulePresentation.js';

dotenv.config();

const roots = ['backend/src', 'src', 'database/migrations', 'tests', 'scripts'];
const sourceExtensions = new Set(['.js', '.jsx', '.sql']);
const catalogFiles = new Set([
  'backend/src/services/permissionService.js',
  'src/config/modulePresentation.js',
  'scripts/audit-permissions.js',
]);

function collectFiles(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(filename, result);
    else if (sourceExtensions.has(path.extname(entry.name))) result.push(filename.replaceAll('\\', '/'));
  }
  return result;
}

function findUsage(files, codes) {
  const usage = new Map(codes.map((code) => [code, []]));
  for (const filename of files) {
    const source = fs.readFileSync(filename, 'utf8');
    for (const code of codes) {
      if (source.includes(`'${code}'`) || source.includes(`"${code}"`)) usage.get(code).push(filename);
    }
  }
  return usage;
}

function usageKind(filename) {
  if (catalogFiles.has(filename)) return 'catálogo';
  if (filename.startsWith('database/migrations/')) return 'migration';
  if (filename.startsWith('tests/')) return 'teste';
  if (filename.startsWith('backend/src/')) return 'backend';
  if (filename.startsWith('src/')) return 'frontend';
  return 'suporte';
}

function classify(item) {
  const runtimeKinds = new Set(item.usage.map(usageKind).filter((kind) => ['backend', 'frontend'].includes(kind)));
  const statuses = [];
  if (!item.database) statuses.push('faltante no banco');
  if (!item.presentation) statuses.push('faltante na apresentação');
  if (item.database && !item.database.description) statuses.push('descrição faltante');
  if (item.database && item.presentation && item.database.name !== item.presentation.name) statuses.push('nome inadequado no banco');
  if (item.database && item.presentation && item.database.group_name !== item.presentation.module) statuses.push('grupo inadequado no banco');
  if (runtimeKinds.size === 0) statuses.push('órfã em runtime');
  if (['employees.manage', 'advances.manage'].includes(item.code)) statuses.push('override administrativo compatível');
  if (['suppliers.manage', 'purchase_quotes.view', 'purchase_quotes.manage'].includes(item.code)) statuses.push('legada/sobreposta sem consumo em runtime');
  if (!statuses.length) statuses.push('correta');
  return statuses;
}

function escapeCell(value) {
  return String(value ?? '-').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function permissionDescription(name) {
  return `Permite ${name.charAt(0).toLowerCase()}${name.slice(1)}.`;
}

async function main() {
  const files = roots.flatMap((root) => collectFiles(root));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const databasePermissions = (await pool.query(
      'SELECT code, name, description, group_name FROM permissions ORDER BY code',
    )).rows;
    const databaseByCode = new Map(databasePermissions.map((permission) => [permission.code, permission]));
    const allCodes = [...new Set([...PERMISSIONS.map((permission) => permission.code), ...databaseByCode.keys()])].sort();
    const usage = findUsage(files, allCodes);
    const matrix = allCodes.map((code) => {
      const catalog = PERMISSIONS.find((permission) => permission.code === code) || null;
      const database = databaseByCode.get(code) || null;
      const presentation = PERMISSION_PRESENTATION[code] || null;
      const item = { code, catalog, database, presentation, usage: usage.get(code) };
      return { ...item, statuses: classify(item) };
    });

    if (process.argv.includes('--sql-values')) {
      console.log(matrix.map((item) => {
        const name = item.presentation?.name || item.catalog?.name || item.database?.name;
        const group = item.presentation?.module || item.catalog?.group_name || item.database?.group_name;
        return `  (${[item.code, name, permissionDescription(name), group].map(sqlLiteral).join(', ')})`;
      }).join(',\n'));
      return;
    }

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ matrix }, null, 2));
      return;
    }

    const lines = [
      '# Matriz real de permissões do OliMen Gestão',
      '',
      `Gerada em ${new Date().toISOString()} a partir do banco configurado em \`.env\` e do código local.`,
      '',
      `- Catálogo em código: ${PERMISSIONS.length}`,
      `- Catálogo no banco: ${databasePermissions.length}`,
      `- Apresentação visual: ${Object.keys(PERMISSION_PRESENTATION).length}`,
      '',
      '| Código | Nome atual no banco | Descrição atual | Grupo atual | Módulo visual | Subgrupo visual | Uso | Status |',
      '|---|---|---|---|---|---|---|---|',
    ];
    for (const item of matrix) {
      const locations = item.usage.length
        ? item.usage.map((filename) => `${usageKind(filename)}: ${filename}`).join('<br>')
        : '-';
      lines.push(`| ${[
        item.code,
        item.database?.name || item.catalog?.name || '-',
        item.database?.description || '-',
        item.database?.group_name || '-',
        item.presentation?.module || '-',
        item.presentation?.subdivision || '-',
        locations,
        item.statuses.join('; '),
      ].map(escapeCell).join(' | ')} |`);
    }
    console.log(lines.join('\n'));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
