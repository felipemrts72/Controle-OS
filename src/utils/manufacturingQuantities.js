const valid = /^\d{1,12}(?:\.\d{1,6})?$/;
export function productionDecimal(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  return valid.test(text) ? (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text) : null;
}
export function multiplyProduction(left, right) {
  const a = productionDecimal(left), b = productionDecimal(right);
  if (!a || !b) return null;
  const [aw, af = ''] = a.split('.'), [bw, bf = ''] = b.split('.');
  const product = BigInt(aw + af) * BigInt(bw + bf);
  const scale = af.length + bf.length;
  const padded = product.toString().padStart(scale + 1, '0');
  const value = scale ? `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : padded;
  return productionDecimal(value);
}
export function requiredQuantities(nodes, quantity) {
  const byKey = new Map(nodes.map(n => [n.key, n])), totals = new Map();
  function total(node, visiting = new Set()) {
    if (totals.has(node.key)) return totals.get(node.key);
    if (visiting.has(node.key)) return null;
    visiting.add(node.key);
    const parent = byKey.get(node.parent_key);
    const value = node.parent_key ? (parent ? multiplyProduction(total(parent, visiting), node.quantity) : null) : productionDecimal(quantity);
    totals.set(node.key, value); return value;
  }
  for (const node of nodes) total(node);
  return totals;
}
export const shouldManufacture = (node) => {
  const type=node.new_product?.type || node.type;
  if (['resale','material_prima'].includes(type)) return false;
  return node.manufacture ?? (type === 'manufactured');
};
export const manufactureQuantity = (node, required) => node.fabrication_quantity == null ? required : productionDecimal(node.fabrication_quantity);
