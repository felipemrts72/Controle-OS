import { query, transaction } from '../database/pool.js';
import { logAudit } from '../services/auditService.js';
import { refreshSoldItemStatus } from '../services/statusService.js';
import { httpError } from '../utils/httpError.js';

export async function setTaskStatus(req, res, next) {
  try {
    const nextStatus = req.path.endsWith('/ready') ? 'ready' : 'pending';
    const task = await transaction(async (client) => {
      const previousResult = await client.query('SELECT * FROM internal_tasks WHERE id = $1', [req.params.id]);
      const previousTask = previousResult.rows[0];
      if (!previousTask) throw httpError(404, 'Tarefa não encontrada.');

      const result = await client.query(
        `UPDATE internal_tasks
         SET status = $1, completed_by = $2, completed_at = $3, updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [nextStatus, nextStatus === 'ready' ? req.user.id : null, nextStatus === 'ready' ? new Date() : null, req.params.id],
      );
      await logAudit(client, {
        entityType: 'internal_task',
        entityId: req.params.id,
        action: nextStatus === 'ready' ? 'mark_ready' : 'mark_pending',
        previousValue: previousTask,
        newValue: result.rows[0],
        userId: req.user.id,
      });
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
