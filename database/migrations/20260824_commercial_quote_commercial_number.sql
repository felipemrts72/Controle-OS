-- Identidade comercial global dos Orçamentos do OliMen.
--
-- Registros anteriores à migration permanecem sem número comercial para que
-- rascunhos/smokes já existentes não ocupem a faixa oficial iniciada em 250.
-- Toda nova inserção recebe o número no PostgreSQL, na mesma transação do
-- Orçamento. O contador por linha é transacional (ao contrário de SEQUENCE),
-- o que também permite que fixtures com ROLLBACK não consumam números reais.

CREATE TABLE IF NOT EXISTS commercial_quote_commercial_counters (
  counter_key VARCHAR(80) PRIMARY KEY,
  last_value BIGINT NOT NULL CHECK (last_value >= 249),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO commercial_quote_commercial_counters (counter_key, last_value)
VALUES ('global', 249)
ON CONFLICT (counter_key) DO NOTHING;

ALTER TABLE commercial_quotes
  ADD COLUMN IF NOT EXISTS commercial_number BIGINT;

CREATE OR REPLACE FUNCTION next_commercial_quote_number(
  requested_counter_key VARCHAR DEFAULT 'global'
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  generated_number BIGINT;
BEGIN
  INSERT INTO commercial_quote_commercial_counters (counter_key, last_value)
  VALUES (requested_counter_key, 250)
  ON CONFLICT (counter_key) DO UPDATE
    SET last_value = commercial_quote_commercial_counters.last_value + 1,
        updated_at = NOW()
  RETURNING last_value INTO generated_number;

  RETURN generated_number;
END;
$$;

ALTER TABLE commercial_quotes
  ALTER COLUMN commercial_number SET DEFAULT next_commercial_quote_number('global');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'commercial_quotes'::regclass
      AND conname = 'commercial_quotes_commercial_number_key'
  ) THEN
    ALTER TABLE commercial_quotes
      ADD CONSTRAINT commercial_quotes_commercial_number_key UNIQUE (commercial_number);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'commercial_quotes'::regclass
      AND conname = 'commercial_quotes_commercial_number_range_check'
  ) THEN
    ALTER TABLE commercial_quotes
      ADD CONSTRAINT commercial_quotes_commercial_number_range_check
      CHECK (commercial_number IS NULL OR commercial_number >= 250);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION protect_commercial_quote_commercial_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.commercial_number IS NULL THEN
    NEW.commercial_number := next_commercial_quote_number('global');
  ELSIF TG_OP = 'UPDATE'
    AND OLD.commercial_number IS DISTINCT FROM NEW.commercial_number THEN
    RAISE EXCEPTION 'commercial_number é imutável depois da criação do Orçamento'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'commercial_quotes'::regclass
      AND tgname = 'trg_commercial_quotes_protect_commercial_number'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_commercial_quotes_protect_commercial_number
    BEFORE INSERT OR UPDATE OF commercial_number ON commercial_quotes
    FOR EACH ROW
    EXECUTE FUNCTION protect_commercial_quote_commercial_number();
  END IF;
END;
$$;

COMMENT ON COLUMN commercial_quotes.commercial_number IS
  'Número comercial global, único e imutável. Faixa 1-249 pertence ao ERP Universal; OliMen inicia em 250.';

COMMENT ON TABLE commercial_quote_commercial_counters IS
  'Contadores transacionais de identidade comercial. Orçamentos usam exclusivamente a chave global.';
