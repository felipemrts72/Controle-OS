SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
ALTER TABLE vacation_leaves ADD COLUMN bonus_days INTEGER NOT NULL DEFAULT 0 CHECK (bonus_days >= 0);
ALTER TABLE vacation_leaves ADD COLUMN bonus_requested_at DATE;
