import { splitTextToFit } from './layout.js';
import { UNIVERSAL_PDF_THEME as THEME } from './theme.js';
import { safeText } from './format.js';

export function drawHorizontalLine(doc, layout, { color = THEME.blueLine, width = 1.5 } = {}) {
  doc.moveTo(layout.margin, doc.y).lineTo(layout.margin + layout.width, doc.y)
    .lineWidth(width).strokeColor(color).stroke();
  doc.y += 8;
}

export function drawCenteredImage(doc, image, { x, y = doc.y, width, height, background = null, radius = 0 } = {}) {
  if (!image?.buffer) return 0;
  if (background) doc.save().roundedRect(x, y, width, height, radius).fill(background).restore();
  doc.image(image.buffer, x, y, { fit: [width, height], align: 'center', valign: 'center' });
  return height;
}

export function drawSectionTitle(doc, layout, title, {
  size = 14, top = 8, keepWith = 18, kind = 'orcamento', pageHeader = null, accent = true,
} = {}) {
  layout.ensureSpace(top + size + keepWith, { kind, header: pageHeader });
  doc.y += top;
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(size);
  const titleHeight = doc.heightOfString(title, { width: layout.width - 10 });
  if (accent) doc.rect(layout.margin, y + 1, 3, size).fill(THEME.blueLine);
  doc.font('Helvetica-Bold').fontSize(size).fillColor(THEME.blue)
    .text(title, layout.margin + (accent ? 10 : 0), y, { width: layout.width - (accent ? 10 : 0) });
  doc.y = y + Math.max(titleHeight, size * 1.2) + 10;
}

export function drawFlowingText(doc, layout, text, {
  width = layout.width, x = layout.margin, font = 'Helvetica', fontSize = 10,
  color = THEME.text, lineGap = 2, kind = 'catalogo', pageHeader = null, startY = null,
} = {}) {
  let remaining = safeText(text);
  if (!remaining) return;
  let forcedY = startY;
  doc.font(font).fontSize(fontSize).fillColor(color);
  while (remaining) {
    if (layout.availableHeight < fontSize * 2) {
      layout.addPage({ kind, header: pageHeader });
      // Uma coordenada forçada pertence apenas à página em que foi calculada.
      // Reutilizá-la após a quebra pode fazer o PDFKit criar uma página
      // automática fora do controle do layout e cortar o cabeçalho.
      forcedY = null;
      doc.font(font).fontSize(fontSize).fillColor(color);
    }
    const fullHeight = doc.heightOfString(remaining, { width, lineGap });
    if (fullHeight <= layout.availableHeight) {
      const y = forcedY ?? doc.y;
      doc.text(remaining, x, y, { width, lineGap });
      doc.y = y + fullHeight;
      break;
    }
    const { head, tail } = splitTextToFit(doc, remaining, {
      width, height: Math.max(layout.availableHeight - 2, fontSize * 1.2), options: { lineGap },
    });
    const y = forcedY ?? doc.y;
    const headHeight = doc.heightOfString(head, { width, lineGap });
    doc.text(head, x, y, { width, lineGap });
    doc.y = y + headHeight;
    forcedY = null;
    remaining = tail;
    if (remaining) {
      layout.addPage({ kind, header: pageHeader });
      doc.font(font).fontSize(fontSize).fillColor(color);
    }
  }
}

export function drawTextPanel(doc, layout, {
  title, text, background = THEME.panel, border = THEME.border,
  kind = 'orcamento', pageHeader = null,
}) {
  const content = safeText(text, '-');
  const innerWidth = layout.width - 24;
  doc.font('Helvetica').fontSize(10);
  const bodyHeight = doc.heightOfString(content, { width: innerWidth, lineGap: 2 });
  const height = Math.min(bodyHeight + 42, layout.contentBottom - layout.margin);
  layout.ensureSpace(Math.min(height, 90), { kind, header: pageHeader });
  if (bodyHeight + 42 <= layout.availableHeight) {
    const y = doc.y;
    doc.save().roundedRect(layout.margin, y, layout.width, bodyHeight + 36, 8).fillAndStroke(background, border).restore();
    doc.font('Helvetica-Bold').fontSize(13).fillColor(THEME.blue).text(title, layout.margin + 12, y + 10, { width: innerWidth });
    doc.font('Helvetica').fontSize(10).fillColor(THEME.text).text(content, layout.margin + 12, y + 28, { width: innerWidth, lineGap: 2 });
    doc.y = y + bodyHeight + 44;
    return;
  }
  drawSectionTitle(doc, layout, title, { size: 13, keepWith: 24, kind, pageHeader });
  drawFlowingText(doc, layout, content, { x: layout.margin, width: layout.width, kind, pageHeader });
  doc.y += 8;
}
