-- Corrige exclusivamente a numeração visual do primeiro lote ERP Universal.
-- Os snapshots, IDs, aliases, totais e vínculos permanecem inalterados.
DO $$
DECLARE
  quote_count INTEGER;
  first_number BIGINT;
  last_number BIGINT;
BEGIN
  SELECT COUNT(*)::int, MIN(legacy_number), MAX(legacy_number)
    INTO quote_count, first_number, last_number
  FROM commercial_legacy_quotes
  WHERE source_system = 'ERP_UNIVERSAL';

  IF quote_count <> 45 OR first_number <> 1 OR last_number <> 45 THEN
    RAISE EXCEPTION 'Lote ERP inesperado; correção de numeração cancelada (% registros, faixa %–%)',
      quote_count, first_number, last_number;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_protect_locked_commercial_legacy_quote ON commercial_legacy_quotes;

UPDATE commercial_legacy_quotes
SET legacy_number = legacy_number + 100
WHERE source_system = 'ERP_UNIVERSAL';

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           ORDER BY quote_date ASC NULLS LAST,
                    source_created_at ASC NULLS LAST,
                    source_id::bigint ASC
         ) AS corrected_number
  FROM commercial_legacy_quotes
  WHERE source_system = 'ERP_UNIVERSAL'
)
UPDATE commercial_legacy_quotes quote
SET legacy_number = ordered.corrected_number
FROM ordered
WHERE quote.id = ordered.id;

CREATE TRIGGER trg_protect_locked_commercial_legacy_quote
BEFORE UPDATE OR DELETE ON commercial_legacy_quotes
FOR EACH ROW EXECUTE FUNCTION protect_locked_commercial_legacy_quote();

DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*)::int INTO invalid_count
  FROM (
    SELECT legacy_number,
           ROW_NUMBER() OVER (
             ORDER BY quote_date ASC NULLS LAST,
                      source_created_at ASC NULLS LAST,
                      source_id::bigint ASC
           ) AS expected_number
    FROM commercial_legacy_quotes
    WHERE source_system = 'ERP_UNIVERSAL'
  ) ordered
  WHERE legacy_number <> expected_number;

  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'A sequência histórica corrigida não respeita a ordem cronológica';
  END IF;
END $$;
