import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOrcamentoPdf } from '../backend/src/services/pdf/orcamentoPdfService.js';
import { getCompanyPdfData } from '../backend/src/services/companySettingsService.js';
import { pool } from '../backend/src/database/pool.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productImagesDir = path.join(projectRoot, 'uploads', 'products');
const outputDir = path.join(projectRoot, 'output', 'pdf');
const outputPath = path.join(outputDir, 'olimen-orcamento-modelo-erp-universal.pdf');

const itemRows = [
  ['102', 'Moinho Universal H-3.5', 3, 21000],
  ['103', 'Bica de 0.80 X 3.30 M sistema canadense', 3, 4800],
  ['104', 'Grelhas para Universal H-3.5', 390, 19.5],
  ['105', 'Queixo liso para Universal H-3.5', 3, 270],
  ['106', 'Queixo furado para Universal H-3.5', 3, 295],
  ['107', 'Parafuso 1/2 X 2.1/2 com porca', 9, 4.5],
  ['108', 'Martelo p/ Universal H-3.5', 100, 400],
  ['109', 'Pino p/ Universal H-3.5', 50, 35],
];

async function main() {
  const company = await getCompanyPdfData(pool);
  const imageNames = (await fs.readdir(productImagesDir)).filter((name) => /\.(?:png|jpe?g)$/i.test(name)).slice(0, 2);
  const imageBuffers = await Promise.all(imageNames.map((name) => fs.readFile(path.join(productImagesDir, name))));
  const data = {
    schema_version: 1,
    quote: { id: 'visual-validation', commercial_number: 250, technical_number: 'ORC-2026-000079', status: 'sent', date: '2026-08-04', valid_until: null },
    customer: { source: 'free_text', name: 'Dornelles', tax_id: null, phone: null, email: null, address: {} },
    items: itemRows.map(([code, name, quantity, unitPrice], index) => ({
      order: index + 1, type: 'product', code, name, description: name, quantity: String(quantity),
      unit_price: String(unitPrice), discount_amount: '0', total: String(quantity * unitPrice),
    })),
    payment_methods: [{
      order: 1, type: 'pix', description: 'PIX', calculation_type: 'amount', percentage: null,
      amount: '128490.50', installment_count: 1, first_due_date: null, notes: null, installments: [],
    }],
    totals: { gross: '128490.50', item_discount: '0', subtotal: '128490.50', general_discount: '0', freight: '0', total: '128490.50' },
    commercial_notes: null,
    catalogs: [
      {
        version_id: 'fixture-h35-v1', version_number: 1, product_name: 'Moinho Universal H-3.5',
        commercial_title: 'Moinho Universal H-3.5', subtitle: null,
        presentation_text: 'O Moinho de Martelos H-3.5 é indicado para a moagem de pedras e minérios, auxiliando na liberação do ouro. Possui estrutura reforçada, alta capacidade de produção e excelente eficiência na moagem.',
        applications_text: 'Aplicado na moagem de pedras e minérios, promovendo a fragmentação do material para facilitar a liberação e a recuperação do ouro.',
        additional_text: 'Orçamento contempla somente o moinho, conforme a versão histórica vinculada.', notes: null,
        specifications: [{ name: 'Capacidade de Moagem', value: '2.5 a 3.5', unit: 'Toneladas por hora' }],
        included_items: ['Moinho completo com revestimentos internos', 'Par de martelo', 'Eixo completo com rolamentos e mancais', 'Queixos', 'Jogo de grelhas'].map((description) => ({ description })),
        images: imageBuffers[0] ? [{ id: 'fixture-image-1', caption: 'Vista principal', is_primary: true, available: true }] : [],
      },
      {
        version_id: 'fixture-bica-v1', version_number: 1, product_name: 'Bica de 0.80 X 3.30 M sistema canadense',
        commercial_title: 'Bica de 0.80 X 3.30 M sistema canadense', subtitle: null,
        presentation_text: 'A Bica 80 x 3,30 m com Sistema Canadense recebe o material após a moagem, realizando a recuperação do ouro por meio de carpete ou placas de cobre.',
        applications_text: 'Este equipamento deve ser utilizado logo após a moagem do material.', additional_text: null, notes: null,
        specifications: [{ name: 'Largura', value: '80', unit: 'CM' }, { name: 'Comprimento', value: '3.30', unit: 'M' }, { name: 'Sistema utilizado', value: 'Canadense', unit: null }],
        included_items: [],
        images: imageBuffers[1] ? [{ id: 'fixture-image-2', caption: 'Vista principal', is_primary: true, available: true }] : [],
      },
    ],
  };
  const pdf = await buildOrcamentoPdf(data, company, {
    draft: false,
    emittedAt: new Date('2026-08-24T12:00:00-04:00'),
    catalogImageAssets: { 'fixture-image-1': imageBuffers[0], 'fixture-image-2': imageBuffers[1] },
    onLayout: (layout) => console.log(JSON.stringify(layout)),
  });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, pdf);
  console.log(outputPath);
  console.log(`${pdf.length} bytes`);
}

main().finally(() => pool.end());
