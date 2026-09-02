-- Additive: existing authorizations and audit history remain untouched.
ALTER TABLE advance_list_items
  ADD COLUMN IF NOT EXISTS limit_review_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS limit_review_rejected_by UUID REFERENCES users(id);
