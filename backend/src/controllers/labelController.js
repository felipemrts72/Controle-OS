import { query, transaction } from '../database/pool.js';
import { buildLabelPdf, buildLabelBatchPdf, normalizeLabelModel } from '../services/labelService.js';
import { generateSingleLabel, generateSoldItemLabels, validateLabelContext } from '../services/labelWorkflowService.js';
import { logAudit } from '../services/auditService.js';
import { httpError } from '../utils/httpError.js';

function getRequestedLabelModel(req) {
  return normalizeLabelModel(req.query.labelModel || '15x10');
}

const volumeDetailsSelect = `SELECT sv.*,
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
    io.status AS order_status,
    EXISTS (
      SELECT 1
        FROM audit_logs al
       WHERE al.entity_type = 'shipment_volume'
         AND al.entity_id = sv.id
         AND al.action = 'ready_without_label'
    ) AS was_ready_without_label
  FROM shipment_volumes sv
  JOIN sold_items si ON si.id = sv.sold_item_id
  JOIN internal_orders io ON io.id = si.internal_order_id`;

async function findVolume(id) {
  const result = await query(
    `${volumeDetailsSelect}
      WHERE sv.id = $1
        AND COALESCE(io.status, '') <> 'deleted'`,
    [id],
  );
  return result.rows[0];
}

function assertPdfContext(volume) {
  const contextError = validateLabelContext(volume);
  if (contextError) throw httpError(400, contextError.message, { code: contextError.code, field: contextError.field });
}

function sendPdf(res, pdf, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdf.length);
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
}

export async function updateOrderInvoiceNumber(req, res, next) {
  try {
    const invoiceNumber = String(req.body.invoice_number || '').trim();
    if (!invoiceNumber) throw httpError(400, 'Informe a Nota Fiscal.', { code: 'INVOICE_NUMBER_REQUIRED', field: 'invoice_number' });

    const result = await transaction(async (client) => {
      const current = await client.query(
        `SELECT id, invoice_number
           FROM internal_orders
          WHERE id = $1
            AND COALESCE(status, '') <> 'deleted'
          FOR UPDATE`,
        [req.params.internalOrderId],
      );
      if (!current.rows[0]) throw httpError(404, 'Ordem de produção não encontrada.');

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
    const volume = await transaction((client) => generateSingleLabel(client, {
      shipmentVolumeId: req.params.shipmentVolumeId,
      invoiceNumber: req.body.invoice_number,
      userId: req.user.id,
    }));
    res.status(volume.generated > 0 ? 201 : 200).json(volume);
  } catch (error) { next(error); }
}

export async function generateSoldItemLabelRecords(req, res, next) {
  try {
    const result = await transaction((client) => generateSoldItemLabels(client, {
      soldItemId: req.params.soldItemId,
      invoiceNumber: req.body.invoice_number,
      userId: req.user.id,
    }));
    res.status(result.generated > 0 ? 201 : 200).json(result);
  } catch (error) { next(error); }
}

export async function markWithoutLabel(req, res, next) {
  try {
    const volume = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE shipment_volumes
            SET label_status = 'ready_without_label', updated_at = NOW()
          WHERE id = $1
            AND label_status = 'released_for_label'
            AND shipment_code IS NULL
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
      if (!result.rows[0]) throw httpError(400, 'O volume não está liberado para a ação sem etiqueta.');
      await logAudit(client, {
        entityType: 'shipment_volume',
        entityId: req.params.shipmentVolumeId,
        action: 'ready_without_label',
        newValue: { label_status: 'ready_without_label', shipment_code: null },
        userId: req.user.id,
      });
      return result.rows[0];
    });
    res.json(volume);
  } catch (error) { next(error); }
}

export async function downloadLabelPdf(req, res, next) {
  try {
    const volume = await findVolume(req.params.shipmentVolumeId);
    if (!volume) throw httpError(404, 'Volume não encontrado.');
    if (!volume.shipment_code) throw httpError(409, 'A etiqueta ainda não foi gerada.', { code: 'LABEL_NOT_GENERATED' });
    assertPdfContext(volume);
    const pdf = await buildLabelPdf(volume, { labelModel: getRequestedLabelModel(req) });
    await transaction((client) => logAudit(client, {
      entityType: 'shipment_volume',
      entityId: volume.id,
      action: 'download_label_pdf',
      newValue: { shipment_code: volume.shipment_code },
      userId: req.user.id,
    }));
    sendPdf(res, pdf, `etiqueta-${volume.shipment_code}.pdf`);
  } catch (error) { next(error); }
}

export async function downloadSoldItemLabelPdf(req, res, next) {
  try {
    const current = await query(
      `${volumeDetailsSelect}
        WHERE sv.sold_item_id = $1
          AND COALESCE(io.status, '') <> 'deleted'
        ORDER BY sv.volume_number`,
      [req.params.soldItemId],
    );
    const volumes = current.rows;
    if (!volumes.length) throw httpError(404, 'Volumes não encontrados.');
    if (volumes.some((volume) => !volume.shipment_code)) {
      throw httpError(409, 'Existem volumes sem etiqueta. Gere as etiquetas pendentes antes de baixar o PDF.', { code: 'LABELS_PENDING' });
    }
    assertPdfContext(volumes[0]);

    const pdf = await buildLabelBatchPdf(volumes, { labelModel: getRequestedLabelModel(req) });
    await transaction((client) => logAudit(client, {
      entityType: 'sold_item',
      entityId: req.params.soldItemId,
      action: 'download_label_batch_pdf',
      newValue: { total_volumes: volumes.length },
      userId: req.user.id,
    }));
    const saleNumber = volumes[0]?.sale_number || req.params.soldItemId;
    sendPdf(res, pdf, `etiquetas-${saleNumber}-${req.params.soldItemId}.pdf`);
  } catch (error) { next(error); }
}

export async function listLabelQueue(_req, res, next) {
  try {
    const result = await query(
      `${volumeDetailsSelect}
        WHERE (
          sv.label_status IN ('released_for_label', 'label_generated', 'ready_without_label')
          OR (sv.label_status = 'shipped' AND EXISTS (
            SELECT 1
              FROM audit_logs ready_without_audit
             WHERE ready_without_audit.entity_type = 'shipment_volume'
               AND ready_without_audit.entity_id = sv.id
               AND ready_without_audit.action = 'ready_without_label'
          ))
        )
          AND COALESCE(io.status, '') <> 'deleted'
        ORDER BY io.promised_date ASC, sv.created_at ASC`,
    );
    res.json(result.rows);
  } catch (error) { next(error); }
}
