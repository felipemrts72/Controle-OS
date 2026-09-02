-- Nomes comerciais do ERP podem ser descrições técnicas completas.
-- Não truncar conteúdo histórico/comercial para caber em limites operacionais antigos.

ALTER TABLE commercial_products
  ALTER COLUMN name TYPE TEXT;

ALTER TABLE product_catalog_versions
  ALTER COLUMN commercial_title TYPE TEXT;

ALTER TABLE commercial_quote_items
  ALTER COLUMN product_name_snapshot TYPE TEXT,
  ALTER COLUMN commercial_product_name_snapshot TYPE TEXT;
