SET LOCAL lock_timeout = '10s';
ALTER TABLE internal_tasks ADD COLUMN completed_quantity NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(completed_quantity >= 0);
UPDATE internal_tasks SET completed_quantity=quantity WHERE status='ready';
ALTER TABLE internal_task_dependencies ADD COLUMN required_quantity NUMERIC(18,6) CHECK(required_quantity > 0);
-- NULL keeps the original completion rule for legacy route dependencies.
