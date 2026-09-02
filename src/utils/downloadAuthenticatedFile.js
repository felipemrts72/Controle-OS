import { api } from '../services/api.js';

function filenameFromDisposition(disposition) {
  if (!disposition) return null;
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded.trim().replace(/^"|"$/g, '')); } catch { return null; }
  }
  return disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
    || disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim()
    || null;
}

export async function downloadAuthenticatedFile(url, fallbackFilename = 'documento.pdf', config = {}) {
  const response = await api.request({ method: 'get', url, ...config, responseType: 'blob' });
  const receivedFilename = filenameFromDisposition(response.headers['content-disposition']) || fallbackFilename;
  const filename = String(receivedFilename).split(/[\\/]/).pop() || 'documento.pdf';
  const objectUrl = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  try {
    link.href = objectUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
  return filename;
}

export async function viewAuthenticatedPdf(url) {
  const previewWindow = window.open('', '_blank');
  if (!previewWindow) throw new Error('Permita pop-ups para visualizar o PDF.');
  previewWindow.document.title = 'Carregando PDF...';
  try {
    const response = await api.get(url, { responseType: 'blob' });
    const objectUrl = URL.createObjectURL(response.data);
    previewWindow.location.replace(objectUrl);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);
    return response.headers;
  } catch (error) {
    previewWindow.close();
    throw error;
  }
}

export async function printAuthenticatedPdf(url) {
  const response = await api.get(url, { responseType: 'blob' });
  const objectUrl = URL.createObjectURL(response.data);
  const frame = document.createElement('iframe');
  frame.title = 'Impressão do orçamento';
  frame.style.position = 'fixed';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.border = '0';
  frame.onload = () => {
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(objectUrl); }, 60 * 1000);
    }, 250);
  };
  frame.src = objectUrl;
  document.body.appendChild(frame);
  return response.headers;
}
