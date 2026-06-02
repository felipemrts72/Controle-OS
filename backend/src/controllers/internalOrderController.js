import { query, transaction } from '../database/pool.js';
import { createInternalOrder } from '../services/orderService.js';
import { refreshInternalOrderStatus } from '../services/statusService.js';
import { httpError } from '../utils/httpError.js';

export async function listInternalOrders(_req, res, next) {
  try {
    const result = await query(
      `SELECT io.*,
        COALESCE(task_counts.ready, 0) AS ready_tasks,
        COALESCE(task_counts.total, 0) AS total_tasks
       FROM internal_orders io
       LEFT JOIN (
         SELECT si.internal_order_id, COUNT(it.id)::int AS total, COUNT(*) FILTER (WHERE it.status = 'ready')::int AS ready
         FROM sold_items si LEFT JOIN internal_tasks it ON it.sold_item_id = si.id
         GROUP BY si.internal_order_id
       ) task_counts ON task_counts.internal_order_id = io.id
       ORDER BY io.promised_date ASC`,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function createOrder(req, res, next) {
  try {
    const order = await createInternalOrder(req.body, req.user.id);
    res.status(201).json(order);
  } catch (error) { next(error); }
}

export async function getInternalOrder(req, res, next) {
  try {
    const order = await query('SELECT * FROM internal_orders WHERE id = $1', [req.params.id]);
    if (!order.rows[0]) throw httpError(404, 'OS não encontrada.');
    const items = await query(
      `SELECT si.*, p.type AS product_type FROM sold_items si
       LEFT JOIN products p ON p.id = si.product_id
       WHERE si.internal_order_id = $1 ORDER BY si.created_at`,
      [req.params.id],
    );
    const itemIds = items.rows.map((item) => item.id);
    const tasks = itemIds.length ? await query(
      `SELECT it.*, s.name AS sector_name FROM internal_tasks it
       LEFT JOIN sectors s ON s.id = it.sector_id
       WHERE it.sold_item_id = ANY($1) ORDER BY it.created_at`,
      [itemIds],
    ) : { rows: [] };
    const volumes = itemIds.length ? await query(
      'SELECT * FROM shipment_volumes WHERE sold_item_id = ANY($1) ORDER BY sold_item_id, volume_number',
      [itemIds],
    ) : { rows: [] };
    res.json({ ...order.rows[0], items: items.rows, tasks: tasks.rows, volumes: volumes.rows });
  } catch (error) { next(error); }
}

export async function updateInternalOrder(req, res, next) {
  try {
    const result = await transaction(async (client) => {
      const order = await client.query(
        `UPDATE internal_orders SET sale_number = $1, customer_name = $2, customer_phone = $3, promised_date = $4, updated_at = NOW()
         WHERE id = $5 RETURNING *`,
        [req.body.sale_number, req.body.customer_name, req.body.customer_phone, req.body.promised_date, req.params.id],
      );
      for (const volume of req.body.volumes || []) {
        if (volume.id) {
          await client.query(
            `UPDATE shipment_volumes SET volume_number = $1, total_volumes = $2, weight_kg = $3, description = $4, updated_at = NOW()
             WHERE id = $5 AND label_status IN ('waiting_tasks', 'released_for_label')`,
            [volume.volume_number, volume.total_volumes, volume.weight_kg, volume.description, volume.id],
          );
        } else if (volume.sold_item_id) {
          await client.query(
            `INSERT INTO shipment_volumes (sold_item_id, volume_number, total_volumes, weight_kg, description, label_status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [volume.sold_item_id, volume.volume_number, volume.total_volumes, volume.weight_kg, volume.description, volume.label_status || 'waiting_tasks'],
          );
        }
      }
      const keptIds = (req.body.volumes || []).filter((volume) => volume.id).map((volume) => volume.id);
      if (keptIds.length) {
        await client.query(
          `DELETE FROM shipment_volumes
           WHERE sold_item_id IN (SELECT id FROM sold_items WHERE internal_order_id = $1)
             AND label_status IN ('waiting_tasks', 'released_for_label')
             AND NOT (id = ANY($2))`,
          [req.params.id, keptIds],
        );
      }
      await refreshInternalOrderStatus(client, req.params.id);
      return order.rows[0];
    });
    res.json(result);
  } catch (error) { next(error); }
}
