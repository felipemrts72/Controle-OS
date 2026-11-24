import { getProductTree, saveProductTree } from '../services/productTreeService.js';
import { query } from '../database/pool.js';

export async function sectors(_req, res, next) {
  try { res.json((await query('SELECT id,name,slug FROM sectors WHERE is_active=TRUE ORDER BY name')).rows); }
  catch (error) { next(error); }
}

export async function show(req, res, next) {
  try { res.json(await getProductTree(req.params.id, req.user)); } catch (error) { next(error); }
}
export async function save(req, res, next) {
  try { res.json(await saveProductTree(req.params.id || null, req.body, req.user)); } catch (error) { next(error); }
}
