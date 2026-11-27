import { httpError } from './httpError.js';
export function productionDate(value, required=false) {
  if (value == null || value === '') {
    if(required) throw httpError(400,'Informe a Data prevista de entrega — uso interno para gerar ou atualizar a produção.');
    return null;
  }
  const text=value instanceof Date ? [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-') : String(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text)) || new Date(text).toISOString().slice(0,10)!==text) throw httpError(400,'Data prevista de entrega inválida.');
  return text;
}
