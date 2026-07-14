-- Migration: 20260507150000_create_payment_events_substrate
-- Justification (Hard Rule #2):
--   No general-purpose payment_events substrate exists. irs_payments is tax-only
--   (no user_id, no direction); work_order_payments is work-order-scoped only.
--   v_user_daily_activity / v_garage_asset_summary surface receipts (money OUT)
--   but cannot expose money-IN events (BaT proceeds, Zelle, ACH from buyers).
--   payment_events is testimony — INSERT-ONLY, never UPDATE/DELETE — matching
--   the agent-trust-invariants.md rule for testimony tables from day one.
-- Safety: pure CREATE; no impact on existing tables.

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount_usd NUMERIC(14,2) NOT NULL CHECK (amount_usd >= 0),
  paid_at TIMESTAMPTZ NOT NULL,
  method TEXT,
  counterparty_name TEXT,
  counterparty_contact_id UUID,
  counterparty_org_id UUID,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('vehicle','org','personal','tax')),
  scope_id UUID,
  description TEXT,
  confirmation_number TEXT,
  source_observation_id UUID,
  source_url TEXT,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_user_paid
  ON payment_events (user_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_scope
  ON payment_events (scope_type, scope_id)
  WHERE scope_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_source_obs
  ON payment_events (source_observation_id)
  WHERE source_observation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_direction_paid
  ON payment_events (user_id, direction, paid_at DESC);

COMMENT ON TABLE payment_events IS
  'Money-in / money-out testimony substrate. Insert-only (never UPDATE/DELETE per agent-trust-invariants.md). Closes the asymmetry where v_user_daily_activity exposed receipts (out) but no payments (in). Supersession: insert correction row, point to original via source_metadata.supersedes_id. Owned by ingest-payment-event edge function (when shipped); direct INSERT allowed for backfills carrying source_metadata.backfilled_at.';

COMMENT ON COLUMN payment_events.direction IS 'in = money landed in user account; out = user paid someone';
COMMENT ON COLUMN payment_events.scope_type IS 'vehicle = scope_id is vehicles.id; org = organizations.id; personal = NULL scope_id; tax = NULL scope_id';
COMMENT ON COLUMN payment_events.method IS 'zelle | wire | ach | bat_payout | venmo | cashier_check | check | cash | card | crypto | other';
COMMENT ON COLUMN payment_events.source_observation_id IS 'When backfilled from vehicle_observations, the source obs.id. Always set on backfilled rows.';
COMMENT ON COLUMN payment_events.source_metadata IS 'Provenance envelope. backfill rows MUST carry {backfilled_at, source, observation_kind}.';

-- Register in pipeline_registry so future writes flow through ingest-payment-event
INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
  ('payment_events', NULL, 'ingest-payment-event (planned)',
   'Money-in/out testimony. Insert-only. Backfills from observations allowed when source_metadata.backfilled_at set. Future intake edge function: ingest-payment-event.',
   false, 'ingest-payment-event edge function (planned) or direct INSERT for backfill'),
  ('payment_events', 'direction', 'ingest-payment-event (planned)',
   'in or out — never null, never updated.', true, 'ingest-payment-event'),
  ('payment_events', 'amount_usd', 'ingest-payment-event (planned)',
   'Always non-negative. Direction carries sign.', true, 'ingest-payment-event'),
  ('payment_events', 'source_observation_id', 'ingest-payment-event (planned)',
   'Lineage to vehicle_observations row when backfilled.', true, 'ingest-payment-event')
ON CONFLICT DO NOTHING;
