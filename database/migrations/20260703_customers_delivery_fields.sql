ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS carrier_name VARCHAR,
  ADD COLUMN IF NOT EXISTS destination_uf VARCHAR(2);

UPDATE customers c
SET carrier_name = COALESCE(NULLIF(c.carrier_name, ''), latest_order.carrier_name),
  destination_uf = COALESCE(NULLIF(c.destination_uf, ''), latest_order.destination_uf),
  updated_at = NOW()
FROM (
  SELECT DISTINCT ON (customer_id)
    customer_id,
    NULLIF(carrier_name, '') AS carrier_name,
    NULLIF(destination_uf, '') AS destination_uf
  FROM internal_orders
  WHERE customer_id IS NOT NULL
    AND (NULLIF(carrier_name, '') IS NOT NULL OR NULLIF(destination_uf, '') IS NOT NULL)
  ORDER BY customer_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
) latest_order
WHERE c.id = latest_order.customer_id
  AND (
    (NULLIF(c.carrier_name, '') IS NULL AND latest_order.carrier_name IS NOT NULL)
    OR (NULLIF(c.destination_uf, '') IS NULL AND latest_order.destination_uf IS NOT NULL)
  );
