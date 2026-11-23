import { getProductTree, saveProductTree } from '../services/productTreeService.js';

export async function show(req, res, next) {
  try { res.json(await getProductTree(req.params.id, req.user)); } catch (error) { next(error); }
}
export async function save(req, res, next) {
  try { res.json(await saveProductTree(req.params.id || null, req.body, req.user)); } catch (error) { next(error); }
}
