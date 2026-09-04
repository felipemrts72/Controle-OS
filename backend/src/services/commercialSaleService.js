import { query } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';
import { copyProductRouteToSoldItemTasks } from './manufacturingRouteService.js';
import { refreshInternalOrderStatus, refreshSoldItemStatus } from './statusService.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value) {
  if (!UUID_PATTERN.test(String(value || ''))) throw httpError(400, 'Identificador inválido.');
}

function productionDecision(product, quantity) {
  if (!product) return { status: 'no_operational_product', reason: 'Item sem Produto interno vinculado.' };
  if (!product.is_active) return { status: 'inactive_product', reason: 'Produto interno inativo.' };
  if (product.type === 'resale') return { status: 'resale', reason: 'Produto de revenda não entra na Produção.' };
  if (product.type === 'material_prima') return { status: 'material_prima', reason: 'Matéria-prima não entra na Produção como item vendido.' };
  if (product.type !== 'manufactured') {
    return { status: 'incomplete_configuration', reason: 'Somente Produto interno do tipo fabricado entra na Produção.' };
  }
  if (product.review_status !== 'approved') return { status: 'pending_review', reason: 'Produto ainda não configurado para produção.' };
  if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1) {
    return { status: 'invalid_quantity', reason: 'A Produção exige quantidade inteira maior que zero.' };
  }
  const routeReady = product.route_steps > 0 && product.invalid_route_steps === 0;
  const componentsReady = product.route_steps === 0 && product.components > 0 && product.invalid_components === 0;
  const defaultTaskReady = product.route_steps === 0 && product.components === 0 && product.product_sector_active;
  if (!routeReady && !componentsReady && !defaultTaskReady) {
    return { status: 'incomplete_configuration', reason: 'Produto fabricado sem setor/roteiro operacional válido.' };
  }
  return { status: 'created', reason: 'Enviado para Produção.' };
}

async function getOperationalProducts(client, items) {
  const ids = [...new Set(items.map((item) => item.operational_product_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const result = await client.query(
    `SELECT p.*,
      (p.sector_id IS NOT NULL AND EXISTS(SELECT 1 FROM sectors ps WHERE ps.id=p.sector_id AND ps.is_active=TRUE)) AS product_sector_active,
      (SELECT COUNT(*)::int FROM product_manufacturing_steps pms WHERE pms.product_id=p.id) AS route_steps,
      (SELECT COUNT(*)::int FROM product_manufacturing_steps pms LEFT JOIN sectors s ON s.id=pms.sector_id
        WHERE pms.product_id=p.id AND (pms.sector_id IS NULL OR s.id IS NULL OR s.is_active=FALSE)) AS invalid_route_steps,
      (SELECT COUNT(*)::int FROM product_components pc WHERE pc.product_id=p.id) AS components,
      (SELECT COUNT(*)::int FROM product_components pc LEFT JOIN sectors s ON s.id=pc.sector_id
        WHERE pc.product_id=p.id AND (pc.sector_id IS NULL OR s.id IS NULL OR s.is_active=FALSE)) AS invalid_components
     FROM products p WHERE p.id=ANY($1::uuid[])`,
    [ids],
  );
  return new Map(result.rows.map((row) => [String(row.id), row]));
}

async function loadQuoteItems(client, quoteId) {
  const result = await client.query(
    `SELECT qi.*,
      COALESCE(qi.product_id, cp.operational_product_id) AS operational_product_id
     FROM commercial_quote_items qi
     LEFT JOIN commercial_products cp ON cp.id=qi.commercial_product_id
     WHERE qi.commercial_quote_id=$1
     ORDER BY qi.line_order`,
    [quoteId],
  );
  return result.rows;
}

async function loadPaymentSnapshot(client, quoteId) {
  const methods = (await client.query(
    'SELECT * FROM commercial_quote_payment_methods WHERE commercial_quote_id=$1 ORDER BY line_order',
    [quoteId],
  )).rows;
  if (!methods.length) return [];
  const installments = (await client.query(
    'SELECT * FROM commercial_quote_installments WHERE payment_method_id=ANY($1::uuid[]) ORDER BY payment_method_id,installment_number',
    [methods.map((method) => method.id)],
  )).rows;
  return methods.map((method) => ({
    ...method,
    installments: installments.filter((installment) => installment.payment_method_id === method.id),
  }));
}

async function createProductionOrder(client, sale, quote, saleItems, products, userId) {
  const eligible = saleItems.filter((item) => item.production_status === 'created');
  if (!eligible.length) return null;
  const customer = quote.customer_snapshot || {};
  const address = customer.address || {};
  const order = (await client.query(
    `INSERT INTO internal_orders (
      sale_number,customer_id,customer_name,customer_phone,promised_date,delivery_type,
      destination_city,destination_uf,created_by,commercial_sale_id,commercial_quote_id
     ) VALUES ($1,$2,$3,$4,NULL,'transportadora',$5,$6,$7,$8,$9) RETURNING *`,
    [`CV-${String(sale.sale_number).padStart(6, '0')}`, quote.customer_id,
      quote.customer_name_snapshot, customer.phone || customer.whatsapp || null,
      address.city || null, address.state || null, userId, sale.id, quote.id],
  )).rows[0];

  for (const saleItem of eligible) {
    const product = products.get(String(saleItem.operational_product_id));
    const soldItem = (await client.query(
      `INSERT INTO sold_items (
        internal_order_id,product_id,product_name_snapshot,quantity,commercial_sale_item_id
       ) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [order.id, product.id, saleItem.product_name_snapshot, Number(saleItem.quantity), saleItem.id],
    )).rows[0];
    const copiedRoute = await copyProductRouteToSoldItemTasks(client, {
      productId: product.id,
      soldItemId: soldItem.id,
      soldQuantity: Number(saleItem.quantity),
    });
    if (!copiedRoute) {
      const components = (await client.query(
        'SELECT * FROM product_components WHERE product_id=$1 ORDER BY created_at,id',
        [product.id],
      )).rows;
      if (components.length) {
        for (const component of components) {
          await client.query(
            `INSERT INTO internal_tasks (sold_item_id,sector_id,task_name,quantity)
             VALUES ($1,$2,$3,$4)`,
            [soldItem.id, component.sector_id, component.component_name, component.quantity || 1],
          );
        }
      } else {
        await client.query(
          `INSERT INTO internal_tasks (sold_item_id,sector_id,task_name,quantity)
           VALUES ($1,$2,$3,$4)`,
          [soldItem.id, product.sector_id, product.name, Number(saleItem.quantity)],
        );
      }
    }
    await refreshSoldItemStatus(client, soldItem.id);
  }
  await refreshInternalOrderStatus(client, order.id);
  await logAudit(client, {
    entityType: 'internal_order', entityId: order.id, action: 'create_from_commercial_sale',
    newValue: { commercial_sale_id: sale.id, commercial_quote_id: quote.id, item_count: eligible.length }, userId,
  });
  return order;
}

export async function createSaleForApprovedQuote(client, quote, userId) {
  const existing = (await client.query(
    'SELECT * FROM commercial_sales WHERE commercial_quote_id=$1', [quote.id],
  )).rows[0];
  if (existing) return existing;

  const quoteItems = await loadQuoteItems(client, quote.id);
  const products = await getOperationalProducts(client, quoteItems);
  const decisions = quoteItems.map((item) => productionDecision(
    products.get(String(item.operational_product_id || '')),
    item.quantity,
  ));
  const paymentSnapshot = await loadPaymentSnapshot(client, quote.id);
  const sale = (await client.query(
    `INSERT INTO commercial_sales (
      commercial_quote_id,commercial_number,quote_number,customer_id,customer_name_snapshot,
      customer_snapshot,quote_date,valid_until,items_gross_total,items_discount_total,subtotal,
      discount_amount,freight_amount,total,payment_methods_snapshot,notes,internal_notes,approved_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (commercial_quote_id) DO NOTHING RETURNING *`,
    [quote.id, quote.commercial_number, quote.quote_number, quote.customer_id, quote.customer_name_snapshot,
      quote.customer_snapshot, quote.quote_date, quote.valid_until, quote.items_gross_total,
      quote.items_discount_total, quote.subtotal, quote.discount_amount, quote.freight_amount, quote.total,
      JSON.stringify(paymentSnapshot), quote.notes, quote.internal_notes, userId],
  )).rows[0];
  if (!sale) return (await client.query('SELECT * FROM commercial_sales WHERE commercial_quote_id=$1', [quote.id])).rows[0];

  const saleItems = [];
  for (let index = 0; index < quoteItems.length; index += 1) {
    const item = quoteItems[index];
    const decision = decisions[index];
    const created = (await client.query(
      `INSERT INTO commercial_sale_items (
        commercial_sale_id,commercial_quote_item_id,line_order,item_type,commercial_product_id,
        operational_product_id,product_code_snapshot,product_name_snapshot,measurement_unit_snapshot,
        description_snapshot,quantity,unit_price,unit_discount_amount,discount_amount,subtotal,
        production_status,production_reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [sale.id, item.id, item.line_order, item.item_type, item.commercial_product_id,
        item.operational_product_id, item.product_code_snapshot,
        item.commercial_product_name_snapshot || item.product_name_snapshot,
        item.measurement_unit_snapshot, item.commercial_description_snapshot || item.description_snapshot,
        item.quantity, item.unit_price, item.unit_discount_amount ?? 0, item.discount_amount,
        item.subtotal, decision.status, decision.reason],
    )).rows[0];
    saleItems.push(created);
  }
  const order = await createProductionOrder(client, sale, quote, saleItems, products, userId);
  await logAudit(client, {
    entityType: 'commercial_sale', entityId: sale.id, action: 'create_from_quote',
    newValue: {
      commercial_quote_id: quote.id,
      production_order_id: order?.id || null,
      production_items: saleItems.filter((item) => item.production_status === 'created').length,
    }, userId,
  });
  return sale;
}

const saleSelect = `SELECT cs.*,cq.status AS quote_status,io.id AS production_order_id,io.status AS production_order_status,
  COUNT(csi.id)::int AS item_count,
  COUNT(*) FILTER (WHERE csi.production_status='created')::int AS production_item_count
 FROM commercial_sales cs
 JOIN commercial_quotes cq ON cq.id=cs.commercial_quote_id
 LEFT JOIN commercial_sale_items csi ON csi.commercial_sale_id=cs.id
 LEFT JOIN internal_orders io ON io.commercial_sale_id=cs.id`;

export async function listCommercialSales(params = {}, database = { query }) {
  const search = String(params.search || '').trim();
  const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 100);
  const result = await database.query(
    `${saleSelect}
     WHERE ($1='' OR cs.sale_number::text ILIKE '%'||$1||'%' OR cs.commercial_number::text ILIKE '%'||$1||'%'
       OR cs.customer_name_snapshot ILIKE '%'||$1||'%')
     GROUP BY cs.id,cq.status,io.id
     ORDER BY cs.created_at DESC LIMIT $2`,
    [search, limit],
  );
  return result.rows;
}

export async function getCommercialSale(id, database = { query }) {
  assertUuid(id);
  const sale = (await database.query(
    `${saleSelect} WHERE cs.id=$1 GROUP BY cs.id,cq.status,io.id`, [id],
  )).rows[0];
  if (!sale) throw httpError(404, 'Venda não encontrada.');
  const items = (await database.query(
    `SELECT csi.*,si.id AS sold_item_id,si.status AS production_item_status
     FROM commercial_sale_items csi
     LEFT JOIN sold_items si ON si.commercial_sale_item_id=csi.id
     WHERE csi.commercial_sale_id=$1 ORDER BY csi.line_order`, [id],
  )).rows;
  return { ...sale, items };
}

export async function getSaleByQuoteId(quoteId, database = { query }) {
  assertUuid(quoteId);
  const row = (await database.query(
    'SELECT id FROM commercial_sales WHERE commercial_quote_id=$1', [quoteId],
  )).rows[0];
  return row ? getCommercialSale(row.id, database) : null;
}

export const commercialSaleInternals = { productionDecision };
