import { query, transaction } from '../database/pool.js';
import { logAudit } from '../services/auditService.js';
import { refreshInternalOrderStatus, refreshSoldItemStatus } from '../services/statusService.js';
import { httpError } from '../utils/httpError.js';

const activeOrderFilter = "COALESCE(io.status, '') <> 'deleted'";

const volumeSelect = `SELECT sv.*, si.product_name_snapshot AS product_name, si.internal_order_id, io.sale_number, io.customer_name, io.customer_phone, io.promised_date, io.status AS order_status
  FROM shipment_volumes sv
  JOIN sold_items si ON si.id = sv.sold_item_id
  JOIN internal_orders io ON io.id = si.internal_order_id`;

async function getSaleSummary(client, saleNumber) {
  const result = await client.query(
    `SELECT io.sale_number,
      io.customer_name,
      io.promised_date,
      COUNT(sv.id)::int AS total_volumes,
      COUNT(*) FILTER (WHERE sv.label_status = 'shipped')::int AS shipped_volumes,
      COUNT(*) FILTER (WHERE sv.label_status <> 'shipped')::int AS remaining_volumes
     FROM internal_orders io
     JOIN sold_items si ON si.internal_order_id = io.id
     JOIN shipment_volumes sv ON sv.sold_item_id = si.id
     WHERE io.sale_number = $1
       AND ${activeOrderFilter}
     GROUP BY io.sale_number, io.customer_name, io.promised_date`,
    [saleNumber],
  );
  return result.rows[0] || null;
}

async function getVolumeWithSummary(client, volume) {
  const saleSummary = await getSaleSummary(client, volume.sale_number);
  return formatShippingVolume(volume, saleSummary);
}

function formatShippingVolume(volume, saleSummary) {
  const remainingVolumes = Number(saleSummary?.remaining_volumes || 0);
  const shippedVolumes = Number(saleSummary?.shipped_volumes || 0);
  const totalVolumes = Number(saleSummary?.total_volumes || 0);

  return {
    shipment_volume_id: volume.id,
    shipment_code: volume.shipment_code,
    sale_number: volume.sale_number,
    customer_name: volume.customer_name,
    customer_phone: volume.customer_phone,
    promised_date: volume.promised_date,
    product_name: volume.product_name,
    product_name_snapshot: volume.product_name,
    volume_number: volume.volume_number,
    total_volumes: volume.total_volumes,
    weight_kg: volume.weight_kg,
    label_status: volume.label_status,
    shipped_at: volume.shipped_at,
    remaining_volumes: remainingVolumes,
    total_sale_volumes: totalVolumes,
    shipped_sale_volumes: shippedVolumes,
    already_shipped: volume.label_status === 'shipped',
    sale_completed: remainingVolumes === 0 && totalVolumes > 0,
    sale_summary: saleSummary,
  };
}

export async function lookupByCode(req, res, next) {
  try {
    const result = await query(`${volumeSelect} WHERE sv.shipment_code = $1 AND ${activeOrderFilter}`, [req.params.shipmentCode]);
    if (!result.rows[0]) {
      res.status(404).json({ message: 'Código não encontrado.' });
      return;
    }
    res.json(await getVolumeWithSummary({ query }, result.rows[0]));
  } catch (error) { next(error); }
}

export async function confirmByCode(req, res, next) {
  try {
    const result = await transaction(async (client) => {
      const found = await client.query(`${volumeSelect} WHERE sv.shipment_code = $1 AND ${activeOrderFilter}`, [req.params.shipmentCode]);
      const volume = found.rows[0];
      if (!volume) return { type: 'invalid_code' };
      if (volume.label_status === 'shipped') {
        return {
          type: 'already_shipped',
          data: await getVolumeWithSummary(client, volume),
        };
      }
      const forced = !['label_generated', 'ready_without_label'].includes(volume.label_status);
      const updated = await client.query(
        `UPDATE shipment_volumes SET label_status = 'shipped', shipped_by = $1, shipped_at = NOW(), forced_shipping = $2, updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [req.user.id, forced, volume.id],
      );
      await logAudit(client, { entityType: 'shipment_volume', entityId: volume.id, action: 'ship', newValue: { forced_shipping: forced }, userId: req.user.id });
      await refreshSoldItemStatus(client, volume.sold_item_id);
      const updatedWithInfo = await client.query(`${volumeSelect} WHERE sv.id = $1 AND ${activeOrderFilter}`, [updated.rows[0].id]);
      const shippedVolume = updatedWithInfo.rows[0];
      const saleSummary = await getSaleSummary(client, shippedVolume.sale_number);
      const data = formatShippingVolume(shippedVolume, saleSummary);
      return { type: data.sale_completed ? 'sale_completed' : 'volume_confirmed', data };
    });
    if (result.type === 'invalid_code') {
      res.status(404).json({ message: 'Código não encontrado.' });
      return;
    }
    if (result.type === 'already_shipped') {
      res.status(409).json(result.data);
      return;
    }
    res.json(result.data);
  } catch (error) { next(error); }
}

export async function lookupBySale(req, res, next) {
  try {
    const result = await query(`${volumeSelect} WHERE io.sale_number = $1 AND ${activeOrderFilter} ORDER BY sv.volume_number`, [req.params.saleNumber]);
    const saleSummary = await getSaleSummary({ query }, req.params.saleNumber);
    res.json({
      volumes: result.rows.map((volume) => formatShippingVolume(volume, saleSummary)),
      sale_summary: saleSummary,
    });
  } catch (error) { next(error); }
}

export async function confirmSale(req, res, next) {
  try {
    const result = await transaction(async (client) => {
      const found = await client.query(`${volumeSelect} WHERE io.sale_number = $1 AND ${activeOrderFilter}`, [req.params.saleNumber]);
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
      const updatedWithInfo = await client.query(`${volumeSelect} WHERE io.sale_number = $1 AND ${activeOrderFilter} ORDER BY sv.volume_number`, [req.params.saleNumber]);
      const saleSummary = await getSaleSummary(client, req.params.saleNumber);
      return {
        type: 'sale_completed',
        volumes: updatedWithInfo.rows.map((volume) => formatShippingVolume(volume, saleSummary)),
        sale_summary: saleSummary,
      };
    });
    res.json(result);
  } catch (error) { next(error); }
}

export async function auditShipping(_req, res, next) {
  try {
    const result = await query(
      `SELECT sv.id AS shipment_volume_id,
        sv.shipment_code,
        io.sale_number,
        io.customer_name,
        si.product_name_snapshot AS product_name,
        sv.volume_number,
        sv.total_volumes,
        sv.weight_kg,
        sv.shipped_at,
        sv.label_status AS status,
        u.name AS shipped_by_name,
        u.role AS shipped_by_role,
        CASE
          WHEN latest_audit.action = 'ship_sale' THEN 'venda inteira'
          WHEN latest_audit.action = 'ship' THEN 'QR Code/código manual'
          ELSE '-'
        END AS confirmation_origin
       FROM shipment_volumes sv
       JOIN sold_items si ON si.id = sv.sold_item_id
       JOIN internal_orders io ON io.id = si.internal_order_id
       LEFT JOIN users u ON u.id = sv.shipped_by
       LEFT JOIN LATERAL (
         SELECT action
         FROM audit_logs al
         WHERE al.entity_type = 'shipment_volume'
           AND al.entity_id = sv.id
           AND al.action IN ('ship', 'ship_sale')
         ORDER BY al.created_at DESC
         LIMIT 1
       ) latest_audit ON TRUE
       WHERE sv.label_status = 'shipped'
         AND COALESCE(io.status, '') <> 'deleted'
       ORDER BY sv.shipped_at DESC NULLS LAST, io.sale_number DESC, sv.volume_number DESC`,
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
}
