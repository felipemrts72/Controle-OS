import { pool, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { hasPermission } from './permissionService.js';
import { listCustomers } from './customerService.js';
import { logAudit } from './auditService.js';
import { calculateSop } from './productCatalogService.js';
import { getCompanyPdfData } from './companySettingsService.js';
import { createOfficialQuoteDocument } from './commercialQuoteDocumentService.js';
import { UNIDENTIFIED_CUSTOMER } from './commercialQuoteDocumentDataService.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_VALUES = new Set(['draft', 'sent', 'approved', 'rejected', 'cancelled']);
const PAYMENT_TYPES = new Set(['cash', 'pix', 'bank_slip', 'bank_transfer', 'debit_card', 'credit_card', 'check', 'other']);
const STATUS_TRANSITIONS = {
  draft: new Set(['sent', 'cancelled']),
  sent: new Set(['draft', 'approved', 'rejected', 'cancelled']),
  approved: new Set(),
  rejected: new Set(),
  cancelled: new Set(),
};

function assertUuid(value, field = 'id') {
  if (!UUID_PATTERN.test(String(value || ''))) {
    throw httpError(400, 'Identificador inválido.', { field });
  }
}

function cleanText(value, maxLength, field, required = false) {
  const text = value === undefined || value === null ? '' : String(value).trim().replace(/\s+/g, ' ');
  if (required && !text) throw httpError(400, `Informe ${field}.`, { field });
  if (maxLength && text.length > maxLength) {
    throw httpError(400, `O campo ${field} excede ${maxLength} caracteres.`, { field });
  }
  return text || null;
}

function decimalToUnits(value, scale, field, { positive = false } = {}) {
  if (value === undefined || value === null || value === '') value = 0;
  const normalized = String(value).trim().replace(',', '.');
  const match = normalized.match(new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${scale}}))?$`));
  if (!match) throw httpError(400, `Valor inválido em ${field}.`, { field });
  const units = BigInt(match[1]) * (10n ** BigInt(scale))
    + BigInt((match[2] || '').padEnd(scale, '0') || '0');
  if (positive && units <= 0n) throw httpError(400, `${field} deve ser maior que zero.`, { field });
  return units;
}

function unitsToDecimal(units, scale) {
  const factor = 10n ** BigInt(scale);
  const whole = units / factor;
  const fraction = (units % factor).toString().padStart(scale, '0');
  return `${whole}.${fraction}`;
}

function multiplyRounded(quantityThousandths, unitPriceCents) {
  return (quantityThousandths * unitPriceCents + 500n) / 1000n;
}

function percentageAmount(totalCents, percentageTenThousandths) {
  return (totalCents * percentageTenThousandths + 500000n) / 1000000n;
}

function parseDate(value, field, required = false) {
  if (!value) {
    if (required) throw httpError(400, `Informe ${field}.`, { field });
    return null;
  }
  const text = String(value).slice(0, 10);
  if (!DATE_PATTERN.test(text)) throw httpError(400, `Data inválida em ${field}.`, { field });
  const [year, month, day] = text.split('-').map(Number);
  if (year < 2000 || year > 9999) throw httpError(400, `Data inválida em ${field}.`, { field });
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw httpError(400, `Data inválida em ${field}.`, { field });
  }
  return text;
}

export function calculateQuoteTotals(items, discountValue = 0, freightValue = 0) {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, 'Adicione pelo menos um item ao orçamento.', { field: 'items' });
  }
  const calculatedItems = items.map((item, index) => {
    const quantity = decimalToUnits(item.quantity, 3, `items.${index}.quantity`, { positive: true });
    const unitPrice = decimalToUnits(item.unit_price, 2, `items.${index}.unit_price`);
    const grossSubtotal = multiplyRounded(quantity, unitPrice);
    const discountAmount = decimalToUnits(item.discount_amount, 2, `items.${index}.discount_amount`);
    if (discountAmount > grossSubtotal) {
      throw httpError(400, 'O desconto do item não pode superar seu valor bruto.', {
        field: `items.${index}.discount_amount`,
      });
    }
    return {
      ...item,
      quantity: unitsToDecimal(quantity, 3),
      unit_price: unitsToDecimal(unitPrice, 2),
      gross_subtotal: unitsToDecimal(grossSubtotal, 2),
      discount_amount: unitsToDecimal(discountAmount, 2),
      subtotal: unitsToDecimal(grossSubtotal - discountAmount, 2),
      _grossCents: grossSubtotal,
      _discountCents: discountAmount,
    };
  });
  const grossCents = calculatedItems.reduce((sum, item) => sum + item._grossCents, 0n);
  const itemDiscountCents = calculatedItems.reduce((sum, item) => sum + item._discountCents, 0n);
  const subtotalCents = grossCents - itemDiscountCents;
  const discountCents = decimalToUnits(discountValue, 2, 'discount_amount');
  const freightCents = decimalToUnits(freightValue, 2, 'freight_amount');
  if (discountCents > subtotalCents) {
    throw httpError(400, 'O desconto geral não pode superar o subtotal.', { field: 'discount_amount' });
  }
  return {
    items: calculatedItems.map(({ _grossCents, _discountCents, ...item }) => item),
    totals: {
      items_gross_total: unitsToDecimal(grossCents, 2),
      items_discount_total: unitsToDecimal(itemDiscountCents, 2),
      subtotal: unitsToDecimal(subtotalCents, 2),
      discount_amount: unitsToDecimal(discountCents, 2),
      freight_amount: unitsToDecimal(freightCents, 2),
      total: unitsToDecimal(subtotalCents - discountCents + freightCents, 2),
    },
  };
}

function buildCustomerSnapshot(customer) {
  return {
    schema_version: 1,
    id: customer.id,
    name: customer.name,
    trade_name: customer.trade_name || null,
    person_type: customer.person_type || null,
    tax_id: customer.tax_id || null,
    phone: customer.phone || null,
    whatsapp: customer.whatsapp || null,
    email: customer.email || null,
    address: {
      zip_code: customer.zip_code || null,
      street: customer.address || null,
      number: customer.address_number || null,
      complement: customer.complement || null,
      neighborhood: customer.neighborhood || null,
      city: customer.city || customer.location || null,
      state: customer.state || customer.destination_uf || null,
    },
  };
}

function buildFreeTextCustomerSnapshot(name) {
  return {
    schema_version: 1,
    source: name ? 'free_text' : 'unidentified',
    id: null,
    name: name || UNIDENTIFIED_CUSTOMER,
    trade_name: null,
    person_type: null,
    tax_id: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: { zip_code: null, street: null, number: null, complement: null, neighborhood: null, city: null, state: null },
  };
}

async function resolveCustomer(client, body) {
  if (body.customer_id) {
    const customer = await getActiveCustomer(client, body.customer_id);
    return { id: customer.id, name: customer.name, snapshot: buildCustomerSnapshot(customer) };
  }
  const name = cleanText(body.customer_name, 180, 'customer_name');
  return { id: null, name: name || UNIDENTIFIED_CUSTOMER, snapshot: buildFreeTextCustomerSnapshot(name) };
}

async function currentCompanyDocumentSnapshot(database) {
  const company = await getCompanyPdfData(database);
  const { logo, logo_url: _logoUrl, ...settings } = company;
  return { snapshot: { schema_version: 1, ...settings }, logo: logo || null };
}

async function getActiveCustomer(client, customerId) {
  assertUuid(customerId, 'customer_id');
  const result = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
  const customer = result.rows[0];
  if (!customer) throw httpError(400, 'Cliente não encontrado.', { field: 'customer_id', code: 'CUSTOMER_NOT_FOUND' });
  if (customer.is_active === false) throw httpError(400, 'O cliente selecionado está inativo.', { field: 'customer_id', code: 'CUSTOMER_INACTIVE' });
  return customer;
}

async function buildItems(client, items, userId = null) {
  const calculated = calculateQuoteTotals(items, 0, 0).items;
  const commercialProductIds = [...new Set(calculated.filter((item) => item.commercial_product_id).map((item) => String(item.commercial_product_id)))];
  commercialProductIds.forEach((id) => assertUuid(id, 'commercial_product_id'));
  const productIds = [...new Set(calculated.filter((item) => item.product_id && !item.commercial_product_id).map((item) => String(item.product_id)))];
  productIds.forEach((id) => assertUuid(id, 'product_id'));
  const commercialProductMap = new Map();
  const productMap = new Map();
  if (commercialProductIds.length) {
    const result = await client.query(
      `SELECT cp.id,cp.name,cp.commercial_code,cp.commercial_description,cp.is_active,
        catalog.id AS product_catalog_id,catalog.reference_price,catalog.sop_discount_type,catalog.sop_discount_value,
        catalog.active_version_id AS product_catalog_version_id
       FROM commercial_products cp
       LEFT JOIN product_catalogs catalog ON catalog.commercial_product_id=cp.id
       WHERE cp.id=ANY($1::uuid[])`, [commercialProductIds],
    );
    result.rows.forEach((row) => commercialProductMap.set(String(row.id), row));
  }
  if (productIds.length) {
    const result = await client.query(
      `SELECT p.id, p.name, p.internal_code, p.measurement_unit_code, p.is_active,
        catalog.id AS product_catalog_id,catalog.reference_price,catalog.commercial_description,
        catalog.sop_discount_type,catalog.sop_discount_value,catalog.active_version_id AS product_catalog_version_id
       FROM products p
       LEFT JOIN product_catalogs catalog ON catalog.product_id = p.id
       WHERE p.id = ANY($1::uuid[])`,
      [productIds],
    );
    result.rows.forEach((row) => productMap.set(row.id, row));
  }

  const resultItems = [];
  for (let index = 0; index < calculated.length; index += 1) {
    const item = calculated[index];
    if (item.commercial_product_id) {
      const product = commercialProductMap.get(String(item.commercial_product_id));
      if (!product) throw httpError(400, 'Produto Comercial não encontrado.', { field: `items.${index}.commercial_product_id`, code: 'COMMERCIAL_PRODUCT_NOT_FOUND' });
      if (product.is_active === false) throw httpError(400, 'O Produto Comercial selecionado está inativo.', { field: `items.${index}.commercial_product_id`, code: 'COMMERCIAL_PRODUCT_INACTIVE' });
      const sop = calculateSop(product.reference_price, product.sop_discount_type, product.sop_discount_value);
      const quantityUnits = decimalToUnits(item.quantity, 3, `items.${index}.quantity`, { positive: true });
      const subtotalCents = decimalToUnits(item.subtotal, 2, `items.${index}.subtotal`);
      const effectiveCents = (subtotalCents * 1000n + quantityUnits / 2n) / quantityUnits;
      const effectiveUnitPrice = unitsToDecimal(effectiveCents, 2);
      resultItems.push({
        ...item,
        item_type: 'product', product_id: null, commercial_product_id: product.id,
        product_code_snapshot: product.commercial_code || null,
        product_name_snapshot: product.name,
        commercial_product_code_snapshot: product.commercial_code || null,
        commercial_product_name_snapshot: product.name,
        measurement_unit_snapshot: cleanText(item.unit, 20, `items.${index}.unit`),
        description_snapshot: cleanText(item.description, null, `items.${index}.description`) || product.commercial_description || product.name,
        commercial_description_snapshot: product.commercial_description || null,
        product_catalog_id: product.product_catalog_id || null,
        product_catalog_version_id: product.product_catalog_version_id || null,
        reference_price_snapshot: product.reference_price || null,
        sop_discount_type_snapshot: product.sop_discount_type || null,
        sop_discount_value_snapshot: product.sop_discount_value || null,
        sop_minimum_price_snapshot: sop?.minimum_price || null,
        effective_unit_price: effectiveUnitPrice,
        is_outside_sop: sop ? effectiveCents < decimalToUnits(sop.minimum_price, 2, 'sop_minimum_price') : false,
        save_product_requested: false,
      });
      continue;
    }
    if (item.product_id) {
      const product = productMap.get(String(item.product_id));
      if (!product) throw httpError(400, 'Produto não encontrado.', { field: `items.${index}.product_id`, code: 'PRODUCT_NOT_FOUND' });
      if (product.is_active === false) throw httpError(400, 'O Produto selecionado está inativo.', { field: `items.${index}.product_id`, code: 'PRODUCT_INACTIVE' });
      const sop = calculateSop(product.reference_price, product.sop_discount_type, product.sop_discount_value);
      const quantityUnits = decimalToUnits(item.quantity, 3, `items.${index}.quantity`, { positive: true });
      const subtotalCents = decimalToUnits(item.subtotal, 2, `items.${index}.subtotal`);
      const effectiveCents = (subtotalCents * 1000n + quantityUnits / 2n) / quantityUnits;
      const effectiveUnitPrice = unitsToDecimal(effectiveCents, 2);
      const isOutsideSop = sop ? effectiveCents < decimalToUnits(sop.minimum_price, 2, 'sop_minimum_price') : false;
      resultItems.push({
        ...item,
        item_type: 'product',
        product_id: product.id,
        commercial_product_id: null,
        product_code_snapshot: product.internal_code || null,
        product_name_snapshot: product.name,
        commercial_product_code_snapshot: null,
        commercial_product_name_snapshot: null,
        measurement_unit_snapshot: product.measurement_unit_code || null,
        description_snapshot: cleanText(item.description, null, `items.${index}.description`)
          || product.commercial_description || product.name,
        commercial_description_snapshot: null,
        product_catalog_id: product.product_catalog_id || null,
        product_catalog_version_id: product.product_catalog_version_id || null,
        reference_price_snapshot: product.reference_price || null,
        sop_discount_type_snapshot: product.sop_discount_type || null,
        sop_discount_value_snapshot: product.sop_discount_value || null,
        sop_minimum_price_snapshot: sop?.minimum_price || null,
        effective_unit_price: effectiveUnitPrice,
        is_outside_sop: isOutsideSop,
        save_product_requested: false,
      });
      continue;
    }
    const manualName = cleanText(item.name, 220, `items.${index}.name`, true);
    if (item.save_product !== false) {
      const duplicate = (await client.query(
        `SELECT id,name,commercial_code FROM commercial_products
         WHERE lower(btrim(name))=lower(btrim($1)) ORDER BY is_active DESC,updated_at DESC LIMIT 1`, [manualName],
      )).rows[0];
      if (duplicate) throw httpError(409, 'Já existe um Produto Comercial com o mesmo nome. Selecione-o na busca ou desmarque “Salvar produto”.', {
        field: `items.${index}.name`, code: 'COMMERCIAL_PRODUCT_DUPLICATE', details: { duplicate },
      });
      const manualCode = cleanText(item.code, 80, `items.${index}.code`);
      const manualDescription = cleanText(item.description, null, `items.${index}.description`);
      const created = (await client.query(
        `INSERT INTO commercial_products(name,commercial_code,commercial_description,created_by,updated_by)
         VALUES($1,$2,$3,$4,$4) RETURNING *`, [manualName, manualCode, manualDescription, userId],
      )).rows[0];
      const catalog = (await client.query(
        `INSERT INTO product_catalogs(commercial_product_id,reference_price,commercial_description,created_by,updated_by)
         VALUES($1,$2,$3,$4,$4) RETURNING *`, [created.id, item.unit_price, manualDescription, userId],
      )).rows[0];
      resultItems.push({
        ...item, item_type: 'product', product_id: null, commercial_product_id: created.id,
        product_code_snapshot: manualCode, product_name_snapshot: manualName,
        commercial_product_code_snapshot: manualCode, commercial_product_name_snapshot: manualName,
        measurement_unit_snapshot: cleanText(item.unit, 20, `items.${index}.unit`),
        description_snapshot: manualDescription, commercial_description_snapshot: manualDescription,
        save_product_requested: true, product_catalog_id: catalog.id, product_catalog_version_id: null,
        reference_price_snapshot: item.unit_price, sop_discount_type_snapshot: null,
        sop_discount_value_snapshot: null, sop_minimum_price_snapshot: null,
        effective_unit_price: item.unit_price, is_outside_sop: false,
      });
      continue;
    }
    resultItems.push({
      ...item,
      item_type: 'manual',
      product_id: null,
      commercial_product_id: null,
      product_code_snapshot: cleanText(item.code, 80, `items.${index}.code`),
      product_name_snapshot: manualName,
      commercial_product_code_snapshot: null,
      commercial_product_name_snapshot: null,
      measurement_unit_snapshot: cleanText(item.unit, 20, `items.${index}.unit`),
      description_snapshot: cleanText(item.description, null, `items.${index}.description`),
      commercial_description_snapshot: null,
      save_product_requested: item.save_product !== false,
      product_catalog_id: null, product_catalog_version_id: null, reference_price_snapshot: null,
      sop_discount_type_snapshot: null, sop_discount_value_snapshot: null, sop_minimum_price_snapshot: null,
      effective_unit_price: item.unit_price, is_outside_sop: false,
    });
  }
  return resultItems;
}

function addMonths(dateText, monthCount) {
  if (!dateText) return null;
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + monthCount, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function distributeInstallments(amountCents, count) {
  const base = amountCents / BigInt(count);
  const remainder = amountCents % BigInt(count);
  return Array.from({ length: count }, (_, index) => base + (BigInt(index) < remainder ? 1n : 0n));
}

function buildPaymentMethods(methods, totalValue) {
  if (methods === undefined || methods === null) return [];
  if (!Array.isArray(methods)) throw httpError(400, 'Condições de pagamento inválidas.', { field: 'payment_methods' });
  const totalCents = decimalToUnits(totalValue, 2, 'total');
  const result = methods.map((method, index) => {
    const methodType = String(method.method_type || 'other');
    if (!PAYMENT_TYPES.has(methodType)) throw httpError(400, 'Forma de pagamento inválida.', { field: `payment_methods.${index}.method_type` });
    const calculationType = String(method.calculation_type || 'amount');
    if (!['amount', 'percentage'].includes(calculationType)) throw httpError(400, 'Modo de pagamento inválido.', { field: `payment_methods.${index}.calculation_type` });
    let percentage = null;
    let amountCents;
    if (calculationType === 'percentage') {
      const percentageUnits = decimalToUnits(method.percentage, 4, `payment_methods.${index}.percentage`, { positive: true });
      if (percentageUnits > 1000000n) throw httpError(400, 'O percentual não pode superar 100%.', { field: `payment_methods.${index}.percentage` });
      percentage = unitsToDecimal(percentageUnits, 4);
      amountCents = percentageAmount(totalCents, percentageUnits);
    } else {
      amountCents = decimalToUnits(method.amount, 2, `payment_methods.${index}.amount`, { positive: true });
    }
    if (amountCents <= 0n) throw httpError(400, 'O valor da forma de pagamento deve ser maior que zero.', { field: `payment_methods.${index}.amount` });
    const installmentCount = Number.parseInt(method.installment_count, 10) || 1;
    if (installmentCount < 1 || installmentCount > 120) throw httpError(400, 'Quantidade de parcelas inválida.', { field: `payment_methods.${index}.installment_count` });
    const firstDueDate = parseDate(method.first_due_date, `payment_methods.${index}.first_due_date`);
    const installments = distributeInstallments(amountCents, installmentCount).map((amount, installmentIndex) => ({
      installment_number: installmentIndex + 1,
      due_date: addMonths(firstDueDate, installmentIndex),
      amount: unitsToDecimal(amount, 2),
    }));
    return {
      method_type: methodType,
      description: cleanText(method.description, 180, `payment_methods.${index}.description`)
        || ({ cash: 'À vista', pix: 'PIX', bank_slip: 'Boleto', bank_transfer: 'Transferência', debit_card: 'Cartão de débito', credit_card: 'Cartão de crédito', check: 'Cheque', other: 'Outra condição' })[methodType],
      calculation_type: calculationType,
      percentage,
      amount: unitsToDecimal(amountCents, 2),
      installment_count: installmentCount,
      first_due_date: firstDueDate,
      notes: cleanText(method.notes, null, `payment_methods.${index}.notes`),
      installments,
      _amountCents: amountCents,
    };
  });
  if (result.length) {
    const allocated = result.reduce((sum, method) => sum + method._amountCents, 0n);
    if (allocated !== totalCents) {
      throw httpError(400, 'A soma das formas de pagamento deve ser igual ao total do orçamento.', {
        field: 'payment_methods', code: 'PAYMENT_TOTAL_MISMATCH',
        details: { quote_total: unitsToDecimal(totalCents, 2), allocated_total: unitsToDecimal(allocated, 2) },
      });
    }
  }
  return result.map(({ _amountCents, ...method }) => method);
}

async function nextQuoteNumber(client, quoteDate) {
  const year = Number(String(quoteDate).slice(0, 4));
  const result = await client.query(
    `INSERT INTO commercial_quote_counters (counter_year, last_value)
     VALUES ($1, 1)
     ON CONFLICT (counter_year) DO UPDATE
       SET last_value = commercial_quote_counters.last_value + 1,
         updated_at = NOW()
     RETURNING last_value`,
    [year],
  );
  return `ORC-${year}-${String(result.rows[0].last_value).padStart(6, '0')}`;
}

async function nextCommercialNumber(client, counterKey = 'global') {
  const result = await client.query(
    'SELECT next_commercial_quote_number($1) AS commercial_number',
    [counterKey],
  );
  return Number(result.rows[0].commercial_number);
}

async function insertItems(client, quoteId, items) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    await client.query(
      `INSERT INTO commercial_quote_items (
        commercial_quote_id, line_order, item_type, product_id, commercial_product_id, product_code_snapshot,
        product_name_snapshot, measurement_unit_snapshot, description_snapshot,
        commercial_product_code_snapshot,commercial_product_name_snapshot,commercial_description_snapshot,
        quantity, unit_price, gross_subtotal, discount_amount, subtotal,
        product_catalog_id,product_catalog_version_id,reference_price_snapshot,
        sop_discount_type_snapshot,sop_discount_value_snapshot,sop_minimum_price_snapshot,
        effective_unit_price,is_outside_sop,save_product_requested
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [quoteId, index + 1, item.item_type, item.product_id, item.commercial_product_id, item.product_code_snapshot,
        item.product_name_snapshot, item.measurement_unit_snapshot, item.description_snapshot,
        item.commercial_product_code_snapshot,item.commercial_product_name_snapshot,item.commercial_description_snapshot,
        item.quantity, item.unit_price, item.gross_subtotal, item.discount_amount, item.subtotal,
        item.product_catalog_id,item.product_catalog_version_id,item.reference_price_snapshot,
        item.sop_discount_type_snapshot,item.sop_discount_value_snapshot,item.sop_minimum_price_snapshot,
        item.effective_unit_price,item.is_outside_sop,item.save_product_requested !== false],
    );
  }
}

async function insertPaymentMethods(client, quoteId, methods) {
  for (let index = 0; index < methods.length; index += 1) {
    const method = methods[index];
    const result = await client.query(
      `INSERT INTO commercial_quote_payment_methods (
        commercial_quote_id, line_order, method_type, description, calculation_type,
        percentage, amount, installment_count, first_due_date, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [quoteId, index + 1, method.method_type, method.description, method.calculation_type,
        method.percentage, method.amount, method.installment_count, method.first_due_date, method.notes],
    );
    for (const installment of method.installments) {
      await client.query(
        `INSERT INTO commercial_quote_installments (payment_method_id, installment_number, due_date, amount)
         VALUES ($1,$2,$3,$4)`,
        [result.rows[0].id, installment.installment_number, installment.due_date, installment.amount],
      );
    }
  }
}

async function insertHistory(client, quoteId, action, userId, previousStatus = null, newStatus = null, details = null) {
  await client.query(
    `INSERT INTO commercial_quote_history
      (commercial_quote_id, action, previous_status, new_status, details, user_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [quoteId, action, previousStatus, newStatus, details, userId],
  );
}

function buildHeaderPayload(body) {
  const quoteDate = parseDate(body.quote_date || new Date().toISOString().slice(0, 10), 'quote_date', true);
  const validUntil = parseDate(body.valid_until, 'valid_until');
  if (validUntil && validUntil < quoteDate) throw httpError(400, 'A validade não pode ser anterior à data do orçamento.', { field: 'valid_until' });
  return {
    quote_date: quoteDate,
    valid_until: validUntil,
    notes: cleanText(body.notes, null, 'notes'),
    internal_notes: cleanText(body.internal_notes, null, 'internal_notes'),
  };
}

export async function createCommercialQuote(body, user) {
  return transaction(async (client) => {
    const company = await currentCompanyDocumentSnapshot(client);
    const header = buildHeaderPayload(body);
    const customer = await resolveCustomer(client, body);
    const rawItems = await buildItems(client, body.items, user.id);
    const calculation = calculateQuoteTotals(rawItems, body.discount_amount, body.freight_amount);
    const paymentMethods = buildPaymentMethods(body.payment_methods, calculation.totals.total);
    const quoteNumber = await nextQuoteNumber(client, header.quote_date);
    const commercialNumber = await nextCommercialNumber(client);
    const result = await client.query(
      `INSERT INTO commercial_quotes (
        quote_number, commercial_number, customer_id, customer_name_snapshot, customer_snapshot,
        company_snapshot, company_logo_snapshot,
        responsible_user_id, quote_date, valid_until, notes, internal_notes,
        items_gross_total, items_discount_total, subtotal, discount_amount, freight_amount, total,
        created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$8,$8)
       RETURNING *`,
      [quoteNumber, commercialNumber, customer.id, customer.name, customer.snapshot, company.snapshot, company.logo, user.id,
        header.quote_date, header.valid_until, header.notes, header.internal_notes,
        calculation.totals.items_gross_total, calculation.totals.items_discount_total,
        calculation.totals.subtotal, calculation.totals.discount_amount,
        calculation.totals.freight_amount, calculation.totals.total],
    );
    const quote = result.rows[0];
    await insertItems(client, quote.id, calculation.items);
    await insertPaymentMethods(client, quote.id, paymentMethods);
    await insertHistory(client, quote.id, 'created', user.id, null, 'draft', { quote_number: quoteNumber, commercial_number: commercialNumber, outside_sop_items: calculation.items.filter((item) => item.is_outside_sop).length });
    await logAudit(client, {
      entityType: 'commercial_quote', entityId: quote.id, action: 'create',
      newValue: { quote_number: quoteNumber, commercial_number: commercialNumber, status: 'draft', customer_id: customer.id, total: quote.total }, userId: user.id,
    });
    return getCommercialQuote(quote.id, client);
  });
}

export async function listCommercialQuotes(queryParams = {}) {
  const page = Math.max(1, Number.parseInt(queryParams.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(queryParams.limit, 10) || 20));
  const params = [];
  const filters = [];
  const search = cleanText(queryParams.search, 180, 'search');
  if (search) {
    params.push(`%${search}%`);
    filters.push(`(q.quote_number ILIKE $${params.length}
      OR COALESCE(q.commercial_number::text, '') ILIKE $${params.length}
      OR q.customer_name_snapshot ILIKE $${params.length})`);
  }
  const customerSearch = cleanText(queryParams.customer, 180, 'customer');
  if (customerSearch) {
    params.push(`%${customerSearch}%`);
    filters.push(`q.customer_name_snapshot ILIKE $${params.length}`);
  }
  if (queryParams.status) {
    if (!STATUS_VALUES.has(queryParams.status)) throw httpError(400, 'Status inválido.', { field: 'status' });
    params.push(queryParams.status);
    filters.push(`q.status = $${params.length}`);
  }
  if (queryParams.customer_id) {
    assertUuid(queryParams.customer_id, 'customer_id');
    params.push(queryParams.customer_id);
    filters.push(`q.customer_id = $${params.length}`);
  }
  const startDate = parseDate(queryParams.start_date, 'start_date');
  const endDate = parseDate(queryParams.end_date, 'end_date');
  if (startDate) { params.push(startDate); filters.push(`q.quote_date >= $${params.length}`); }
  if (endDate) { params.push(endDate); filters.push(`q.quote_date <= $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM commercial_quotes q ${where}`, params);
  params.push(limit, (page - 1) * limit);
  const result = await pool.query(
    `SELECT q.id, q.quote_number, q.commercial_number, q.customer_id, q.customer_name_snapshot, q.status,
      q.quote_date, q.valid_until, q.subtotal, q.discount_amount, q.freight_amount, q.total,
      q.created_at, q.updated_at, u.name AS responsible_name
     FROM commercial_quotes q
     LEFT JOIN users u ON u.id = q.responsible_user_id
     ${where}
     ORDER BY q.quote_date DESC, q.commercial_number DESC NULLS LAST, q.quote_number DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const total = countResult.rows[0].total;
  return { items: result.rows, pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function getCommercialQuote(id, database = pool) {
  assertUuid(id);
  const result = await database.query(
    `SELECT q.*, responsible.name AS responsible_name, creator.name AS created_by_name,
      updater.name AS updated_by_name
     FROM commercial_quotes q
     LEFT JOIN users responsible ON responsible.id = q.responsible_user_id
     LEFT JOIN users creator ON creator.id = q.created_by
     LEFT JOIN users updater ON updater.id = q.updated_by
     WHERE q.id = $1`,
    [id],
  );
  if (!result.rows[0]) throw httpError(404, 'Orçamento não encontrado.');
  const itemsResult = await database.query(
    'SELECT * FROM commercial_quote_items WHERE commercial_quote_id = $1 ORDER BY line_order', [id],
  );
  const paymentsResult = await database.query(
    'SELECT * FROM commercial_quote_payment_methods WHERE commercial_quote_id = $1 ORDER BY line_order', [id],
  );
  const historyResult = await database.query(
    `SELECT h.*, u.name AS user_name
     FROM commercial_quote_history h LEFT JOIN users u ON u.id = h.user_id
     WHERE h.commercial_quote_id = $1 ORDER BY h.created_at DESC, h.id DESC`, [id],
  );
  const documentsResult = await database.query(
    `SELECT id, document_version, quote_status, filename, byte_size, sha256, created_by, created_at
     FROM commercial_quote_documents WHERE commercial_quote_id = $1
     ORDER BY document_version DESC`, [id],
  );
  const methodIds = paymentsResult.rows.map((row) => row.id);
  let installments = [];
  if (methodIds.length) {
    installments = (await database.query(
      `SELECT * FROM commercial_quote_installments
       WHERE payment_method_id = ANY($1::uuid[]) ORDER BY payment_method_id, installment_number`, [methodIds],
    )).rows;
  }
  return {
    ...result.rows[0],
    items: itemsResult.rows,
    payment_methods: paymentsResult.rows.map((method) => ({
      ...method,
      installments: installments.filter((installment) => installment.payment_method_id === method.id),
    })),
    documents: documentsResult.rows,
    history: historyResult.rows,
  };
}

export async function updateCommercialQuote(id, body, user) {
  assertUuid(id);
  return transaction(async (client) => {
    const company = await currentCompanyDocumentSnapshot(client);
    const currentResult = await client.query('SELECT * FROM commercial_quotes WHERE id = $1 FOR UPDATE', [id]);
    const current = currentResult.rows[0];
    if (!current) throw httpError(404, 'Orçamento não encontrado.');
    if (current.status !== 'draft') throw httpError(409, 'Somente orçamentos em rascunho podem ser editados.', { code: 'QUOTE_NOT_EDITABLE' });
    const header = buildHeaderPayload(body);
    const customer = await resolveCustomer(client, body);
    const rawItems = await buildItems(client, body.items, user.id);
    const calculation = calculateQuoteTotals(rawItems, body.discount_amount, body.freight_amount);
    const paymentMethods = buildPaymentMethods(body.payment_methods, calculation.totals.total);
    const result = await client.query(
      `UPDATE commercial_quotes SET
        customer_id=$1, customer_name_snapshot=$2, customer_snapshot=$3,
        company_snapshot=$4, company_logo_snapshot=$5,
        quote_date=$6, valid_until=$7, notes=$8, internal_notes=$9,
        items_gross_total=$10, items_discount_total=$11, subtotal=$12,
        discount_amount=$13, freight_amount=$14, total=$15,
        updated_by=$16, updated_at=NOW()
       WHERE id=$17 RETURNING *`,
      [customer.id, customer.name, customer.snapshot, company.snapshot, company.logo, header.quote_date, header.valid_until,
        header.notes, header.internal_notes, calculation.totals.items_gross_total,
        calculation.totals.items_discount_total, calculation.totals.subtotal,
        calculation.totals.discount_amount, calculation.totals.freight_amount,
        calculation.totals.total, user.id, id],
    );
    await client.query('DELETE FROM commercial_quote_items WHERE commercial_quote_id = $1', [id]);
    await client.query('DELETE FROM commercial_quote_payment_methods WHERE commercial_quote_id = $1', [id]);
    await insertItems(client, id, calculation.items);
    await insertPaymentMethods(client, id, paymentMethods);
    await insertHistory(client, id, 'edited', user.id, 'draft', 'draft', {
      previous_total: current.total, new_total: result.rows[0].total, outside_sop_items: calculation.items.filter((item) => item.is_outside_sop).length,
    });
    await logAudit(client, {
      entityType: 'commercial_quote', entityId: id, action: 'edit',
      previousValue: { customer_id: current.customer_id, total: current.total, updated_at: current.updated_at },
      newValue: { customer_id: customer.id, total: result.rows[0].total, updated_at: result.rows[0].updated_at }, userId: user.id,
    });
    return getCommercialQuote(id, client);
  });
}

function requiredPermissionForStatus(status) {
  if (status === 'approved') return 'commercial.quotes.approve';
  if (status === 'cancelled') return 'commercial.quotes.cancel';
  return 'commercial.quotes.edit';
}

export async function changeCommercialQuoteStatus(id, newStatus, user) {
  assertUuid(id);
  if (!STATUS_VALUES.has(newStatus)) throw httpError(400, 'Status inválido.', { field: 'status' });
  const permission = requiredPermissionForStatus(newStatus);
  if (!hasPermission(user, permission)) throw httpError(403, 'Acesso não autorizado.');
  return transaction(async (client) => {
    const result = await client.query('SELECT * FROM commercial_quotes WHERE id = $1 FOR UPDATE', [id]);
    const current = result.rows[0];
    if (!current) throw httpError(404, 'Orçamento não encontrado.');
    if (current.status === newStatus) return getCommercialQuote(id, client);
    if (!STATUS_TRANSITIONS[current.status]?.has(newStatus)) {
      throw httpError(409, `Não é permitido alterar o status de ${current.status} para ${newStatus}.`, { code: 'QUOTE_STATUS_TRANSITION_INVALID' });
    }
    if (newStatus === 'sent') {
      const paymentTotal = await client.query(
        'SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM commercial_quote_payment_methods WHERE commercial_quote_id = $1', [id],
      );
      if (decimalToUnits(paymentTotal.rows[0].total, 2, 'payment_total') !== decimalToUnits(current.total, 2, 'total')) {
        throw httpError(409, 'Defina condições de pagamento que fechem o total antes de enviar.', { code: 'QUOTE_PAYMENT_INCOMPLETE' });
      }
    }
    const outsideSop = (await client.query('SELECT COUNT(*)::int total FROM commercial_quote_items WHERE commercial_quote_id=$1 AND is_outside_sop=TRUE', [id])).rows[0].total;
    const timestampColumn = { sent: 'sent_at', approved: 'approved_at', rejected: 'rejected_at', cancelled: 'cancelled_at' }[newStatus];
    const userColumn = { sent: 'sent_by', approved: 'approved_by', rejected: 'rejected_by', cancelled: 'cancelled_by' }[newStatus];
    const assignments = ['status = $1', 'updated_by = $2', 'updated_at = NOW()'];
    if (timestampColumn) assignments.push(`${timestampColumn} = NOW()`, `${userColumn} = $2`);
    const updated = await client.query(
      `UPDATE commercial_quotes SET ${assignments.join(', ')} WHERE id = $3 RETURNING *`, [newStatus, user.id, id],
    );
    const action = newStatus === 'approved' ? 'approved'
      : newStatus === 'rejected' ? 'rejected'
        : newStatus === 'cancelled' ? 'cancelled'
          : newStatus === 'sent' ? 'sent' : 'reopened';
    await insertHistory(client, id, action, user.id, current.status, newStatus, { outside_sop_items: outsideSop, special_authorization_required_in_future: outsideSop > 0 });
    await logAudit(client, {
      entityType: 'commercial_quote', entityId: id, action: `status_${newStatus}`,
      previousValue: { status: current.status }, newValue: { status: newStatus }, userId: user.id,
    });
    const quote = await getCommercialQuote(updated.rows[0].id, client);
    if (newStatus === 'sent') {
      await createOfficialQuoteDocument(client, quote, user.id, { forceNewVersion: true });
    } else if (['approved', 'rejected', 'cancelled'].includes(newStatus)) {
      await createOfficialQuoteDocument(client, quote, user.id);
    }
    return quote;
  });
}

export async function duplicateCommercialQuote(id, user) {
  assertUuid(id);
  return transaction(async (client) => {
    const source = await getCommercialQuote(id, client);
    const quoteDate = new Date().toISOString().slice(0, 10);
    const quoteNumber = await nextQuoteNumber(client, quoteDate);
    const commercialNumber = await nextCommercialNumber(client);
    const durationResult = await client.query(
      `SELECT CASE WHEN valid_until IS NULL THEN NULL ELSE GREATEST(valid_until - quote_date, 0) END AS duration
       FROM commercial_quotes WHERE id = $1`, [id],
    );
    const duration = durationResult.rows[0].duration;
    const validUntilResult = duration === null
      ? { rows: [{ valid_until: null }] }
      : await client.query('SELECT ($1::date + $2::int)::date AS valid_until', [quoteDate, duration]);
    const validUntil = validUntilResult.rows[0].valid_until;
    const result = await client.query(
      `INSERT INTO commercial_quotes (
        quote_number, commercial_number, customer_id, customer_name_snapshot, customer_snapshot, customer_snapshot_version,
        company_snapshot, company_snapshot_version, company_logo_snapshot,
        responsible_user_id, status, quote_date, valid_until, notes, internal_notes,
        items_gross_total, items_discount_total, subtotal, discount_amount, freight_amount, total,
        calculation_version, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$10,$10)
       RETURNING *`,
      [quoteNumber, commercialNumber, source.customer_id, source.customer_name_snapshot, source.customer_snapshot,
        source.customer_snapshot_version, source.company_snapshot, source.company_snapshot_version,
        source.company_logo_snapshot, user.id, quoteDate, validUntil, source.notes, source.internal_notes,
        source.items_gross_total, source.items_discount_total, source.subtotal, source.discount_amount,
        source.freight_amount, source.total, source.calculation_version],
    );
    const duplicated = result.rows[0];
    await client.query(
      `INSERT INTO commercial_quote_items (
        commercial_quote_id, line_order, item_type, product_id, commercial_product_id, product_code_snapshot,
        product_name_snapshot, measurement_unit_snapshot, description_snapshot,
        commercial_product_code_snapshot,commercial_product_name_snapshot,commercial_description_snapshot,
        quantity, unit_price, gross_subtotal, discount_amount, subtotal,
        product_catalog_id,product_catalog_version_id,reference_price_snapshot,sop_discount_type_snapshot,
        sop_discount_value_snapshot,sop_minimum_price_snapshot,effective_unit_price,is_outside_sop,
        save_product_requested
       ) SELECT $1, line_order, item_type, product_id, commercial_product_id, product_code_snapshot,
        product_name_snapshot, measurement_unit_snapshot, description_snapshot,
        commercial_product_code_snapshot,commercial_product_name_snapshot,commercial_description_snapshot,
        quantity, unit_price, gross_subtotal, discount_amount, subtotal,
        product_catalog_id,product_catalog_version_id,reference_price_snapshot,sop_discount_type_snapshot,
        sop_discount_value_snapshot,sop_minimum_price_snapshot,effective_unit_price,is_outside_sop,
        save_product_requested
       FROM commercial_quote_items WHERE commercial_quote_id = $2`, [duplicated.id, id],
    );
    for (const method of source.payment_methods) {
      const paymentResult = await client.query(
        `INSERT INTO commercial_quote_payment_methods (
          commercial_quote_id, line_order, method_type, description, calculation_type,
          percentage, amount, installment_count, first_due_date, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [duplicated.id, method.line_order, method.method_type, method.description, method.calculation_type,
          method.percentage, method.amount, method.installment_count, method.first_due_date, method.notes],
      );
      for (const installment of method.installments) {
        await client.query(
          `INSERT INTO commercial_quote_installments (payment_method_id, installment_number, due_date, amount)
           VALUES ($1,$2,$3,$4)`,
          [paymentResult.rows[0].id, installment.installment_number, installment.due_date, installment.amount],
        );
      }
    }
    await insertHistory(client, duplicated.id, 'duplicated', user.id, null, 'draft', {
      source_quote_id: source.id, source_quote_number: source.quote_number,
      source_commercial_number: source.commercial_number, commercial_number: commercialNumber,
    });
    await logAudit(client, {
      entityType: 'commercial_quote', entityId: duplicated.id, action: 'duplicate',
      newValue: { quote_number: quoteNumber, commercial_number: commercialNumber, source_quote_id: source.id }, userId: user.id,
    });
    return getCommercialQuote(duplicated.id, client);
  });
}

export async function searchCommercialQuoteProducts(search = '', user = null) {
  const term = cleanText(search, 160, 'q') || '';
  const result = await pool.query(
    `SELECT * FROM (
       SELECT cp.id,cp.id AS commercial_product_id,NULL::uuid AS product_id,'commercial'::text AS origin_type,
        cp.commercial_code AS code,cp.name,NULL::varchar AS unit,cp.commercial_description AS description,
        catalog.reference_price,catalog.id AS product_catalog_id,catalog.active_version_id AS product_catalog_version_id,
        catalog.sop_discount_type,catalog.sop_discount_value,version.version_number AS catalog_version_number,
        version.commercial_title AS catalog_title,0 AS origin_order
       FROM commercial_products cp
       LEFT JOIN product_catalogs catalog ON catalog.commercial_product_id=cp.id
       LEFT JOIN product_catalog_versions version ON version.id=catalog.active_version_id
       WHERE cp.is_active=TRUE
         AND ($1='' OR cp.name ILIKE $2 OR COALESCE(cp.commercial_code,'') ILIKE $2)
       UNION ALL
       SELECT p.id,NULL::uuid AS commercial_product_id,p.id AS product_id,'operational_legacy'::text AS origin_type,
        p.internal_code AS code,p.name,p.measurement_unit_code AS unit,catalog.commercial_description AS description,
        catalog.reference_price,catalog.id AS product_catalog_id,catalog.active_version_id AS product_catalog_version_id,
        catalog.sop_discount_type,catalog.sop_discount_value,version.version_number AS catalog_version_number,
        version.commercial_title AS catalog_title,1 AS origin_order
       FROM products p
       LEFT JOIN product_catalogs catalog ON catalog.product_id=p.id
       LEFT JOIN product_catalog_versions version ON version.id=catalog.active_version_id
       WHERE COALESCE(p.is_active,TRUE)=TRUE
         AND ($1='' OR p.name ILIKE $2 OR COALESCE(p.internal_code,'') ILIKE $2)
         AND NOT EXISTS(SELECT 1 FROM commercial_products cp WHERE cp.operational_product_id=p.id AND cp.is_active=TRUE)
     ) choices
     ORDER BY origin_order,CASE WHEN LOWER(COALESCE(code,''))=LOWER($1) THEN 0 ELSE 1 END,name
     LIMIT 40`,
    [term, `%${term}%`],
  );
  const canViewSop = user && hasPermission(user, 'commercial.catalog.sop.view');
  return result.rows.map((row) => ({ ...row, catalog_configured: Boolean(row.product_catalog_id),
    sop_minimum_price: canViewSop ? calculateSop(row.reference_price,row.sop_discount_type,row.sop_discount_value)?.minimum_price || null : undefined,
    sop_discount_type: canViewSop ? row.sop_discount_type : undefined,
    sop_discount_value: canViewSop ? row.sop_discount_value : undefined }));
}

export function concealQuoteSop(quote, user) {
  const { company_logo_snapshot: _companyLogo, ...publicQuote } = quote;
  if (hasPermission(user, 'commercial.catalog.sop.view')) return publicQuote;
  return { ...publicQuote, items: (quote.items || []).map(({ sop_discount_type_snapshot: _type, sop_discount_value_snapshot: _value, sop_minimum_price_snapshot: _minimum, is_outside_sop: _outside, ...item }) => item) };
}

export async function searchCommercialQuoteCustomers(queryParams = {}) {
  const result = await listCustomers({ search: queryParams.q || '', status: 'active', page: 1, limit: 20 });
  return result.items;
}

export const commercialQuoteInternals = {
  buildPaymentMethods,
  distributeInstallments,
  nextCommercialNumber,
  nextQuoteNumber,
};
