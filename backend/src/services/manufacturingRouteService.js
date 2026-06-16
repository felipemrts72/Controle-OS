import { httpError } from '../utils/httpError.js';

function normalizeStep(step, index) {
  return {
    id: step.id || null,
    client_id: step.client_id || step.id || `step-${index}`,
    name: String(step.name || '').trim(),
    sector_id: step.sector_id || null,
    quantity: Number(step.quantity || 1),
    sort_order: Number(step.sort_order || index + 1),
    dependency_client_ids: [...new Set(step.dependency_client_ids || step.dependencies || [])],
  };
}

function assertNoCycles(steps) {
  const stepIds = new Set(steps.map((step) => step.client_id));
  const visiting = new Set();
  const visited = new Set();
  const edges = new Map(steps.map((step) => [step.client_id, step.dependency_client_ids || []]));

  function visit(stepId) {
    if (visiting.has(stepId)) {
      throw httpError(400, 'Não foi possível salvar o roteiro porque existe uma dependência circular entre as etapas.', {
        code: 'MANUFACTURING_ROUTE_CYCLE',
      });
    }
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    for (const dependencyId of edges.get(stepId) || []) {
      if (stepIds.has(dependencyId)) visit(dependencyId);
    }
    visiting.delete(stepId);
    visited.add(stepId);
  }

  steps.forEach((step) => visit(step.client_id));
}

export async function getProductManufacturingSteps(client, productId) {
  const steps = await client.query(
    `SELECT pms.*, s.name AS sector_name
     FROM product_manufacturing_steps pms
     LEFT JOIN sectors s ON s.id = pms.sector_id
     WHERE pms.product_id = $1
     ORDER BY pms.sort_order ASC, pms.created_at ASC`,
    [productId],
  );
  if (!steps.rows.length) return [];

  const ids = steps.rows.map((step) => step.id);
  const dependencies = await client.query(
    `SELECT psd.step_id, psd.depends_on_step_id, pms.name AS depends_on_step_name
     FROM product_step_dependencies psd
     JOIN product_manufacturing_steps pms ON pms.id = psd.depends_on_step_id
     WHERE psd.step_id = ANY($1)`,
    [ids],
  );
  const dependenciesByStep = dependencies.rows.reduce((groups, dependency) => {
    const current = groups.get(dependency.step_id) || [];
    current.push(dependency);
    groups.set(dependency.step_id, current);
    return groups;
  }, new Map());

  return steps.rows.map((step) => ({
    ...step,
    client_id: step.id,
    dependency_client_ids: (dependenciesByStep.get(step.id) || []).map((dependency) => dependency.depends_on_step_id),
    dependencies: dependenciesByStep.get(step.id) || [],
  }));
}

export async function saveProductManufacturingSteps(client, productId, rawSteps = []) {
  const steps = rawSteps.map(normalizeStep);

  for (const step of steps) {
    if (!step.name) throw httpError(400, 'Informe o nome da etapa.', { code: 'STEP_NAME_REQUIRED', field: 'manufacturing_steps.name' });
    if (!step.sector_id) throw httpError(400, 'Informe o setor responsável da etapa.', { code: 'STEP_SECTOR_REQUIRED', field: 'manufacturing_steps.sector_id' });
    if (step.quantity < 1) throw httpError(400, 'A quantidade da etapa deve ser maior que zero.', { code: 'INVALID_QUANTITY', field: 'manufacturing_steps.quantity' });
    const sector = await client.query('SELECT id FROM sectors WHERE id = $1 AND is_active = TRUE', [step.sector_id]);
    if (!sector.rows[0]) throw httpError(400, 'O setor responsável não foi encontrado.', { code: 'SECTOR_NOT_FOUND', field: 'sector_id' });
  }

  const stepIds = new Set(steps.map((step) => step.client_id));
  for (const step of steps) {
    if (step.dependency_client_ids.includes(step.client_id)) throw httpError(400, 'Uma etapa não pode depender dela mesma.', { code: 'STEP_SELF_DEPENDENCY' });
    for (const dependencyId of step.dependency_client_ids) {
      if (!stepIds.has(dependencyId)) {
        throw httpError(400, 'Dependência inválida para este produto.', { code: 'STEP_DEPENDENCY_DIFFERENT_PRODUCT' });
      }
    }
  }
  assertNoCycles(steps);

  await client.query('DELETE FROM product_manufacturing_steps WHERE product_id = $1', [productId]);
  const idByClientId = new Map();
  for (const step of steps) {
    const inserted = await client.query(
      `INSERT INTO product_manufacturing_steps (product_id, name, sector_id, quantity, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [productId, step.name, step.sector_id, step.quantity, step.sort_order],
    );
    idByClientId.set(step.client_id, inserted.rows[0].id);
  }

  for (const step of steps) {
    const stepId = idByClientId.get(step.client_id);
    for (const dependencyClientId of step.dependency_client_ids) {
      await client.query(
        `INSERT INTO product_step_dependencies (step_id, depends_on_step_id)
         VALUES ($1, $2)`,
        [stepId, idByClientId.get(dependencyClientId)],
      );
    }
  }
}

export async function copyProductRouteToSoldItemTasks(client, { productId, soldItemId, soldQuantity }) {
  const routeSteps = await client.query(
    `SELECT * FROM product_manufacturing_steps
     WHERE product_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [productId],
  );
  if (!routeSteps.rows.length) return false;

  const routeStepIds = routeSteps.rows.map((step) => step.id);
  const routeDependencies = await client.query(
    `SELECT step_id, depends_on_step_id
     FROM product_step_dependencies
     WHERE step_id = ANY($1)`,
    [routeStepIds],
  );
  const dependenciesByStep = routeDependencies.rows.reduce((groups, dependency) => {
    const current = groups.get(dependency.step_id) || [];
    current.push(dependency.depends_on_step_id);
    groups.set(dependency.step_id, current);
    return groups;
  }, new Map());

  const taskIdByStepId = new Map();
  for (const step of routeSteps.rows) {
    const dependencyCount = dependenciesByStep.get(step.id)?.length || 0;
    const inserted = await client.query(
      `INSERT INTO internal_tasks (sold_item_id, sector_id, task_name, quantity, product_manufacturing_step_id, is_released)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [soldItemId, step.sector_id, step.name, Number(soldQuantity || 1) * Number(step.quantity || 1), step.id, dependencyCount === 0],
    );
    taskIdByStepId.set(step.id, inserted.rows[0].id);
  }

  for (const dependency of routeDependencies.rows) {
    await client.query(
      `INSERT INTO internal_task_dependencies (task_id, depends_on_task_id)
       VALUES ($1, $2)`,
      [taskIdByStepId.get(dependency.step_id), taskIdByStepId.get(dependency.depends_on_step_id)],
    );
  }

  return true;
}

export async function releaseDependentTasks(client, completedTaskId) {
  const dependents = await client.query(
    `SELECT DISTINCT itd.task_id
     FROM internal_task_dependencies itd
     WHERE itd.depends_on_task_id = $1`,
    [completedTaskId],
  );

  for (const dependent of dependents.rows) {
    const blocked = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM internal_task_dependencies itd
       JOIN internal_tasks dependency ON dependency.id = itd.depends_on_task_id
       WHERE itd.task_id = $1
         AND dependency.status <> 'ready'`,
      [dependent.task_id],
    );

    if (blocked.rows[0].total === 0) {
      await client.query(
        `UPDATE internal_tasks
         SET is_released = TRUE, updated_at = NOW()
         WHERE id = $1 AND is_released = FALSE`,
        [dependent.task_id],
      );
    }
  }
}
