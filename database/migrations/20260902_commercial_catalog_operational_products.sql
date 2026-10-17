-- Códigos operacionais novos usam uma sequence; códigos históricos, inclusive
-- alfanuméricos, permanecem intocados.
CREATE SEQUENCE IF NOT EXISTS products_internal_code_seq AS BIGINT START WITH 1 INCREMENT BY 1;

SELECT setval(
  'products_internal_code_seq',
  COALESCE((SELECT MAX(internal_code::bigint) FROM products WHERE internal_code ~ '^[0-9]+$'), 1),
  EXISTS(SELECT 1 FROM products WHERE internal_code ~ '^[0-9]+$')
);

-- Um Produto criado pelo Comercial nasce pendente de complementação. Peso e
-- volumes desconhecidos não podem ser substituídos por valores fictícios.
ALTER TABLE products
  ALTER COLUMN default_volume_quantity DROP NOT NULL,
  ALTER COLUMN default_total_weight_kg DROP NOT NULL;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_creation_origin_check;
ALTER TABLE products ADD CONSTRAINT products_creation_origin_check
  CHECK (creation_origin IN ('manual', 'purchases', 'commercial'));

COMMENT ON SEQUENCE products_internal_code_seq IS
  'Gera códigos numéricos únicos para novos Produtos internos; não renumera cadastros existentes.';
COMMENT ON COLUMN products.creation_origin IS
  'Origem do cadastro: manual, Compras ou Comercial.';
