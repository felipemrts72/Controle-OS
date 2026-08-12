BEGIN;

CREATE TABLE IF NOT EXISTS measurement_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  aliases VARCHAR(80)[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO measurement_units (code, name, symbol, aliases, sort_order) VALUES
  ('UN', 'Unidade', 'un', ARRAY['un','und','unidade','unidades'], 10),
  ('KG', 'Quilograma', 'kg', ARRAY['kg','quilo','quilos','quilograma','quilogramas'], 20),
  ('G', 'Grama', 'g', ARRAY['g','grama','gramas'], 30),
  ('T', 'Tonelada', 't', ARRAY['t','ton','tonelada','toneladas'], 40),
  ('M', 'Metro', 'm', ARRAY['m','metro','metros'], 50),
  ('CM', 'Centímetro', 'cm', ARRAY['cm','centimetro','centímetros','centimetros'], 60),
  ('MM', 'Milímetro', 'mm', ARRAY['mm','milimetro','milímetros','milimetros'], 70),
  ('M²', 'Metro quadrado', 'm²', ARRAY['m2','m²','metro quadrado','metros quadrados'], 80),
  ('M³', 'Metro cúbico', 'm³', ARRAY['m3','m³','metro cubico','metro cúbico','metros cubicos','metros cúbicos'], 90),
  ('L', 'Litro', 'L', ARRAY['l','lt','litro','litros'], 100),
  ('ML', 'Mililitro', 'mL', ARRAY['ml','mililitro','mililitros'], 110),
  ('CX', 'Caixa', 'cx', ARRAY['cx','caixa','caixas'], 120),
  ('PCT', 'Pacote', 'pct', ARRAY['pct','pacote','pacotes'], 130),
  ('PAR', 'Par', 'par', ARRAY['par','pares'], 140),
  ('JG', 'Jogo', 'jg', ARRAY['jg','jogo','jogos'], 150),
  ('BARRA', 'Barra', 'barra', ARRAY['barra','barras'], 160),
  ('CHAPA', 'Chapa', 'chapa', ARRAY['chapa','chapas'], 170),
  ('ROLO', 'Rolo', 'rolo', ARRAY['rolo','rolos'], 180),
  ('KIT', 'Kit', 'kit', ARRAY['kit','kits'], 190),
  ('CONJ', 'Conjunto', 'conj', ARRAY['conj','conjunto','conjuntos'], 200),
  ('PC', 'Peça', 'pç', ARRAY['pc','pç','peca','peça','pecas','peças'], 210)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  symbol = EXCLUDED.symbol,
  aliases = EXCLUDED.aliases,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS measurement_unit_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(30) NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS creation_origin VARCHAR(30) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS preliminary_created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS preliminary_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_measurement_unit_code_fkey') THEN
    ALTER TABLE products ADD CONSTRAINT products_measurement_unit_code_fkey
      FOREIGN KEY (measurement_unit_code) REFERENCES measurement_units(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_review_status_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_review_status_check
      CHECK (review_status IN ('pending_review', 'approved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_creation_origin_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_creation_origin_check
      CHECK (creation_origin IN ('manual', 'purchases'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_measurement_units_active_sort ON measurement_units(is_active, sort_order, code);
CREATE INDEX IF NOT EXISTS idx_products_review_status ON products(review_status, is_active);

COMMENT ON TABLE measurement_units IS 'Catálogo central de unidades; não representa nem movimenta saldo de estoque.';
COMMENT ON COLUMN products.measurement_unit_code IS 'Unidade padrão de apresentação e compras; não representa saldo.';
COMMENT ON COLUMN products.review_status IS 'Estado de completude cadastral do produto.';

COMMIT;
