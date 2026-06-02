import { query } from '../database/pool.js';

export async function dashboard(_req, res, next) {
  try {
    const result = await query(
      `SELECT io.*,
        COALESCE(COUNT(it.id), 0)::int AS total_tasks,
        COALESCE(COUNT(*) FILTER (WHERE it.status = 'ready'), 0)::int AS ready_tasks
       FROM internal_orders io
       LEFT JOIN sold_items si ON si.internal_order_id = io.id
       LEFT JOIN internal_tasks it ON it.sold_item_id = si.id
       GROUP BY io.id
       ORDER BY io.promised_date ASC`,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function tvBySector(req, res, next) {
  try {
    const result = await query(
      `SELECT it.*, s.name AS sector_name, io.sale_number, io.customer_name, io.promised_date, si.product_name_snapshot
       FROM internal_tasks it
       JOIN sectors s ON s.id = it.sector_id
       JOIN sold_items si ON si.id = it.sold_item_id
       JOIN internal_orders io ON io.id = si.internal_order_id
       WHERE s.slug = $1 AND it.status = 'pending'
       ORDER BY io.promised_date ASC`,
      [req.params.sectorId],
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}
