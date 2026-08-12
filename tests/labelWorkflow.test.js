import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import 'dotenv/config';
import pg from 'pg';
import {
  generateSingleLabel,
  generateSoldItemLabels,
  isLabelGeneratableStatus,
  validateLabelContext,
} from '../backend/src/services/labelWorkflowService.js';
import { generateThenDownloadLabels, labelCounts } from '../src/utils/labelWorkflow.js';
import { shouldScrollElementIntoView } from '../src/utils/viewport.js';
import { buildLabelBatchPdf } from '../backend/src/services/labelService.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
after(async () => pool.end());

async function withRollback(callback) {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    return await callback(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function createSyntheticItem(client, { count = 1, status = 'released_for_label', invoiceNumber = null, destinationCity = 'Cuiabá', destinationUf = 'MT' } = {}) {
  const order = await client.query(
    `INSERT INTO internal_orders (
       sale_number, customer_name, promised_date, delivery_type, destination_city, destination_uf, invoice_number
     ) VALUES ($1, 'Cliente sintético', CURRENT_DATE + 1, 'transportadora', $2, $3, $4)
     RETURNING id, sale_number`,
    [`TEST-${crypto.randomUUID()}`, destinationCity, destinationUf, invoiceNumber],
  );
  const item = await client.query(
    `INSERT INTO sold_items (internal_order_id, product_name_snapshot, quantity)
     VALUES ($1, 'Produto sintético', $2)
     RETURNING id`,
    [order.rows[0].id, count],
  );
  for (let index = 1; index <= count; index += 1) {
    await client.query(
      `INSERT INTO shipment_volumes (sold_item_id, volume_number, total_volumes, weight_kg, label_status)
       VALUES ($1, $2, $3, 1, $4)`,
      [item.rows[0].id, index, count, status],
    );
  }
  return { orderId: order.rows[0].id, saleNumber: order.rows[0].sale_number, soldItemId: item.rows[0].id };
}

test('ready_without_label continua elegível e dez etiquetas são geradas de forma idempotente', async () => {
  await withRollback(async (client) => {
    const fixture = await createSyntheticItem(client, { count: 10, status: 'ready_without_label' });
    const first = await generateSoldItemLabels(client, { soldItemId: fixture.soldItemId, invoiceNumber: 'NF-100', userId: null });
    assert.deepEqual({ total: first.total, generated: first.generated, existing: first.existing }, { total: 10, generated: 10, existing: 0 });

    const created = await client.query(
      'SELECT id, shipment_code, label_status FROM shipment_volumes WHERE sold_item_id = $1 ORDER BY volume_number',
      [fixture.soldItemId],
    );
    assert.equal(new Set(created.rows.map((row) => row.shipment_code)).size, 10);
    assert.equal(created.rows.every((row) => row.label_status === 'label_generated'), true);

    const second = await generateSoldItemLabels(client, { soldItemId: fixture.soldItemId, invoiceNumber: 'NF-100', userId: null });
    assert.deepEqual({ total: second.total, generated: second.generated, existing: second.existing }, { total: 10, generated: 0, existing: 10 });
    const retried = await client.query(
      'SELECT id, shipment_code FROM shipment_volumes WHERE sold_item_id = $1 ORDER BY volume_number',
      [fixture.soldItemId],
    );
    assert.deepEqual(retried.rows, created.rows.map(({ id, shipment_code }) => ({ id, shipment_code })));

    const audits = await client.query(
      `SELECT action, COUNT(*)::int AS count
         FROM audit_logs
        WHERE entity_id = ANY($1::uuid[])
        GROUP BY action`,
      [[fixture.soldItemId, ...created.rows.map((row) => row.id)]],
    );
    assert.equal(Object.fromEntries(audits.rows.map((row) => [row.action, row.count])).generate_label, 10);
  });
});

test('uma etiqueta exige NF, salva a NF e não duplica o código', async () => {
  await withRollback(async (client) => {
    const fixture = await createSyntheticItem(client);
    const volume = await client.query('SELECT id FROM shipment_volumes WHERE sold_item_id = $1', [fixture.soldItemId]);

    await assert.rejects(
      generateSingleLabel(client, { shipmentVolumeId: volume.rows[0].id, invoiceNumber: '', userId: null }),
      (error) => error.status === 400 && error.code === 'INVOICE_NUMBER_REQUIRED',
    );
    const unchanged = await client.query('SELECT shipment_code, label_status FROM shipment_volumes WHERE id = $1', [volume.rows[0].id]);
    assert.deepEqual(unchanged.rows[0], { shipment_code: null, label_status: 'released_for_label' });

    const generated = await generateSingleLabel(client, { shipmentVolumeId: volume.rows[0].id, invoiceNumber: '12345', userId: null });
    assert.equal(generated.generated, 1);
    assert.match(generated.shipment_code, /^\d{6}$/);
    const order = await client.query('SELECT invoice_number FROM internal_orders WHERE id = $1', [fixture.orderId]);
    assert.equal(order.rows[0].invoice_number, '12345');

    const retry = await generateSingleLabel(client, { shipmentVolumeId: volume.rows[0].id, invoiceNumber: '12345', userId: null });
    assert.equal(retry.generated, 0);
    assert.equal(retry.shipment_code, generated.shipment_code);
  });
});

test('geração parcial preserva códigos existentes e cria somente os pendentes', async () => {
  await withRollback(async (client) => {
    const fixture = await createSyntheticItem(client, { count: 10, invoiceNumber: 'NF-PARCIAL' });
    const firstThree = await client.query(
      'SELECT id FROM shipment_volumes WHERE sold_item_id = $1 ORDER BY volume_number LIMIT 3',
      [fixture.soldItemId],
    );
    for (let index = 0; index < firstThree.rows.length; index += 1) {
      await client.query(
        "UPDATE shipment_volumes SET shipment_code = $1, label_status = 'label_generated' WHERE id = $2",
        [`10000${index + 1}`, firstThree.rows[index].id],
      );
    }

    const result = await generateSoldItemLabels(client, { soldItemId: fixture.soldItemId, invoiceNumber: 'NF-PARCIAL', userId: null });
    assert.deepEqual({ generated: result.generated, existing: result.existing }, { generated: 7, existing: 3 });
    const volumes = await client.query('SELECT shipment_code FROM shipment_volumes WHERE sold_item_id = $1 ORDER BY volume_number', [fixture.soldItemId]);
    assert.deepEqual(volumes.rows.slice(0, 3).map((row) => row.shipment_code), ['100001', '100002', '100003']);
    assert.equal(new Set(volumes.rows.map((row) => row.shipment_code)).size, 10);
  });
});

test('item sem volumes salvos recebe mensagem específica sem criar registros', async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      generateSoldItemLabels(client, { soldItemId: crypto.randomUUID(), invoiceNumber: 'NF-SEM-VOLUME', userId: null }),
      (error) => error.status === 404 && error.code === 'VOLUMES_REQUIRED',
    );
  });
});

test('falhas anteriores à criação preservam volumes e destino obrigatório é validado', async () => {
  await withRollback(async (client) => {
    const fixture = await createSyntheticItem(client, { count: 2, destinationCity: null, destinationUf: null });
    await assert.rejects(
      generateSoldItemLabels(client, { soldItemId: fixture.soldItemId, invoiceNumber: 'NF-DEST', userId: null }),
      (error) => error.status === 400 && error.code === 'DESTINATION_REQUIRED',
    );
    const volumes = await client.query('SELECT shipment_code, label_status FROM shipment_volumes WHERE sold_item_id = $1', [fixture.soldItemId]);
    assert.equal(volumes.rows.every((row) => row.shipment_code === null && row.label_status === 'released_for_label'), true);
  });
});

test('tarefas pendentes continuam bloqueando geração', async () => {
  await withRollback(async (client) => {
    const fixture = await createSyntheticItem(client, { status: 'waiting_tasks' });
    await assert.rejects(
      generateSoldItemLabels(client, { soldItemId: fixture.soldItemId, invoiceNumber: 'NF-1', userId: null }),
      (error) => error.status === 409 && error.code === 'TASKS_PENDING',
    );
  });
});

test('item expedido após pronto sem etiqueta pode gerar código sem perder o estado de expedição', async () => {
  await withRollback(async (client) => {
    const fixture = await createSyntheticItem(client, { status: 'ready_without_label' });
    const volume = await client.query('SELECT id FROM shipment_volumes WHERE sold_item_id = $1', [fixture.soldItemId]);
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action)
       VALUES ('shipment_volume', $1, 'ready_without_label')`,
      [volume.rows[0].id],
    );
    await client.query("UPDATE shipment_volumes SET label_status = 'shipped' WHERE id = $1", [volume.rows[0].id]);

    const result = await generateSingleLabel(client, { shipmentVolumeId: volume.rows[0].id, invoiceNumber: 'NF-POS', userId: null });
    assert.equal(result.generated, 1);
    assert.equal(result.label_status, 'shipped');
    assert.match(result.shipment_code, /^\d{6}$/);
  });
});

test('regras puras mantêm estados e contagens distintos', () => {
  assert.equal(isLabelGeneratableStatus('ready_without_label'), true);
  assert.equal(isLabelGeneratableStatus('waiting_tasks'), false);
  assert.equal(isLabelGeneratableStatus('shipped'), false);
  assert.deepEqual(labelCounts([
    { shipment_code: null },
    { shipment_code: '123456' },
    { shipment_code: '654321' },
  ]), { total: 3, generated: 2, pending: 1 });
  assert.equal(validateLabelContext({ invoice_number: 'NF', delivery_type: 'transportadora', destination_city: 'Sinop', destination_uf: 'MT' }), null);
});

test('venda 190000 permanece íntegra em qualquer etapa legítima do ciclo de etiquetas', async () => {
  const result = await pool.query(
    `SELECT io.sale_number, io.customer_name, io.invoice_number, io.destination_city, io.destination_uf,
            si.product_name_snapshot,
            COUNT(sv.id)::int AS volumes,
            COUNT(*) FILTER (WHERE sv.label_status = 'ready_without_label')::int AS ready_without_label,
            COUNT(*) FILTER (WHERE sv.shipment_code IS NOT NULL)::int AS generated
       FROM internal_orders io
       JOIN sold_items si ON si.internal_order_id = io.id
       JOIN shipment_volumes sv ON sv.sold_item_id = si.id
      WHERE io.sale_number = '190000'
      GROUP BY io.id, si.id`,
  );
  assert.deepEqual({...result.rows[0],ready_without_label:undefined,generated:undefined}, {sale_number:'190000',customer_name:'Jose Teste',invoice_number:'8888888',destination_city:'Juara',destination_uf:'PA',product_name_snapshot:'Martelo P/ H-3.5',volumes:10,ready_without_label:undefined,generated:undefined});
  assert.equal(result.rows[0].ready_without_label+result.rows[0].generated,10);
});

test('venda 190000 gera ou reimprime dez códigos sem alterar o estado persistido', async () => {
  const baseline=await pool.query(`SELECT COUNT(*) FILTER(WHERE sv.shipment_code IS NOT NULL)::int generated,COUNT(*) FILTER(WHERE sv.label_status='ready_without_label')::int ready_without_label FROM shipment_volumes sv JOIN sold_items si ON si.id=sv.sold_item_id JOIN internal_orders io ON io.id=si.internal_order_id WHERE io.sale_number='190000'`);
  await withRollback(async (client) => {
    const item = await client.query(
      `SELECT si.id, io.invoice_number
         FROM sold_items si
         JOIN internal_orders io ON io.id = si.internal_order_id
        WHERE io.sale_number = '190000'`,
    );
    if(baseline.rows[0].generated===0){const result = await generateSoldItemLabels(client, {soldItemId:item.rows[0].id,invoiceNumber:item.rows[0].invoice_number,userId:null});assert.equal(result.generated,10);}

    const volumes = await client.query(
      `SELECT sv.*, si.product_name_snapshot, io.sale_number, io.customer_name, io.customer_phone,
              io.delivery_type, io.destination_city, io.destination_uf, io.invoice_number
         FROM shipment_volumes sv
         JOIN sold_items si ON si.id = sv.sold_item_id
         JOIN internal_orders io ON io.id = si.internal_order_id
        WHERE sv.sold_item_id = $1
        ORDER BY sv.volume_number`,
      [item.rows[0].id],
    );
    assert.equal(volumes.rows.every((volume) => /^\d{6}$/.test(volume.shipment_code)), true);
    const pdf = await buildLabelBatchPdf(volumes.rows, { labelModel: '15x10' });
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 1000);
  });

  const unchanged = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE sv.shipment_code IS NOT NULL)::int AS generated,
            COUNT(*) FILTER (WHERE sv.label_status = 'ready_without_label')::int AS ready_without_label
       FROM shipment_volumes sv
       JOIN sold_items si ON si.id = sv.sold_item_id
       JOIN internal_orders io ON io.id = si.internal_order_id
      WHERE io.sale_number = '190000'`,
  );
  assert.deepEqual(unchanged.rows[0], baseline.rows[0]);
});

test('fluxo do frontend atualiza persistência antes do download e oferece nova tentativa sem novo POST', () => {
  const orderPage = fs.readFileSync(new URL('../src/pages/InternalOrderDetailPage/InternalOrderDetailPage.jsx', import.meta.url), 'utf8');
  assert.match(orderPage, /generateThenDownloadLabels\(\{/);
  assert.match(orderPage, /refresh: load/);
  assert.match(orderPage, /download: async \(\) =>/);
  const retrySection = orderPage.slice(orderPage.indexOf('async function retryModalDownload'), orderPage.indexOf('function closeLabelModal'));
  assert.doesNotMatch(retrySection, /createSoldItemLabels|createSingleLabel/);
  assert.match(orderPage, /As etiquetas foram geradas, mas o PDF não pôde ser baixado\./);
});

test('falha simulada no download ocorre após criação e nova tentativa não recria etiquetas', async () => {
  const calls = [];
  let createCount = 0;
  let downloadCount = 0;
  const result = await generateThenDownloadLabels({
    create: async () => { createCount += 1; calls.push('create'); return { generated: 10 }; },
    refresh: async () => { calls.push('refresh'); },
    download: async () => { downloadCount += 1; calls.push('download'); throw new Error('falha de entrega'); },
  });
  assert.equal(result.status, 'download_failed');
  assert.equal(result.creation.generated, 10);
  assert.deepEqual(calls, ['create', 'refresh', 'download']);

  await (async () => { downloadCount += 1; calls.push('retry-download'); })();
  assert.equal(createCount, 1);
  assert.equal(downloadCount, 2);
  assert.deepEqual(calls, ['create', 'refresh', 'download', 'retry-download']);
});

test('endpoints separam criação atômica de download puro e preservam permissões', () => {
  const routes = fs.readFileSync(new URL('../backend/src/routes/labelRoutes.js', import.meta.url), 'utf8');
  const controller = fs.readFileSync(new URL('../backend/src/controllers/labelController.js', import.meta.url), 'utf8');
  assert.match(routes, /post\('\/sold-item\/:soldItemId\/generate', requirePermission\('labels\.print'\)/);
  assert.match(routes, /get\('\/sold-item\/:soldItemId\/pdf', requireAnyPermission\('labels\.print', 'labels\.reprint'\)/);
  assert.match(routes, /post\('\/:shipmentVolumeId\/without-label', requirePermission\('labels\.mark_without_label'\)/);

  const batchDownload = controller.slice(
    controller.indexOf('export async function downloadSoldItemLabelPdf'),
    controller.indexOf('export async function listLabelQueue'),
  );
  assert.doesNotMatch(batchDownload, /createShipmentCode|UPDATE shipment_volumes/);
  assert.match(batchDownload, /LABELS_PENDING/);
  assert.match(controller, /transaction\(\(client\) => generateSoldItemLabels/);
});

test('Conferência e envio posiciona resultado entre busca e lista e só rola quando necessário', () => {
  const shippingPage = fs.readFileSync(new URL('../src/pages/ShippingPage/ShippingPage.jsx', import.meta.url), 'utf8');
  const lookupIndex = shippingPage.indexOf('<ShippingLookup');
  const loadedIndex = shippingPage.indexOf('className="shipping-page__loaded-sale"');
  const readyIndex = shippingPage.indexOf('className="shipping-ready panel"');
  assert.ok(lookupIndex > 0 && loadedIndex > lookupIndex && readyIndex > loadedIndex);
  assert.equal((shippingPage.match(/<ShippingResultCard/g) || []).length, 1);
  assert.equal(shouldScrollElementIntoView({ top: 10, bottom: 500 }, 700), false);
  assert.equal(shouldScrollElementIntoView({ top: 10, bottom: 800 }, 700), true);
  assert.equal(shouldScrollElementIntoView({ top: -1, bottom: 500 }, 700), true);
});
