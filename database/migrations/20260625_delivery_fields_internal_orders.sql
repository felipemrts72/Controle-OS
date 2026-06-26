ALTER TABLE internal_orders
  ADD COLUMN IF NOT EXISTS delivery_type VARCHAR NOT NULL DEFAULT 'transportadora',
  ADD COLUMN IF NOT EXISTS carrier_name VARCHAR,
  ADD COLUMN IF NOT EXISTS destination_city VARCHAR,
  ADD COLUMN IF NOT EXISTS destination_uf VARCHAR(2),
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'internal_orders_delivery_type_check'
      AND conrelid = 'internal_orders'::regclass
  ) THEN
    ALTER TABLE internal_orders
      ADD CONSTRAINT internal_orders_delivery_type_check
      CHECK (delivery_type IN ('transportadora', 'retirada', 'frota_propria'));
  END IF;
END $$;

UPDATE internal_orders
SET delivery_type = 'transportadora'
WHERE delivery_type IS NULL;
