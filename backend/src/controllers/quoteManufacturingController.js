import { correctQuoteProductionNames } from '../services/quoteProductionTaskNameService.js';
import { query, transaction } from '../database/pool.js';
import { manufacturingTemplate, manufacturingReview, issueQuoteManufacturing, saveApprovedQuotePlanning } from '../services/quoteManufacturingService.js';

const handler = fn => async (req,res,next) => { try { res.json(await fn(req)); } catch(error) { next(error); } };
export const correctNames=handler(req=>correctQuoteProductionNames(req.params.id,req.body,req.user));
export const template=handler(req=>transaction(client=>manufacturingTemplate(client,req.body)));
export const saveApproved=handler(req=>saveApprovedQuotePlanning(req.params.id,req.body,req.user));
export const review=handler(req=>transaction(client=>manufacturingReview(client,req.params.id)));
export const issue=handler(req=>issueQuoteManufacturing(req.params.id,req.body,req.user));
export const types=handler(async()=> (await query('SELECT code,name,is_active FROM product_types WHERE is_active=TRUE ORDER BY name')).rows);
export const units=handler(async()=> (await query('SELECT code,name FROM measurement_units WHERE is_active=TRUE ORDER BY sort_order,code')).rows);
export const sectors=handler(async()=> (await query('SELECT id,name,slug FROM sectors WHERE is_active=TRUE ORDER BY name')).rows);
export const products=handler(async req=> (await query(`SELECT p.id,p.name,p.type,p.measurement_unit_code,p.sector_id,s.name AS sector_name,t.name AS type_name,p.internal_code
  FROM products p LEFT JOIN sectors s ON s.id=p.sector_id LEFT JOIN product_types t ON t.code=p.type
  WHERE p.is_active=TRUE AND p.name ILIKE $1 ORDER BY p.name LIMIT 40`,[`%${String(req.query.q || '').slice(0,160)}%`])).rows);
export const tree=handler(req=>transaction(client=>manufacturingTemplate(client,{product_id:req.params.productId})));
