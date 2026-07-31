CREATE EXTENSION IF NOT EXISTS "pgcrypto";

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('suppliers.view', 'Ver fornecedores', NULL, 'Compras e fornecedores'),
  ('suppliers.create', 'Criar fornecedores', NULL, 'Compras e fornecedores'),
  ('suppliers.edit', 'Editar fornecedores', NULL, 'Compras e fornecedores'),
  ('suppliers.deactivate', 'Desativar ou reativar fornecedores', NULL, 'Compras e fornecedores'),
  ('supplier_groups.manage', 'Gerenciar grupos de materiais', NULL, 'Compras e fornecedores'),
  ('purchases.view', 'Ver compras e solicitações', NULL, 'Compras e fornecedores'),
  ('purchases.create_request', 'Criar solicitações de compra', NULL, 'Compras e fornecedores'),
  ('purchases.edit_own_request', 'Editar solicitações próprias', NULL, 'Compras e fornecedores'),
  ('purchases.approve', 'Aprovar solicitações de compra', NULL, 'Compras e fornecedores'),
  ('purchases.create_preapproved', 'Criar solicitação pré-aprovada', NULL, 'Compras e fornecedores'),
  ('purchases.create_direct', 'Criar compra direta', NULL, 'Compras e fornecedores'),
  ('purchases.cancel', 'Cancelar solicitações e compras', NULL, 'Compras e fornecedores'),
  ('purchases.receive', 'Registrar recebimentos', NULL, 'Compras e fornecedores'),
  ('purchases.view_values', 'Ver valores de compras', NULL, 'Compras e fornecedores'),
  ('purchase_quotes.create', 'Criar solicitações de cotação', NULL, 'Compras e fornecedores'),
  ('purchase_quotes.send', 'Registrar envio de cotações', NULL, 'Compras e fornecedores'),
  ('purchase_quotes.register_response', 'Registrar propostas de fornecedores', NULL, 'Compras e fornecedores'),
  ('purchase_quotes.choose_supplier', 'Escolher fornecedores em cotações', NULL, 'Compras e fornecedores'),
  ('purchase_quotes.pdf', 'Baixar PDFs de cotação', NULL, 'Compras e fornecedores')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.slug = 'admin' AND p.code IN (
  'suppliers.view','suppliers.create','suppliers.edit','suppliers.deactivate','supplier_groups.manage',
  'purchases.view','purchases.create_request','purchases.edit_own_request','purchases.approve',
  'purchases.create_preapproved','purchases.create_direct','purchases.cancel','purchases.receive','purchases.view_values',
  'purchase_quotes.create','purchase_quotes.send','purchase_quotes.register_response',
  'purchase_quotes.choose_supplier','purchase_quotes.pdf'
) ON CONFLICT DO NOTHING;

CREATE TABLE material_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  normalized_name VARCHAR(120) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO material_groups (name, normalized_name) VALUES
  ('Rolamentos','rolamentos'),('Ferragens','ferragens'),('Aço e chapas','aço e chapas'),
  ('Ferramentas','ferramentas'),('Soldagem','soldagem'),('Elétrica','elétrica'),
  ('Hidráulica','hidráulica'),('Pintura','pintura'),('Motores','motores'),('Usinagem','usinagem'),
  ('Equipamentos de proteção','equipamentos de proteção'),('Administrativo','administrativo')
ON CONFLICT (normalized_name) DO NOTHING;

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_type VARCHAR(20) NOT NULL CHECK (person_type IN ('legal','individual')),
  legal_name VARCHAR(180) NOT NULL,
  trade_name VARCHAR(180),
  tax_id VARCHAR(14) NOT NULL UNIQUE CHECK (tax_id ~ '^[0-9]{11}$' OR tax_id ~ '^[0-9]{14}$'),
  state_registration VARCHAR(30), phone VARCHAR(20), whatsapp VARCHAR(20),
  primary_email VARCHAR(180), quote_email VARCHAR(180), website VARCHAR(240),
  contact_name VARCHAR(160), contact_phone VARCHAR(20), contact_whatsapp VARCHAR(20), contact_email VARCHAR(180),
  zip_code VARCHAR(8), address VARCHAR(180), address_number VARCHAR(30), complement VARCHAR(120),
  neighborhood VARCHAR(120), city VARCHAR(120), state VARCHAR(2), notes TEXT,
  average_delivery_days INTEGER CHECK (average_delivery_days IS NULL OR average_delivery_days >= 0),
  default_payment_terms VARCHAR(180), is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier_material_groups (
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  material_group_id UUID NOT NULL REFERENCES material_groups(id),
  PRIMARY KEY (supplier_id, material_group_id)
);

CREATE TABLE purchase_counters (
  counter_type VARCHAR(30) NOT NULL,
  counter_year INTEGER NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (counter_type, counter_year)
);

CREATE TABLE purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), number VARCHAR(30) NOT NULL UNIQUE,
  requester_id UUID NOT NULL REFERENCES users(id), sector_id UUID REFERENCES sectors(id),
  request_date DATE NOT NULL DEFAULT CURRENT_DATE, justification TEXT NOT NULL, notes TEXT,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('consumption','stock_replenishment','maintenance','production','investment','other')),
  needed_date DATE, status VARCHAR(40) NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','pending_approval','returned','rejected','approved','quoting','supplier_selected',
    'purchased','partially_received','received','cancelled')),
  approver_id UUID REFERENCES users(id), approved_at TIMESTAMP, decision_reason TEXT,
  is_preapproved BOOLEAN NOT NULL DEFAULT FALSE, direct_purchase_justification TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMP, cancelled_by UUID REFERENCES users(id)
);

CREATE TABLE purchase_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL REFERENCES purchase_requests(id),
  description VARCHAR(240) NOT NULL, material_group_id UUID REFERENCES material_groups(id), unit VARCHAR(30) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0), technical_specification TEXT,
  preferred_brand VARCHAR(120), brand_required BOOLEAN NOT NULL DEFAULT FALSE,
  reference_code VARCHAR(120), notes TEXT, estimated_unit_value NUMERIC(14,2) CHECK (estimated_unit_value IS NULL OR estimated_unit_value >= 0),
  needed_date DATE, specific_purpose VARCHAR(240), allows_equivalent BOOLEAN NOT NULL DEFAULT TRUE,
  product_id UUID REFERENCES products(id), created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_request_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL REFERENCES purchase_requests(id),
  user_id UUID REFERENCES users(id), previous_status VARCHAR(40), new_status VARCHAR(40) NOT NULL,
  reason TEXT, action VARCHAR(50) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), number VARCHAR(30) NOT NULL UNIQUE,
  purchase_request_id UUID NOT NULL REFERENCES purchase_requests(id), response_deadline DATE,
  delivery_address TEXT, response_email VARCHAR(180), response_whatsapp VARCHAR(20), notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','responses_received','completed','cancelled')),
  responsible_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_quote_items (
  quote_request_id UUID NOT NULL REFERENCES purchase_quote_requests(id),
  request_item_id UUID NOT NULL REFERENCES purchase_request_items(id),
  PRIMARY KEY (quote_request_id, request_item_id)
);

CREATE TABLE purchase_quote_suppliers (
  quote_request_id UUID NOT NULL REFERENCES purchase_quote_requests(id), supplier_id UUID NOT NULL REFERENCES suppliers(id),
  added_at TIMESTAMP NOT NULL DEFAULT NOW(), PRIMARY KEY (quote_request_id, supplier_id)
);

CREATE TABLE purchase_quote_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), quote_request_id UUID NOT NULL REFERENCES purchase_quote_requests(id),
  supplier_id UUID REFERENCES suppliers(id), channel VARCHAR(20) NOT NULL CHECK (channel IN ('email','whatsapp','other')),
  destination VARCHAR(200), notes TEXT, sent_by UUID NOT NULL REFERENCES users(id), sent_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), quote_request_id UUID NOT NULL REFERENCES purchase_quote_requests(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id), proposal_date DATE NOT NULL, valid_until DATE,
  payment_terms VARCHAR(180), delivery_days INTEGER CHECK (delivery_days IS NULL OR delivery_days >= 0),
  freight NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (freight >= 0), additional_taxes NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (additional_taxes >= 0),
  notes TEXT, total_value NUMERIC(14,2) NOT NULL DEFAULT 0, created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (quote_request_id, supplier_id)
);

CREATE TABLE supplier_proposal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), proposal_id UUID NOT NULL REFERENCES supplier_proposals(id),
  request_item_id UUID NOT NULL REFERENCES purchase_request_items(id), unit_value NUMERIC(14,2) CHECK (unit_value IS NULL OR unit_value >= 0),
  offered_brand VARCHAR(120), is_equivalent BOOLEAN NOT NULL DEFAULT FALSE, quoted_quantity NUMERIC(14,3) CHECK (quoted_quantity IS NULL OR quoted_quantity > 0),
  notes TEXT, UNIQUE (proposal_id, request_item_id)
);

CREATE TABLE purchase_quote_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), quote_request_id UUID NOT NULL REFERENCES purchase_quote_requests(id),
  request_item_id UUID NOT NULL REFERENCES purchase_request_items(id), supplier_id UUID NOT NULL REFERENCES suppliers(id),
  proposal_item_id UUID REFERENCES supplier_proposal_items(id), justification TEXT, selected_by UUID NOT NULL REFERENCES users(id),
  selected_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (quote_request_id, request_item_id)
);

CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), number VARCHAR(30) NOT NULL UNIQUE,
  purchase_request_id UUID REFERENCES purchase_requests(id), quote_request_id UUID REFERENCES purchase_quote_requests(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id), buyer_id UUID NOT NULL REFERENCES users(id),
  discount NUMERIC(14,2) NOT NULL DEFAULT 0, freight NUMERIC(14,2) NOT NULL DEFAULT 0, taxes NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0, payment_method VARCHAR(100), payment_terms VARCHAR(180), expected_delivery_date DATE,
  notes TEXT, direct_purchase_justification TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','ordered','partially_received','received','cancelled')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMP, cancelled_by UUID REFERENCES users(id), cancellation_reason TEXT
);

CREATE TABLE purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id UUID NOT NULL REFERENCES purchases(id),
  request_item_id UUID REFERENCES purchase_request_items(id), description VARCHAR(240) NOT NULL, unit VARCHAR(30) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0), unit_value NUMERIC(14,2) NOT NULL CHECK (unit_value >= 0),
  discount NUMERIC(14,2) NOT NULL DEFAULT 0, total NUMERIC(14,2) NOT NULL DEFAULT 0,
  received_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0), created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id UUID NOT NULL REFERENCES purchases(id),
  receipt_date TIMESTAMP NOT NULL DEFAULT NOW(), responsible_id UUID NOT NULL REFERENCES users(id), notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id UUID NOT NULL REFERENCES purchase_receipts(id),
  purchase_item_id UUID NOT NULL REFERENCES purchase_items(id), quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  has_discrepancy BOOLEAN NOT NULL DEFAULT FALSE, is_damaged BOOLEAN NOT NULL DEFAULT FALSE, is_rejected BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT
);

CREATE TABLE purchase_domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_type VARCHAR(80) NOT NULL, aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id UUID NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP
);

CREATE INDEX idx_suppliers_search ON suppliers (lower(legal_name), lower(COALESCE(trade_name,'')));
CREATE INDEX idx_suppliers_active ON suppliers (is_active);
CREATE INDEX idx_supplier_groups_group ON supplier_material_groups (material_group_id);
CREATE INDEX idx_purchase_requests_status ON purchase_requests (status, created_at DESC);
CREATE INDEX idx_purchase_requests_requester ON purchase_requests (requester_id);
CREATE INDEX idx_purchase_request_items_request ON purchase_request_items (request_id);
CREATE INDEX idx_purchase_request_history_request ON purchase_request_history (request_id, created_at);
CREATE INDEX idx_quote_requests_status ON purchase_quote_requests (status, created_at DESC);
CREATE INDEX idx_quote_requests_request ON purchase_quote_requests (purchase_request_id);
CREATE INDEX idx_proposals_quote ON supplier_proposals (quote_request_id);
CREATE INDEX idx_purchases_status ON purchases (status, created_at DESC);
CREATE INDEX idx_purchases_request ON purchases (purchase_request_id);
CREATE INDEX idx_purchase_items_purchase ON purchase_items (purchase_id);
CREATE INDEX idx_receipts_purchase ON purchase_receipts (purchase_id, receipt_date);
CREATE INDEX idx_domain_events_pending ON purchase_domain_events (processed_at) WHERE processed_at IS NULL;
