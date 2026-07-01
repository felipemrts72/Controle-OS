import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';
import { refreshInternalOrderStatus, refreshSoldItemStatus } from './statusService.js';
import { copyProductRouteToSoldItemTasks } from './manufacturingRouteService.js';

const DELIVERY_TYPES = new Set(['transportadora', 'retirada', 'frota_propria']);

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

    const duplicate = await client.query('SELECT id FROM internal_orders WHERE sale_number = $1', [payload.sale_number]);
    if (duplicate.rows[0]) {
      throw httpError(409, 'Já existe uma OS cadastrada com este número de venda. Verifique o número informado ou utilize outro número.', {
        code: 'SALE_NUMBER_ALREADY_EXISTS',
        field: 'sale_number',
      });
    }

    const orderResult = await client.query(
      `INSERT INTO internal_orders (
        sale_number, customer_name, customer_phone, promised_date,
        delivery_type, carrier_name, destination_city, destination_uf, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        payload.sale_number,
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
