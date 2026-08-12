import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../backend/src/database/pool.js';
import { suggestSuppliers } from '../backend/src/services/purchaseService.js';

after(async () => pool.end());

test('sugestões de fornecedores agrupam e ordenam sem erro 42P10', async () => {
  const suggestions = await suggestSuppliers(randomUUID());
  assert.deepEqual(suggestions, []);
});
