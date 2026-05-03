-- OAuth 2.0 server tables for Claude.ai (mobile + web) MCP connector.
-- Implements RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), RFC 7591 (DCR), RFC 8414 (metadata),
-- and the MCP authorization spec (2025-03-26).
--
-- Stateless-friendly: access + refresh tokens are HS256-signed JWTs. Only the
-- one-time auth codes and the DCR client registry need DB storage.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. oauth_clients — DCR registry. Claude.ai registers itself; we store the
--    metadata so we can validate redirect_uri on each authorize call.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret_hash TEXT,                    -- nullable for public clients (PKCE-only)
    client_name TEXT NOT NULL,
    redirect_uris TEXT[] NOT NULL,              -- whitelist
    grant_types TEXT[] DEFAULT ARRAY['authorization_code','refresh_token'],
    response_types TEXT[] DEFAULT ARRAY['code'],
    token_endpoint_auth_method TEXT DEFAULT 'none',  -- 'none' = public client (PKCE)
    scope TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_created_at ON oauth_clients(created_at DESC);

ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='oauth_clients' AND policyname='Service role manages oauth_clients') THEN
    CREATE POLICY "Service role manages oauth_clients" ON oauth_clients FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. oauth_authorization_codes — short-lived one-time codes between authorize
--    and token. Stores PKCE challenge so token endpoint can verify the verifier.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code TEXT PRIMARY KEY,                      -- random opaque string
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    scope TEXT,
    code_challenge TEXT NOT NULL,               -- base64url(sha256(verifier))
    code_challenge_method TEXT NOT NULL DEFAULT 'S256',
    expires_at TIMESTAMPTZ NOT NULL,            -- typically NOW() + 10 minutes
    used_at TIMESTAMPTZ,                        -- one-time: token endpoint stamps this
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_authorization_codes(expires_at);

ALTER TABLE oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='oauth_authorization_codes' AND policyname='Service role manages oauth_authorization_codes') THEN
    CREATE POLICY "Service role manages oauth_authorization_codes" ON oauth_authorization_codes FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. oauth_login_sessions — short-lived sessions for the in-flight magic-link
--    login. We can't pass state through Supabase's magic-link redirect cleanly,
--    so we store the in-progress authorize request keyed by a session id that
--    rides along the magic link as a query parameter.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_login_sessions (
    session_id TEXT PRIMARY KEY,                -- random opaque
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    scope TEXT,
    state TEXT,
    code_challenge TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL,
    email TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,            -- typically NOW() + 15 minutes
    completed_at TIMESTAMPTZ,
    user_id UUID,                               -- set by callback
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_login_sessions_expires_at ON oauth_login_sessions(expires_at);

ALTER TABLE oauth_login_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='oauth_login_sessions' AND policyname='Service role manages oauth_login_sessions') THEN
    CREATE POLICY "Service role manages oauth_login_sessions" ON oauth_login_sessions FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup function — call from a cron if the project has one.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.oauth_cleanup_expired()
RETURNS TABLE(deleted_codes INT, deleted_sessions INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c_codes INT; c_sessions INT;
BEGIN
  DELETE FROM oauth_authorization_codes WHERE expires_at < NOW() RETURNING 1 INTO c_codes;
  GET DIAGNOSTICS c_codes = ROW_COUNT;
  DELETE FROM oauth_login_sessions WHERE expires_at < NOW() RETURNING 1 INTO c_sessions;
  GET DIAGNOSTICS c_sessions = ROW_COUNT;
  RETURN QUERY SELECT c_codes, c_sessions;
END;
$$;

GRANT EXECUTE ON FUNCTION public.oauth_cleanup_expired() TO service_role;

COMMENT ON TABLE oauth_clients IS 'OAuth 2.0 dynamically-registered clients (RFC 7591). Claude.ai self-registers via /oauth/register.';
COMMENT ON TABLE oauth_authorization_codes IS 'Short-lived one-time codes between /oauth/authorize and /oauth/token. PKCE-bound.';
COMMENT ON TABLE oauth_login_sessions IS 'Magic-link login sessions in-flight during /oauth/authorize.';
