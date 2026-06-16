BEGIN;

CREATE TABLE IF NOT EXISTS product_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR UNIQUE NOT NULL,
  name VARCHAR NOT NULL,
  is_system BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO product_types (code, name, is_system, is_active)
VALUES
  ('manufactured', 'Fabricado', TRUE, TRUE),
  ('resale', 'Revenda', TRUE, TRUE),
  ('material_prima', 'Matéria-prima', TRUE, TRUE)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    is_system = TRUE,
    is_active = TRUE,
    updated_at = NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_type_check'
  ) THEN
    ALTER TABLE products DROP CONSTRAINT products_type_check;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS product_manufacturing_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  sector_id UUID NOT NULL REFERENCES sectors(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_step_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id UUID NOT NULL REFERENCES product_manufacturing_steps(id) ON DELETE CASCADE,
  depends_on_step_id UUID NOT NULL REFERENCES product_manufacturing_steps(id) ON DELETE RESTRICT,
  CONSTRAINT product_step_dependencies_no_self CHECK (step_id <> depends_on_step_id),
  CONSTRAINT product_step_dependencies_unique UNIQUE (step_id, depends_on_step_id)
);

ALTER TABLE internal_tasks
  ADD COLUMN IF NOT EXISTS product_manufacturing_step_id UUID REFERENCES product_manufacturing_steps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_released BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE sold_items
  ADD COLUMN IF NOT EXISTS is_spare_part BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS internal_task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES internal_tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID NOT NULL REFERENCES internal_tasks(id) ON DELETE RESTRICT,
  CONSTRAINT internal_task_dependencies_no_self CHECK (task_id <> depends_on_task_id),
  CONSTRAINT internal_task_dependencies_unique UNIQUE (task_id, depends_on_task_id)
);

UPDATE internal_tasks SET is_released = TRUE WHERE is_released IS NULL;
UPDATE sold_items SET is_spare_part = FALSE WHERE is_spare_part IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_types_code ON product_types(code);
CREATE INDEX IF NOT EXISTS idx_product_types_active ON product_types(is_active);
CREATE INDEX IF NOT EXISTS idx_product_manufacturing_steps_product_id ON product_manufacturing_steps(product_id);
CREATE INDEX IF NOT EXISTS idx_product_manufacturing_steps_sector_id ON product_manufacturing_steps(sector_id);
CREATE INDEX IF NOT EXISTS idx_product_step_dependencies_step_id ON product_step_dependencies(step_id);
CREATE INDEX IF NOT EXISTS idx_product_step_dependencies_depends_on ON product_step_dependencies(depends_on_step_id);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_manufacturing_step_id ON internal_tasks(product_manufacturing_step_id);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_is_released ON internal_tasks(is_released);
CREATE INDEX IF NOT EXISTS idx_internal_task_dependencies_task_id ON internal_task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_internal_task_dependencies_depends_on ON internal_task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_sold_items_is_spare_part ON sold_items(is_spare_part);

COMMIT;
