import { query } from '../database/pool.js';

export async function listServices(_req, res, next) {
  try {
    const tasksResult = await query(
      `SELECT io.id AS internal_order_id,
        io.sale_number,
        io.customer_name,
        io.promised_date,
        it.id AS task_id,
        it.task_name,
        it.quantity,
        s.name AS sector_name,
        s.slug AS sector_slug,
        it.status,
        si.product_name_snapshot AS product_name,
        it.created_at
       FROM internal_tasks it
       JOIN sectors s ON s.id = it.sector_id
       JOIN sold_items si ON si.id = it.sold_item_id
       JOIN internal_orders io ON io.id = si.internal_order_id
       WHERE s.is_active = TRUE
       ORDER BY io.promised_date ASC, io.sale_number ASC, it.created_at ASC`,
    );

    const ordersById = tasksResult.rows.reduce((groups, row) => {
      const current = groups.get(row.internal_order_id) || {
        internal_order_id: row.internal_order_id,
        sale_number: row.sale_number,
        customer_name: row.customer_name,
        promised_date: row.promised_date,
        pending_tasks_count: 0,
        ready_tasks_count: 0,
        tasks: [],
      };

      if (row.status === 'ready') current.ready_tasks_count += 1;
      if (row.status === 'pending') current.pending_tasks_count += 1;

      current.tasks.push({
        task_id: row.task_id,
        task_name: row.task_name,
        quantity: row.quantity,
        sector_name: row.sector_name,
        sector_slug: row.sector_slug,
        status: row.status,
        product_name: row.product_name,
        promised_date: row.promised_date,
      });
      groups.set(row.internal_order_id, current);
      return groups;
    }, new Map());

    res.json([...ordersById.values()]);
  } catch (error) {
    next(error);
  }
}
