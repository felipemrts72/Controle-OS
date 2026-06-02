import { query, transaction } from '../database/pool.js';
import { logAudit } from '../services/auditService.js';
import { refreshSoldItemStatus } from '../services/statusService.js';

export async function setTaskStatus(req, res, next) {
  try {
    const nextStatus = req.path.endsWith('/ready') ? 'ready' : 'pending';
    const task = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE internal_tasks
         SET status = $1, completed_by = $2, completed_at = $3, updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [nextStatus, nextStatus === 'ready' ? req.user.id : null, nextStatus === 'ready' ? new Date() : null, req.params.id],
      );
      await logAudit(client, { entityType: 'internal_task', entityId: req.params.id, action: nextStatus === 'ready' ? 'mark_ready' : 'mark_pending', userId: req.user.id });
      await refreshSoldItemStatus(client, result.rows[0].sold_item_id);
      return result.rows[0];
    });
    res.json(task);
  } catch (error) { next(error); }
}

export async function listTasksBySector(req, res, next) {
  try {
    const result = await query(
      `SELECT it.*, s.name AS sector_name, io.sale_number, io.customer_name, io.promised_date, si.product_name_snapshot
       FROM internal_tasks it
       JOIN sectors s ON s.id = it.sector_id
       JOIN sold_items si ON si.id = it.sold_item_id
       JOIN internal_orders io ON io.id = si.internal_order_id
       WHERE it.sector_id = $1 AND it.status = 'pending'
       ORDER BY io.promised_date ASC`,
      [req.params.sectorId],
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}
