import pg from 'pg';
import { createHash } from 'node:crypto';

const url = new URL(process.env.DATABASE_URL || '');
if (!['127.0.0.1','localhost'].includes(url.hostname) || !/^olimen_qa_/.test(decodeURIComponent(url.pathname.slice(1)))) throw new Error('Somente banco sintético local.');
const db = new pg.Client({ connectionString:url.toString() });
await db.connect();
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
try {
  await db.query('BEGIN');
  const run=(await db.query("INSERT INTO integration_import_runs(source_system,import_type,status,source_snapshot_at,source_payload_hash) VALUES('ERP_UNIVERSAL','qa_synthetic','completed','2026-01-01',$1) RETURNING id",[sha('qa-run')])).rows[0].id;
  const product=(await db.query("SELECT id FROM products WHERE name='QA Fabricado'")).rows[0].id;
  const commercial=[];
  for (let i=1;i<=65;i++) {
    const id=(await db.query("INSERT INTO commercial_products(name,commercial_code,operational_product_id,source_system,source_id,import_run_id) VALUES($1,$2,$3,'ERP_UNIVERSAL',$4,$5) RETURNING id",[`QA Produto Comercial ${i}`,`QA-${i}`,i<=14?product:null,`qa-product-${i}`,run])).rows[0].id;
    commercial.push(id);
  }
  const versions=[];
  for (let i=1;i<=14;i++) {
    const catalog=(await db.query("INSERT INTO product_catalogs(commercial_product_id,source_system,source_id,source_catalog_id,import_run_id) VALUES($1,'ERP_UNIVERSAL',$2,$2,$3) RETURNING id",[commercial[i-1],`qa-catalog-${i}`,run])).rows[0].id;
    const count=i<=5?2:1;
    for(let v=1;v<=count;v++) {
      const source=`qa-version-${i}-${v}`;
      const version=(await db.query("INSERT INTO product_catalog_versions(product_catalog_id,version_number,status,commercial_title,published_at,source_system,source_id,import_run_id) VALUES($1,$2,'published',$3,NOW(),'ERP_UNIVERSAL',$4,$5) RETURNING id",[catalog,v,`QA Catálogo ${i}`,source,run])).rows[0].id;
      versions.push({id:version,source});
      if(v===count) await db.query('UPDATE product_catalogs SET active_version_id=$1 WHERE id=$2',[version,catalog]);
    }
  }
  for(let i=0;i<38;i++) await db.query('INSERT INTO product_catalog_specifications(product_catalog_version_id,name,value) VALUES($1,$2,$3)',[versions[i%19].id,`QA especificação ${i+1}`,'Sintética']);
  for(let i=0;i<62;i++) await db.query('INSERT INTO product_catalog_included_items(product_catalog_version_id,description) VALUES($1,$2)',[versions[i%19].id,`QA item ${i+1}`]);
  for(let i=0;i<19;i++) await db.query("INSERT INTO product_catalog_images(product_catalog_version_id,original_name,stored_name,mime_type,size_bytes,source_system,source_id,sha256,import_run_id) VALUES($1,$2,$2,'image/png',8,'ERP_UNIVERSAL',$3,$4,$5)",[versions[1+i%18].id,`qa-${i}.png`,`qa-image-${i}`,sha(`qa-image-${i%15}`),run]);
  for(let i=1;i<=45;i++) {
    const quoteDate=new Date(Date.UTC(2025,0,i)).toISOString().slice(0,10);
    const sourceNumber=i===1?95:i===2?83:i===4?4:100+i;
    const count=i<=22?3:2;
    const amount=count*100;
    const quote=(await db.query(`INSERT INTO commercial_legacy_quotes(legacy_number,source_system,source_id,source_legacy_number,source_status,source_created_at,quote_date,customer_name_snapshot,customer_snapshot,item_count,items_gross_total,items_discount_total,subtotal,general_discount_amount,total,payment_total,calculation_version,total_provenance,payload_hash,import_run_id,locked_at)
      VALUES($1,'ERP_UNIVERSAL',$2,$3,'approved',$4::timestamp,$11::date,'QA Cliente Histórico',$5,$6,$7,0,$7,0,$7,$8,'qa-v1','synthetic',$9,$10,NULL) RETURNING id`,[i,String(i),sourceNumber,quoteDate,JSON.stringify({name:'QA Cliente Histórico'}),count,amount,i===4?null:amount,sha(`qa-quote-${i}`),run,quoteDate])).rows[0].id;
    await db.query("INSERT INTO commercial_legacy_quote_source_aliases(commercial_legacy_quote_id,source_system,source_id,source_legacy_number,is_primary,fingerprint,import_run_id) VALUES($1,'ERP_UNIVERSAL',$2,$3,TRUE,$4,$5)",[quote,`qa-alias-${i}`,sourceNumber,sha(`qa-alias-${i}`),run]);
    if(i===1) for(const number of [96,97]) await db.query("INSERT INTO commercial_legacy_quote_source_aliases(commercial_legacy_quote_id,source_system,source_id,source_legacy_number,is_primary,fingerprint,import_run_id) VALUES($1,'ERP_UNIVERSAL',$2,$3,FALSE,$4,$5)",[quote,`qa-alias-${number}`,number,sha(`qa-alias-${number}`),run]);
    for(let j=1;j<=count;j++) await db.query(`INSERT INTO commercial_legacy_quote_items(commercial_legacy_quote_id,source_item_id,line_order,commercial_product_id,product_name_snapshot,measurement_unit_snapshot,quantity,unit_price,unit_discount_amount,discount_percent,gross_subtotal,discount_amount,subtotal,legacy_include_catalog,source_catalog_version_id,import_run_id)
      VALUES($1,$2,$3,$4,$5,'un',1,100,0,0,100,0,100,$6,$7,$8)`,[quote,`qa-item-${i}-${j}`,j,commercial[(i+j)%65],`QA item ${i}-${j}`,i===1&&j===1,i===1&&j===1?versions[0].source:null,run]);
    if(i!==4) await db.query("INSERT INTO commercial_legacy_quote_payment_methods(commercial_legacy_quote_id,source_payment_id,line_order,legacy_method,method_type,description,amount,installment_count,import_run_id) VALUES($1,$2,1,'DINHEIRO','cash','Pagamento QA',$3,1,$4)",[quote,`qa-payment-${i}`,amount,run]);
    await db.query('UPDATE commercial_legacy_quotes SET locked_at=NOW() WHERE id=$1',[quote]);
  }
  await db.query('COMMIT');
  console.log('Lote sintético: 45 cotações, 112 itens, 65 produtos comerciais, 14 catálogos.');
} catch(error) { await db.query('ROLLBACK'); throw error; } finally { await db.end(); }
