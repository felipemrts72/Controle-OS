export function formatPurchaseDate(value, emptyLabel = 'Sem prazo') {
  if (value === null || value === undefined || String(value).trim() === '') return emptyLabel;
  const raw = String(value).trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const dateTime = new Date(raw);
  if (Number.isNaN(dateTime.getTime())) return emptyLabel;
  return dateTime.toLocaleDateString('pt-BR');
}

export const getSupplierStatusLabel = (value) => value ? 'Ativo' : 'Inativo';
export const getMaterialGroupStatusLabel = (value) => value ? 'Ativo' : 'Inativo';
export const getProductReviewStatusLabel = (value) => value === 'pending_review' ? 'Pendente de revisão' : 'Revisado';
export const getPurchaseRequestStatusLabel = (status) => ({draft:'Rascunho',pending_approval:'Aguardando aprovação',returned:'Devolvida',rejected:'Rejeitada',approved:'Aprovada — aguardando cotação ou compra',quoting:'Em cotação',supplier_selected:'Fornecedor escolhido',purchased:'Compra realizada',partially_received:'Parcialmente recebida',received:'Recebida',cancelled:'Cancelada'})[status] || status;
export const getQuoteStatusLabel = (status) => ({draft:'Rascunho',sent:'Enviada',responses_received:'Com respostas',completed:'Concluída',cancelled:'Cancelada'})[status] || status;
export const getPurchaseOrderStatusLabel = (status) => ({preparing:'Pedido em preparação',ordered:'Pedido realizado',partially_received:'Parcialmente recebido',received:'Recebido',cancelled:'Cancelado'})[status] || status;
