SET LOCAL lock_timeout = '10s';
ALTER TABLE commercial_quotes
  ADD COLUMN manufacturing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN manufacturing_issued_at TIMESTAMPTZ,
  ADD COLUMN manufacturing_issued_by UUID REFERENCES users(id),
  ADD COLUMN manufacturing_choice BOOLEAN;
ALTER TABLE commercial_quote_items ADD COLUMN manufacturing_plan JSONB;
-- Reutiliza as tarefas operacionais, com precisão suficiente para unidades fracionárias.
ALTER TABLE sold_items ALTER COLUMN quantity TYPE NUMERIC(18,6);
ALTER TABLE internal_tasks ALTER COLUMN quantity TYPE NUMERIC(18,6);
ALTER TABLE internal_tasks
  ADD COLUMN measurement_unit_code VARCHAR(20) REFERENCES measurement_units(code),
  ADD COLUMN manufacturing_node_key UUID,
  ADD COLUMN manufacturing_parent_key UUID,
  ADD COLUMN component_product_id UUID REFERENCES products(id),
  ADD COLUMN manufacturing_snapshot JSONB,
  ADD COLUMN manufacturing_notes TEXT;
CREATE UNIQUE INDEX internal_tasks_manufacturing_node ON internal_tasks(sold_item_id,manufacturing_node_key)
  WHERE manufacturing_node_key IS NOT NULL;
ALTER TABLE commercial_sale_items DROP CONSTRAINT commercial_sale_items_production_status_check;
ALTER TABLE commercial_sale_items ADD CONSTRAINT commercial_sale_items_production_status_check CHECK (production_status IN (
  'created','no_operational_product','pending_review','resale','material_prima','inactive_product',
  'incomplete_configuration','invalid_quantity','not_requested'
));
