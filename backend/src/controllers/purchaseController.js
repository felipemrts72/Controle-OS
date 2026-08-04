import * as service from '../services/purchaseService.js';
import { getCompanyPdfData } from '../services/companySettingsService.js';
import { buildPurchaseQuotePdf } from '../services/pdf/purchaseQuotePdfService.js';
import { sendPdfResponse } from '../services/pdf/pdfDocument.js';
import * as importService from '../services/purchaseImportService.js';

const handler = (fn, status = 200) => async (req, res, next) => { try { res.status(status).json(await fn(req)); } catch (error) { next(error); } };

export const suppliersIndex = handler((req) => service.listSuppliers(req.query));
export const suppliersShow = handler((req) => service.getSupplier(req.params.id));
export const suppliersStore = handler((req) => service.createSupplier(req.body, req.user), 201);
export const suppliersUpdate = handler((req) => service.updateSupplier(req.params.id, req.body, req.user));
export const suppliersActive = handler((req) => service.setSupplierActive(req.params.id, req.body.is_active, req.user));
export const supplierCatalog = handler((req) => importService.listSupplierCatalog(req.params.id, req.query));
export const supplierMappingStore = handler((req) => importService.saveSupplierMapping(req.params.id, req.body, req.user), 201);
export const supplierMappingActive = handler((req) => importService.setSupplierMappingActive(req.params.id, req.params.mappingId, req.body.is_active, req.user));
export const supplierPrices = handler((req) => importService.getSupplierPriceHistory(req.params.id, req.query.mapping_id));
export const groupsIndex = handler((req) => service.listMaterialGroups(req.query));
export const groupsStore = handler((req) => service.createMaterialGroup(req.body, req.user), 201);
export const groupsUpdate = handler((req) => service.updateMaterialGroup(req.params.id, req.body, req.user));
export const groupsActive = handler((req) => service.setMaterialGroupActive(req.params.id, req.body.is_active, req.user));
export const requestsIndex = handler((req) => service.listPurchaseRequests(req.query, req.user));
export const requestsShow = handler((req) => service.getPurchaseRequest(req.params.id, req.user));
export const requestsStore = handler((req) => service.createPurchaseRequest(req.body, req.user), 201);
export const requestsPreapproved = handler((req) => service.createPurchaseRequest(req.body, req.user, 'preapproved'), 201);
export const requestsUpdate = handler((req) => service.updatePurchaseRequest(req.params.id, req.body, req.user));
export const requestsTransition = handler((req) => service.transitionPurchaseRequest(req.params.id, req.body.action, req.body.reason, req.user));
export const quotesIndex = handler((req) => service.listQuoteRequests(req.query));
export const quotesShow = handler((req) => service.getQuoteRequest(req.params.id, req.user));
export const quotesStore = handler((req) => service.createQuoteRequest(req.body, req.user), 201);
export const quotesDirectStore = handler((req) => service.createQuoteRequest({ ...req.body, quote_type: 'direct' }, req.user), 201);
export const quotesDefaults = handler(() => service.getQuoteDefaults());
export const quotesSuggest = handler((req) => service.suggestSuppliers(req.params.requestId));
export const quotesDispatch = handler((req) => service.registerQuoteDispatch(req.params.id, req.body, req.user), 201);
export const quotesProposal = handler((req) => service.registerProposal(req.params.id, req.body, req.user), 201);
export const quotesSelect = handler((req) => service.selectQuoteSuppliers(req.params.id, req.body, req.user));
export const quotesCopied = handler((req) => service.auditQuoteAction(req.params.id, req.user));
export const purchasesIndex = handler((req) => service.listPurchases(req.query, req.user));
export const purchasesShow = handler((req) => service.getPurchase(req.params.id, req.user));
export const purchasesDirect = handler((req) => service.createDirectPurchase(req.body, req.user), 201);
export const purchasesReceive = handler((req) => service.receivePurchase(req.params.id, req.body, req.user), 201);
export const purchasesCancel = handler((req) => service.cancelPurchase(req.params.id, req.body.reason, req.user));
export const purchasesDashboard = handler((req) => service.getPurchaseDashboard(req.user));
export const importsPreview = handler((req) => importService.previewImport(req.body, req.user));
export const importsConfirm = handler((req) => importService.confirmImport(req.body, req.user), 201);
export const importsCreateProduct = handler((req) => importService.createProductFromImport(req.body, req.user), 201);
export const importsProducts = handler((req) => importService.listImportProducts(req.query.search));

export async function quotesText(req, res, next) { try {
  const [quote, company] = await Promise.all([service.quoteTextData(req.params.id), getCompanyPdfData()]);
  const companyName = company.nome_fantasia || company.razao_social || 'Nossa empresa';
  const lines = [`A empresa ${companyName} solicita orçamento dos itens relacionados abaixo. Favor informar preço, marca, prazo de entrega, condição de pagamento e validade da proposta.`, '', `Cotação: ${quote.number}`];
  quote.items.forEach((item, index) => lines.push(`${index + 1}. ${item.description} — ${item.quantity} ${item.unit}${item.technical_specification ? ` — ${item.technical_specification}` : ''}`));
  lines.push('', `Prazo para resposta: ${quote.response_deadline || 'a combinar'}`, `Local de entrega: ${quote.delivery_address || 'a combinar'}`, `Retorno: ${[quote.response_email, quote.response_whatsapp].filter(Boolean).join(' | ') || 'a combinar'}`);
  if (quote.notes) lines.push(`Observações: ${quote.notes}`); lines.push(`Responsável: ${quote.contact_responsible_name || quote.responsible_name}`); res.json({ text: lines.join('\n') });
} catch (error) { next(error); } }

export async function quotesPdf(req, res, next) { try {
  const [quote, company] = await Promise.all([service.getQuoteRequest(req.params.id), getCompanyPdfData()]);
  const supplier = req.query.supplier_id ? quote.suppliers.find((item) => item.id === req.query.supplier_id) : null;
  if (req.query.supplier_id && !supplier) return next(Object.assign(new Error('Fornecedor não pertence à cotação.'), { status: 400 }));
  const pdf = await buildPurchaseQuotePdf(quote, supplier, company);
  await service.auditQuoteAction(req.params.id, req.user, 'pdf_generated');
  sendPdfResponse(res, pdf, `cotacao-${quote.number}${supplier ? `-${supplier.trade_name || supplier.legal_name}` : ''}.pdf`);
} catch (error) { next(error); } }
