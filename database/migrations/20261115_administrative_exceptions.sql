CREATE TABLE administrative_master_secret (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  password_hash TEXT
);
INSERT INTO administrative_master_secret DEFAULT VALUES;

CREATE TABLE administrative_master_attempts (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0
);
INSERT INTO administrative_master_attempts DEFAULT VALUES;

ALTER TABLE vacation_leaves ADD COLUMN historical_start_irregularity TEXT;

CREATE TABLE administrative_exception_uses (
  id UUID PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
