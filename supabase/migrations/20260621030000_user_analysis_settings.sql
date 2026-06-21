-- Per-user analysis compute settings + secure credential storage.
-- ============================================================================
-- Lets a user choose, in app Settings, HOW their vehicles get analyzed — instead of
-- editing GitHub secrets/YAML. Supports all three models:
--   nuke_hosted     — platform pays; no credential.
--   byo_api_key     — user's own Anthropic/OpenAI key.
--   byo_subscription— user's own Claude subscription token (claude setup-token).
--
-- SECURITY: credentials NEVER live in this table and are NEVER returned to the client.
-- They go into Supabase Vault (encrypted at rest); the row keeps only a vault secret id
-- + a masked hint. All writes go through SECURITY DEFINER RPCs, so a client cannot set
-- credential_secret_id directly or read a secret back. The runner reads the decrypted
-- value only via a service-role-only RPC.

CREATE TABLE IF NOT EXISTS user_analysis_settings (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  method               text NOT NULL DEFAULT 'nuke_hosted'
                         CHECK (method IN ('nuke_hosted','byo_api_key','byo_subscription')),
  provider             text CHECK (provider IN ('anthropic','openai','google')),
  model                text,
  tier                 text NOT NULL DEFAULT 'free',
  enabled              boolean NOT NULL DEFAULT true,
  credential_secret_id uuid,        -- vault.secrets(id); set ONLY via set_analysis_credential
  credential_hint      text,        -- masked, e.g. '****abcd', for display only
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_analysis_settings ENABLE ROW LEVEL SECURITY;

-- Read-only to the owner (the row holds no secret). No client INSERT/UPDATE/DELETE
-- policy on purpose — every write is a SECURITY DEFINER RPC below.
DROP POLICY IF EXISTS uas_select_own ON user_analysis_settings;
CREATE POLICY uas_select_own ON user_analysis_settings
  FOR SELECT USING (auth.uid() = user_id);

-- Non-credential changes (switch to hosted, change model/tier/enabled).
CREATE OR REPLACE FUNCTION set_analysis_method(
  p_method text, p_model text DEFAULT NULL, p_tier text DEFAULT NULL, p_enabled boolean DEFAULT NULL
) RETURNS user_analysis_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r user_analysis_settings;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_method NOT IN ('nuke_hosted','byo_api_key','byo_subscription') THEN
    RAISE EXCEPTION 'invalid method %', p_method;
  END IF;
  INSERT INTO user_analysis_settings (user_id, method, model, tier, enabled)
    VALUES (auth.uid(), p_method, p_model, COALESCE(p_tier,'free'), COALESCE(p_enabled,true))
  ON CONFLICT (user_id) DO UPDATE SET
    method  = EXCLUDED.method,
    model   = COALESCE(p_model, user_analysis_settings.model),
    tier    = COALESCE(p_tier, user_analysis_settings.tier),
    enabled = COALESCE(p_enabled, user_analysis_settings.enabled),
    updated_at = now()
  RETURNING * INTO r;
  RETURN r;
END $$;

-- Store a BYO credential in Vault; the secret is written here and never read back out
-- to the caller. Returns the row (with only the masked hint).
CREATE OR REPLACE FUNCTION set_analysis_credential(
  p_method text, p_provider text, p_secret text, p_model text DEFAULT NULL
) RETURNS user_analysis_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE r user_analysis_settings; v_id uuid; v_hint text; v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_method NOT IN ('byo_api_key','byo_subscription') THEN
    RAISE EXCEPTION 'credentials only apply to byo_* methods';
  END IF;
  IF p_secret IS NULL OR length(p_secret) < 8 THEN RAISE EXCEPTION 'secret looks invalid'; END IF;
  v_hint := '****' || right(p_secret, 4);
  v_name := 'analysis_cred_' || auth.uid()::text;

  SELECT credential_secret_id INTO v_id FROM user_analysis_settings WHERE user_id = auth.uid();
  IF v_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_id, p_secret, v_name, 'nuke per-user analysis credential');
  ELSE
    v_id := vault.create_secret(p_secret, v_name, 'nuke per-user analysis credential');
  END IF;

  INSERT INTO user_analysis_settings (user_id, method, provider, model, credential_secret_id, credential_hint)
    VALUES (auth.uid(), p_method, p_provider, p_model, v_id, v_hint)
  ON CONFLICT (user_id) DO UPDATE SET
    method = EXCLUDED.method, provider = EXCLUDED.provider,
    model  = COALESCE(p_model, user_analysis_settings.model),
    credential_secret_id = v_id, credential_hint = v_hint, updated_at = now()
  RETURNING * INTO r;
  RETURN r;
END $$;

-- Runner-only: decrypt a user's credential. SECURITY DEFINER, and execute is revoked
-- from anon/authenticated so only the service role (the drain) can call it.
CREATE OR REPLACE FUNCTION get_analysis_credential(p_user_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT ds.decrypted_secret
  FROM user_analysis_settings s
  JOIN vault.decrypted_secrets ds ON ds.id = s.credential_secret_id
  WHERE s.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_analysis_credential(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_analysis_method(text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION set_analysis_credential(text,text,text,text) TO authenticated;

COMMENT ON TABLE user_analysis_settings IS
  'Per-user analysis compute choice (nuke_hosted | byo_api_key | byo_subscription). Credentials live in Vault, not here — only a secret id + masked hint. Writes via set_analysis_method / set_analysis_credential RPCs; runner decrypts via get_analysis_credential (service role only).';
