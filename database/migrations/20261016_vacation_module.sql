-- O runner executa cada arquivo em uma transação; falhar rápido evita espera prolongada no ERP.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE vacation_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  acquisition_start DATE NOT NULL,
  acquisition_end DATE NOT NULL,
  concession_start DATE NOT NULL,
  concession_end DATE NOT NULL,
  reviewed_at TIMESTAMP,
  reviewed_by UUID REFERENCES users(id),
  review_note TEXT,
  special_case BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, ordinal),
  UNIQUE (employee_id, acquisition_start),
  UNIQUE (id, employee_id),
  CHECK (acquisition_start <= acquisition_end AND concession_start <= concession_end)
);
CREATE INDEX vacation_periods_employee_idx ON vacation_periods(employee_id, acquisition_start);

CREATE TABLE vacation_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  period_id UUID NOT NULL,
  occurrence_date DATE NOT NULL,
  quantity NUMERIC(2,1) NOT NULL CHECK (quantity IN (0.5, 1.0)),
  classification VARCHAR(20) NOT NULL CHECK (classification IN ('justificada', 'injustificada', 'pendente')),
  notes TEXT,
  cancelled_at TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (period_id, employee_id) REFERENCES vacation_periods(id, employee_id)
);
CREATE UNIQUE INDEX vacation_absence_active_day_idx ON vacation_absences(employee_id, occurrence_date) WHERE cancelled_at IS NULL;
CREATE INDEX vacation_absences_period_idx ON vacation_absences(period_id, occurrence_date);

CREATE TABLE vacation_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  period_id UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days INTEGER NOT NULL CHECK (days >= 1),
  status VARCHAR(20) NOT NULL CHECK (status IN ('programada', 'gozada', 'cancelada', 'historica')),
  employee_agreed BOOLEAN NOT NULL DEFAULT FALSE,
  calendar_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  calendar_review_note TEXT,
  calendar_reviewed_by UUID REFERENCES users(id),
  notice_date DATE,
  payment_due_date DATE,
  payment_confirmed_at TIMESTAMP,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (period_id, employee_id) REFERENCES vacation_periods(id, employee_id),
  CHECK (start_date <= end_date),
  CHECK (days = end_date - start_date + 1)
);
CREATE INDEX vacation_leaves_period_idx ON vacation_leaves(period_id, start_date);
CREATE INDEX vacation_leaves_employee_idx ON vacation_leaves(employee_id, start_date);
CREATE UNIQUE INDEX vacation_leaves_active_dates_idx ON vacation_leaves(employee_id, start_date, end_date) WHERE status <> 'cancelada';

CREATE TABLE vacation_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  period_id UUID,
  entity_type VARCHAR(20) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(30) NOT NULL,
  reason TEXT,
  before_data JSONB,
  after_data JSONB,
  actor_id UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (period_id, employee_id) REFERENCES vacation_periods(id, employee_id)
);
CREATE INDEX vacation_audit_employee_idx ON vacation_audit(employee_id, created_at DESC);

INSERT INTO permissions (code, name, description, group_name) VALUES
  ('vacations.view', 'Ver férias', 'Consultar períodos, faltas e férias.', 'Administrativo'),
  ('vacations.absences.create', 'Lançar faltas', 'Registrar faltas.', 'Administrativo'),
  ('vacations.absences.edit', 'Editar faltas', 'Corrigir faltas.', 'Administrativo'),
  ('vacations.schedule', 'Programar férias', 'Criar programação de férias.', 'Administrativo'),
  ('vacations.confirm', 'Confirmar férias gozadas', 'Dar baixa em férias.', 'Administrativo'),
  ('vacations.correct', 'Corrigir férias', 'Corrigir ou cancelar lançamentos.', 'Administrativo'),
  ('vacations.review', 'Conferir períodos históricos', 'Confirmar histórico de férias.', 'Administrativo'),
  ('vacations.confirmed.correct', 'Corrigir baixa confirmada', 'Corrigir ou cancelar baixa confirmada.', 'Administrativo')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.slug = 'admin' AND p.code LIKE 'vacations.%'
ON CONFLICT DO NOTHING;
