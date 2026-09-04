import { getCommercialSale, listCommercialSales } from '../services/commercialSaleService.js';

export async function index(req, res, next) {
  try {
    res.json(await listCommercialSales(req.query));
  } catch (error) { next(error); }
}

export async function show(req, res, next) {
  try {
    res.json(await getCommercialSale(req.params.id));
  } catch (error) { next(error); }
}
