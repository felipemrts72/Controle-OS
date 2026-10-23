ALTER TABLE vacation_periods
  ADD COLUMN historical_entitlement INTEGER
  CHECK (historical_entitlement BETWEEN 0 AND 30);
