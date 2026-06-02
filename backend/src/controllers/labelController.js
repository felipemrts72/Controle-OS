import { query, transaction } from '../database/pool.js';
import { createShipmentCode, buildLabelPdf } from '../services/labelService.js';
import { logAudit } from '../services/auditService.js';
import { httpError } from '../utils/httpError.js';

async function findVolume(id) {
  const result = await query(
    `SELECT sv.*, si.product_name_snapshot, io.sale_number, io.customer_name, io.customer_phone, io.promised_date
     FROM shipment_volumes sv
     JOIN sold_items si ON si.id = sv.sold_item_id
     JOIN internal_orders io ON io.id = si.internal_order_id
     WHERE sv.id = $1`,
    [id],
  );
  return result.rows[0];
}

export async function generateLabel(req, res, next) {
  try {
    const volume = await transaction(async (client) => {
      const current = await client.query('SELECT * FROM shipment_volumes WHERE id = $1', [req.params.shipmentVolumeId]);
      if (!current.rows[0]) throw httpError(404, 'Volume não encontrado.');
      if (!['released_for_label', 'label_generated'].includes(current.rows[0].label_status)) {
        throw httpError(400, 'Volume ainda não está liberado para etiqueta.');
      }
      const code = current.rows[0].shipment_code || await createShipmentCode(client);
      const updated = await client.query(
        `UPDATE shipment_volumes SET shipment_code = $1, label_status = 'label_generated', updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [code, req.params.shipmentVolumeId],
      );
      await logAudit(client, { entityType: 'shipment_volume', entityId: req.params.shipmentVolumeId, action: 'generate_label', newValue: { shipment_code: code }, userId: req.user.id });
      return updated.rows[0];
    });
    res.json(volume);
  } catch (error) { next(error); }
}

export async function markWithoutLabel(req, res, next) {
  try {
    const volume = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE shipment_volumes SET label_status = 'ready_without_label', updated_at = NOW()
         WHERE id = $1 AND label_status = 'released_for_label' RETURNING *`,
        [req.params.shipmentVolumeId],
      );
      if (!result.rows[0]) throw httpError(400, 'Volume não está liberado para etiqueta.');
      await logAudit(client, { entityType: 'shipment_volume', entityId: req.params.shipmentVolumeId, action: 'ready_without_label', userId: req.user.id });
      return result.rows[0];
    });
    res.json(volume);
  } catch (error) { next(error); }
}

export async function downloadLabelPdf(req, res, next) {
  try {
    let volume = await findVolume(req.params.shipmentVolumeId);
    if (!volume) throw httpError(404, 'Volume não encontrado.');
    if (!volume.shipment_code) {
      await transaction(async (client) => {
        const code = await createShipmentCode(client);
        await client.query(
          `UPDATE shipment_volumes SET shipment_code = $1, label_status = 'label_generated', updated_at = NOW()
           WHERE id = $2`,
          [code, req.params.shipmentVolumeId],
        );
      });
      volume = await findVolume(req.params.shipmentVolumeId);
    }
    const pdf = await buildLabelPdf(volume);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etiqueta-${volume.shipment_code}.pdf"`);
    res.send(pdf);
  } catch (error) { next(error); }
}

export async function listLabelQueue(_req, res, next) {
  try {
    const result = await query(
      `SELECT sv.*, si.product_name_snapshot, io.sale_number, io.customer_name, io.promised_date
       FROM shipment_volumes sv
       JOIN sold_items si ON si.id = sv.sold_item_id
       JOIN internal_orders io ON io.id = si.internal_order_id
       WHERE sv.label_status IN ('released_for_label', 'label_generated', 'ready_without_label')
       ORDER BY io.promised_date ASC, sv.created_at ASC`,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}
