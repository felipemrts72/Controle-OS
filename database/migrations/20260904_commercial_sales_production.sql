BEGIN;

CREATE SEQUENCE IF NOT EXISTS commercial_sale_number_seq AS BIGINT START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS commercial_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number BIGINT NOT NULL DEFAULT nextval('commercial_sale_number_seq') UNIQUE,
  commercial_quote_id UUID NOT NULL UNIQUE REFERENCES commercial_quotes(id) ON DELETE RESTRICT,
  commercial_number BIGINT NOT NULL,
  quote_number VARCHAR NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name_snapshot TEXT NOT NULL,
  customer_snapshot JSONB NOT NULL,
  quote_date DATE NOT NULL,
  valid_until DATE,
  items_gross_total NUMERIC(14,2) NOT NULL,
  items_discount_total NUMERIC(14,2) NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL,
  discount_amount NUMERIC(14,2) NOT NULL,
  freight_amount NUMERIC(14,2) NOT NULL,
  total NUMERIC(14,2) NOT NULL,
  payment_methods_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  internal_notes TEXT,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commercial_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_sale_id UUID NOT NULL REFERENCES commercial_sales(id) ON DELETE RESTRICT,
  commercial_quote_item_id UUID NOT NULL UNIQUE REFERENCES commercial_quote_items(id) ON DELETE RESTRICT,
  line_order INTEGER NOT NULL,
  item_type VARCHAR(30) NOT NULL,
  commercial_product_id UUID REFERENCES commercial_products(id) ON DELETE SET NULL,
  operational_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_code_snapshot TEXT,
  product_name_snapshot TEXT NOT NULL,
  measurement_unit_snapshot VARCHAR(20),
  description_snapshot TEXT,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL,
  unit_discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(14,2) NOT NULL,
  production_status VARCHAR(40) NOT NULL CHECK (production_status IN (
    'created', 'no_operational_product', 'pending_review', 'resale', 'material_prima',
    'inactive_product', 'incomplete_configuration', 'invalid_quantity'
  )),
  production_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commercial_sale_id, line_order)
);

ALTER TABLE internal_orders
  ADD COLUMN IF NOT EXISTS commercial_sale_id UUID,
  ADD COLUMN IF NOT EXISTS commercial_quote_id UUID;

ALTER TABLE sold_items
  ADD COLUMN IF NOT EXISTS commercial_sale_item_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'internal_orders_commercial_sale_id_fkey') THEN
    ALTER TABLE internal_orders ADD CONSTRAINT internal_orders_commercial_sale_id_fkey
      FOREIGN KEY (commercial_sale_id) REFERENCES commercial_sales(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'internal_orders_commercial_quote_id_fkey') THEN
    ALTER TABLE internal_orders ADD CONSTRAINT internal_orders_commercial_quote_id_fkey
      FOREIGN KEY (commercial_quote_id) REFERENCES commercial_quotes(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sold_items_commercial_sale_item_id_fkey') THEN
    ALTER TABLE sold_items ADD CONSTRAINT sold_items_commercial_sale_item_id_fkey
      FOREIGN KEY (commercial_sale_item_id) REFERENCES commercial_sale_items(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_internal_orders_commercial_sale
  ON internal_orders(commercial_sale_id) WHERE commercial_sale_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_internal_orders_commercial_quote
  ON internal_orders(commercial_quote_id) WHERE commercial_quote_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sold_items_commercial_sale_item
  ON sold_items(commercial_sale_item_id) WHERE commercial_sale_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commercial_sales_created_at ON commercial_sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commercial_sale_items_sale ON commercial_sale_items(commercial_sale_id, line_order);

-- Orçamentos não possuem data de entrega. Ordens originadas do Comercial podem
-- entrar na fila sem inventar um prazo; a data pode ser definida depois no fluxo operacional.
ALTER TABLE internal_orders ALTER COLUMN promised_date DROP NOT NULL;

CREATE OR REPLACE FUNCTION prevent_commercial_sale_identity_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.sale_number IS DISTINCT FROM NEW.sale_number
     OR OLD.commercial_quote_id IS DISTINCT FROM NEW.commercial_quote_id THEN
    RAISE EXCEPTION 'A identidade e a origem da Venda são imutáveis.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_commercial_sale_identity_immutable ON commercial_sales;
CREATE TRIGGER trg_commercial_sale_identity_immutable
BEFORE UPDATE ON commercial_sales
FOR EACH ROW EXECUTE FUNCTION prevent_commercial_sale_identity_change();

INSERT INTO permissions (code, name, description, group_name)
VALUES ('commercial.sales.view', 'Ver vendas', 'Permite visualizar Vendas originadas de Orçamentos aprovados.', 'Comercial')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'commercial.sales.view'
WHERE r.slug IN ('admin', 'manager')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE commercial_sales IS 'Venda imutável criada exclusivamente a partir da aprovação de um Orçamento moderno.';
COMMENT ON TABLE commercial_sale_items IS 'Snapshot integral dos itens vendidos e decisão rastreável de envio à Produção.';
COMMENT ON COLUMN commercial_sale_items.production_status IS 'Resultado objetivo da elegibilidade produtiva no momento da aprovação.';
COMMENT ON COLUMN internal_orders.commercial_sale_id IS 'Origem comercial da Ordem; nulo nas Ordens legadas/manuais.';

COMMIT;
