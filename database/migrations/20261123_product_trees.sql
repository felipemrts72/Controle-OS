-- Composição visual por ocorrência. Não modifica o roteiro usado pelas OS.
CREATE TABLE product_trees (
  product_id UUID PRIMARY KEY REFERENCES products(id),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE product_tree_nodes (
  tree_id UUID NOT NULL REFERENCES product_trees(product_id),
  id UUID NOT NULL,
  parent_id UUID,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(18,6) NOT NULL CHECK (quantity > 0),
  unit_code VARCHAR(20) NOT NULL REFERENCES measurement_units(code),
  note VARCHAR(1000) NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  PRIMARY KEY (tree_id, id),
  FOREIGN KEY (tree_id, parent_id) REFERENCES product_tree_nodes(tree_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX product_tree_one_root ON product_tree_nodes(tree_id) WHERE parent_id IS NULL;
CREATE INDEX product_tree_product ON product_tree_nodes(product_id);
CREATE TABLE product_tree_requests (
  user_id UUID NOT NULL REFERENCES users(id),
  request_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, request_id)
);
