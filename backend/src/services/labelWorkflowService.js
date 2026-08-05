import { logAudit } from './auditService.js';
import { createShipmentCode } from './labelService.js';
import { httpError } from '../utils/httpError.js';

export const LABEL_GENERATABLE_STATUSES = Object.freeze([
  'released_for_label',
  'ready_without_label',
  'label_generated',
]);

export function isLabelGeneratableStatus(status) {
  return LABEL_GENERATABLE_STATUSES.includes(status);
}

export function validateLabelContext(context) {
  if (!String(context?.invoice_number || '').trim()) {
    return { code: 'INVOICE_NUMBER_REQUIRED', message: 'Informe a Nota Fiscal antes de gerar as etiquetas.', field: 'invoice_number' };
  }

  const requiresDestination = ['transportadora', 'frota_propria'].includes(context?.delivery_type || 'transportadora');
  if (requiresDestination && (!String(context?.destination_city || '').trim() || !String(context?.destination_uf || '').trim())) {
    return { code: 'DESTINATION_REQUIRED', message: 'Informe o destino da venda antes de gerar as etiquetas.', field: 'destination' };
  }

  return null;
}

function assertVolumesCanGenerate(volumes) {
  if (!volumes.length) {
    throw httpError(409, 'Os volumes precisam ser salvos antes de gerar as etiquetas.', { code: 'VOLUMES_REQUIRED' });
  }

  const blocked = volumes.find((volume) => !isLabelGeneratableStatus(volume.label_status)
    && !(volume.label_status === 'shipped' && (volume.shipment_code || volume.was_ready_without_label)));
  if (!blocked) return;

  if (blocked.label_status === 'waiting_tasks') {
    throw httpError(409, 'Ainda existem tarefas pendentes. Conclua as tarefas antes de gerar as etiquetas.', { code: 'TASKS_PENDING' });
  }
  if (blocked.label_status === 'shipped') {
    throw httpError(409, 'O item já foi expedido sem estar liberado para geração posterior de etiquetas.', { code: 'ITEM_SHIPPED' });
  }
  throw httpError(409, 'O volume não está disponível para geração de etiqueta.', { code: 'LABEL_STATUS_BLOCKED' });
}

async function updateInvoiceNumber(client, order, requestedInvoiceNumber, userId) {
  const requested = requestedInvoiceNumber == null ? '' : String(requestedInvoiceNumber).trim();
  const invoiceNumber = requested || String(order.invoice_number || '').trim();
  const context = { ...order, invoice_number: invoiceNumber };
  const contextError = validateLabelContext(context);
  if (contextError) throw httpError(400, contextError.message, { code: contextError.code, field: contextError.field });

  if (invoiceNumber !== String(order.invoice_number || '').trim()) {
    await client.query(
      `UPDATE internal_orders
          SET invoice_number = $1, updated_at = NOW()
        WHERE id = $2`,
      [invoiceNumber, order.internal_order_id],
    );
    await logAudit(client, {
      entityType: 'internal_order',
      entityId: order.internal_order_id,
      action: 'update_invoice_number',
      previousValue: { id: order.internal_order_id, invoice_number: order.invoice_number },
      newValue: { invoice_number: invoiceNumber },
      userId,
    });
  }

  return invoiceNumber;
}

async function generateLockedVolumes(client, volumes, userId, auditEntity) {
  assertVolumesCanGenerate(volumes);

  let generatedCount = 0;
  let existingCount = 0;
  for (const volume of volumes) {
    if (volume.shipment_code) {
      existingCount += 1;
      if (volume.label_status !== 'label_generated' && volume.label_status !== 'shipped') {
        await client.query(
          `UPDATE shipment_volumes
              SET label_status = 'label_generated', updated_at = NOW()
            WHERE id = $1`,
          [volume.id],
        );
      }
      continue;
    }

    const shipmentCode = await createShipmentCode(client);
    const nextStatus = volume.label_status === 'shipped' ? 'shipped' : 'label_generated';
    await client.query(
      `UPDATE shipment_volumes
          SET shipment_code = $1, label_status = $2, updated_at = NOW()
        WHERE id = $3`,
      [shipmentCode, nextStatus, volume.id],
    );
    await logAudit(client, {
      entityType: 'shipment_volume',
      entityId: volume.id,
      action: 'generate_label',
      previousValue: { label_status: volume.label_status, shipment_code: volume.shipment_code },
      newValue: { label_status: nextStatus, shipment_code: shipmentCode },
      userId,
    });
    generatedCount += 1;
  }

  await logAudit(client, {
    entityType: auditEntity.type,
    entityId: auditEntity.id,
    action: 'generate_labels',
    newValue: { total_volumes: volumes.length, generated: generatedCount, existing: existingCount },
    userId,
  });

  return { generatedCount, existingCount };
}

const volumeContextSelect = `SELECT sv.*,
    si.product_name_snapshot,
    io.id AS internal_order_id,
    io.sale_number,
    io.customer_name,
    COALESCE(io.delivery_type, 'transportadora') AS delivery_type,
    io.destination_city,
    io.destination_uf,
    io.invoice_number,
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

export async function generateSoldItemLabels(client, { soldItemId, invoiceNumber, userId }) {
  const current = await client.query(
    `${volumeContextSelect}
      WHERE sv.sold_item_id = $1
        AND COALESCE(io.status, '') <> 'deleted'
      ORDER BY sv.volume_number
      FOR UPDATE OF sv, io`,
    [soldItemId],
  );
  if (!current.rows.length) throw httpError(404, 'Os volumes precisam ser salvos antes de gerar as etiquetas.', { code: 'VOLUMES_REQUIRED' });

  const order = current.rows[0];
  const savedInvoiceNumber = await updateInvoiceNumber(client, order, invoiceNumber, userId);
  const counts = await generateLockedVolumes(client, current.rows, userId, { type: 'sold_item', id: soldItemId });

  return {
    sold_item_id: soldItemId,
    internal_order_id: order.internal_order_id,
    sale_number: order.sale_number,
    invoice_number: savedInvoiceNumber,
    total: current.rows.length,
    generated: counts.generatedCount,
    existing: counts.existingCount,
  };
}

export async function generateSingleLabel(client, { shipmentVolumeId, invoiceNumber, userId }) {
  const current = await client.query(
    `${volumeContextSelect}
      WHERE sv.id = $1
        AND COALESCE(io.status, '') <> 'deleted'
      FOR UPDATE OF sv, io`,
    [shipmentVolumeId],
  );
  if (!current.rows.length) throw httpError(404, 'Volume não encontrado.');

  const order = current.rows[0];
  const savedInvoiceNumber = await updateInvoiceNumber(client, order, invoiceNumber, userId);
  const counts = await generateLockedVolumes(client, current.rows, userId, { type: 'shipment_volume', id: shipmentVolumeId });
  const updated = await client.query('SELECT * FROM shipment_volumes WHERE id = $1', [shipmentVolumeId]);

  return {
    ...updated.rows[0],
    internal_order_id: order.internal_order_id,
    sale_number: order.sale_number,
    invoice_number: savedInvoiceNumber,
    generated: counts.generatedCount,
    existing: counts.existingCount,
  };
}
