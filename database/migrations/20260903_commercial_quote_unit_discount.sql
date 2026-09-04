-- Preserva o desconto total histórico e registra explicitamente, para novos
-- orçamentos, o desconto monetário informado por unidade.
ALTER TABLE commercial_quote_items
  ADD COLUMN IF NOT EXISTS unit_discount_amount NUMERIC(14,2)
    CHECK (unit_discount_amount IS NULL OR unit_discount_amount >= 0);

COMMENT ON COLUMN commercial_quote_items.unit_discount_amount IS
  'Desconto monetário por unidade. NULL identifica linhas modernas antigas cujo discount_amount tinha semântica de total da linha.';
