import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';
import { refreshInternalOrderStatus, refreshSoldItemStatus } from './statusService.js';

export async function createInternalOrder(payload, userId) {
  return transaction(async (client) => {
    if (!payload.items?.length) throw httpError(400, 'Informe ao menos um item na OS.');

    const orderResult = await client.query(
      `INSERT INTO internal_orders (sale_number, customer_name, customer_phone, promised_date, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [payload.sale_number, payload.customer_name, payload.customer_phone, payload.promised_date, userId],
    );
    const order = orderResult.rows[0];

    for (const item of payload.items || []) {
      if (!item.product_id) throw httpError(400, 'Informe o produto do item.');
      if (Number(item.quantity) < 1) throw httpError(400, 'A quantidade do item deve ser maior que zero.');

      const productResult = await client.query('SELECT * FROM products WHERE id = $1 AND is_active = TRUE', [item.product_id]);
      const product = productResult.rows[0];
      if (!product) throw httpError(404, 'Produto não encontrado.');
      if (product.type === 'material_prima') throw httpError(400, 'Matéria-prima não pode ser lançada diretamente na OS.');

      const soldItemResult = await client.query(
        `INSERT INTO sold_items (internal_order_id, product_id, product_name_snapshot, quantity)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [order.id, product.id, product.name, item.quantity || 1],
      );
      const soldItem = soldItemResult.rows[0];

      if (product.type === 'manufactured') {
        const components = await client.query('SELECT * FROM product_components WHERE product_id = $1', [product.id]);
        if (components.rows.length) {
          for (const component of components.rows) {
            await client.query(
              `INSERT INTO internal_tasks (sold_item_id, sector_id, task_name, quantity)
               VALUES ($1, $2, $3, $4)`,
              [soldItem.id, component.sector_id, component.component_name, component.quantity || 1],
            );
          }
        } else {
          if (!product.sector_id) throw httpError(400, 'Produto fabricado sem setor responsável.');
          await client.query(
            `INSERT INTO internal_tasks (sold_item_id, sector_id, task_name, quantity)
             VALUES ($1, $2, $3, $4)`,
            [soldItem.id, product.sector_id, product.name, item.quantity || 1],
          );
        }
      }

      const itemQuantity = Number(item.quantity || 1);
      const volumesPerUnit = Number(product.default_volume_quantity);
      const totalVolumes = itemQuantity * volumesPerUnit;
      const perVolumeWeight = Number(product.default_total_weight_kg) / volumesPerUnit;
      const labelStatus = product.type === 'resale' ? 'released_for_label' : 'waiting_tasks';
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
