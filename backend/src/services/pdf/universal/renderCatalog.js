// Layout portado de backend/src/pdf/catalogo/renderCatalogo.js do ERP Universal.
import { containSize } from './image.js';
import { UNIVERSAL_PDF_THEME as THEME } from './theme.js';
import { safeText } from './format.js';
import { drawCenteredImage, drawFlowingText, drawHorizontalLine, drawSectionTitle, drawTextPanel } from './common.js';

function drawCatalogHeader(doc, layout, company, catalog, { continuation = false } = {}) {
  const logo = company.logo_asset;
  // Coordenada absoluta evita herdar o cursor de uma imagem EXIF da ficha anterior.
  const y = layout.margin;
  doc.y = y;
  if (logo) {
    const size = containSize(logo, 76, 35);
    drawCenteredImage(doc, logo, { x: layout.margin, y, width: size.width, height: size.height });
  }
  doc.font('Helvetica-Bold').fontSize(10).fillColor(THEME.blue)
    .text(continuation ? 'CATÁLOGO TÉCNICO - continuação' : 'CATÁLOGO TÉCNICO', layout.margin + 100, y + 9, {
      width: layout.width - 100, align: 'right', characterSpacing: 1.4,
    });
  doc.y = y + 42;
  drawHorizontalLine(doc, layout, { width: 2 });
  if (continuation) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(THEME.navy)
      .text(safeText(catalog.commercial_title || catalog.product_name), layout.margin, doc.y, { width: layout.width });
    doc.y += 5;
  }
}

function catalogPageHeader(doc, layout, company, catalog) {
  return () => drawCatalogHeader(doc, layout, company, catalog, { continuation: true });
}

function drawCatalogHero(doc, layout, catalog) {
  const title = safeText(catalog.commercial_title || catalog.product_name, 'Equipamento');
  const badgeWidth = 68;
  // O PDF real do ERP usa o herói técnico visualmente menor que a versão
  // posterior do helper legado; 21 pt mantém títulos como o da Bica em uma
  // linha, reproduzindo a referência oficial sem condensar a tipografia.
  const titleFontSize = 21;
  doc.font('Helvetica-Bold').fontSize(titleFontSize);
  const titleHeight = doc.heightOfString(title, { width: layout.width - badgeWidth - 16, lineGap: 1 });
  const subtitle = safeText(catalog.subtitle);
  doc.font('Helvetica').fontSize(11);
  const subtitleHeight = subtitle ? doc.heightOfString(subtitle, { width: layout.width - badgeWidth - 16 }) + 5 : 0;
  layout.ensureSpace(titleHeight + subtitleHeight + 18);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(titleFontSize).fillColor(THEME.navy)
    .text(title, layout.margin, y, { width: layout.width - badgeWidth - 16, lineGap: 1 });
  doc.save().roundedRect(layout.margin + layout.width - badgeWidth, y, badgeWidth, 20, 10).fill(THEME.blueSoft).restore();
  doc.font('Helvetica-Bold').fontSize(8).fillColor(THEME.blueLine)
    .text(`Versão ${catalog.version_number}`, layout.margin + layout.width - badgeWidth, y + 6, { width: badgeWidth, align: 'center' });
  if (subtitle) {
    doc.font('Helvetica').fontSize(11).fillColor('#53657e')
      .text(subtitle, layout.margin, y + titleHeight + 3, { width: layout.width - badgeWidth - 16 });
  }
  doc.y = y + titleHeight + subtitleHeight + 12;
}

function validImages(catalog) {
  return (catalog.images || []).filter((image) => image.asset?.buffer);
}

function drawMainImage(doc, layout, catalog, pageHeader) {
  const images = validImages(catalog);
  const main = images.find((image) => image.is_primary) || images[0] || null;
  if (!main) return null;
  const height = 255;
  layout.ensureSpace(height + 12, { kind: 'catalogo', header: pageHeader });
  const y = doc.y;
  drawCenteredImage(doc, main.asset, { x: layout.margin, y, width: layout.width, height, background: '#f2f6fb', radius: 10 });
  doc.y = y + height;
  if (main.caption) {
    doc.font('Helvetica').fontSize(8).fillColor(THEME.muted)
      .text(main.caption, layout.margin, doc.y + 4, { width: layout.width, align: 'center' });
  }
  doc.y += 14;
  return main;
}

function drawSpecifications(doc, layout, catalog, pageHeader) {
  if (!catalog.specifications?.length) return;
  drawSectionTitle(doc, layout, 'Especificações técnicas', { keepWith: 32, kind: 'catalogo', pageHeader });
  const nameWidth = layout.width * 0.34;
  const valueWidth = layout.width - nameWidth;
  for (const row of catalog.specifications) {
    const value = [row.value, row.unit].filter(Boolean).join(' ');
    doc.font('Helvetica-Bold').fontSize(8.5);
    const leftHeight = doc.heightOfString(safeText(row.name), { width: nameWidth - 16, lineGap: 1 });
    doc.font('Helvetica').fontSize(8.5);
    const rightHeight = doc.heightOfString(safeText(value), { width: valueWidth - 16, lineGap: 1 });
    const height = Math.max(26, leftHeight + 12, rightHeight + 12);
    layout.ensureSpace(height, { kind: 'catalogo', header: pageHeader });
    const y = doc.y;
    doc.save().rect(layout.margin, y, nameWidth, height).fillAndStroke('#f2f7fd', '#dfe6ef').restore();
    doc.save().rect(layout.margin + nameWidth, y, valueWidth, height).fillAndStroke('#ffffff', '#dfe6ef').restore();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#244872').text(safeText(row.name), layout.margin + 8, y + 6, { width: nameWidth - 16, lineGap: 1 });
    doc.font('Helvetica').fontSize(8.5).fillColor(THEME.text).text(safeText(value), layout.margin + nameWidth + 8, y + 6, { width: valueWidth - 16, lineGap: 1 });
    doc.y = y + height;
  }
  doc.y += 6;
}

function drawIncludedItems(doc, layout, catalog, pageHeader) {
  if (!catalog.included_items?.length) return;
  drawSectionTitle(doc, layout, 'Itens inclusos', { keepWith: 32, kind: 'catalogo', pageHeader });
  const gap = 20;
  const columnWidth = (layout.width - gap) / 2;
  for (let index = 0; index < catalog.included_items.length; index += 2) {
    const row = catalog.included_items.slice(index, index + 2);
    doc.font('Helvetica').fontSize(8.5);
    const height = Math.max(...row.map((item) => doc.heightOfString(`- ${safeText(item.description)}`, { width: columnWidth, lineGap: 1 })), 14);
    layout.ensureSpace(height + 5, { kind: 'catalogo', header: pageHeader });
    const y = doc.y;
    row.forEach((item, column) => {
      doc.font('Helvetica').fontSize(8.5).fillColor(THEME.text)
        .text(`- ${safeText(item.description)}`, layout.margin + column * (columnWidth + gap), y, { width: columnWidth, lineGap: 1 });
    });
    doc.y = y + height + 5;
  }
}

function drawGallery(doc, layout, catalog, main, pageHeader) {
  const images = validImages(catalog).filter((image) => image.id !== main?.id);
  if (!images.length) return;
  drawSectionTitle(doc, layout, 'Galeria', { keepWith: 120, kind: 'catalogo', pageHeader });
  const columns = images.length === 1 ? 1 : 2;
  const gap = 12;
  const cellWidth = columns === 1 ? layout.width : (layout.width - gap) / 2;
  const imageHeight = columns === 1 ? 255 : 155;
  for (let index = 0; index < images.length; index += columns) {
    const row = images.slice(index, index + columns);
    const captionHeight = row.some((image) => image.caption) ? 16 : 2;
    layout.ensureSpace(imageHeight + captionHeight + 10, { kind: 'catalogo', header: pageHeader });
    const y = doc.y;
    row.forEach((item, column) => {
      const x = layout.margin + column * (cellWidth + gap);
      drawCenteredImage(doc, item.asset, { x, y, width: cellWidth, height: imageHeight, background: '#f6f8fb', radius: 8 });
      if (item.caption) doc.font('Helvetica').fontSize(8).fillColor(THEME.muted)
        .text(item.caption, x, y + imageHeight + 4, { width: cellWidth, align: 'center' });
    });
    doc.y = y + imageHeight + captionHeight + 10;
  }
}

export function renderCatalogs(doc, layout, data, company) {
  for (const catalog of data.catalogs || []) {
    layout.addPage({ kind: 'catalogo' });
    drawCatalogHeader(doc, layout, company, catalog);
    const pageHeader = catalogPageHeader(doc, layout, company, catalog);
    drawCatalogHero(doc, layout, catalog);
    const main = drawMainImage(doc, layout, catalog, pageHeader);
    if (catalog.presentation_text) {
      drawFlowingText(doc, layout, catalog.presentation_text, { fontSize: 10, color: '#344258', lineGap: 3, kind: 'catalogo', pageHeader });
      doc.y += 8;
    }
    drawSpecifications(doc, layout, catalog, pageHeader);
    drawIncludedItems(doc, layout, catalog, pageHeader);
    if (catalog.applications_text) {
      const sectionStart = doc.y;
      drawSectionTitle(doc, layout, 'Aplicações', { keepWith: 30, kind: 'catalogo', pageHeader });
      const bodyY = Math.max(doc.y, sectionStart + 46);
      doc.y = bodyY;
      drawFlowingText(doc, layout, catalog.applications_text, {
        fontSize: 9, color: '#344258', kind: 'catalogo', pageHeader, startY: bodyY,
      });
      doc.y += 6;
    }
    const observations = [catalog.additional_text, catalog.notes].filter(Boolean).join('\n\n');
    if (observations) drawTextPanel(doc, layout, { title: 'Observações', text: observations, kind: 'catalogo', pageHeader });
    drawGallery(doc, layout, catalog, main, pageHeader);
  }
}
