-- Rate limiting infrastructure for public edge functions.
-- Uses fixed-window counters (per IP, per function, per time window).
-- Deployed: 2026-02-26

CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT        PRIMARY KEY,
  count      INT         NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for periodic cleanup of expired rows
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON rate_limits (expires_at);

-- No RLS needed — only accessible via service role in edge functions
-- (table is in public schema but never exposed via anon/user role)

-- Atomic increment with upsert — returns the new count.
-- Called from edge functions with service role key.
CREATE OR REPLACE FUNCTION rate_limit_increment(
  p_key         TEXT,
  p_window_start TIMESTAMPTZ,
  p_expires_at  TIMESTAMPTZ
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO rate_limits (key, count, window_start, expires_at, updated_at)
  VALUES (p_key, 1, p_window_start, p_expires_at, NOW())
  ON CONFLICT (key) DO UPDATE
    SET count      = rate_limits.count + 1,
        updated_at = NOW()
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;

-- Cleanup function — call periodically (e.g. from a cron or 1% of requests)
CREATE OR REPLACE FUNCTION rate_limits_cleanup()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM rate_limits WHERE expires_at < NOW() - INTERVAL '5 minutes';
$$;
