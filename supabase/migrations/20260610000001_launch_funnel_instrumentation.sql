-- ============================================================================
-- LAUNCH FUNNEL INSTRUMENTATION
-- Filed: 2026-06-10
--
-- First-party product analytics written to our own DB (no PostHog/GA).
-- The launch funnel — post → land → search → vehicle view → signup/return —
-- must be measurable before any public launch. Events are written by the
-- frontend via anonymous INSERT (RLS insert-only); analysis happens with
-- service-role / SQL. Signups are already measurable via auth.users and
-- vehicle views via vehicle_views — this table covers the anonymous top of
-- funnel: page views, searches, result counts, client errors.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL CHECK (char_length(event) <= 64),
  props JSONB NOT NULL DEFAULT '{}',
  -- Anonymous session key (random uuid in localStorage) — lets us compute
  -- queries-per-visitor and day-2 return without cookies or third parties.
  session_key TEXT CHECK (char_length(session_key) <= 64),
  user_id UUID,
  path TEXT CHECK (char_length(path) <= 512),
  referrer TEXT CHECK (char_length(referrer) <= 512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Funnel queries scan by time and event type
CREATE INDEX IF NOT EXISTS idx_app_events_created ON app_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_event_created ON app_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_session ON app_events (session_key, created_at);

-- Insert-only for clients; nobody reads through PostgREST (service role and
-- SQL bypass RLS for analysis). Payload size is bounded by the CHECKs above.
ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_events_insert_anon ON app_events;
CREATE POLICY app_events_insert_anon ON app_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Retention: keep 90 days. Cheap nightly cron.
SELECT cron.unschedule('app-events-retention')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'app-events-retention');

SELECT cron.schedule(
  'app-events-retention',
  '40 8 * * *',
  $$ DELETE FROM app_events WHERE created_at < now() - interval '90 days'; $$
);
