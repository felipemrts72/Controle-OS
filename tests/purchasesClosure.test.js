import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../backend/src/database/pool.js';
import { listMeasurementUnits, resolveMeasurementUnit } from '../backend/src/services/measurementUnitService.js';
import { confirmImport } from '../backend/src/services/purchaseImportService.js';
import { listReceivablePurchases } from '../backend/src/services/purchaseService.js';
import { getMaterialGroupStatusLabel, getProductReviewStatusLabel, getPurchaseOrderStatusLabel, getPurchaseRequestStatusLabel, getQuoteStatusLabel, getSupplierStatusLabel } from '../src/pages/PurchasesPage/purchaseUtils.js';
import { canManageProductImage, canUploadInitialProductImage, createProductImageUploadToken, getProductImageAuditAction, removeProductImage, saveProductImage, validateProductImage } from '../backend/src/services/productImageService.js';

const purchaseService=fs.readFileSync(new URL('../backend/src/services/purchaseService.js',import.meta.url),'utf8');
const routes=fs.readFileSync(new URL('../backend/src/routes/purchaseRoutes.js',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../database/migrations/20260805_purchase_units_product_review.sql',import.meta.url),'utf8');
const receiptPage=fs.readFileSync(new URL('../src/pages/PurchasesPage/PurchasesPage.jsx',import.meta.url),'utf8');
const newFlows=fs.readFileSync(new URL('../src/pages/PurchasesPage/PurchaseFlowsV2.jsx',import.meta.url),'utf8');
const photoMigration=fs.readFileSync(new URL('../database/migrations/20260805_z_product_preliminary_photo.sql',import.meta.url),'utf8');
const photoService=fs.readFileSync(new URL('../backend/src/services/productImageService.js',import.meta.url),'utf8');
const photoController=fs.readFileSync(new URL('../backend/src/controllers/productImageController.js',import.meta.url),'utf8');
const productRoutes=fs.readFileSync(new URL('../backend/src/routes/productRoutes.js',import.meta.url),'utf8');
const productForm=fs.readFileSync(new URL('../src/components/ProductForm/ProductForm.jsx',import.meta.url),'utf8');
const productPhotoEditor=fs.readFileSync(new URL('../src/components/ProductPhotoEditor/ProductPhotoEditor.jsx',import.meta.url),'utf8');
const productPhotoCss=fs.readFileSync(new URL('../src/components/ProductPhotoEditor/ProductPhotoEditor.css',import.meta.url),'utf8');
const productFormPage=fs.readFileSync(new URL('../src/pages/ProductFormPage/ProductFormPage.jsx',import.meta.url),'utf8');
const appRoutes=fs.readFileSync(new URL('../src/routes/AppRoutes.jsx',import.meta.url),'utf8');

after(async()=>pool.end());

test('catálogo central possui as 21 unidades aprovadas e normaliza valores legados conhecidos',async()=>{
  const units=await listMeasurementUnits();assert.equal(units.length,21);
  assert.equal((await resolveMeasurementUnit('un')).code,'UN');assert.equal((await resolveMeasurementUnit('UND')).code,'UN');
  assert.equal((await resolveMeasurementUnit('unidade')).code,'UN');assert.equal((await resolveMeasurementUnit('quilo')).code,'KG');assert.equal((await resolveMeasurementUnit('peças')).code,'PC');
  await assert.rejects(()=>resolveMeasurementUnit('balde improvisado'),error=>error.status===400&&error.code==='MEASUREMENT_UNIT_INVALID');
});

test('migration preserva históricos e não cria estrutura de saldo',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS measurement_units/);assert.match(migration,/ADD COLUMN IF NOT EXISTS measurement_unit_code/);assert.match(migration,/pending_review/);
  assert.doesNotMatch(migration,/ALTER COLUMN internal_product_id SET NOT NULL/i);assert.doesNotMatch(migration,/stock_balance|inventory_movement|saldo_estoque/i);
});

test('novas importações não aceitam item sem Produto interno',async()=>{
  await assert.rejects(()=>confirmImport({items:[{description:'Teste',quantity:1,unit:'UN'}]},{id:'00000000-0000-0000-0000-000000000001',permissions:[]}),error=>error.status===400&&error.code==='INTERNAL_PRODUCT_REQUIRED');
});

test('Recebimentos usa cards, filtros paginados e o mesmo ReceiptPanel/endpoint',()=>{
  assert.match(routes,/get\('\/receipts'/);assert.match(receiptPage,/purchases-page__receipt-cards/);assert.match(receiptPage,/Parcialmente recebidos/);assert.match(receiptPage,/Ainda não recebidos/);assert.match(receiptPage,/Atrasados/);assert.match(receiptPage,/Histórico de recebimentos/);
  assert.equal((purchaseService.match(/export async function receivePurchase/g)||[]).length,1);assert.equal((routes.match(/post\('\/orders\/:id\/receipts'/g)||[]).length,1);
});

test('listagem de Recebimentos oculta valores sem purchases.view_values',async()=>{
  const result=await listReceivablePurchases({filter:'open',limit:5},{permissions:['purchases.receive']});
  result.data.forEach(row=>assert.equal(Object.hasOwn(row,'total'),false));
});

test('cotações aceitam rascunho sem participante e calculam sugestões separadas',()=>{
  const start=purchaseService.indexOf('export async function createQuoteRequest');const end=purchaseService.indexOf('export async function suggestSuppliers',start);const implementation=purchaseService.slice(start,end);
  assert.doesNotMatch(implementation,/Selecione ao menos um fornecedor/);assert.match(implementation,/if\(supplierIds\.length\)/);assert.match(purchaseService,/row\.participants=/);assert.match(purchaseService,/row\.suggested_suppliers=/);assert.match(purchaseService,/supplier_added/);assert.match(purchaseService,/supplier_removed_before_send/);
});

test('novos fluxos de cotação e compra exigem Produto e unidade controlada no frontend',()=>{
  assert.match(newFlows,/PurchaseProductPicker/);assert.match(newFlows,/MeasurementUnitSelect/);assert.match(newFlows,/Participantes iniciais \(opcional\)/);assert.match(newFlows,/Nenhuma entrada de estoque foi gerada/);
});

test('estoquista pode anexar foto opcional segura ao Produto preliminar',()=>{
  const png=Buffer.from('89504e470d0a1a0a00000000','hex');assert.doesNotThrow(()=>validateProductImage(png,'image/png','produto.png'));
  assert.throws(()=>validateProductImage(Buffer.from('não é imagem'),'image/png','produto.png'),/PNG inválido/);
  assert.match(photoMigration,/CREATE TABLE IF NOT EXISTS product_images/);assert.match(routes,/purchase_imports\.create_product[^\n]+product|imports\/products\/:id\/photo/s);
  assert.match(fs.readFileSync(new URL('../src/components/PurchaseProductPicker/PurchaseProductPicker.jsx',import.meta.url),'utf8'),/Foto do Produto \(opcional\)/);
});

test('foto acompanha o ciclo de revisão e não deixa arquivo órfão',async()=>{
  const ownerRow=(await pool.query('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0];
  const sectorRow=(await pool.query("SELECT id FROM sectors WHERE is_active=TRUE ORDER BY slug='expedicao' DESC,id LIMIT 1")).rows[0];
  assert.ok(ownerRow&&sectorRow,'teste requer usuário e setor existentes');
  const product=(await pool.query(`INSERT INTO products(name,type,sector_id,default_volume_quantity,default_total_weight_kg,is_active,review_status,creation_origin,preliminary_created_by,preliminary_created_at) VALUES($1,'resale',$2,1,1,TRUE,'pending_review','purchases',$3,NOW()) RETURNING id,review_status,creation_origin,preliminary_created_by`,[`Produto temporário foto ${Date.now()}`,sectorRow.id,ownerRow.id])).rows[0];
  const owner={id:ownerRow.id,permissions:['purchase_imports.create_product']};
  const editor={id:ownerRow.id,permissions:['products.edit']};
  const viewer={id:ownerRow.id,permissions:['products.view']};
  const admin={id:ownerRow.id,is_super_admin:true,permissions:[]};
  const pngOne=Buffer.from('89504e470d0a1a0a01020304','hex');
  const pngTwo=Buffer.from('89504e470d0a1a0a05060708','hex');
  const uploadDirectory=path.resolve('uploads','products');
  const trackedPaths=[];
  try{
    assert.equal(canManageProductImage(product,owner),true);
    assert.equal(canManageProductImage(product,viewer),false);
    assert.equal(canManageProductImage(product,editor),true);
    assert.equal(canManageProductImage(product,admin),true);
    assert.equal(getProductImageAuditAction(false),'preliminary_photo_added');
    assert.equal(getProductImageAuditAction(true),'preliminary_photo_replaced');

    const added=await saveProductImage(product.id,{originalName:'primeira.png',mimeType:'image/png'},pngOne,owner);
    assert.equal(added.action,'preliminary_photo_added');
    let image=(await pool.query('SELECT stored_name FROM product_images WHERE product_id=$1',[product.id])).rows[0];
    const firstPath=path.join(uploadDirectory,image.stored_name);trackedPaths.push(firstPath);await fsPromises.access(firstPath);
    await pool.query("UPDATE products SET name=name||' revisado no formulário',updated_at=NOW() WHERE id=$1",[product.id]);
    assert.equal((await pool.query('SELECT stored_name FROM product_images WHERE product_id=$1',[product.id])).rows[0].stored_name,image.stored_name);
    await fsPromises.access(firstPath);

    await assert.rejects(()=>saveProductImage(product.id,{originalName:'invalida.png',mimeType:'image/png'},Buffer.from('inválida'),owner),/PNG inválido/);
    assert.equal((await pool.query('SELECT stored_name FROM product_images WHERE product_id=$1',[product.id])).rows[0].stored_name,image.stored_name);
    await fsPromises.access(firstPath);

    const replaced=await saveProductImage(product.id,{originalName:'segunda.png',mimeType:'image/png'},pngTwo,owner);
    assert.equal(replaced.action,'preliminary_photo_replaced');
    image=(await pool.query('SELECT stored_name FROM product_images WHERE product_id=$1',[product.id])).rows[0];
    const secondPath=path.join(uploadDirectory,image.stored_name);trackedPaths.push(secondPath);await fsPromises.access(secondPath);
    await assert.rejects(()=>fsPromises.access(firstPath),error=>error.code==='ENOENT');

    const removedByOwner=await removeProductImage(product.id,owner);
    assert.equal(removedByOwner.action,'preliminary_photo_removed');
    assert.equal((await pool.query('SELECT COUNT(*)::int count FROM product_images WHERE product_id=$1',[product.id])).rows[0].count,0);
    await assert.rejects(()=>fsPromises.access(secondPath),error=>error.code==='ENOENT');

    await saveProductImage(product.id,{originalName:'antes-revisao.png',mimeType:'image/png'},pngOne,owner);
    image=(await pool.query('SELECT stored_name FROM product_images WHERE product_id=$1',[product.id])).rows[0];
    const beforeReviewPath=path.join(uploadDirectory,image.stored_name);trackedPaths.push(beforeReviewPath);
    await pool.query("UPDATE products SET review_status='approved',reviewed_by=$2,reviewed_at=NOW() WHERE id=$1",[product.id,ownerRow.id]);
    const reviewed={...product,review_status:'approved'};
    assert.equal(canManageProductImage(reviewed,owner),false);
    await assert.rejects(()=>saveProductImage(product.id,{originalName:'bloqueada.png',mimeType:'image/png'},pngTwo,owner),error=>error.status===403);
    assert.equal((await pool.query('SELECT stored_name FROM product_images WHERE product_id=$1',[product.id])).rows[0].stored_name,image.stored_name);
    await fsPromises.access(beforeReviewPath);

    const replacedByEditor=await saveProductImage(product.id,{originalName:'gerente.png',mimeType:'image/png'},pngTwo,editor);
    assert.equal(replacedByEditor.action,'preliminary_photo_replaced');
    image=(await pool.query('SELECT stored_name FROM product_images WHERE product_id=$1',[product.id])).rows[0];
    const editorPath=path.join(uploadDirectory,image.stored_name);trackedPaths.push(editorPath);await fsPromises.access(editorPath);
    await assert.rejects(()=>fsPromises.access(beforeReviewPath),error=>error.code==='ENOENT');
    await removeProductImage(product.id,editor);
    await assert.rejects(()=>fsPromises.access(editorPath),error=>error.code==='ENOENT');

    const actions=(await pool.query("SELECT action FROM audit_logs WHERE entity_type='product' AND entity_id=$1 AND action LIKE 'preliminary_photo_%' ORDER BY created_at,id",[product.id])).rows.map(row=>row.action);
    assert.ok(actions.includes('preliminary_photo_added'));
    assert.ok(actions.includes('preliminary_photo_replaced'));
    assert.ok(actions.includes('preliminary_photo_removed'));
    assert.match(productRoutes,/get\('\/:id\/photo'/);
    assert.match(productRoutes,/put\('\/:id\/photo'/);
    assert.match(productRoutes,/delete\('\/:id\/photo'/);
    assert.match(photoController,/Content-Type/);
    assert.match(photoService,/randomUUID\(\)/);
    assert.doesNotMatch(photoService,/storedName\s*=.*originalName/);
    assert.throws(()=>validateProductImage(pngOne,'image/png','..\\foto.png'),/Nome de arquivo inválido/);
  }finally{
    await pool.query('DELETE FROM product_images WHERE product_id=$1',[product.id]);
    await pool.query("DELETE FROM audit_logs WHERE entity_type='product' AND entity_id=$1",[product.id]);
    await pool.query('DELETE FROM products WHERE id=$1',[product.id]);
    for(const filePath of trackedPaths)await fsPromises.unlink(filePath).catch(()=>{});
    const remaining=(await fsPromises.readdir(uploadDirectory).catch(()=>[])).filter(name=>name.startsWith(`product-${product.id}-`));
    assert.deepEqual(remaining,[]);
    assert.equal((await pool.query('SELECT COUNT(*)::int count FROM products WHERE id=$1',[product.id])).rows[0].count,0);
    assert.equal((await pool.query("SELECT COUNT(*)::int count FROM audit_logs WHERE entity_type='product' AND entity_id=$1",[product.id])).rows[0].count,0);
  }
});

test('cadastro normal mantém foto em memória e autoriza somente o primeiro upload de products.create',async()=>{
  const ownerRow=(await pool.query('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0];
  const sectorRow=(await pool.query("SELECT id FROM sectors WHERE is_active=TRUE ORDER BY slug='expedicao' DESC,id LIMIT 1")).rows[0];
  assert.ok(ownerRow&&sectorRow,'teste requer usuário e setor existentes');
  const product=(await pool.query(`INSERT INTO products(name,type,sector_id,default_volume_quantity,default_total_weight_kg,is_active,review_status,creation_origin) VALUES($1,'resale',$2,1,1,TRUE,'approved','manual') RETURNING id,review_status,creation_origin,preliminary_created_by`,[`Produto normal foto ${Date.now()}`,sectorRow.id])).rows[0];
  const creator={id:ownerRow.id,permissions:['products.create']};
  const editor={id:ownerRow.id,permissions:['products.edit']};
  const unauthorized={id:ownerRow.id,permissions:['products.view']};
  const token=createProductImageUploadToken(product.id,creator);
  const pngOne=Buffer.from('89504e470d0a1a0a11121314','hex');
  const pngTwo=Buffer.from('89504e470d0a1a0a21222324','hex');
  const uploadDirectory=path.resolve('uploads','products');
  const trackedPaths=[];
  try{
    assert.equal((await pool.query('SELECT COUNT(*)::int count FROM product_images WHERE product_id=$1',[product.id])).rows[0].count,0);
    assert.equal(canManageProductImage(product,creator),false);
    assert.equal(canUploadInitialProductImage(product,creator,token),true);
    assert.equal(canUploadInitialProductImage(product,unauthorized,token),false);

    await assert.rejects(()=>saveProductImage(product.id,{originalName:'inválida.png',mimeType:'image/png',creationToken:token},Buffer.from('inválida'),creator),/PNG inválido/);
    assert.ok((await pool.query('SELECT id FROM products WHERE id=$1',[product.id])).rows[0],'Produto deve permanecer após falha da foto');
    assert.equal((await pool.query('SELECT COUNT(*)::int count FROM product_images WHERE product_id=$1',[product.id])).rows[0].count,0);

    const added=await saveProductImage(product.id,{originalName:'normal.png',mimeType:'image/png',creationToken:token},pngOne,creator);
    assert.equal(added.action,'preliminary_photo_added');
    let image=(await pool.query('SELECT stored_name FROM product_images WHERE product_id=$1',[product.id])).rows[0];
    const firstPath=path.join(uploadDirectory,image.stored_name);trackedPaths.push(firstPath);await fsPromises.access(firstPath);

    await assert.rejects(()=>saveProductImage(product.id,{originalName:'segunda.png',mimeType:'image/png',creationToken:token},pngTwo,creator),error=>error.status===403);
    assert.equal((await pool.query('SELECT stored_name FROM product_images WHERE product_id=$1',[product.id])).rows[0].stored_name,image.stored_name);
    await fsPromises.access(firstPath);

    const replaced=await saveProductImage(product.id,{originalName:'editor.png',mimeType:'image/png'},pngTwo,editor);
    assert.equal(replaced.action,'preliminary_photo_replaced');
    image=(await pool.query('SELECT stored_name FROM product_images WHERE product_id=$1',[product.id])).rows[0];
    const editorPath=path.join(uploadDirectory,image.stored_name);trackedPaths.push(editorPath);await fsPromises.access(editorPath);
    await assert.rejects(()=>fsPromises.access(firstPath),error=>error.code==='ENOENT');
    await removeProductImage(product.id,editor);
    await assert.rejects(()=>fsPromises.access(editorPath),error=>error.code==='ENOENT');
  }finally{
    await pool.query('DELETE FROM product_images WHERE product_id=$1',[product.id]);
    await pool.query("DELETE FROM audit_logs WHERE entity_type='product' AND entity_id=$1",[product.id]);
    await pool.query('DELETE FROM products WHERE id=$1',[product.id]);
    for(const filePath of trackedPaths)await fsPromises.unlink(filePath).catch(()=>{});
    const remaining=(await fsPromises.readdir(uploadDirectory).catch(()=>[])).filter(name=>name.startsWith(`product-${product.id}-`));
    assert.deepEqual(remaining,[]);
    assert.equal((await pool.query('SELECT COUNT(*)::int count FROM products WHERE id=$1',[product.id])).rows[0].count,0);
    assert.equal((await pool.query("SELECT COUNT(*)::int count FROM audit_logs WHERE entity_type='product' AND entity_id=$1",[product.id])).rows[0].count,0);
  }
});

test('Novo produto posiciona foto após Nome e oferece câmera, galeria e nova tentativa no mobile',()=>{
  const jsxStart=productForm.indexOf('return (');
  const namePosition=productForm.indexOf('>Nome<',jsxStart);
  const photoPosition=productForm.indexOf('<ProductPhotoEditor',jsxStart);
  const typePosition=productForm.indexOf('>Tipo<',jsxStart);
  assert.ok(namePosition<photoPosition&&photoPosition<typePosition);
  assert.match(productPhotoEditor,/accept="image\/png,image\/jpeg" capture="environment"/);
  assert.match(productPhotoEditor,/Escolher da galeria/);
  assert.match(productPhotoEditor,/Tentar enviar novamente/);
  assert.match(productPhotoCss,/min-height:44px/);
  assert.match(productPhotoCss,/flex-direction:column/);
  assert.match(productPhotoCss,/max-width:100%/);
  assert.match(productFormPage,/api\.post\('\/products'/);
  assert.match(productFormPage,/X-Product-Create-Token/);
  assert.match(productFormPage,/Produto criado, mas a foto não foi enviada/);
  assert.match(productRoutes,/put\('\/:id\/photo', requireAnyPermission\('products\.create','products\.edit','purchase_imports\.create_product'\)/);
  assert.match(appRoutes,/path="\/produtos\/novo"[^\n]+permission="products\.create"/);
});

test('detalhe da cotação separa sugestões dinâmicas de participantes históricos',()=>{
  assert.match(newFlows,/Fornecedores sugeridos/);assert.match(newFlows,/Fornecedores participantes/);assert.match(newFlows,/Outros fornecedores ativos/);assert.match(newFlows,/SUPPLIER_OUTSIDE_QUOTE_GROUPS/);
});

test('mapeadores de status são específicos por entidade',()=>{
  assert.equal(getSupplierStatusLabel(true),'Ativo');assert.equal(getSupplierStatusLabel(false),'Inativo');assert.equal(getMaterialGroupStatusLabel(true),'Ativo');assert.equal(getMaterialGroupStatusLabel(false),'Inativo');
  assert.equal(getPurchaseRequestStatusLabel('approved'),'Aprovada — aguardando cotação ou compra');assert.equal(getQuoteStatusLabel('draft'),'Rascunho');assert.equal(getPurchaseOrderStatusLabel('partially_received'),'Parcialmente recebido');assert.equal(getProductReviewStatusLabel('pending_review'),'Pendente de revisão');
});

test('SC-2026-00004 permanece histórica e pode originar cotação sem fornecedor congelado',async()=>{
  const result=await pool.query(`SELECT pr.status,pri.product_id,pri.unit FROM purchase_requests pr JOIN purchase_request_items pri ON pri.request_id=pr.id WHERE pr.number='SC-2026-00004'`);
  assert.equal(result.rows[0]?.status,'approved');assert.equal(result.rows[0]?.product_id,null);assert.equal(result.rows[0]?.unit,'un');
  assert.match(purchaseService,/supplierIds=Array\.isArray/);
});
