-- Instagram Connect substrate (Meta app "Nuke Connect" 1025281197031266, edge fn instagram-connect)
-- Justification: new platform capability (orgs OAuth their IG; feed cached + mirrored for org profiles).
-- ONE new table (org_instagram_media = purgeable feed cache, NOT testimony — Meta Platform Terms
-- require hard deletion on disconnect). Everything else extends existing organs:
-- concierge_partner_connections gains channel 'instagram' + status 'expired'; storage reuses
-- the existing public 'concierge-media' bucket; tokens live in Vault behind service-role-only RPCs.

-- 1) channel + status enums (CHECK constraints) — add instagram / expired
ALTER TABLE concierge_partner_connections DROP CONSTRAINT IF EXISTS concierge_partner_connections_channel_check;
ALTER TABLE concierge_partner_connections ADD CONSTRAINT concierge_partner_connections_channel_check
  CHECK (channel = ANY (ARRAY['shopify','square','lightspeed','woocommerce','csv','manual','api','instagram']));

ALTER TABLE concierge_partner_connections DROP CONSTRAINT IF EXISTS concierge_partner_connections_status_check;
ALTER TABLE concierge_partner_connections ADD CONSTRAINT concierge_partner_connections_status_check
  CHECK (status = ANY (ARRAY['invited','connected','syncing','error','revoked','expired']));

-- 2) feed cache table
CREATE TABLE IF NOT EXISTS org_instagram_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  connection_id UUID NOT NULL REFERENCES concierge_partner_connections(id),
  ig_media_id TEXT NOT NULL UNIQUE,
  media_type TEXT,                 -- IMAGE | VIDEO | CAROUSEL_ALBUM
  caption TEXT,
  permalink TEXT,                  -- the explicit way OUT to instagram
  taken_at TIMESTAMPTZ,
  storage_path TEXT,               -- mirrored binary in concierge-media bucket (never hotlink IG CDN)
  thumb_path TEXT,
  raw JSONB DEFAULT '{}'::jsonb,   -- source DNA: (source, method, observed_at, trust)
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ           -- post deleted on IG -> hidden here (rows purge fully on disconnect)
);

CREATE INDEX IF NOT EXISTS idx_org_ig_media_org_taken ON org_instagram_media(org_id, taken_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_org_ig_media_connection ON org_instagram_media(connection_id);

ALTER TABLE org_instagram_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read live org instagram media" ON org_instagram_media;
CREATE POLICY "Public read live org instagram media" ON org_instagram_media
  FOR SELECT USING (deleted_at IS NULL);
-- writes: service role only (edge fn) — no anon/authenticated write policies on purpose.

COMMENT ON TABLE org_instagram_media IS 'Cache of a connected org''s own Instagram feed (instagram-connect edge fn). Purgeable on disconnect per Meta Platform Terms — NOT testimony.';

-- 3) Vault wrappers (vault schema is not PostgREST-exposed; service-role-only SECURITY DEFINER)
CREATE OR REPLACE FUNCTION ig_vault_store(p_name TEXT, p_secret TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE v_id UUID;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT vault.create_secret(p_secret, p_name || ':' || gen_random_uuid()::text) INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION ig_vault_read(p_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE v_secret TEXT;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = p_id;
  RETURN v_secret;
END; $$;

CREATE OR REPLACE FUNCTION ig_vault_delete(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  DELETE FROM vault.secrets WHERE id = p_id;
END; $$;

REVOKE ALL ON FUNCTION ig_vault_store(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ig_vault_read(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ig_vault_delete(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ig_vault_store(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION ig_vault_read(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION ig_vault_delete(UUID) TO service_role;

-- 4) feed refresh cron (30 min scan; per-connection cadence via next_sync_at, default 6h)
SELECT cron.schedule(
  'instagram-feed-sync',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/instagram-connect/sync',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cron$
);
