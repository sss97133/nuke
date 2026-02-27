-- ============================================================================
-- VEHICLE INTELLIGENCE CRON JOBS
-- Filed by VP Vehicle Intel — 2026-02-27
--
-- Addresses gap: compute-vehicle-valuation, batch-vin-decode, batch-ymm-propagate,
-- and analyze-market-signals had NO recurring cron jobs despite being the core
-- scoring/enrichment functions for 1.25M vehicles.
--
-- Coverage as of 2026-02-27:
--   nuke_estimate: 513K / 1.25M (40.9%)
--   VIN candidates needing decode: ~37 in first 50 (pre-2000 vehicles mostly legacy VINs)
--   YMM propagation: 286 factory fields filled in single run
-- ============================================================================

-- ============================================================================
-- 1. NUKE ESTIMATE BACKFILL — compute-vehicle-valuation every 10 minutes
--    Picks up vehicles with year+make set but no nuke_estimate.
--    Max 50 per run (keeps under 10s timeout).
--    ~7K/hour backfill rate.
-- ============================================================================
SELECT cron.unschedule('compute-vehicle-valuation-backfill')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'compute-vehicle-valuation-backfill'
);

SELECT cron.schedule(
  'compute-vehicle-valuation-backfill',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co' || '/functions/v1/compute-vehicle-valuation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := '{"batch_size": 50}'::jsonb
    );
  $$
);

-- ============================================================================
-- 2. VIN DECODE BACKFILL — batch-vin-decode every 30 minutes
--    Picks vehicles with VINs missing horsepower/drivetrain/body_style.
--    Only 37 candidates in first 50 (most are pre-1981 VINs, NHTSA won't decode).
--    Still runs to catch any newly added modern vehicles.
--    Default 50 VINs/run (NHTSA free API).
-- ============================================================================
SELECT cron.unschedule('batch-vin-decode-backfill')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'batch-vin-decode-backfill'
);

SELECT cron.schedule(
  'batch-vin-decode-backfill',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co' || '/functions/v1/batch-vin-decode',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := '{"batch_size": 50}'::jsonb
    );
  $$
);

-- ============================================================================
-- 3. YMM SPEC PROPAGATION — batch-ymm-propagate every 4 hours
--    Copies factory-level specs (hp, drivetrain, body_style, etc.) from
--    well-filled sibling vehicles to sparse ones of the same year/make/model.
--    Single run filled 286 fields across 63 vehicles.
--    Run every 4h (new vehicles from extraction queue constantly arriving).
-- ============================================================================
SELECT cron.unschedule('batch-ymm-propagate-hourly')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'batch-ymm-propagate-hourly'
);

SELECT cron.schedule(
  'batch-ymm-propagate-hourly',
  '0 */4 * * *',
  $$
    SELECT net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co' || '/functions/v1/batch-ymm-propagate',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := '{"batch_size": 500}'::jsonb
    );
  $$
);

-- ============================================================================
-- NOTES ON SIGNAL SCORE
-- signal_score is computed by analyze-market-signals but that function is a
-- reporting/analytics tool, NOT a per-vehicle scoring function. The actual
-- per-vehicle signal scores (deal_score, heat_score) are computed by
-- compute-vehicle-valuation and stored in nuke_estimates + propagated to
-- vehicles.deal_score and vehicles.heat_score.
--
-- api-v1-signal reads from nuke_estimates — so filling nuke_estimates via
-- the cron above (job 1) is the correct fix for signal score coverage.
-- ============================================================================
