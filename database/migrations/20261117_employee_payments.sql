CREATE TABLE employee_payments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
  total_cents BIGINT NOT NULL CHECK (total_cents > 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES users(id),
  CHECK ((finalized_at IS NULL) = (finalized_by IS NULL))
);
