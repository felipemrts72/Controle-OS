import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../backend/src/database/pool.js';
after(() => pool.end());
const smallest = async (c) => Number((await c.query('SELECT n FROM generate_series(1,(SELECT count(*)::int+1 FROM commercial_products)) n WHERE NOT EXISTS(SELECT 1 FROM commercial_products WHERE commercial_number=n) ORDER BY n LIMIT 1')).rows[0].n);

test('código automático usa menor livre, preserva referências e UNIQUE rejeita duplicação', async () => {
  const c = await pool.connect(); await c.query('BEGIN');
  try {
    const expected = await smallest(c);
    const p = (await c.query("INSERT INTO commercial_products(name) VALUES('Número rollback') RETURNING *")).rows[0];
    assert.equal(Number(p.commercial_number), expected);
    assert.equal(p.commercial_code, String(expected));
    const next = await smallest(c);
    const other = (await c.query("INSERT INTO commercial_products(name,commercial_code) VALUES('Referência rollback',$1) RETURNING *", [`REF-${Date.now()}`])).rows[0];
    assert.equal(Number(other.commercial_number), next);
    await c.query('UPDATE commercial_products SET commercial_code=NULL WHERE id=$1', [p.id]);
    assert.equal((await c.query('SELECT commercial_code FROM commercial_products WHERE id=$1', [p.id])).rows[0].commercial_code, p.commercial_code);
    await c.query('SAVEPOINT duplicate');
    await assert.rejects(c.query("INSERT INTO commercial_products(name,commercial_number) VALUES('Duplicado',$1)", [p.commercial_number]), (e) => e.code === '23505');
    await c.query('ROLLBACK TO SAVEPOINT duplicate');
  } finally { await c.query('ROLLBACK'); c.release(); }
});

test('duas conexões concorrentes aguardam allocator e recebem números diferentes', async () => {
  const a = await pool.connect(), b = await pool.connect(); const ids = [];
  await a.query('BEGIN'); await b.query('BEGIN');
  try {
    const p = (await a.query("INSERT INTO commercial_products(name) VALUES('Concorrência A controlada') RETURNING *")).rows[0]; ids.push(p.id);
    let finished = false;
    const pending = b.query("INSERT INTO commercial_products(name) VALUES('Concorrência B controlada') RETURNING *").then((r) => { finished = true; return r.rows[0]; });
    await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(finished, false);
    await a.query('COMMIT');
    const q = await pending; ids.push(q.id); assert.notEqual(q.commercial_number, p.commercial_number);
    await b.query('ROLLBACK');
  } finally {
    await a.query('ROLLBACK'); await b.query('ROLLBACK');
    await a.query('DELETE FROM commercial_products WHERE id=ANY($1::uuid[])', [ids]); a.release(); b.release();
  }
});
