ALTER TABLE employee_payments
  ADD COLUMN updated_at TIMESTAMPTZ,
  ADD COLUMN updated_by UUID REFERENCES users(id);
