import { query, transaction } from '../database/pool.js';
import { logAudit } from '../services/auditService.js';
import { refreshInternalOrderStatus, refreshSoldItemStatus } from '../services/statusService.js';
import { httpError } from '../utils/httpError.js';

const volumeSelect = `SELECT sv.*, si.product_name_snapshot, si.internal_order_id, io.sale_number, io.customer_name, io.customer_phone, io.promised_date
  FROM shipment_volumes sv
  JOIN sold_items si ON si.id = sv.sold_item_id
  JOIN internal_orders io ON io.id = si.internal_order_id`;

export async function lookupByCode(req, res, next) {
  try {
    const result = await query(`${volumeSelect} WHERE sv.shipment_code = $1`, [req.params.shipmentCode]);
    if (!result.rows[0]) throw httpError(404, 'Código não encontrado.');
    res.json(result.rows[0]);
  } catch (error) { next(error); }
}

export async function confirmByCode(req, res, next) {
  try {
    const result = await transaction(async (client) => {
      const found = await client.query(`${volumeSelect} WHERE sv.shipment_code = $1`, [req.params.shipmentCode]);
      const volume = found.rows[0];
      if (!volume) throw httpError(404, 'Código não encontrado.');
      const forced = !['label_generated', 'ready_without_label'].includes(volume.label_status);
      const updated = await client.query(
        `UPDATE shipment_volumes SET label_status = 'shipped', shipped_by = $1, shipped_at = NOW(), forced_shipping = $2, updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [req.user.id, forced, volume.id],
      );
      await logAudit(client, { entityType: 'shipment_volume', entityId: volume.id, action: 'ship', newValue: { forced_shipping: forced }, userId: req.user.id });
      await refreshSoldItemStatus(client, volume.sold_item_id);
      return updated.rows[0];
    });
    res.json(result);
  } catch (error) { next(error); }
}

export async function lookupBySale(req, res, next) {
  try {
    const result = await query(`${volumeSelect} WHERE io.sale_number = $1 ORDER BY sv.volume_number`, [req.params.saleNumber]);
    res.json(result.rows);
  } catch (error) { next(error); }
}

export async function confirmSale(req, res, next) {
  try {
    const result = await transaction(async (client) => {
      const found = await client.query(`${volumeSelect} WHERE io.sale_number = $1`, [req.params.saleNumber]);
      if (!found.rows.length) throw httpError(404, 'Venda não encontrada.');
      const forced = found.rows.some((volume) => !['label_generated', 'ready_without_label', 'shipped'].includes(volume.label_status));
      const ids = found.rows.map((volume) => volume.id);
      const updated = await client.query(
        `UPDATE shipment_volumes SET label_status = 'shipped', shipped_by = $1, shipped_at = NOW(), forced_shipping = forced_shipping OR $2, updated_at = NOW()
         WHERE id = ANY($3) RETURNING *`,
        [req.user.id, forced, ids],
      );
      for (const volume of found.rows) {
        await logAudit(client, { entityType: 'shipment_volume', entityId: volume.id, action: 'ship_sale', newValue: { forced_shipping: forced }, userId: req.user.id });
      }
      for (const soldItemId of [...new Set(found.rows.map((volume) => volume.sold_item_id))]) {
        await refreshSoldItemStatus(client, soldItemId);
      }
      await refreshInternalOrderStatus(client, found.rows[0].internal_order_id);
      return updated.rows;
    });
    res.json(result);
  } catch (error) { next(error); }
}
