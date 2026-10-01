-- Drift capture: concierge partner pipe + asset_observations
--
-- These objects were applied directly to the live database (project
-- qkgaybvrernstplzjaam) and exist in NO migration. This file brings the repo
-- back in sync with prod per the Drift Repair standing task in
-- .claude/rules/production-engineering.md ("commit its definition").
--
-- Captured from prod 2026-07-03 via pg_catalog (columns, constraints, indexes,
-- RLS). Every statement is guarded (IF NOT EXISTS / DO block) so applying this
-- against prod is a safe no-op, while a fresh/branch database gets the real
-- schema. Depends on public.assets and public.organizations already existing.
--
-- Security posture as captured: RLS is ENABLED with NO policies on all four
-- tables (deny-all except service_role). Explicit org-scoped policies are a
-- deliberate follow-up (see docs/partner-onboarding.md) — do not "fix" this by
-- opening the tables up without designing the policies.

-- ---------------------------------------------------------------------------
-- concierge_partner_connections: one row per partner integration (org + channel)
-- mandate: what the partner authorized us to do with their data
-- access_tier_default: default visibility of ingested data
-- consent: structured consent record (jsonb)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.concierge_partner_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id),
  channel               text NOT NULL
                          CHECK (channel = ANY (ARRAY['shopify','square','lightspeed','woocommerce','csv','manual','api'])),
  endpoint              text,
  credential_secret_id  uuid,
  mandate               text NOT NULL DEFAULT 'display'
                          CHECK (mandate = ANY (ARRAY['display','quote','sell'])),
  access_tier_default   text NOT NULL DEFAULT 'public'
                          CHECK (access_tier_default = ANY (ARRAY['public','member','gated'])),
  consent               jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                text NOT NULL DEFAULT 'invited'
                          CHECK (status = ANY (ARRAY['invited','connected','syncing','error','revoked'])),
  sync_interval_minutes integer NOT NULL DEFAULT 1440,
  last_sync_at          timestamptz,
  next_sync_at          timestamptz,
  last_sync_count       integer,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, channel)
);

CREATE INDEX IF NOT EXISTS concierge_partner_connections_due_idx
  ON public.concierge_partner_connections (next_sync_at)
  WHERE status = ANY (ARRAY['connected','syncing','error']);

-- ---------------------------------------------------------------------------
-- concierge_partner_invitations: email/token invites that redeem into a connection
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.concierge_partner_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id),
  token_hash    text NOT NULL UNIQUE,
  channel_scope text[] NOT NULL DEFAULT ARRAY['shopify','instagram'],
  contact       jsonb NOT NULL DEFAULT '{}'::jsonb,
  note          text,
  created_by    text NOT NULL DEFAULT 'house',
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  used_at       timestamptz,
  revoked_at    timestamptz,
  redeemed_ip   inet,
  connection_id uuid REFERENCES public.concierge_partner_connections(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS concierge_partner_invitations_org_idx
  ON public.concierge_partner_invitations (org_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- concierge_partner_sync_runs: telemetry per sync (the throughput pulse)
-- items_seen vs items_landed = the funnel; items_superseded = observation churn
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.concierge_partner_sync_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    uuid NOT NULL REFERENCES public.concierge_partner_connections(id),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  ok               boolean,
  items_seen       integer NOT NULL DEFAULT 0,
  items_landed     integer NOT NULL DEFAULT 0,
  items_superseded integer NOT NULL DEFAULT 0,
  error            text
);

CREATE INDEX IF NOT EXISTS concierge_partner_sync_runs_conn_idx
  ON public.concierge_partner_sync_runs (connection_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- asset_observations: the polymorphic twin of vehicle_observations, keyed on
-- assets(id) rather than vehicle_id. This is the generic observation substrate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asset_observations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  source_id         uuid,
  kind              text NOT NULL,
  observed_at       timestamptz NOT NULL,
  content_text      text,
  structured_data   jsonb DEFAULT '{}'::jsonb,
  content_hash      text NOT NULL,
  confidence        numeric(4,3) DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  source_url        text,
  source_identifier text,
  extraction_method text,
  agent_model       text,
  superseded_by     uuid,
  supersedes        uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_observations_asset
  ON public.asset_observations (asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_observations_hash
  ON public.asset_observations (content_hash);
CREATE INDEX IF NOT EXISTS idx_asset_observations_kind
  ON public.asset_observations (kind);

-- ---------------------------------------------------------------------------
-- RLS: enabled, no policies (deny-all except service_role) — matches prod.
-- Idempotent: ENABLE is harmless if already enabled.
-- ---------------------------------------------------------------------------
ALTER TABLE public.concierge_partner_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_partner_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_partner_sync_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_observations            ENABLE ROW LEVEL SECURITY;
