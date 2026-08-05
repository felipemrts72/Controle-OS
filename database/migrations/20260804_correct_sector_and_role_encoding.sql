-- Correção idempotente e estritamente direcionada de nomes com codificação corrompida.
-- IDs, slugs e relacionamentos permanecem inalterados.

UPDATE sectors
SET name = 'Expedição',
    updated_at = NOW()
WHERE id = '23fde37d-677c-4c27-b4f2-c5be40053332'
  AND slug = 'expedicao'
  AND name = 'Expedi' || CHR(195) || CHR(167) || CHR(195) || CHR(163) || 'o';

UPDATE roles
SET name = 'Expedição Teste',
    updated_at = NOW()
WHERE id = '205f9333-45de-425b-a680-73ea3f0f33ed'
  AND slug = 'expedicao_teste'
  AND name = 'Expedi' || CHR(65533) || CHR(65533) || 'o Teste';
