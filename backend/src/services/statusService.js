export async function refreshSoldItemStatus(client, soldItemId) {
  const tasks = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'ready')::int AS ready
     FROM internal_tasks WHERE sold_item_id = $1`,
    [soldItemId],
  );
  const volumes = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE label_status = 'shipped')::int AS shipped
     FROM shipment_volumes WHERE sold_item_id = $1`,
    [soldItemId],
  );

  const taskTotals = tasks.rows[0];
  const volumeTotals = volumes.rows[0];
  let status = 'pending';
  if (volumeTotals.total > 0 && volumeTotals.shipped === volumeTotals.total) status = 'shipped';
  else if (taskTotals.total === 0 || taskTotals.ready === taskTotals.total) status = 'ready_for_label';
  else if (taskTotals.ready > 0) status = 'in_progress';

  await client.query('UPDATE sold_items SET status = $1, updated_at = NOW() WHERE id = $2', [status, soldItemId]);

  if (status === 'ready_for_label') {
    await client.query(
      `UPDATE shipment_volumes
       SET label_status = 'released_for_label', updated_at = NOW()
       WHERE sold_item_id = $1 AND label_status = 'waiting_tasks'`,
      [soldItemId],
    );
  }

  const order = await client.query('SELECT internal_order_id FROM sold_items WHERE id = $1', [soldItemId]);
  if (order.rows[0]) await refreshInternalOrderStatus(client, order.rows[0].internal_order_id);
}

export async function refreshInternalOrderStatus(client, internalOrderId) {
  const totals = await client.query(
    `SELECT
      (SELECT COUNT(*)::int FROM sold_items si JOIN shipment_volumes sv ON sv.sold_item_id = si.id WHERE si.internal_order_id = $1) AS volumes,
      (SELECT COUNT(*)::int FROM sold_items si JOIN shipment_volumes sv ON sv.sold_item_id = si.id WHERE si.internal_order_id = $1 AND sv.label_status = 'shipped') AS shipped,
      (SELECT COUNT(*)::int FROM sold_items si JOIN shipment_volumes sv ON sv.sold_item_id = si.id WHERE si.internal_order_id = $1 AND sv.label_status IN ('released_for_label', 'label_generated', 'ready_without_label')) AS readyish,
      (SELECT COUNT(*)::int FROM sold_items si JOIN internal_tasks it ON it.sold_item_id = si.id WHERE si.internal_order_id = $1 AND it.status = 'ready') AS ready_tasks,
      (SELECT COUNT(*)::int FROM sold_items si JOIN internal_tasks it ON it.sold_item_id = si.id WHERE si.internal_order_id = $1) AS total_tasks`,
    [internalOrderId],
  );

  const row = totals.rows[0];
  let status = 'pending';
  if (row.volumes > 0 && row.shipped === row.volumes) status = 'shipped';
  else if (row.shipped > 0) status = 'partially_shipped';
  else if (row.volumes > 0 && row.readyish === row.volumes) status = 'ready_for_label';
  else if (row.ready_tasks > 0 || row.total_tasks > 0) status = 'in_progress';

  await client.query('UPDATE internal_orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, internalOrderId]);
}
