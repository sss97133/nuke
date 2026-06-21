-- 20260524_user_observations.sql
-- Per schema_proposal_user_observations.json (2026-05-23 user-profile mining job).
-- Anchors purchase-pattern observations to auth.users instead of vehicles.
-- Buying-history findings span vehicles, are about the BUYER not the asset.
--
-- Hard Rule #2 justification: vehicle_observations.vehicle_id is NOT NULL;
-- the mining job produced ~830 user-anchored observations with no natural vehicle.
-- Forcing them onto a vehicle creates fake attribution. Storing as files breaks
-- queryability and violates Skylar's 2026-05-23 directive: substrate must be DB.
--
-- The `visibility` column is added beyond the original proposal per Skylar's
-- 2026-05-23 privacy/display permission model: per-observation role gating
-- baked in as first-class, not bolted on later.

CREATE TYPE user_observation_kind AS ENUM (
  'vendor_preference',
  'brand_preference',
  'purchase_cadence',
  'shipping_address_pattern',
  'payment_method_pattern',
  'vehicle_attribution_inferred',
  'tool_owned',
  'counterparty_relationship',
  'spending_pattern',
  'category_breakdown'
);

CREATE TABLE user_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind user_observation_kind NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  ingested_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('qb_transactions','apple_cash','apple_mail','receipt_ocr','imessage','photos_metadata','manual')),
  source_url text,
  source_identifier text,
  raw_source_ref text,
  method text NOT NULL,
  trust text NOT NULL CHECK (trust IN ('T1','T2','T3','T4')),
  confidence_score numeric CHECK (confidence_score >= 0 AND confidence_score <= 1),
  confidence_factors jsonb,
  content_text text,
  content_hash text,
  structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_url text,
  evidence_file_path text,
  is_superseded boolean DEFAULT false,
  superseded_by uuid REFERENCES user_observations(id),
  superseded_at timestamptz,
  needs text,
  flags jsonb DEFAULT '{}'::jsonb,
  vehicle_attribution_candidates uuid[],
  related_observation_ids uuid[],
  possible_duplicate_of uuid REFERENCES user_observations(id),
  visibility text[] NOT NULL DEFAULT ARRAY['owner']
);

CREATE INDEX idx_user_obs_user_kind ON user_observations(user_id, kind);
CREATE INDEX idx_user_obs_source ON user_observations(source, observed_at DESC);
CREATE INDEX idx_user_obs_structured ON user_observations USING gin(structured_data);
CREATE INDEX idx_user_obs_not_superseded ON user_observations(user_id) WHERE NOT is_superseded;
CREATE INDEX idx_user_obs_visibility ON user_observations USING gin(visibility);

COMMENT ON TABLE user_observations IS 'Testimony store for observations about a USER (buying patterns, vendor preferences, tools owned, counterparty relationships). Mirrors vehicle_observations shape so cross-querying is trivial. Anchored to auth.users.id.';
COMMENT ON COLUMN user_observations.visibility IS 'Role-gated display visibility. Array of role tags (owner, shop_team, family, tax_view, public, etc.) that can see this observation on display surfaces. Calculation/agent layer reads regardless. Per Skylar 2026-05-23 privacy model.';
