import { query, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';
import { refreshInternalOrderStatus, refreshSoldItemStatus } from './statusService.js';
import { copyProductRouteToSoldItemTasks } from './manufacturingRouteService.js';

const DELIVERY_TYPES = new Set(['transportadora', 'retirada', 'frota_propria']);

function collapseSpaces(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeCustomerName(value) {
  return collapseSpaces(value).toLowerCase();
}

function normalizeCustomerKey(value) {
  return normalizeCustomerName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function resolveCustomerLocation(payload) {
  return collapseSpaces(payload.destination_city || '') || null;
}

function isVerySimilarName(firstName, secondName) {
  const first = normalizeCustomerKey(firstName);
  const second = normalizeCustomerKey(secondName);
  if (!first || !second) return false;
  if (first === second) return true;
  if (first.length < 5 || second.length < 5) return false;
  return first.startsWith(second) || second.startsWith(first);
}

async function findSimilarCustomer(client, name) {
  const normalizedName = normalizeCustomerName(name);
  const firstToken = normalizedName.split(' ')[0] || normalizedName;
  if (!firstToken) return null;

  const result = await client.query(
    `SELECT *
     FROM customers
     WHERE normalized_name = $1
        OR normalized_name LIKE $2
     ORDER BY updated_at DESC
     LIMIT 25`,
    [normalizedName, `${firstToken}%`],
  );

  return result.rows.find((customer) => isVerySimilarName(customer.name, name)) || null;
}

export async function searchCustomers(term) {
  const normalizedTerm = normalizeCustomerName(term);
  if (normalizedTerm.length < 2) return [];

  const result = await query(
    `SELECT id, name, phone, location
     FROM customers
     WHERE normalized_name LIKE $1
     ORDER BY
       CASE WHEN normalized_name = $2 THEN 0 ELSE 1 END,
       updated_at DESC,
       name ASC
     LIMIT 8`,
    [`%${normalizedTerm}%`, normalizedTerm],
  );
  return result.rows;
}

export async function upsertCustomerForOrder(client, payload) {
  const name = collapseSpaces(payload.customer_name);
  if (!name) return null;

  const phone = collapseSpaces(payload.customer_phone) || null;
  const location = resolveCustomerLocation(payload);

  if (payload.customer_id) {
    const current = await client.query('SELECT * FROM customers WHERE id = $1', [payload.customer_id]);
    if (current.rows[0]) {
      const normalizedName = normalizeCustomerName(name);
      const duplicate = await client.query(
        'SELECT * FROM customers WHERE normalized_name = $1 AND id <> $2 LIMIT 1',
        [normalizedName, payload.customer_id],
      );
      if (duplicate.rows[0]) {
        const updatedDuplicate = await client.query(
          `UPDATE customers
           SET name = $1,
            phone = $2,
            location = $3,
            updated_at = NOW()
           WHERE id = $4
           RETURNING *`,
          [name, phone, location, duplicate.rows[0].id],
        );
        return updatedDuplicate.rows[0];
      }

      const updated = await client.query(
        `UPDATE customers
         SET name = $1,
          normalized_name = $2,
          phone = $3,
          location = $4,
          updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [name, normalizedName, phone, location, payload.customer_id],
      );
      return updated.rows[0];
    }
  }

  const existingCustomer = await findSimilarCustomer(client, name);
  if (existingCustomer) {
    const updated = await client.query(
      `UPDATE customers
       SET name = $1,
        normalized_name = $2,
        phone = $3,
        location = $4,
        updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name, normalizeCustomerName(name), phone, location, existingCustomer.id],
    );
    return updated.rows[0];
  }

  const created = await client.query(
    `INSERT INTO customers (name, normalized_name, phone, location)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (normalized_name) DO UPDATE
       SET name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location,
        updated_at = NOW()
     RETURNING *`,
    [name, normalizeCustomerName(name), phone, location],
  );
  return created.rows[0];
}

export function normalizeDeliveryPayload(payload) {
  const deliveryType = payload.delivery_type || 'transportadora';
  if (!DELIVERY_TYPES.has(deliveryType)) {
    throw httpError(400, 'Tipo de entrega invalido.', { code: 'INVALID_DELIVERY_TYPE', field: 'delivery_type' });
  }

  return {
    delivery_type: deliveryType,
    carrier_name: deliveryType === 'transportadora' ? payload.carrier_name || null : null,
    destination_city: deliveryType === 'retirada' ? null : payload.destination_city || null,
    destination_uf: deliveryType === 'retirada' ? null : (payload.destination_uf || null)?.toUpperCase(),
  };
}

export async function createInternalOrder(payload, userId) {
  return transaction(async (client) => {
    if (!payload.items?.length) throw httpError(400, 'Informe ao menos um item na OS.');
    const delivery = normalizeDeliveryPayload(payload);
    const customer = await upsertCustomerForOrder(client, { ...payload, ...delivery });

    const duplicate = await client.query('SELECT id FROM internal_orders WHERE sale_number = $1', [payload.sale_number]);
    if (duplicate.rows[0]) {
      throw httpError(409, 'Já existe uma OS cadastrada com este número de venda. Verifique o número informado ou utilize outro número.', {
        code: 'SALE_NUMBER_ALREADY_EXISTS',
        field: 'sale_number',
      });
    }

    const orderResult = await client.query(
      `INSERT INTO internal_orders (
        sale_number, customer_id, customer_name, customer_phone, promised_date,
        delivery_type, carrier_name, destination_city, destination_uf, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        payload.sale_number,
        customer?.id || null,
        payload.customer_name,
        payload.customer_phone,
        payload.promised_date,
        delivery.delivery_type,
        delivery.carrier_name,
        delivery.destination_city,
        delivery.destination_uf,
        userId,
      ],
    );
    const order = orderResult.rows[0];

    for (const item of payload.items || []) {
      if (!item.product_id) throw httpError(400, 'Informe o produto do item.');
      if (Number(item.quantity) < 1) throw httpError(400, 'A quantidade do item deve ser maior que zero.');

      const productResult = await client.query('SELECT * FROM products WHERE id = $1 AND is_active = TRUE', [item.product_id]);
      const product = productResult.rows[0];
      if (!product) throw httpError(404, 'Produto não encontrado.');
      if (product.type === 'material_prima' && !item.is_spare_part) {
        throw httpError(400, 'Matéria-prima só pode ser lançada na OS como peça de reposição.', {
          code: 'MATERIAL_REQUIRES_SPARE_PART',
          field: 'is_spare_part',
        });
      }

      const soldItemResult = await client.query(
        `INSERT INTO sold_items (internal_order_id, product_id, product_name_snapshot, quantity, is_spare_part)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [order.id, product.id, product.name, item.quantity || 1, item.is_spare_part === true],
      );
      const soldItem = soldItemResult.rows[0];
      let hasProductionTasks = false;

      const copiedRoute = await copyProductRouteToSoldItemTasks(client, {
        productId: product.id,
        soldItemId: soldItem.id,
        soldQuantity: item.quantity || 1,
      });
      hasProductionTasks = copiedRoute;

      if (!copiedRoute && (product.type === 'manufactured' || item.is_spare_part === true)) {
        const components = await client.query('SELECT * FROM product_components WHERE product_id = $1', [product.id]);
        if (components.rows.length) {
          for (const component of components.rows) {
            await client.query(
              `INSERT INTO internal_tasks (sold_item_id, sector_id, task_name, quantity)
               VALUES ($1, $2, $3, $4)`,
              [soldItem.id, component.sector_id, component.component_name, component.quantity || 1],
            );
          }
          hasProductionTasks = true;
        } else {
          if (!product.sector_id) throw httpError(400, 'Produto sem setor responsável.');
          await client.query(
            `INSERT INTO internal_tasks (sold_item_id, sector_id, task_name, quantity)
             VALUES ($1, $2, $3, $4)`,
            [soldItem.id, product.sector_id, product.name, item.quantity || 1],
          );
          hasProductionTasks = true;
        }
      }

      const itemQuantity = Number(item.quantity || 1);
      const volumesPerUnit = Number(product.default_volume_quantity);
      const totalVolumes = itemQuantity * volumesPerUnit;
      const perVolumeWeight = Number(product.default_total_weight_kg) / volumesPerUnit;
      const labelStatus = hasProductionTasks ? 'waiting_tasks' : 'released_for_label';
      for (let index = 1; index <= totalVolumes; index += 1) {
        await client.query(
          `INSERT INTO shipment_volumes (sold_item_id, volume_number, total_volumes, weight_kg, description, label_status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [soldItem.id, index, totalVolumes, perVolumeWeight, item.description || product.name, labelStatus],
        );
      }
      await refreshSoldItemStatus(client, soldItem.id);
    }

    await logAudit(client, { entityType: 'internal_order', entityId: order.id, action: 'create', newValue: payload, userId });
    await refreshInternalOrderStatus(client, order.id);
    return order;
  });
}
