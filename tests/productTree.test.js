import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateTree } from '../backend/src/services/productTreeService.js';

const make = () => ({ request_id: randomUUID(), version: 0, nodes: [{ key: randomUUID(), parent_key: null,
  new_product: { name: 'Equipamento fictício', type: 'manufactured' }, quantity: '1', unit_code: 'UN' }] });
test('valida decimais sem arredondar e hierarquia de vários níveis', () => {
  const body = make();
  for (let i = 0; i < 30; i++) body.nodes.push({ key: randomUUID(), parent_key: body.nodes.at(-1).key,
    product_id: randomUUID(), quantity: '0,123456', unit_code: 'KG' });
  assert.equal(validateTree(body, null).nodes.at(-1).quantity, '0.123456');
});
test('recusa quantidades inválidas, órfãos, chaves repetidas e ciclos', () => {
  for (const quantity of ['0', '-1', 'NaN', '1e3', '1.0000001', '1000000000000', true]) {
    const body = make(); body.nodes[0].quantity = quantity;
    assert.throws(() => validateTree(body, null));
  }
  const orphan = make(); orphan.nodes[0].parent_key = randomUUID();
  assert.throws(() => validateTree(orphan, null));
  const cycle = make(); cycle.nodes.push({ ...cycle.nodes[0], key: randomUUID(), parent_key: cycle.nodes[0].key, new_product: { name: 'Filho', type: 'manufactured' } });
  cycle.nodes[1].parent_key = cycle.nodes[1].key;
  assert.throws(() => validateTree(cycle, null), /circular/);
  const duplicate = make(); duplicate.nodes.push({ ...duplicate.nodes[0] });
  assert.throws(() => validateTree(duplicate, null), /raiz/);
});
test('recusa duplicidade de nomes provisórios e de produtos irmãos', () => {
  const body = make();
  body.nodes.push({ ...body.nodes[0], key: randomUUID(), parent_key: body.nodes[0].key });
  assert.throws(() => validateTree(body, null), /repetido/);
  const id = randomUUID();
  body.nodes = [body.nodes[0], ...[1, 2].map(() => ({ key: randomUUID(), parent_key: body.nodes[0].key, product_id: id, quantity: '1', unit_code: 'UN' }))];
  assert.throws(() => validateTree(body, null), /repetido/);
});
