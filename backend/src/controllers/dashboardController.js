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

export async function tvPanel(_req, res, next) {
  try {
    const tasksResult = await query(
      `SELECT it.id AS task_id,
        it.task_name,
        it.quantity,
        s.name AS sector_name,
        s.slug AS sector_slug,
        io.sale_number,
        io.customer_name,
        io.promised_date,
        io.promised_date < CURRENT_DATE AS is_late
       FROM internal_tasks it
       JOIN sectors s ON s.id = it.sector_id
       JOIN sold_items si ON si.id = it.sold_item_id
       JOIN internal_orders io ON io.id = si.internal_order_id
       WHERE s.is_active = TRUE
         AND it.status = 'pending'
         AND (
           s.slug <> 'pintura'
           OR NOT EXISTS (
             SELECT 1
             FROM internal_tasks dependency
             JOIN sectors dependency_sector ON dependency_sector.id = dependency.sector_id
             WHERE dependency.sold_item_id = it.sold_item_id
               AND dependency.id <> it.id
               AND dependency.status = 'pending'
               AND dependency_sector.slug <> 'pintura'
           )
         )
       ORDER BY (io.promised_date < CURRENT_DATE) DESC, io.promised_date ASC, it.created_at ASC`,
    );
    res.json(tasksResult.rows);
  } catch (error) { next(error); }
}

export async function tvBySector(req, res, next) {
  try {
    const result = await query(
      `SELECT it.id AS task_id,
        it.task_name,
        it.quantity,
        s.name AS sector_name,
        s.slug AS sector_slug,
        io.sale_number,
        io.customer_name,
        io.promised_date,
        io.promised_date < CURRENT_DATE AS is_late
       FROM internal_tasks it
       JOIN sectors s ON s.id = it.sector_id
       JOIN sold_items si ON si.id = it.sold_item_id
       JOIN internal_orders io ON io.id = si.internal_order_id
       WHERE s.slug = $1
         AND s.is_active = TRUE
         AND it.status = 'pending'
         AND (
           s.slug <> 'pintura'
           OR NOT EXISTS (
             SELECT 1
             FROM internal_tasks dependency
             JOIN sectors dependency_sector ON dependency_sector.id = dependency.sector_id
             WHERE dependency.sold_item_id = it.sold_item_id
               AND dependency.id <> it.id
               AND dependency.status = 'pending'
               AND dependency_sector.slug <> 'pintura'
           )
         )
       ORDER BY (io.promised_date < CURRENT_DATE) DESC, io.promised_date ASC, it.created_at ASC`,
      [req.params.sectorId],
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}
