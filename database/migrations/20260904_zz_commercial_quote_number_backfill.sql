-- Regulariza Orçamentos modernos criados antes da identidade comercial global.
-- Históricos ERP vivem em commercial_legacy_quotes e não são afetados.

LOCK TABLE commercial_quotes IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION protect_commercial_quote_commercial_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.commercial_number IS NULL THEN
    NEW.commercial_number := next_commercial_quote_number('global');
  ELSIF TG_OP = 'UPDATE'
    AND OLD.commercial_number IS NOT NULL
    AND OLD.commercial_number IS DISTINCT FROM NEW.commercial_number THEN
    RAISE EXCEPTION 'commercial_number é imutável depois da criação do Orçamento'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  quote_row RECORD;
BEGIN
  FOR quote_row IN
    SELECT id
    FROM commercial_quotes
    WHERE commercial_number IS NULL
    ORDER BY created_at, id
  LOOP
    UPDATE commercial_quotes
    SET commercial_number = next_commercial_quote_number('global')
    WHERE id = quote_row.id
      AND commercial_number IS NULL;
  END LOOP;
END;
$$;

ALTER TABLE commercial_quotes
  ALTER COLUMN commercial_number SET NOT NULL;

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

COMMENT ON COLUMN commercial_quotes.commercial_number IS
  'Número comercial global, único, obrigatório e imutável. Faixa 1-249 pertence ao ERP Universal; OliMen inicia em 250.';
