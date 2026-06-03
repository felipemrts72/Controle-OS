import { query, transaction } from '../database/pool.js';
import { logAudit } from '../services/auditService.js';
import { refreshSoldItemStatus } from '../services/statusService.js';
import { httpError } from '../utils/httpError.js';

export async function setTaskStatus(req, res, next) {
  try {
    const nextStatus = req.path.endsWith('/ready') ? 'ready' : 'pending';
    const task = await transaction(async (client) => {
      const previousResult = await client.query(
        `SELECT it.*
         FROM internal_tasks it
         JOIN sold_items si ON si.id = it.sold_item_id
         JOIN internal_orders io ON io.id = si.internal_order_id
         WHERE it.id = $1
           AND COALESCE(io.status, '') <> 'deleted'`,
        [req.params.id],
      );
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
       WHERE it.sector_id = $1
        AND it.status = 'pending'
        AND COALESCE(io.status, '') <> 'deleted'
       ORDER BY io.promised_date ASC`,
      [req.params.sectorId],
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function pinTask(req, res, next) {
  try {
    const task = await transaction(async (client) => {
      const currentResult = await client.query(
        `SELECT it.*
         FROM internal_tasks it
         JOIN sold_items si ON si.id = it.sold_item_id
         JOIN internal_orders io ON io.id = si.internal_order_id
         WHERE it.id = $1
           AND COALESCE(io.status, '') <> 'deleted'`,
        [req.params.id],
      );
      const currentTask = currentResult.rows[0];
      if (!currentTask) throw httpError(404, 'Tarefa não encontrada.');

      if (!currentTask.is_pinned) {
        const countResult = await client.query(
          `SELECT COUNT(*)::int AS total
           FROM internal_tasks
           JOIN sold_items si ON si.id = internal_tasks.sold_item_id
           JOIN internal_orders io ON io.id = si.internal_order_id
           WHERE internal_tasks.sector_id = $1
             AND internal_tasks.is_pinned = TRUE
             AND internal_tasks.status = 'pending'
             AND COALESCE(io.status, '') <> 'deleted'`,
          [currentTask.sector_id],
        );
        if (countResult.rows[0].total >= 3) {
          throw httpError(400, 'Limite de 3 tarefas fixadas neste setor.');
        }
      }

      const updated = await client.query(
        `UPDATE internal_tasks
         SET is_pinned = TRUE, pinned_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [req.params.id],
      );
      await logAudit(client, {
        entityType: 'internal_task',
        entityId: req.params.id,
        action: 'pin',
        previousValue: currentTask,
        newValue: updated.rows[0],
        userId: req.user.id,
      });
      return updated.rows[0];
    });
    res.json(task);
  } catch (error) {
    next(error);
  }
}

export async function unpinTask(req, res, next) {
  try {
    const task = await transaction(async (client) => {
      const currentResult = await client.query(
        `SELECT it.*
         FROM internal_tasks it
         JOIN sold_items si ON si.id = it.sold_item_id
         JOIN internal_orders io ON io.id = si.internal_order_id
         WHERE it.id = $1
           AND COALESCE(io.status, '') <> 'deleted'`,
        [req.params.id],
      );
      const currentTask = currentResult.rows[0];
      if (!currentTask) throw httpError(404, 'Tarefa não encontrada.');

      const updated = await client.query(
        `UPDATE internal_tasks
         SET is_pinned = FALSE, pinned_at = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [req.params.id],
      );
      await logAudit(client, {
        entityType: 'internal_task',
        entityId: req.params.id,
        action: 'unpin',
        previousValue: currentTask,
        newValue: updated.rows[0],
        userId: req.user.id,
      });
      return updated.rows[0];
    });
    res.json(task);
  } catch (error) {
    next(error);
  }
}
