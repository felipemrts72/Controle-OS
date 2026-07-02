import { query, transaction } from '../database/pool.js';
import { createShipmentCode, buildLabelPdf, buildLabelBatchPdf, normalizeLabelModel } from '../services/labelService.js';
import { logAudit } from '../services/auditService.js';
import { httpError } from '../utils/httpError.js';

function getRequestedLabelModel(req) {
  const labelModel = req.query.labelModel || '15x10';
  return normalizeLabelModel(labelModel);
}

async function findVolume(id) {
  const result = await query(
    `SELECT sv.*,
      si.product_name_snapshot,
      io.id AS internal_order_id,
      io.sale_number,
      io.customer_name,
      io.customer_phone,
      io.promised_date,
      COALESCE(io.delivery_type, 'transportadora') AS delivery_type,
      io.carrier_name,
      io.destination_city,
      io.destination_uf,
      io.invoice_number,
      io.status AS order_status
     FROM shipment_volumes sv
     JOIN sold_items si ON si.id = sv.sold_item_id
     JOIN internal_orders io ON io.id = si.internal_order_id
     WHERE sv.id = $1
       AND COALESCE(io.status, '') <> 'deleted'`,
    [id],
  );
  return result.rows[0];
}

export async function updateOrderInvoiceNumber(req, res, next) {
  try {
    const invoiceNumber = String(req.body.invoice_number || '').trim();
    if (!invoiceNumber) throw httpError(400, 'Informe o numero da Nota Fiscal.', { code: 'INVOICE_NUMBER_REQUIRED', field: 'invoice_number' });

    const result = await transaction(async (client) => {
      const current = await client.query(
        `SELECT id, invoice_number
         FROM internal_orders
         WHERE id = $1
           AND COALESCE(status, '') <> 'deleted'`,
        [req.params.internalOrderId],
      );
      if (!current.rows[0]) throw httpError(404, 'OS nao encontrada.');

      const updated = await client.query(
        `UPDATE internal_orders
         SET invoice_number = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [invoiceNumber, req.params.internalOrderId],
      );
      await logAudit(client, {
        entityType: 'internal_order',
        entityId: req.params.internalOrderId,
        action: 'update_invoice_number',
        previousValue: current.rows[0],
        newValue: { invoice_number: invoiceNumber },
        userId: req.user.id,
      });
      return updated.rows[0];
    });

    res.json(result);
  } catch (error) { next(error); }
}

export async function generateLabel(req, res, next) {
  try {
    const volume = await transaction(async (client) => {
      const current = await client.query(
        `SELECT sv.*
         FROM shipment_volumes sv
         JOIN sold_items si ON si.id = sv.sold_item_id
         JOIN internal_orders io ON io.id = si.internal_order_id
         WHERE sv.id = $1
           AND COALESCE(io.status, '') <> 'deleted'`,
        [req.params.shipmentVolumeId],
      );
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
         WHERE id = $1
           AND label_status = 'released_for_label'
           AND EXISTS (
             SELECT 1
             FROM sold_items si
             JOIN internal_orders io ON io.id = si.internal_order_id
             WHERE si.id = shipment_volumes.sold_item_id
               AND COALESCE(io.status, '') <> 'deleted'
           )
         RETURNING *`,
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
    if (!['released_for_label', 'label_generated'].includes(volume.label_status)) {
      throw httpError(400, 'Volume ainda não está liberado para etiqueta.');
    }
    if (!volume.shipment_code) {
      await transaction(async (client) => {
        const code = await createShipmentCode(client);
        await client.query(
          `UPDATE shipment_volumes SET shipment_code = $1, label_status = 'label_generated', updated_at = NOW()
           WHERE id = $2`,
          [code, req.params.shipmentVolumeId],
        );
        await logAudit(client, { entityType: 'shipment_volume', entityId: req.params.shipmentVolumeId, action: 'generate_label_pdf', newValue: { shipment_code: code }, userId: req.user.id });
      });
      volume = await findVolume(req.params.shipmentVolumeId);
    }
    const pdf = await buildLabelPdf(volume, { labelModel: getRequestedLabelModel(req) });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etiqueta-${volume.shipment_code}.pdf"`);
    res.send(pdf);
  } catch (error) { next(error); }
}

export async function downloadSoldItemLabelPdf(req, res, next) {
  try {
    const { volumes } = await transaction(async (client) => {
      const current = await client.query(
        `SELECT sv.*,
          si.product_name_snapshot,
          io.id AS internal_order_id,
          io.sale_number,
          io.customer_name,
          io.customer_phone,
          io.promised_date,
          COALESCE(io.delivery_type, 'transportadora') AS delivery_type,
          io.carrier_name,
          io.destination_city,
          io.destination_uf,
          io.invoice_number,
          io.status AS order_status
         FROM shipment_volumes sv
         JOIN sold_items si ON si.id = sv.sold_item_id
         JOIN internal_orders io ON io.id = si.internal_order_id
         WHERE sv.sold_item_id = $1
           AND COALESCE(io.status, '') <> 'deleted'
         ORDER BY sv.volume_number`,
        [req.params.soldItemId],
      );

      if (!current.rows.length) throw httpError(404, 'Volumes não encontrados.');

      const blocked = current.rows.find((volume) => !['released_for_label', 'label_generated'].includes(volume.label_status));
      if (blocked) throw httpError(400, 'Todos os volumes precisam estar liberados para etiqueta.');

      let generatedCount = 0;
      let reprintedCount = 0;

      for (const volume of current.rows) {
        if (volume.shipment_code) {
          reprintedCount += 1;
          continue;
        }

        const code = await createShipmentCode(client);
        await client.query(
          `UPDATE shipment_volumes SET shipment_code = $1, label_status = 'label_generated', updated_at = NOW()
           WHERE id = $2`,
          [code, volume.id],
        );
        generatedCount += 1;
      }

      await logAudit(client, {
        entityType: 'sold_item',
        entityId: req.params.soldItemId,
        action: 'generate_label_batch_pdf',
        newValue: {
          total_volumes: current.rows.length,
          generated: generatedCount,
          reprinted: reprintedCount,
        },
        userId: req.user.id,
      });

      const updated = await client.query(
        `SELECT sv.*,
          si.product_name_snapshot,
          io.id AS internal_order_id,
          io.sale_number,
          io.customer_name,
          io.customer_phone,
          io.promised_date,
          COALESCE(io.delivery_type, 'transportadora') AS delivery_type,
          io.carrier_name,
          io.destination_city,
          io.destination_uf,
          io.invoice_number,
          io.status AS order_status
         FROM shipment_volumes sv
         JOIN sold_items si ON si.id = sv.sold_item_id
         JOIN internal_orders io ON io.id = si.internal_order_id
         WHERE sv.sold_item_id = $1
           AND COALESCE(io.status, '') <> 'deleted'
         ORDER BY sv.volume_number`,
        [req.params.soldItemId],
      );

      return { volumes: updated.rows, generatedCount, reprintedCount };
    });

    const pdf = await buildLabelBatchPdf(volumes, { labelModel: getRequestedLabelModel(req) });
    const saleNumber = volumes[0]?.sale_number || req.params.soldItemId;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etiquetas-${saleNumber}-${req.params.soldItemId}.pdf"`);
    res.send(pdf);
  } catch (error) { next(error); }
}

export async function listLabelQueue(_req, res, next) {
  try {
    const result = await query(
      `SELECT sv.*,
        si.product_name_snapshot,
        io.id AS internal_order_id,
        io.sale_number,
        io.customer_name,
        io.customer_phone,
        io.promised_date,
        COALESCE(io.delivery_type, 'transportadora') AS delivery_type,
        io.carrier_name,
        io.destination_city,
        io.destination_uf,
        io.invoice_number,
        io.status AS order_status
       FROM shipment_volumes sv
       JOIN sold_items si ON si.id = sv.sold_item_id
       JOIN internal_orders io ON io.id = si.internal_order_id
       WHERE sv.label_status IN ('released_for_label', 'label_generated', 'ready_without_label')
         AND COALESCE(io.status, '') <> 'deleted'
       ORDER BY io.promised_date ASC, sv.created_at ASC`,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}
