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
