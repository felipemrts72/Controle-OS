-- Fundação do módulo Comercial: evolução aditiva do cadastro mestre de clientes.
-- Compatibilidade: não remove nem renomeia campos consumidos por Produção/OS.
-- A UNIQUE de normalized_name permanece nesta etapa porque orderService ainda usa
-- ON CONFLICT (normalized_name). Ela só poderá ser removida após adaptar esse fluxo.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS trade_name VARCHAR,
  ADD COLUMN IF NOT EXISTS person_type VARCHAR(2),
  ADD COLUMN IF NOT EXISTS document VARCHAR,
  ADD COLUMN IF NOT EXISTS email VARCHAR,
  ADD COLUMN IF NOT EXISTS whatsapp VARCHAR,
  ADD COLUMN IF NOT EXISTS postal_code VARCHAR(9),
  ADD COLUMN IF NOT EXISTS street VARCHAR,
  ADD COLUMN IF NOT EXISTS address_number VARCHAR,
  ADD COLUMN IF NOT EXISTS address_complement VARCHAR,
  ADD COLUMN IF NOT EXISTS neighborhood VARCHAR,
  ADD COLUMN IF NOT EXISTS city VARCHAR,
  ADD COLUMN IF NOT EXISTS state VARCHAR(2),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_person_type_check'
      AND conrelid = 'customers'::regclass
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_person_type_check
      CHECK (person_type IS NULL OR person_type IN ('PF', 'PJ'));
  END IF;
END $$;

-- Reaproveita dados logísticos legados como ponto de partida, sem apagá-los.
UPDATE customers
SET city = COALESCE(city, NULLIF(BTRIM(location), '')),
    state = COALESCE(state, NULLIF(UPPER(BTRIM(destination_uf)), '')),
    is_active = COALESCE(is_active, TRUE)
WHERE city IS NULL OR state IS NULL OR is_active IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_document ON customers(document);
CREATE INDEX IF NOT EXISTS idx_customers_trade_name ON customers(trade_name);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(is_active);
CREATE INDEX IF NOT EXISTS idx_customers_city_state ON customers(city, state);
