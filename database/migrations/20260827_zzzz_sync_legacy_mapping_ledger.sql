-- Mantém a matriz do ledger coerente com a numeração cronológica corrigida.
UPDATE integration_import_runs run
SET stats = jsonb_set(
  run.stats,
  '{mapping}',
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', quote.id,
        'legacy_number', quote.legacy_number,
        'source_legacy_number', quote.source_legacy_number
      ) ORDER BY quote.legacy_number
    )
    FROM commercial_legacy_quotes quote
    WHERE quote.import_run_id = run.id
      AND quote.source_system = 'ERP_UNIVERSAL'
  ), '[]'::jsonb),
  TRUE
)
WHERE run.source_system = 'ERP_UNIVERSAL'
  AND run.import_type = 'COMMERCIAL_HISTORY_V1'
  AND run.status = 'completed';
