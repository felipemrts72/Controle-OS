CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  normalized_name VARCHAR NOT NULL UNIQUE,
  phone VARCHAR,
  location VARCHAR,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS name VARCHAR,
  ADD COLUMN IF NOT EXISTS normalized_name VARCHAR,
  ADD COLUMN IF NOT EXISTS phone VARCHAR,
  ADD COLUMN IF NOT EXISTS location VARCHAR,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

ALTER TABLE customers
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customers WHERE name IS NULL) THEN
    ALTER TABLE customers ALTER COLUMN name SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customers WHERE normalized_name IS NULL) THEN
    ALTER TABLE customers ALTER COLUMN normalized_name SET NOT NULL;
  END IF;
END $$;

ALTER TABLE internal_orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_normalized_name ON customers(normalized_name);

INSERT INTO customers (name, normalized_name, phone, location, created_at, updated_at)
SELECT DISTINCT ON (normalized_name)
  customer_name,
  normalized_name,
  customer_phone,
  destination_city,
  COALESCE(created_at, NOW()),
  COALESCE(updated_at, created_at, NOW())
FROM (
  SELECT
    customer_name,
    LOWER(REGEXP_REPLACE(BTRIM(customer_name), '[[:space:]]+', ' ', 'g')) AS normalized_name,
    customer_phone,
    destination_city,
    created_at,
    updated_at
  FROM internal_orders
  WHERE customer_name IS NOT NULL
    AND BTRIM(customer_name) <> ''
) historical_orders
ORDER BY normalized_name, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
ON CONFLICT (normalized_name) DO UPDATE
  SET phone = COALESCE(NULLIF(EXCLUDED.phone, ''), customers.phone),
    location = COALESCE(NULLIF(EXCLUDED.location, ''), customers.location),
    updated_at = NOW();

UPDATE internal_orders io
SET customer_id = c.id
FROM customers c
WHERE io.customer_id IS NULL
  AND io.customer_name IS NOT NULL
  AND LOWER(REGEXP_REPLACE(BTRIM(io.customer_name), '[[:space:]]+', ' ', 'g')) = c.normalized_name;

CREATE INDEX IF NOT EXISTS idx_internal_orders_customer_id ON internal_orders(customer_id);
