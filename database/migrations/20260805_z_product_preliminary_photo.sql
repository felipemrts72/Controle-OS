BEGIN;

CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL UNIQUE,
  mime_type VARCHAR(80) NOT NULL CHECK (mime_type IN ('image/png','image/jpeg')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
COMMENT ON TABLE product_images IS 'Foto cadastral opcional do Produto; não representa estoque nem ficha técnica completa.';

COMMIT;
