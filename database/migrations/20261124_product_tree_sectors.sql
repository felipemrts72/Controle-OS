ALTER TABLE product_tree_nodes ADD COLUMN sector_id UUID REFERENCES sectors(id);
UPDATE product_tree_nodes n SET sector_id = p.sector_id FROM products p WHERE p.id = n.product_id;
CREATE INDEX product_tree_nodes_sector ON product_tree_nodes(sector_id) WHERE sector_id IS NOT NULL;
COMMENT ON COLUMN product_tree_nodes.sector_id IS 'Setor responsável nesta composição; mesmo identificador operacional usado nas tarefas de produção.';
