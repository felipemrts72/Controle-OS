import {
  createCustomer,
  getCustomer,
  listCustomers,
  setCustomerActive,
  updateCustomer,
} from '../services/customerService.js';

export async function index(req, res, next) {
  try {
    res.json(await listCustomers(req.query));
  } catch (error) { next(error); }
}

export async function show(req, res, next) {
  try {
    res.json(await getCustomer(req.params.id));
  } catch (error) { next(error); }
}

export async function store(req, res, next) {
  try {
    res.status(201).json(await createCustomer(req.body, req.user.id));
  } catch (error) { next(error); }
}

export async function update(req, res, next) {
  try {
    res.json(await updateCustomer(req.params.id, req.body, req.user.id));
  } catch (error) { next(error); }
}

export async function updateActive(req, res, next) {
  try {
    res.json(await setCustomerActive(req.params.id, req.body.is_active, req.user.id));
  } catch (error) { next(error); }
}
