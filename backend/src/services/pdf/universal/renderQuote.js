import { containSize } from './image.js';
import { splitTextToFit } from './layout.js';
import { formatDate, formatDocument, formatMoney, formatPhone, safeText } from './format.js';
import { UNIVERSAL_PDF_THEME as THEME } from './theme.js';
import { drawCenteredImage, drawHorizontalLine, drawSectionTitle, drawTextPanel } from './common.js';

const PAYMENT_LABELS = {
  cash: 'Dinheiro', pix: 'PIX', bank_slip: 'Boleto', bank_transfer: 'Transferência',
  debit_card: 'Cartão de débito', credit_card: 'Crédito', check: 'Cheque', other: 'Outro',
};

function displayNumber(number) {
  return safeText(number, 'SEM NÚMERO COMERCIAL');
}

function companyAddress(company) {
  const street = [company.endereco, company.numero].filter(Boolean).join(', ');
  const city = [company.cidade, company.estado].filter(Boolean).join(' - ');
  return [street, company.complemento, company.bairro, city, company.cep ? `CEP: ${company.cep}` : ''].filter(Boolean).join('  |  ');
}

function drawHeader(doc, layout, data, company) {
  const logo = company.logo_asset;
  if (logo) {
    const size = containSize(logo, Math.min(layout.width, 150 * 0.75), 82);
    const x = layout.margin + (layout.width - size.width) / 2;
    drawCenteredImage(doc, logo, { x, y: doc.y, width: size.width, height: size.height });
    doc.y += size.height + 5;
  }
  doc.font('Helvetica-Bold').fontSize(22).fillColor(THEME.blue)
    .text(`ORÇAMENTO #${displayNumber(data.quote.commercial_number)}`, layout.margin, doc.y, { width: layout.width, align: 'center' });
  if (data.quote.source_reference) {
    doc.font('Helvetica').fontSize(8.5).fillColor('#64748b')
      .text(data.quote.source_reference, layout.margin, doc.y, { width: layout.width, align: 'center' });
  }
  const name = company.nome_fantasia || company.razao_social || 'TORNEADORA UNIVERSAL';
  doc.font('Helvetica-Bold').fontSize(13).fillColor(THEME.text).text(name, { align: 'center' });
  if (company.razao_social && company.razao_social !== name) {
    doc.font('Helvetica').fontSize(10).fillColor('#475569').text(company.razao_social, { align: 'center' });
  }
  const contact = [
    company.cnpj ? `CNPJ: ${formatDocument(company.cnpj)}` : '',
    company.telefone ? `Telefone: ${formatPhone(company.telefone)}` : '',
    company.email ? `E-mail: ${company.email}` : '',
  ].filter(Boolean);
  if (contact.length) doc.font('Helvetica').fontSize(9).fillColor('#475569').text(contact.join('  |  '), { align: 'center' });
  const address = companyAddress(company);
  if (address) doc.font('Helvetica').fontSize(9).fillColor('#475569').text(address, { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#475569')
    .text(`Data do orçamento: ${formatDate(data.quote.date)}`, { align: 'center' });
  doc.y += 5;
  drawHorizontalLine(doc, layout, { width: 2 });
}

function drawContinuationHeader(doc, layout, data) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(THEME.blue)
    .text(`ORÇAMENTO #${displayNumber(data.quote.commercial_number)} - continuação`, layout.margin, doc.y, { width: layout.width });
  doc.y += 4;
  drawHorizontalLine(doc, layout, { width: 1 });
}

function customerAddress(customer) {
  const address = customer.address || {};
  const street = [address.street, address.number].filter(Boolean).join(', ');
  const city = [address.city, address.state].filter(Boolean).join(' - ');
  return [street, address.complement, address.neighborhood, city, address.zip_code ? `CEP ${address.zip_code}` : ''].filter(Boolean).join(' | ');
}

function drawCustomer(doc, layout, customer) {
  drawSectionTitle(doc, layout, 'Dados do cliente', { top: 2, keepWith: 32, accent: false });
  const rows = [
    ['Nome', customer.name || 'Cliente não identificado'],
    ['CPF/CNPJ', customer.tax_id ? formatDocument(customer.tax_id) : ''],
    ['Telefone', customer.phone ? formatPhone(customer.phone) : ''],
    ['E-mail', customer.email],
  ].filter(([, value]) => value);
  const columnWidth = (layout.width - 18) / 2;
  rows.forEach(([label, value], index) => {
    const x = layout.margin + (index % 2) * (columnWidth + 18);
    if (index % 2 === 0 && index > 0) doc.y += 5;
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(THEME.text).text(`${label}:`, x, y, { continued: true });
    doc.font('Helvetica').text(` ${value}`, { width: columnWidth - 2 });
    if (index % 2 === 0 && index + 1 < rows.length) doc.y = y;
  });
  const address = customerAddress(customer);
  if (address) {
    doc.y += 5;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(THEME.text).text('Endereço:', layout.margin, doc.y, { continued: true });
    doc.font('Helvetica').text(` ${address}`, { width: layout.width });
  }
  doc.y += 10;
}

const TABLE_COLUMNS = [
  { key: 'code', label: 'Código', width: 42, align: 'left' },
  { key: 'description', label: 'Descrição do item', width: 200, align: 'left' },
  { key: 'quantity', label: 'Qtd.', width: 43, align: 'right' },
  { key: 'price', label: 'Valor unitário', width: 78, align: 'right' },
  { key: 'discount', label: 'Desconto', width: 65, align: 'right' },
  { key: 'total', label: 'Total líquido', width: 83, align: 'right' },
];
const TABLE_WIDTH = TABLE_COLUMNS.reduce((total, column) => total + column.width, 0);

function drawTableGrid(doc, layout, y, height, { header = false } = {}) {
  const right = layout.margin + TABLE_WIDTH;
  const bottom = y + height;
  doc.save().lineWidth(THEME.tableOuterBorderWidth).strokeColor(THEME.tableOuterBorder)
    .moveTo(layout.margin, y).lineTo(right, y).moveTo(layout.margin, y).lineTo(layout.margin, bottom)
    .moveTo(right, y).lineTo(right, bottom).stroke();
  doc.lineWidth(header ? THEME.tableHeaderDividerWidth : THEME.tableHorizontalBorderWidth)
    .strokeColor(header ? THEME.tableHeaderDivider : THEME.tableHorizontalBorder)
    .moveTo(layout.margin, bottom).lineTo(right, bottom).stroke();
  let x = layout.margin;
  doc.lineWidth(THEME.tableVerticalBorderWidth).strokeColor(THEME.tableVerticalBorder);
  for (const column of TABLE_COLUMNS.slice(0, -1)) {
    x += column.width;
    doc.moveTo(x, y).lineTo(x, bottom);
  }
  doc.stroke().restore();
}

function drawTableHeader(doc, layout) {
  const height = 23;
  const y = doc.y;
  doc.save().rect(layout.margin, y, TABLE_WIDTH, height).fill(THEME.tableHeaderBackground).restore();
  let x = layout.margin;
  for (const column of TABLE_COLUMNS) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(THEME.blue)
      .text(column.label, x + 4, y + 7, { width: column.width - 8, height: height - 8, align: column.align, lineBreak: false, ellipsis: true });
    x += column.width;
  }
  drawTableGrid(doc, layout, y, height, { header: true });
  doc.y = y + height;
}

function itemDescription(item) {
  return safeText(item.description || item.name, '-');
}

function discountLabel(item) {
  return Number(item.discount_amount || 0) > 0 ? formatMoney(item.discount_amount) : '0%';
}

function drawTableRow(doc, layout, item, description, { continuation = false } = {}) {
  doc.font('Helvetica-Bold').fontSize(8.5);
  const descriptionHeight = doc.heightOfString(description, { width: TABLE_COLUMNS[1].width - 10, lineGap: 1 });
  const height = Math.max(27, descriptionHeight + 10);
  const values = {
    code: continuation ? '' : safeText(item.code),
    description: continuation ? `(continuação) ${description}` : description,
    quantity: continuation ? '' : Number(item.quantity || 0).toFixed(2),
    price: continuation ? '' : formatMoney(item.unit_price),
    discount: continuation ? '' : discountLabel(item),
    total: continuation ? '' : formatMoney(item.total),
  };
  const y = doc.y;
  doc.save().rect(layout.margin, y, TABLE_WIDTH, height).fill('#ffffff').restore();
  let x = layout.margin;
  for (const column of TABLE_COLUMNS) {
    doc.font(column.key === 'description' || ['price', 'discount', 'total'].includes(column.key) ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(column.key === 'description' ? 8.5 : 7.8).fillColor(THEME.text)
      .text(String(values[column.key]), x + 4, y + 5, { width: column.width - 8, height: height - 8, align: column.align, lineGap: 1 });
    x += column.width;
  }
  drawTableGrid(doc, layout, y, height);
  doc.y = y + height;
}

function drawItems(doc, layout, data) {
  const continuation = () => drawContinuationHeader(doc, layout, data);
  drawSectionTitle(doc, layout, 'Itens', { top: 2, keepWith: 50, accent: false });
  drawTableHeader(doc, layout);
  for (const item of data.items) {
    let remaining = itemDescription(item);
    let isContinuation = false;
    while (remaining) {
      doc.font('Helvetica-Bold').fontSize(8.5);
      const fullHeight = Math.max(27, doc.heightOfString(isContinuation ? `(continuação) ${remaining}` : remaining, { width: TABLE_COLUMNS[1].width - 10, lineGap: 1 }) + 10);
      if (fullHeight > layout.availableHeight && fullHeight < 250) {
        layout.addPage({ kind: 'orcamento', header: continuation });
        drawTableHeader(doc, layout);
        continue;
      }
      let chunk = remaining;
      let tail = '';
      if (fullHeight > layout.availableHeight) {
        const split = splitTextToFit(doc, remaining, { width: TABLE_COLUMNS[1].width - 10, height: Math.max(layout.availableHeight - 12, 30), options: { lineGap: 1 } });
        chunk = split.head;
        tail = split.tail;
      }
      drawTableRow(doc, layout, item, chunk, { continuation: isContinuation });
      remaining = tail;
      isContinuation = true;
      if (remaining) {
        layout.addPage({ kind: 'orcamento', header: continuation });
        drawTableHeader(doc, layout);
      }
    }
  }
  doc.y += 12;
}

function paymentText(payment) {
  const label = PAYMENT_LABELS[payment.type] || payment.description || payment.type || '-';
  const installments = Number(payment.installment_count || 1) > 1 ? ` - ${payment.installment_count} parcelas` : '';
  const allDates = (payment.installments || []).filter((item) => item.due_date);
  const dates = allDates.slice(0, 6).map((item) => `Parcela ${item.number}: ${formatDate(item.due_date)} - ${formatMoney(item.amount)}`);
  if (allDates.length > dates.length) dates.push(`... e mais ${allDates.length - dates.length} parcela(s)`);
  const details = [payment.description && payment.description.toLocaleLowerCase('pt-BR') !== label.toLocaleLowerCase('pt-BR') ? payment.description : '', ...dates].filter(Boolean);
  return `${label}${installments}\n${formatMoney(payment.amount)}${details.length ? `\n${details.join('\n')}` : ''}`;
}

function drawPaymentsAndTotals(doc, layout, data) {
  const leftWidth = 225;
  const gap = 20;
  const rightWidth = layout.width - leftWidth - gap;
  doc.font('Helvetica').fontSize(9);
  const paymentBody = data.payment_methods.length ? data.payment_methods.map(paymentText).join('\n\n') : 'Não informado';
  const paymentHeight = doc.heightOfString(paymentBody, { width: leftWidth - 20, lineGap: 1 });
  const lines = [
    ['Total bruto', formatMoney(data.totals.gross)],
    ['Desconto dos itens', formatMoney(data.totals.item_discount)],
    ['Desconto geral', formatMoney(data.totals.general_discount)],
    ...(Number(data.totals.freight || 0) > 0 ? [['Frete', formatMoney(data.totals.freight)]] : []),
    ['Total líquido', formatMoney(data.totals.total)],
  ];
  const blockHeight = Math.max(paymentHeight + 36, lines.length * 22 + 24, 112);
  layout.ensureSpace(blockHeight + 8, { kind: 'orcamento', header: () => drawContinuationHeader(doc, layout, data) });
  const y = doc.y;
  doc.save().roundedRect(layout.margin, y, leftWidth, blockHeight, 8).fillAndStroke('#ffffff', '#dbe1ea').restore();
  doc.font('Helvetica-Bold').fontSize(13).fillColor(THEME.blue).text('Forma de pagamento', layout.margin + 10, y + 10, { width: leftWidth - 20 });
  doc.font('Helvetica').fontSize(9).fillColor(THEME.text).text(paymentBody, layout.margin + 10, y + 31, { width: leftWidth - 20, lineGap: 1 });
  const totalsX = layout.margin + leftWidth + gap;
  let lineY = y + 6;
  lines.forEach(([label, value], index) => {
    const final = index === lines.length - 1;
    doc.font(final ? 'Helvetica-Bold' : 'Helvetica').fontSize(final ? 15 : 10).fillColor(final ? '#111827' : THEME.text);
    doc.text(label, totalsX, lineY, { width: rightWidth * 0.52 });
    doc.font('Helvetica-Bold').text(value, totalsX + rightWidth * 0.5, lineY, { width: rightWidth * 0.5, align: 'right' });
    lineY += final ? 28 : 22;
    doc.moveTo(totalsX, lineY - 8).lineTo(totalsX + rightWidth, lineY - 8)
      .lineWidth(final ? 1.5 : 0.5).strokeColor(final ? THEME.blueLine : THEME.borderSoft).stroke();
  });
  doc.y = y + blockHeight + 12;
}

export function drawCommercialSignatureFooters(doc, layout, company) {
  const signature = company.signature_asset;
  const responsible = company.nome_representante || company.responsavel_nome
    || company.nome_fantasia || company.razao_social || 'Torneadora Universal';
  const gap = 42;
  const width = (layout.width - gap) / 2;
  const pageRange = doc.bufferedPageRange();
  const lastQuotePage = layout.pageIndexes('orcamento').at(-1);
  const signaturePages = lastQuotePage === undefined ? [] : [lastQuotePage];
  for (const index of signaturePages) {
    doc.switchToPage(pageRange.start + index);
    const areaTop = doc.page.height - layout.margin - THEME.footerHeight - THEME.commercialSignatureHeight;
    const imageY = areaTop + 5;
    const lineY = areaTop + 39;
    if (signature) {
      const size = containSize(signature, width, 30);
      drawCenteredImage(doc, signature, { x: layout.margin, y: imageY, width, height: size.height });
    }
    doc.save().lineWidth(0.6).strokeColor('#374151');
    doc.moveTo(layout.margin, lineY).lineTo(layout.margin + width, lineY).stroke();
    doc.moveTo(layout.margin + width + gap, lineY).lineTo(layout.margin + layout.width, lineY).stroke();
    doc.restore();
    doc.font('Helvetica').fontSize(7.5).fillColor('#4b5563');
    doc.text(responsible || 'Responsável', layout.margin, lineY + 5, { width, height: 11, align: 'center', lineBreak: false, ellipsis: true });
    doc.text('Assinatura do cliente', layout.margin + width + gap, lineY + 5, { width, height: 11, align: 'center', lineBreak: false });
  }
  return signaturePages;
}

export function renderQuote(doc, layout, data, company) {
  layout.addPage({ kind: 'orcamento' });
  drawHeader(doc, layout, data, company);
  drawCustomer(doc, layout, data.customer || {});
  drawItems(doc, layout, data);
  // O fechamento inteiro é composto já considerando a faixa fixa de
  // assinatura. Se não couber, pagamentos/observações avançam para a próxima
  // página do Orçamento e garantem que ela nunca exista apenas para assinar.
  layout.withBottomReserve(THEME.commercialSignatureHeight, () => {
    drawPaymentsAndTotals(doc, layout, data);
    doc.font('Helvetica').fontSize(10);
    const observationsHeight = doc.heightOfString(safeText(data.commercial_notes, '-'), { width: layout.width - 24, lineGap: 2 });
    layout.ensureSpace(Math.min(observationsHeight + 72, 170), { kind: 'orcamento', header: () => drawContinuationHeader(doc, layout, data) });
    drawTextPanel(doc, layout, {
      title: 'Observações', text: data.commercial_notes || '-', background: THEME.warningPanel,
      border: THEME.warningBorder, kind: 'orcamento', pageHeader: () => drawContinuationHeader(doc, layout, data),
    });
    layout.ensureSpace(18, { kind: 'orcamento', header: () => drawContinuationHeader(doc, layout, data) });
    doc.font('Helvetica').fontSize(8.5).fillColor('#4b5563')
      .text('Este orçamento foi apresentado ao cliente para análise e aprovação.', layout.margin, doc.y, { width: layout.width });
  });
}

export { displayNumber };
