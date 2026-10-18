-- The outcome layer for classified listings, and the exit model's weights as data.
--
-- Skylar, 2026-10-15: "when a listing is sick af it sells fast ... but not for us. we want to define in code in sql in
-- postgres ... why and factual with citation." A fast exit is the outcome; the why is the listing's position in its
-- family's prices (mv_family_year_prices). This migration keeps both sides in the database so the weights that rank
-- the feed are fitted on recorded exits, versioned, and can be refitted and compared, instead of being typed into code.
--
-- 1. v_classified_exit_outcomes: one row per classified listing whose departure the system can see, with its clocks.
--      facebook_sweep      marketplace_listings: first_seen_at, last_seen_at, removed_at (removal_reason
--                          'not_seen_in_sweep': the listing was missing from a later sweep of the same search).
--      craigslist_revisit  vehicle_events (craigslist): created_at, metadata.last_checked_at, ended_at (a revisit got
--                          HTTP 404 or 410; poll-listing-feeds removal.ts since 2026-10-15).
--    region_code: the listing's state (Facebook "City, ST"; Craigslist the listing's place observation), so days to
--    exit can be read by region (thin demand far from buyers is a slower exit).
--    fate_7d: exited (gone within 7 days of first sight), stayed (gone later, or seen again 7+ days after first sight),
--    unknown (not seen again yet). Gone means the listing ended: withdrawn, expired or sold elsewhere; never a sale.
--    Service role only (marketplace_listings carries seller fields; this view exposes none, but its rows stay private).
-- 2. listing_exit_models: one row per fitted model version: the label, the features with their definitions, means,
--    standard deviations and coefficients, the training and held-out populations with their counts and dates, the
--    held-out AUC and calibration, and the receipt (the study script in the repo). Readers use the active row.
-- Contract: supabase/sql/test_listing_exit_models.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE VIEW public.v_classified_exit_outcomes WITH (security_invoker = true) AS
WITH x AS (
  SELECT 'facebook_sweep'::text AS basis, m.id AS listing_ref, m.vehicle_id, m.price::numeric AS ask,
         upper(substring(m.location FROM ',\s*([A-Za-z]{2})\s*$')) AS region_code,
         m.first_seen_at, greatest(m.last_seen_at, m.first_seen_at) AS last_seen_at,
         CASE WHEN m.removed_at > m.first_seen_at THEN m.removed_at END AS exited_at,
         CASE WHEN m.removed_at > m.first_seen_at THEN coalesce(m.removal_reason, 'removed') END AS exit_evidence
  FROM public.marketplace_listings m
  WHERE m.first_seen_at IS NOT NULL AND coalesce(m.status, '') NOT IN ('duplicate', 'blocked')
  UNION ALL
  SELECT 'craigslist_revisit', e.id, e.vehicle_id, e.current_price,
         (SELECT o.region_code FROM public.vehicle_location_observations o
          WHERE o.vehicle_id = e.vehicle_id AND o.source_type = 'listing' AND o.source_url = e.source_url
          ORDER BY o.observed_at DESC LIMIT 1),
         e.created_at,
         greatest(e.created_at, CASE WHEN e.metadata->>'last_checked_at' ~ '^\d{4}-\d{2}-\d{2}T'
                                     THEN (e.metadata->>'last_checked_at')::timestamptz END),
         CASE WHEN e.event_status = 'ended' AND e.ended_at > e.created_at THEN e.ended_at END,
         CASE WHEN e.event_status = 'ended' AND e.ended_at > e.created_at
              THEN 'http_' || coalesce(e.metadata->'removal'->>'http_status', 'unknown') END
  FROM public.vehicle_events e
  WHERE e.source_platform = 'craigslist' AND e.event_type = 'listing' AND e.created_at >= timestamptz '2026-10-13'
)
SELECT x.*,
  round((extract(epoch FROM coalesce(x.exited_at, x.last_seen_at) - x.first_seen_at) / 86400)::numeric, 2) AS days_observed,
  CASE WHEN x.exited_at IS NOT NULL AND x.exited_at - x.first_seen_at <= interval '7 days' THEN 'exited'
       WHEN x.exited_at IS NOT NULL OR x.last_seen_at - x.first_seen_at >= interval '7 days' THEN 'stayed'
       ELSE 'unknown' END AS fate_7d
FROM x;

REVOKE ALL ON public.v_classified_exit_outcomes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_classified_exit_outcomes TO service_role;
COMMENT ON VIEW public.v_classified_exit_outcomes IS
  'Classified listings whose departure the system can see: facebook_sweep (marketplace_listings first/last seen and '
  'removed_at: missing from a later sweep) and craigslist_revisit (vehicle_events since 2026-10-13: created_at, '
  'metadata.last_checked_at, ended_at on HTTP 404/410), with the listing''s region_code. fate_7d = exited (gone within 7 days of first sight), stayed '
  '(gone later or seen 7+ days on), unknown. Gone = the listing ended, never a sale. Service role only.';

CREATE TABLE IF NOT EXISTS public.listing_exit_models (
  version text PRIMARY KEY,
  active boolean NOT NULL DEFAULT false,
  horizon_days integer NOT NULL CHECK (horizon_days > 0),
  label text NOT NULL,
  intercept double precision NOT NULL,
  features jsonb NOT NULL CHECK (jsonb_typeof(features) = 'array' AND jsonb_array_length(features) > 0),
  base_rate double precision NOT NULL CHECK (base_rate > 0 AND base_rate < 1),
  trained_on jsonb NOT NULL,
  evaluated_on jsonb NOT NULL,
  receipt text NOT NULL,
  trained_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS listing_exit_models_one_active ON public.listing_exit_models (active) WHERE active;
ALTER TABLE public.listing_exit_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS listing_exit_models_read ON public.listing_exit_models;
CREATE POLICY listing_exit_models_read ON public.listing_exit_models FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.listing_exit_models FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.listing_exit_models TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.listing_exit_models TO service_role;
COMMENT ON TABLE public.listing_exit_models IS
  'Fitted exit models for classified listings: one row per version (grain: version), at most one active. A model '
  'predicts the chance a listing is gone within horizon_days of first sight from its position in its family''s prices. '
  'features = [{name, definition, mean, sd, coef}] on standardized inputs; base_rate = the training exit rate; '
  'trained_on / evaluated_on = populations, counts, dates, held-out AUC and calibration; receipt = the study script. '
  'Written only by migrations; read by classified_ask_board.';
COMMENT ON COLUMN public.listing_exit_models.label IS
  'What the model predicts, in words (the outcome definition the coefficients were fitted to). Unit: none.';
COMMENT ON COLUMN public.listing_exit_models.features IS
  'Array of {name, definition, mean, sd, coef}: a reader standardizes each input as (value - mean) / sd and sums coef * z '
  'with the intercept; the chance is 1 / (1 + exp(-sum)). Unit: coef per standard deviation.';

COMMIT;
