ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS person_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS trade_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS tax_id VARCHAR(14),
  ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(20),
  ADD COLUMN IF NOT EXISTS email VARCHAR(180),
  ADD COLUMN IF NOT EXISTS zip_code VARCHAR(8),
  ADD COLUMN IF NOT EXISTS address VARCHAR(180),
  ADD COLUMN IF NOT EXISTS address_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS complement VARCHAR(120),
  ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(120),
  ADD COLUMN IF NOT EXISTS city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS state VARCHAR(2),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Os campos operacionais legados continuam existindo. A cópia apenas inicializa
-- os campos estruturados do Comercial sem apagar nem reinterpretar dados antigos.
UPDATE customers
SET city = COALESCE(city, NULLIF(BTRIM(location), '')),
  state = COALESCE(
    state,
    CASE
      WHEN UPPER(BTRIM(destination_uf)) ~ '^[A-Z]{2}$' THEN UPPER(BTRIM(destination_uf))
      ELSE NULL
    END
  )
WHERE city IS NULL OR state IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_person_type_check'
      AND conrelid = 'customers'::regclass
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_person_type_check
      CHECK (person_type IS NULL OR person_type IN ('individual', 'legal'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_tax_id_format_check'
      AND conrelid = 'customers'::regclass
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_tax_id_format_check
      CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{11}$' OR tax_id ~ '^[0-9]{14}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tax_id_unique
  ON customers(tax_id)
  WHERE tax_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_is_active ON customers(is_active);

INSERT INTO permissions (code, name, description, group_name)
VALUES
  ('commercial.customers.view', 'Ver clientes do Comercial', 'Listar e consultar o cadastro mestre de clientes.', 'Comercial'),
  ('commercial.customers.create', 'Criar clientes do Comercial', 'Cadastrar clientes no cadastro mestre compartilhado.', 'Comercial'),
  ('commercial.customers.edit', 'Editar clientes do Comercial', 'Editar e ativar ou inativar clientes do cadastro mestre.', 'Comercial')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name;

-- Novas permissões não são distribuídas para perfis operacionais automaticamente.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'commercial.customers.view',
  'commercial.customers.create',
  'commercial.customers.edit'
)
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;
