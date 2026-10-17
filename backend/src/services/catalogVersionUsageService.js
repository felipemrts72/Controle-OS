// Historical usage, not publication or preview, protects a technical version.
// Keep the same version-row lock in writers and official document generation.
export async function getCatalogVersionUsage(database, ids) {
  if (!ids.length) return new Map();
  const result = await database.query(`SELECT v.id,
    (EXISTS(SELECT 1 FROM commercial_quote_items i JOIN commercial_quotes q ON q.id=i.commercial_quote_id
      WHERE i.product_catalog_version_id=v.id AND (q.sent_at IS NOT NULL OR q.status IN ('sent','approved','rejected')
        OR EXISTS(SELECT 1 FROM commercial_sales s WHERE s.commercial_quote_id=q.id)
        OR EXISTS(SELECT 1 FROM commercial_quote_history h WHERE h.commercial_quote_id=q.id AND h.action IN ('sent','emitted','approved'))))
    OR EXISTS(SELECT 1 FROM commercial_quote_documents d
      WHERE d.document_data_snapshot->'catalogs' @> jsonb_build_array(jsonb_build_object('version_id',v.id::text)))
    OR EXISTS(SELECT 1 FROM commercial_legacy_quote_documents d
      WHERE d.document_data_snapshot->'catalogs' @> jsonb_build_array(jsonb_build_object('version_id',v.id::text)))
    OR EXISTS(SELECT 1 FROM commercial_legacy_quote_items i JOIN commercial_legacy_quotes q ON q.id=i.commercial_legacy_quote_id
      WHERE i.legacy_include_catalog AND i.source_catalog_version_id=v.source_id AND q.source_system=v.source_system)
    ) AS is_used,
    EXISTS(SELECT 1 FROM commercial_quote_items i WHERE i.product_catalog_version_id=v.id) AS has_quote_references
    FROM product_catalog_versions v WHERE v.id=ANY($1::uuid[])`, [ids]);
  return new Map(result.rows.map((row) => [row.id, row]));
}

export async function lockQuoteCatalogVersions(client, quote) {
  const ids = [...new Set((quote.items || []).map((item) => item.product_catalog_version_id).filter(Boolean))].sort();
  if (ids.length) await client.query('SELECT id FROM product_catalog_versions WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [ids]);
}
