-- Comercial / Orçamentos. Estruturas novas e isoladas dos domínios operacionais.
-- A numeração é obtida por UPSERT atômico em commercial_quote_counters;
-- não depende de MAX(numero) e participa da mesma transação do orçamento.

CREATE TABLE IF NOT EXISTS commercial_quote_counters (
  counter_year INTEGER PRIMARY KEY CHECK (counter_year BETWEEN 2000 AND 9999),
  last_value BIGINT NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_commercial_profiles (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE RESTRICT,
  reference_price NUMERIC(14,2) CHECK (reference_price IS NULL OR reference_price >= 0),
  commercial_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS commercial_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number VARCHAR(30) NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name_snapshot VARCHAR(180) NOT NULL,
  customer_snapshot JSONB NOT NULL,
  customer_snapshot_version INTEGER NOT NULL DEFAULT 1 CHECK (customer_snapshot_version > 0),
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'cancelled')),
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  notes TEXT,
  internal_notes TEXT,
  items_gross_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (items_gross_total >= 0),
  items_discount_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (items_discount_total >= 0),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  freight_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  calculation_version INTEGER NOT NULL DEFAULT 1 CHECK (calculation_version > 0),
  sent_at TIMESTAMPTZ,
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_until IS NULL OR valid_until >= quote_date),
  CHECK (items_discount_total <= items_gross_total),
  CHECK (subtotal = items_gross_total - items_discount_total),
  CHECK (discount_amount <= subtotal),
  CHECK (total = subtotal - discount_amount + freight_amount)
);

CREATE TABLE IF NOT EXISTS commercial_quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_quote_id UUID NOT NULL REFERENCES commercial_quotes(id) ON DELETE CASCADE,
  line_order INTEGER NOT NULL CHECK (line_order > 0),
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('product', 'manual')),
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  product_code_snapshot VARCHAR(80),
  product_name_snapshot VARCHAR(180) NOT NULL,
  measurement_unit_snapshot VARCHAR(20),
  description_snapshot TEXT,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  gross_subtotal NUMERIC(14,2) NOT NULL CHECK (gross_subtotal >= 0),
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  subtotal NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commercial_quote_id, line_order),
  CHECK (
    (item_type = 'product' AND product_id IS NOT NULL)
    OR (item_type = 'manual' AND product_id IS NULL)
  ),
  CHECK (discount_amount <= gross_subtotal),
  CHECK (subtotal = gross_subtotal - discount_amount)
);

CREATE TABLE IF NOT EXISTS commercial_quote_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_quote_id UUID NOT NULL REFERENCES commercial_quotes(id) ON DELETE CASCADE,
  line_order INTEGER NOT NULL CHECK (line_order > 0),
  method_type VARCHAR(30) NOT NULL
    CHECK (method_type IN ('cash', 'pix', 'bank_slip', 'bank_transfer', 'debit_card', 'credit_card', 'check', 'other')),
  description VARCHAR(180) NOT NULL,
  calculation_type VARCHAR(20) NOT NULL CHECK (calculation_type IN ('amount', 'percentage')),
  percentage NUMERIC(7,4),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  installment_count INTEGER NOT NULL DEFAULT 1 CHECK (installment_count BETWEEN 1 AND 120),
  first_due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commercial_quote_id, line_order),
  CHECK (
    (calculation_type = 'amount' AND percentage IS NULL)
    OR (calculation_type = 'percentage' AND percentage > 0 AND percentage <= 100)
  )
);

CREATE TABLE IF NOT EXISTS commercial_quote_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_method_id UUID NOT NULL REFERENCES commercial_quote_payment_methods(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL CHECK (installment_number > 0),
  due_date DATE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_method_id, installment_number)
);

CREATE TABLE IF NOT EXISTS commercial_quote_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_quote_id UUID NOT NULL REFERENCES commercial_quotes(id) ON DELETE CASCADE,
  action VARCHAR(40) NOT NULL,
  previous_status VARCHAR(20),
  new_status VARCHAR(20),
  details JSONB,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commercial_quotes_customer ON commercial_quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_commercial_quotes_status_date ON commercial_quotes(status, quote_date DESC);
CREATE INDEX IF NOT EXISTS idx_commercial_quotes_responsible ON commercial_quotes(responsible_user_id);
CREATE INDEX IF NOT EXISTS idx_commercial_quote_items_quote ON commercial_quote_items(commercial_quote_id);
CREATE INDEX IF NOT EXISTS idx_commercial_quote_items_product ON commercial_quote_items(product_id);
CREATE INDEX IF NOT EXISTS idx_commercial_quote_payments_quote ON commercial_quote_payment_methods(commercial_quote_id);
CREATE INDEX IF NOT EXISTS idx_commercial_quote_history_quote ON commercial_quote_history(commercial_quote_id, created_at DESC);

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('commercial.quotes.view', 'Ver orçamentos', 'Permite visualizar os orçamentos comerciais.', 'Comercial'),
  ('commercial.quotes.create', 'Criar orçamentos', 'Permite criar e duplicar orçamentos comerciais.', 'Comercial'),
  ('commercial.quotes.edit', 'Editar orçamentos', 'Permite editar rascunhos e alterar estados comerciais de negociação.', 'Comercial'),
  ('commercial.quotes.approve', 'Aprovar orçamentos', 'Permite aprovar orçamentos sem gerar efeitos operacionais.', 'Comercial'),
  ('commercial.quotes.cancel', 'Cancelar orçamentos', 'Permite cancelar orçamentos preservando o histórico.', 'Comercial')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

-- Somente Administrador recebe as permissões novas automaticamente.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'commercial.quotes.view',
  'commercial.quotes.create',
  'commercial.quotes.edit',
  'commercial.quotes.approve',
  'commercial.quotes.cancel'
)
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;
