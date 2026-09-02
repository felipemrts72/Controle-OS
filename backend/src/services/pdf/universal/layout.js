import { UNIVERSAL_PDF_THEME as THEME } from './theme.js';

// Portado do ERP Universal: reserva assinatura nos Orçamentos e não a reserva
// nas fichas de Catálogo Técnico.
export class UniversalPdfLayout {
  constructor(doc, { margin = THEME.pageMargin } = {}) {
    this.doc = doc;
    this.margin = margin;
    this.pages = [];
    this.bottomReserve = 0;
  }

  addPage({ kind = 'orcamento', header = null } = {}) {
    this.doc.addPage({ size: 'A4', margins: { top: this.margin, right: this.margin, bottom: this.margin, left: this.margin } });
    this.pages.push({ kind });
    this.doc.x = this.margin;
    this.doc.y = this.margin;
    if (header) header();
  }

  get width() { return this.doc.page.width - this.margin * 2; }

  get contentBottom() {
    return this.doc.page.height - this.margin - THEME.footerHeight - this.bottomReserve;
  }

  get currentPageKind() { return this.pages.at(-1)?.kind || 'orcamento'; }
  get availableHeight() { return this.contentBottom - this.doc.y; }

  ensureSpace(height, { kind = 'orcamento', header = null } = {}) {
    if (height <= this.availableHeight) return false;
    this.addPage({ kind, header });
    return true;
  }

  pageIndexes(kind) {
    return this.pages.map((page, index) => (page.kind === kind ? index : -1)).filter((index) => index >= 0);
  }

  withBottomReserve(height, callback) {
    const previous = this.bottomReserve;
    this.bottomReserve = Math.max(0, Number(height) || 0);
    try {
      return callback();
    } finally {
      this.bottomReserve = previous;
    }
  }

  drawFooters(company = {}) {
    const range = this.doc.bufferedPageRange();
    const total = range.count;
    const name = company.nome_fantasia || company.razao_social || '';
    const contact = [company.telefone, company.email].filter(Boolean).join(' - ');
    for (let index = 0; index < total; index += 1) {
      this.doc.switchToPage(range.start + index);
      const y = this.doc.page.height - this.margin + 5;
      this.doc.save().moveTo(this.margin, y - 8).lineTo(this.doc.page.width - this.margin, y - 8)
        .lineWidth(0.5).strokeColor('#cbd5e1').stroke();
      this.doc.font('Helvetica-Bold').fontSize(7).fillColor('#475569')
        .text(name, this.margin, y, { width: this.width * 0.45, height: 10, lineBreak: false, ellipsis: true });
      this.doc.font('Helvetica').fontSize(7).fillColor('#64748b')
        .text(contact, this.margin + this.width * 0.35, y, { width: this.width * 0.45, height: 10, align: 'center', lineBreak: false, ellipsis: true });
      this.doc.text(`Página ${index + 1}/${total}`, this.margin + this.width * 0.82, y, { width: this.width * 0.18, height: 10, align: 'right', lineBreak: false });
      this.doc.restore();
    }
  }
}

export function splitTextToFit(doc, text, { width, height, options = {} }) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return { head: '', tail: '' };
  let low = 1;
  let high = words.length;
  let best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = words.slice(0, middle).join(' ');
    if (doc.heightOfString(candidate, { width, ...options }) <= height) {
      best = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (!best) best = 1;
  return { head: words.slice(0, best).join(' '), tail: words.slice(best).join(' ') };
}
