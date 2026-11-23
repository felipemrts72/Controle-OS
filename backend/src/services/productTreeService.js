import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { hasPermission } from './permissionService.js';
import { logAudit } from './auditService.js';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const normalized = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const requireId = (value) => { if (typeof value !== 'string' || !uuid.test(value)) throw httpError(400, 'Identificador inválido.'); };
const permit = (user, code) => { if (!hasPermission(user, code)) throw httpError(403, 'Acesso não autorizado.'); };

export function validateTree(body, productId) {
  requireId(body?.request_id);
  if (productId) requireId(productId);
  if (!Number.isInteger(body.version) || body.version < 0) throw httpError(400, 'Versão inválida.');
  if (!Array.isArray(body.nodes) || !body.nodes.length || body.nodes.length > 2000) throw httpError(400, 'A árvore deve conter de 1 a 2.000 itens.');
  const nodes = body.nodes.map((raw) => {
    requireId(raw?.key);
    if (raw.parent_key !== null) requireId(raw.parent_key);
    if (raw.product_id) requireId(raw.product_id);
    if (Boolean(raw.product_id) === Boolean(raw.new_product)) throw httpError(400, 'Selecione um produto existente ou informe um novo.');
    const quantity = String(raw.quantity ?? '').replace(',', '.');
    if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(quantity) || Number(quantity) <= 0) throw httpError(400, 'Quantidade deve ser positiva, com até seis casas decimais.');
    if (typeof raw.unit_code !== 'string' || !raw.unit_code || raw.unit_code.length > 20) throw httpError(400, 'Informe a unidade.');
    if (typeof (raw.note ?? '') !== 'string' || (raw.note || '').length > 1000) throw httpError(400, 'Observação deve ter até 1.000 caracteres.');
    let newProduct;
    if (raw.new_product) {
      const { name, type } = raw.new_product;
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 220 || typeof type !== 'string' || !type) throw httpError(400, 'Informe nome e tipo do novo produto.');
      newProduct = { name: name.trim(), type };
    }
    return { key: raw.key.toLowerCase(), parent_key: raw.parent_key?.toLowerCase() || null,
      product_id: raw.product_id?.toLowerCase() || null, new_product: newProduct, quantity, unit_code: raw.unit_code, note: raw.note || '' };
  });
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const roots = nodes.filter((n) => !n.parent_key);
  if (byKey.size !== nodes.length || roots.length !== 1) throw httpError(400, 'A árvore deve ter uma raiz e identificadores únicos.');
  if (productId ? roots[0].product_id !== productId.toLowerCase() : !roots[0].new_product) throw httpError(400, 'Produto principal divergente.');
  const names = new Set(); const siblings = new Set();
  for (const node of nodes) {
    if (node.new_product) {
      const name = normalized(node.new_product.name);
      if (names.has(name)) throw httpError(409, `Novo produto repetido: ${node.new_product.name}.`);
      names.add(name);
    }
    const sibling = `${node.parent_key}:${node.product_id || normalized(node.new_product.name)}`;
    if (siblings.has(sibling)) throw httpError(409, 'Produto repetido no mesmo nível. Ajuste a quantidade do componente.');
    siblings.add(sibling);
    const visited = new Set([node.key]); const products = new Set(node.product_id ? [node.product_id] : []);
    let parent = node.parent_key;
    while (parent) {
      const ancestor = byKey.get(parent);
      if (!ancestor) throw httpError(400, 'Componente sem pai na árvore.');
      if (visited.has(parent) || (ancestor.product_id && products.has(ancestor.product_id))) throw httpError(400, 'Referência circular na composição.');
      visited.add(parent); if (ancestor.product_id) products.add(ancestor.product_id);
      parent = ancestor.parent_key;
    }
  }
  return { nodes, root: roots[0] };
}

async function loadTree(client, productId) {
  const product = (await client.query('SELECT id,name,type,measurement_unit_code,is_active FROM products WHERE id=$1', [productId])).rows[0];
  if (!product) throw httpError(404, 'Produto não encontrado.');
  const header = (await client.query('SELECT * FROM product_trees WHERE product_id=$1', [productId])).rows[0];
  if (header) {
    const nodes = (await client.query(`SELECT n.id AS key,n.parent_id AS parent_key,n.product_id,n.quantity,n.unit_code,n.note,
      p.name,p.type,p.is_active FROM product_tree_nodes n JOIN products p ON p.id=n.product_id
      WHERE n.tree_id=$1 ORDER BY n.position`, [productId])).rows;
    return { product_id: productId, version: header.version, nodes };
  }
  const nodes = [];
  // Importação somente para o rascunho; mantém a composição operacional intacta.
  async function visit(item, parent, quantity, ancestors) {
    if (nodes.length >= 2000 || ancestors.has(item.id)) throw httpError(409, 'A composição legada contém ciclo ou excede 2.000 itens.');
    const key = randomUUID();
    nodes.push({ key, parent_key: parent, product_id: item.id, name: item.name, type: item.type,
      unit_code: item.measurement_unit_code || '', quantity: String(quantity), note: '', is_active: item.is_active });
    const path = new Set([...ancestors, item.id]);
    const children = (await client.query(`SELECT p.id,p.name,p.type,p.measurement_unit_code,p.is_active,c.quantity,c.component_name
      FROM product_components c LEFT JOIN products p ON p.id=c.material_product_id WHERE c.product_id=$1 ORDER BY c.created_at,c.id`, [item.id])).rows;
    for (const child of children) {
      if (child.id) await visit(child, key, child.quantity, path);
      else nodes.push({ key: randomUUID(), parent_key: key, product_id: null,
        new_product: { name: child.component_name, type: '' }, name: child.component_name,
        quantity: String(child.quantity), unit_code: '', note: 'Componente legado: confirme tipo e unidade antes de salvar.' });
    }
  }
  await visit(product, null, 1, new Set());
  return { product_id: productId, version: 0, nodes };
}

export async function getProductTree(id, user) {
  requireId(id);
  if (!['products.view', 'products.edit', 'products.create'].some((p) => hasPermission(user, p))) throw httpError(403, 'Acesso não autorizado.');
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    return loadTree(client, id);
  });
}

export async function saveProductTree(productId, body, user) {
  permit(user, productId ? 'products.edit' : 'products.create');
  const { nodes, root } = validateTree(body, productId);
  if (nodes.some((n) => n.new_product)) permit(user, 'products.create');
  const fingerprint = createHash('sha256').update(JSON.stringify({ productId, version: body.version, nodes })).digest('hex');
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('product_components_graph'))");
    const previousRequest = (await client.query('SELECT * FROM product_tree_requests WHERE user_id=$1 AND request_id=$2', [user.id, body.request_id])).rows[0];
    if (previousRequest) {
      if (previousRequest.fingerprint !== fingerprint) throw httpError(409, 'Esta requisição já foi utilizada com outros dados.');
      return previousRequest.result;
    }
    const previous = productId ? (await client.query('SELECT version FROM product_trees WHERE product_id=$1 FOR UPDATE', [productId])).rows[0] : null;
    if ((previous?.version || 0) !== body.version) throw httpError(409, 'A árvore foi alterada por outro usuário. Seu rascunho foi preservado; reabra a versão salva antes de tentar novamente.');
    const types = new Set((await client.query('SELECT code FROM product_types WHERE is_active=TRUE')).rows.map((r) => r.code));
    const units = new Set((await client.query('SELECT code FROM measurement_units WHERE is_active=TRUE')).rows.map((r) => r.code));
    const existing = new Map((await client.query('SELECT id,name,type,is_active FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [nodes.map((n) => n.product_id).filter(Boolean)])).rows.map((p) => [p.id, p]));
    for (const node of nodes) {
      if (!units.has(node.unit_code)) throw httpError(400, 'Unidade inválida ou inativa.');
      if (node.product_id) {
        const product = existing.get(node.product_id);
        if (!product || !product.is_active) throw httpError(409, `Produto indisponível: ${node.product_id}. Remova ou substitua o componente.`);
      } else {
        if (!types.has(node.new_product.type)) throw httpError(400, 'Tipo inválido ou inativo.');
        const duplicate = await client.query("SELECT id FROM products WHERE lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))=$1 LIMIT 1", [normalized(node.new_product.name)]);
        if (duplicate.rowCount) throw httpError(409, `Já existe um produto chamado "${node.new_product.name}". Pesquise e selecione o cadastro existente.`);
        let created;
        for (let attempt = 0; attempt < 1000 && !created; attempt++) {
          created = (await client.query(`INSERT INTO products(name,type,measurement_unit_code,internal_code,
            default_volume_quantity,default_total_weight_kg,review_status,creation_origin,preliminary_created_by,preliminary_created_at)
            VALUES($1,$2,$3,nextval('products_internal_code_seq')::text,NULL,NULL,'pending_review','manual',$4,NOW())
            ON CONFLICT DO NOTHING RETURNING id`, [node.new_product.name, node.new_product.type, node.unit_code, user.id])).rows[0];
        }
        if (!created) throw httpError(409, 'Não foi possível reservar o código do produto.');
        node.product_id = created.id;
        await logAudit(client, { entityType: 'product', entityId: created.id, action: 'create_from_tree', newValue: node.new_product, userId: user.id });
      }
    }
    const rootId = root.product_id;
    // Valida também caminhos por outras composições, sem alterá-las.
    const edges = (await client.query(`SELECT p.product_id AS parent,c.product_id AS child FROM product_tree_nodes c
      JOIN product_tree_nodes p ON p.tree_id=c.tree_id AND p.id=c.parent_id WHERE c.tree_id<>$1
      UNION SELECT product_id,material_product_id FROM product_components WHERE material_product_id IS NOT NULL`, [rootId])).rows;
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    for (const node of nodes) if (node.parent_key) edges.push({ parent: byKey.get(node.parent_key).product_id, child: node.product_id });
    const graph = new Map();
    for (const { parent, child } of edges) { if (!graph.has(parent)) graph.set(parent, new Set()); graph.get(parent).add(child); }
    for (const node of nodes) {
      const seen = new Set(); const pending = [...(graph.get(node.product_id) || [])];
      while (pending.length) {
        const id = pending.pop();
        if (id === node.product_id) throw httpError(409, 'Referência circular entre produtos. Revise os componentes.');
        if (!seen.has(id)) { seen.add(id); pending.push(...(graph.get(id) || [])); }
      }
    }
    await client.query(`INSERT INTO product_trees(product_id,version,updated_by) VALUES($1,1,$2)
      ON CONFLICT(product_id) DO UPDATE SET version=product_trees.version+1,updated_by=$2,updated_at=NOW()`, [rootId, user.id]);
    await client.query('DELETE FROM product_tree_nodes WHERE tree_id=$1', [rootId]);
    for (const [position, node] of nodes.entries()) await client.query(`INSERT INTO product_tree_nodes
      (tree_id,id,parent_id,product_id,quantity,unit_code,note,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [rootId, node.key, node.parent_key, node.product_id, node.quantity, node.unit_code, node.note, position]);
    const result = await loadTree(client, rootId);
    await logAudit(client, { entityType: 'product', entityId: rootId, action: 'save_tree',
      newValue: { version: result.version, nodes: result.nodes }, userId: user.id });
    await client.query('INSERT INTO product_tree_requests(user_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4)', [user.id, body.request_id, fingerprint, JSON.stringify(result)]);
    return result;
  });
}
