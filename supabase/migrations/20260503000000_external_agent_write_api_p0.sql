-- External Agent Write API — P0 unblock migration
-- Lands the prerequisites for the /v1/events public agent-write surface.
-- See docs/external-agent-write-api.md and .claude/plans/humble-drifting-backus.md.
--
-- Components:
--   1. api_keys table — already exists in prod (applied via database/migrations/20260201_api_keys_table.sql).
--      This migration is the canonical source-of-truth in supabase/migrations/ going forward.
--      All statements use IF NOT EXISTS so re-running is idempotent.
--   2. api_usage_logs table — referenced by apiKeyAuth.ts but not yet created in prod.
--   3. check_api_key_rate_limit(text) RPC — referenced by _shared/apiKeyAuth.ts but undefined.
--   4. observation_sources rows for `shop` (service work) and `agent-submission` (catch-all
--      for external-agent writes that don't fit a more specific source).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. api_keys (idempotent — table already exists in prod)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    scopes TEXT[] DEFAULT ARRAY['read', 'write'],
    is_active BOOLEAN DEFAULT true,
    rate_limit_per_hour INTEGER DEFAULT 1000,
    rate_limit_remaining INTEGER DEFAULT 1000,
    rate_limit_reset_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT api_keys_name_length CHECK (char_length(name) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active) WHERE is_active = true;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='api_keys' AND policyname='Users can view own API keys') THEN
    CREATE POLICY "Users can view own API keys" ON api_keys FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='api_keys' AND policyname='Users can create own API keys') THEN
    CREATE POLICY "Users can create own API keys" ON api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='api_keys' AND policyname='Users can update own API keys') THEN
    CREATE POLICY "Users can update own API keys" ON api_keys FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='api_keys' AND policyname='Users can delete own API keys') THEN
    CREATE POLICY "Users can delete own API keys" ON api_keys FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. api_usage_logs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_id TEXT,
    request_method TEXT,
    request_path TEXT,
    response_status INTEGER,
    response_time_ms INTEGER,
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_logs_user_id ON api_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_timestamp ON api_usage_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_resource ON api_usage_logs(resource, action);

ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='api_usage_logs' AND policyname='Users can view own usage logs') THEN
    CREATE POLICY "Users can view own usage logs" ON api_usage_logs FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='api_usage_logs' AND policyname='Service role can insert usage logs') THEN
    CREATE POLICY "Service role can insert usage logs" ON api_usage_logs FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. check_api_key_rate_limit RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic: validates the key by hash, checks active+expiry, decrements
-- rate_limit_remaining, returns {allowed, remaining, reset_at, scopes, user_id, key_id}.
-- Called from supabase/functions/_shared/apiKeyAuth.ts.

CREATE OR REPLACE FUNCTION public.check_api_key_rate_limit(p_key_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key   RECORD;
  v_now   TIMESTAMPTZ := NOW();
  v_reset TIMESTAMPTZ;
BEGIN
  SELECT id, user_id, scopes, is_active, rate_limit_per_hour,
         rate_limit_remaining, rate_limit_reset_at, expires_at
    INTO v_key
    FROM api_keys
   WHERE key_hash = p_key_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'key_not_found');
  END IF;

  IF NOT v_key.is_active THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'key_inactive');
  END IF;

  IF v_key.expires_at IS NOT NULL AND v_key.expires_at < v_now THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'key_expired');
  END IF;

  -- Window roll-over.
  IF v_key.rate_limit_reset_at IS NULL OR v_key.rate_limit_reset_at < v_now THEN
    v_reset := v_now + INTERVAL '1 hour';
    UPDATE api_keys
       SET rate_limit_remaining = GREATEST(rate_limit_per_hour - 1, 0),
           rate_limit_reset_at  = v_reset,
           last_used_at         = v_now
     WHERE id = v_key.id;
    RETURN jsonb_build_object(
      'allowed',   true,
      'remaining', GREATEST(v_key.rate_limit_per_hour - 1, 0),
      'reset_at',  v_reset,
      'scopes',    v_key.scopes,
      'user_id',   v_key.user_id,
      'key_id',    v_key.id
    );
  END IF;

  -- Within window.
  IF v_key.rate_limit_remaining <= 0 THEN
    RETURN jsonb_build_object(
      'allowed',   false,
      'reason',    'rate_limited',
      'reset_at',  v_key.rate_limit_reset_at,
      'remaining', 0
    );
  END IF;

  UPDATE api_keys
     SET rate_limit_remaining = rate_limit_remaining - 1,
         last_used_at         = v_now
   WHERE id = v_key.id;

  RETURN jsonb_build_object(
    'allowed',   true,
    'remaining', v_key.rate_limit_remaining - 1,
    'reset_at',  v_key.rate_limit_reset_at,
    'scopes',    v_key.scopes,
    'user_id',   v_key.user_id,
    'key_id',    v_key.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_api_key_rate_limit(TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.check_api_key_rate_limit(TEXT) IS
  'Atomic rate-limit check + decrement for X-API-Key auth. Called from _shared/apiKeyAuth.ts. Returns {allowed, remaining, reset_at, scopes, user_id, key_id} or {allowed:false, reason}.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. observation_sources for external-agent writes
-- ─────────────────────────────────────────────────────────────────────────────
-- `shop` carries service/work_record observations from physical work sessions.
-- `agent-submission` is the generic external-agent intake source — used by
--    /v1/events when the caller does not specify a more specific source.

INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES
  ('shop', 'Shop / Service Work', 'shop', 0.85,
    ARRAY['work_record','condition','specification','media','comment']::observation_kind[]),
  ('agent-submission', 'External Agent Submission', 'agent', 0.55,
    ARRAY['work_record','condition','specification','media','comment','expert_opinion','sighting']::observation_kind[])
ON CONFLICT (slug) DO NOTHING;

-- Done.
