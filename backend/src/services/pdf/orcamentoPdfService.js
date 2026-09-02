import PDFDocument from 'pdfkit';
import { UniversalPdfLayout } from './universal/layout.js';
import { imageAsset } from './universal/image.js';
import {
  renderQuote, drawCommercialSignatureFooters, displayNumber,
} from './universal/renderQuote.js';
import { renderCatalogs } from './universal/renderCatalog.js';

function addDraftWatermarks(doc) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    doc.save().fillColor('#64748b').opacity(0.075).font('Helvetica-Bold').fontSize(54)
      .rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .text('RASCUNHO', 70, doc.page.height / 2 - 30, { width: doc.page.width - 140, align: 'center' })
      .restore();
  }
}

function prepareCompany(doc, company) {
  return {
    ...(company || {}),
    logo_asset: imageAsset(doc, company?.logo),
    // Preparado para configuração persistida futura. Sem imagem cadastrada,
    // não há assinatura artificial: ficam a linha e o nome real do responsável.
    signature_asset: imageAsset(doc, company?.signature || company?.assinatura),
  };
}

function prepareCatalogs(doc, data, imageAssets) {
  return (data.catalogs || []).map((catalog) => ({
    ...catalog,
    images: (catalog.images || []).map((image) => ({
      ...image,
      asset: imageAsset(doc, imageAssets?.[image.id] || image.asset),
    })),
  }));
}

// O pipeline documental do OliMen continua chamando a mesma função. Somente a
// composição foi substituída pelo renderer portado do ERP Universal.
export function buildOrcamentoPdf(data, company, {
  draft = false,
  emittedAt = new Date(),
  catalogImageAssets = {},
  onLayout = null,
} = {}) {
  return new Promise((resolve, reject) => {
    const companyName = company?.nome_fantasia || company?.razao_social || '';
    const doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
      info: {
        Title: `ORÇAMENTO #${displayNumber(data.quote.commercial_number)}`,
        Author: companyName,
        Subject: 'Orçamento comercial e catálogo técnico',
        Creator: 'OliMen - renderer ERP Universal / PDFKit',
        CreationDate: emittedAt,
        ModDate: emittedAt,
      },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      const layout = new UniversalPdfLayout(doc);
      const preparedCompany = prepareCompany(doc, company);
      const preparedData = { ...data, catalogs: prepareCatalogs(doc, data, catalogImageAssets) };
      renderQuote(doc, layout, preparedData, preparedCompany);
      renderCatalogs(doc, layout, preparedData, preparedCompany);
      if (draft) addDraftWatermarks(doc);
      const signaturePages = drawCommercialSignatureFooters(doc, layout, preparedCompany);
      layout.drawFooters(preparedCompany);
      onLayout?.({ pages: layout.pages.map((page) => page.kind), signaturePages });
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
