UPDATE sectors
SET name = regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'),
    updated_at = NOW()
WHERE name IS DISTINCT FROM regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g');

CREATE UNIQUE INDEX IF NOT EXISTS idx_sectors_name_normalized_unique
  ON sectors ((lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))));
