export async function logAudit(client, { entityType, entityId, action, previousValue = null, newValue = null, userId = null }) {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, previous_value, new_value, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entityType, entityId, action, previousValue, newValue, userId],
  );
}
