import { api } from '../services/api.js';
import { downloadAuthenticatedFile } from './downloadAuthenticatedFile.js';

export function labelCounts(volumes = []) {
  const generated = volumes.filter((volume) => Boolean(volume.shipment_code)).length;
  return { total: volumes.length, generated, pending: volumes.length - generated };
}

export function canGenerateLabel(volume) {
  return ['released_for_label', 'ready_without_label', 'label_generated'].includes(volume?.label_status);
}

export function labelErrorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

export async function generateThenDownloadLabels({ create, refresh, download }) {
  const creation = await create();
  await refresh?.(creation);
  try {
    const filename = await download();
    return { status: 'downloaded', creation, filename };
  } catch (error) {
    return { status: 'download_failed', creation, error };
  }
}

export async function createSoldItemLabels(soldItemId, invoiceNumber, apiClient = api) {
  const response = await apiClient.post(`/labels/sold-item/${soldItemId}/generate`, {
    invoice_number: String(invoiceNumber || '').trim(),
  });
  return response.data;
}

export async function createSingleLabel(volumeId, invoiceNumber, apiClient = api) {
  const response = await apiClient.post(`/labels/${volumeId}/generate`, {
    invoice_number: String(invoiceNumber || '').trim(),
  });
  return response.data;
}

export async function downloadSoldItemLabels(soldItemId, saleNumber, labelModel, downloader = downloadAuthenticatedFile) {
  return downloader(
    `/labels/sold-item/${soldItemId}/pdf`,
    `etiquetas-${saleNumber}-${soldItemId}.pdf`,
    { params: { labelModel } },
  );
}

export async function downloadSingleLabel(volume, labelModel, downloader = downloadAuthenticatedFile) {
  return downloader(
    `/labels/${volume.id}/pdf`,
    `etiqueta-${volume.shipment_code || volume.volume_number}.pdf`,
    { params: { labelModel } },
  );
}
