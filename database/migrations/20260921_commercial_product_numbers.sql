-- Commercial numbering is independent of products.internal_code.
-- Keep all legacy references (including alphanumeric commercial_code) intact.
LOCK TABLE commercial_products IN ACCESS EXCLUSIVE MODE;
ALTER TABLE commercial_products ADD COLUMN commercial_number BIGINT;
UPDATE commercial_products SET commercial_number=commercial_code::bigint
WHERE commercial_code ~ '^[1-9][0-9]*$';
ALTER TABLE commercial_products ADD CONSTRAINT commercial_products_number_unique UNIQUE(commercial_number);
ALTER TABLE commercial_products ADD CONSTRAINT commercial_products_number_positive CHECK(commercial_number>0);

CREATE FUNCTION assign_commercial_product_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.commercial_number IS NOT NULL THEN
    IF NEW.commercial_number IS DISTINCT FROM OLD.commercial_number THEN
      RAISE EXCEPTION 'O código numérico comercial não pode ser alterado' USING ERRCODE='23514';
    END IF;
    NEW.commercial_code := COALESCE(NULLIF(btrim(NEW.commercial_code),''), OLD.commercial_code, OLD.commercial_number::text);
    RETURN NEW;
  END IF;
  -- A transaction-scoped lock serializes allocations, including direct SQL/imports.
  PERFORM pg_advisory_xact_lock(hashtextextended('commercial_products_number',0));
  IF NEW.commercial_number IS NULL THEN
    SELECT candidate INTO NEW.commercial_number
    FROM generate_series(1::bigint,(SELECT count(*)+1 FROM commercial_products)) candidate
    WHERE NOT EXISTS (SELECT 1 FROM commercial_products cp WHERE cp.commercial_number=candidate)
    ORDER BY candidate LIMIT 1;
  END IF;
  NEW.commercial_code := COALESCE(NULLIF(btrim(NEW.commercial_code),''), NEW.commercial_number::text);
  RETURN NEW;
END $$;
CREATE TRIGGER commercial_products_assign_number BEFORE INSERT OR UPDATE ON commercial_products
FOR EACH ROW EXECUTE FUNCTION assign_commercial_product_number();

DO $$ DECLARE item RECORD; BEGIN
  FOR item IN SELECT id FROM commercial_products WHERE commercial_number IS NULL ORDER BY created_at,id LOOP
    UPDATE commercial_products SET commercial_number=NULL WHERE id=item.id;
  END LOOP;
END $$;
ALTER TABLE commercial_products ALTER COLUMN commercial_number SET NOT NULL;
CREATE UNIQUE INDEX commercial_products_code_unique ON commercial_products(commercial_code);
COMMENT ON COLUMN commercial_products.commercial_number IS 'Código comercial numérico único; menor inteiro positivo livre. Independente do Estoque.';
COMMENT ON COLUMN commercial_products.commercial_code IS 'Referência comercial anterior preservada; novos cadastros recebem o número comercial como referência.';
