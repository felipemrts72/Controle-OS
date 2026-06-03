import { query, transaction } from '../database/pool.js';
import { createInternalOrder } from '../services/orderService.js';
import { logAudit } from '../services/auditService.js';
import { refreshInternalOrderStatus } from '../services/statusService.js';
import { httpError } from '../utils/httpError.js';

export async function listInternalOrders(_req, res, next) {
  try {
    const result = await query(
      `SELECT io.*,
        COALESCE(task_counts.ready, 0) AS ready_tasks,
        COALESCE(task_counts.total, 0) AS total_tasks,
        COALESCE(volume_counts.ready, 0) AS ready_volumes,
        COALESCE(volume_counts.total, 0) AS total_volumes
       FROM internal_orders io
       LEFT JOIN (
         SELECT si.internal_order_id, COUNT(it.id)::int AS total, COUNT(*) FILTER (WHERE it.status = 'ready')::int AS ready
         FROM sold_items si LEFT JOIN internal_tasks it ON it.sold_item_id = si.id
         GROUP BY si.internal_order_id
       ) task_counts ON task_counts.internal_order_id = io.id
       LEFT JOIN (
         SELECT si.internal_order_id, COUNT(sv.id)::int AS total,
          COUNT(*) FILTER (WHERE sv.label_status IN ('label_generated', 'ready_without_label', 'shipped'))::int AS ready
         FROM sold_items si LEFT JOIN shipment_volumes sv ON sv.sold_item_id = si.id
         GROUP BY si.internal_order_id
       ) volume_counts ON volume_counts.internal_order_id = io.id
       WHERE COALESCE(io.status, 'pending') <> 'deleted'
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
    const order = await query(
      `SELECT io.*,
        created_user.name AS created_by_name,
        deleted_user.name AS deleted_by_name
       FROM internal_orders io
       LEFT JOIN users created_user ON created_user.id = io.created_by
       LEFT JOIN users deleted_user ON deleted_user.id = io.deleted_by
       WHERE io.id = $1`,
      [req.params.id],
    );
    if (!order.rows[0]) throw httpError(404, 'OS não encontrada.');
    const items = await query(
      `SELECT si.*,
        p.type AS product_type,
        p.default_volume_quantity,
        p.default_total_weight_kg,
        COALESCE(volume_totals.total_volumes, 0)::int AS total_volumes,
        COALESCE(volume_totals.total_weight_kg, 0)::numeric AS total_weight_kg
       FROM sold_items si
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN (
         SELECT sold_item_id,
          COUNT(*) AS total_volumes,
          SUM(weight_kg) AS total_weight_kg
         FROM shipment_volumes
         GROUP BY sold_item_id
       ) volume_totals ON volume_totals.sold_item_id = si.id
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
      `SELECT sv.*,
        shipped_user.name AS shipped_by_name,
        shipped_user.role AS shipped_by_role
       FROM shipment_volumes sv
       LEFT JOIN users shipped_user ON shipped_user.id = sv.shipped_by
       WHERE sv.sold_item_id = ANY($1)
       ORDER BY sv.sold_item_id, sv.volume_number`,
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

export async function deleteInternalOrder(req, res, next) {
  try {
    await transaction(async (client) => {
      const current = await client.query('SELECT * FROM internal_orders WHERE id = $1', [req.params.id]);
      if (!current.rows[0]) throw httpError(404, 'OS não encontrada.');
      if (current.rows[0].status === 'deleted') return;

      const updated = await client.query(
        `UPDATE internal_orders
         SET status = 'deleted', deleted_by = $1, deleted_at = NOW(), updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [req.user.id, req.params.id],
      );

      await logAudit(client, {
        entityType: 'internal_order',
        entityId: req.params.id,
        action: 'soft_delete',
        previousValue: current.rows[0],
        newValue: updated.rows[0],
        userId: req.user.id,
      });
    });
    res.status(204).send();
  } catch (error) { next(error); }
}

export async function listInternalOrderHistory(req, res, next) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offset = (page - 1) * limit;
    const status = req.query.status || 'todos';
    const filters = [];
    const params = [];

    if (status === 'excluidas') {
      filters.push("io.status = 'deleted'");
    } else if (status === 'finalizadas') {
      filters.push("io.status = 'shipped'");
    } else if (status === 'andamento') {
      filters.push("COALESCE(io.status, 'pending') NOT IN ('shipped', 'deleted')");
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await query(`SELECT COUNT(*)::int AS total FROM internal_orders io ${where}`, params);
    const total = countResult.rows[0]?.total || 0;

    const result = await query(
      `SELECT io.*,
        created_user.name AS created_by_name,
        deleted_user.name AS deleted_by_name,
        COALESCE(task_counts.ready, 0)::int AS ready_tasks,
        COALESCE(task_counts.total, 0)::int AS total_tasks,
        COALESCE(volume_counts.shipped, 0)::int AS shipped_volumes,
        COALESCE(volume_counts.total, 0)::int AS total_volumes,
        volume_counts.last_shipped_at
       FROM internal_orders io
       LEFT JOIN users created_user ON created_user.id = io.created_by
       LEFT JOIN users deleted_user ON deleted_user.id = io.deleted_by
       LEFT JOIN (
         SELECT si.internal_order_id, COUNT(it.id)::int AS total, COUNT(*) FILTER (WHERE it.status = 'ready')::int AS ready
         FROM sold_items si LEFT JOIN internal_tasks it ON it.sold_item_id = si.id
         GROUP BY si.internal_order_id
       ) task_counts ON task_counts.internal_order_id = io.id
       LEFT JOIN (
         SELECT si.internal_order_id,
          COUNT(sv.id)::int AS total,
          COUNT(*) FILTER (WHERE sv.label_status = 'shipped')::int AS shipped,
          MAX(sv.shipped_at) AS last_shipped_at
         FROM sold_items si LEFT JOIN shipment_volumes sv ON sv.sold_item_id = si.id
         GROUP BY si.internal_order_id
       ) volume_counts ON volume_counts.internal_order_id = io.id
       ${where}
       ORDER BY COALESCE(io.deleted_at, volume_counts.last_shipped_at, io.updated_at, io.created_at) DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({
      items: result.rows,
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) { next(error); }
}
