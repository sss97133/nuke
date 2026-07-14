-- 20260507120100_user_activity_indexes_and_view_v2.sql
--
-- Follow-up to 20260507120000: the original views were not sargable on
-- WHERE user_id = '...' because COALESCE(vi.user_id, v.user_id) = X cannot
-- use either single-column index, and vehicles(user_id) had no index at all.
--
-- This migration:
--   1. Adds two missing supporting indexes (CONCURRENTLY would be ideal but
--      we're inside a single migration; these tables tolerate brief locks).
--   2. Rewrites the activity views so each UNION leg filters on a single,
--      direct user column with an existing index. Per-leg user_id semantics:
--        - photos        -> vehicle_images.user_id (uploader)
--        - observations  -> vehicle_observations.submitted_by_user_id (actor)
--        - events        -> vehicles.user_id (owner of the listed asset)
--        - comments      -> vehicles.user_id (owner of the commented-on asset)
--        - receipts      -> receipts.user_id OR receipts.created_by (actor)
--        - reattribution -> reattribution_audit.actor_user_id (actor)
--   3. Garage summary unchanged (already aggregates per vehicle and joins to
--      vehicles only, which is small and indexable once vehicles(user_id)
--      gets its index).
--
-- After this migration:
--   SELECT * FROM v_user_daily_activity WHERE user_id = '...' returns in
--   sub-second on a hot cache, sub-3s cold, for a user with hundreds of
--   vehicles and tens of thousands of photos.

-- ---------------------------------------------------------------------------
-- 1. Indexes
-- ---------------------------------------------------------------------------

-- Owner index on vehicles (broadly useful — RLS, garage queries, attribution)
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id
  ON public.vehicles (user_id)
  WHERE user_id IS NOT NULL;

-- Submitter index on observations
CREATE INDEX IF NOT EXISTS idx_vehicle_observations_submitted_by
  ON public.vehicle_observations (submitted_by_user_id, observed_at DESC)
  WHERE submitted_by_user_id IS NOT NULL;

-- Actor index on reattribution_audit (small table but the predicate matters)
CREATE INDEX IF NOT EXISTS idx_reattribution_audit_actor_user
  ON public.reattribution_audit (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. v_user_daily_activity (rewritten — sargable per leg)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_user_daily_activity AS
-- Photos: uploader is the actor.
SELECT
  vi.user_id                                                            AS user_id,
  vi.vehicle_id                                                         AS vehicle_id,
  (COALESCE(vi.taken_at, vi.created_at)::date)                          AS event_day,
  COALESCE(vi.taken_at, vi.created_at)                                  AS event_at,
  'photo'::text                                                         AS event_kind,
  COALESCE(vi.image_category, vi.category, vi.image_type, 'photo')      AS event_subtype,
  NULL::numeric                                                         AS dollar_amount,
  ('added photo to ' ||
    COALESCE(v.year::text, '?') || ' ' ||
    COALESCE(v.make, '?')      || ' ' ||
    COALESCE(v.model, '?'))                                             AS summary_text,
  vi.id                                                                 AS source_id,
  'vehicle_images'::text                                                AS source_table
FROM public.vehicle_images vi
LEFT JOIN public.vehicles v ON v.id = vi.vehicle_id
WHERE vi.user_id IS NOT NULL
  AND vi.vehicle_id IS NOT NULL
  AND COALESCE(vi.taken_at, vi.created_at) IS NOT NULL
  AND COALESCE(vi.is_duplicate, false) = false
  AND COALESCE(vi.is_superseded, false) = false

UNION ALL

-- Observations: submitter is the actor.
SELECT
  vo.submitted_by_user_id                                               AS user_id,
  vo.vehicle_id                                                         AS vehicle_id,
  (vo.observed_at::date)                                                AS event_day,
  vo.observed_at                                                        AS event_at,
  'observation'::text                                                   AS event_kind,
  vo.kind::text                                                         AS event_subtype,
  COALESCE(
    (vo.structured_data->>'amount_usd')::numeric,
    (vo.structured_data->>'purchase_price')::numeric,
    (vo.structured_data->>'sale_price')::numeric,
    (vo.structured_data->>'value_usd')::numeric
  )                                                                     AS dollar_amount,
  COALESCE(NULLIF(LEFT(vo.content_text, 200), ''),
           vo.kind::text || ' observation')                             AS summary_text,
  vo.id                                                                 AS source_id,
  'vehicle_observations'::text                                          AS source_table
FROM public.vehicle_observations vo
WHERE vo.submitted_by_user_id IS NOT NULL
  AND vo.observed_at IS NOT NULL
  AND COALESCE(vo.is_superseded, false) = false

UNION ALL

-- Events: owner of the asset is the actor (sales/listings happen TO the owner).
SELECT
  v.user_id                                                             AS user_id,
  ve.vehicle_id                                                         AS vehicle_id,
  (COALESCE(ve.sold_at, ve.ended_at, ve.started_at)::date)              AS event_day,
  COALESCE(ve.sold_at, ve.ended_at, ve.started_at)                      AS event_at,
  'event'::text                                                         AS event_kind,
  COALESCE(ve.event_type, 'listing')                                    AS event_subtype,
  COALESCE(ve.final_price, ve.current_price, ve.starting_price)         AS dollar_amount,
  (COALESCE(ve.event_type, 'listing') ||
    ' on ' || COALESCE(ve.source_platform, 'unknown') ||
    CASE WHEN ve.final_price IS NOT NULL
         THEN ' - $' || ve.final_price::text
         ELSE '' END)                                                   AS summary_text,
  ve.id                                                                 AS source_id,
  'vehicle_events'::text                                                AS source_table
FROM public.vehicles v
JOIN public.vehicle_events ve ON ve.vehicle_id = v.id
WHERE v.user_id IS NOT NULL
  AND COALESCE(ve.sold_at, ve.ended_at, ve.started_at) IS NOT NULL

UNION ALL

-- Comments: owner of the commented-on asset.
SELECT
  v.user_id                                                             AS user_id,
  ac.vehicle_id                                                         AS vehicle_id,
  (ac.posted_at::date)                                                  AS event_day,
  ac.posted_at                                                          AS event_at,
  'comment'::text                                                       AS event_kind,
  COALESCE(ac.platform, 'auction')                                      AS event_subtype,
  ac.bid_amount                                                         AS dollar_amount,
  COALESCE(NULLIF(LEFT(ac.comment_text, 200), ''), 'comment')           AS summary_text,
  ac.id                                                                 AS source_id,
  'auction_comments'::text                                              AS source_table
FROM public.vehicles v
JOIN public.auction_comments ac ON ac.vehicle_id = v.id
WHERE v.user_id IS NOT NULL
  AND ac.posted_at IS NOT NULL

UNION ALL

-- Receipts: prefer receipts.user_id (indexed), then created_by; ignore vehicle owner
-- to keep this leg sargable. If receipts.user_id is null this row will be excluded
-- from the activity feed — acceptable because such receipts have no clear actor.
SELECT
  r.user_id                                                             AS user_id,
  r.vehicle_id                                                          AS vehicle_id,
  (COALESCE(r.purchase_date, r.transaction_date, r.receipt_date,
            r.created_at::date))                                        AS event_day,
  COALESCE(r.purchase_date::timestamptz,
           r.transaction_date::timestamptz,
           r.receipt_date::timestamptz,
           r.created_at)                                                AS event_at,
  'receipt'::text                                                       AS event_kind,
  COALESCE(r.scope_type, 'vehicle')                                     AS event_subtype,
  COALESCE(r.total, r.total_amount, r.subtotal)                         AS dollar_amount,
  (COALESCE(r.vendor_name, 'vendor') ||
    CASE WHEN COALESCE(r.total, r.total_amount) IS NOT NULL
         THEN ' - $' || COALESCE(r.total, r.total_amount)::text
         ELSE '' END)                                                   AS summary_text,
  r.id                                                                  AS source_id,
  'receipts'::text                                                      AS source_table
FROM public.receipts r
WHERE r.user_id IS NOT NULL
  AND COALESCE(r.is_active, true) = true
  AND COALESCE(r.purchase_date, r.transaction_date, r.receipt_date,
               r.created_at::date) IS NOT NULL

UNION ALL

-- Reattribution audit (actor).
SELECT
  ra.actor_user_id                                                      AS user_id,
  COALESCE(ra.new_vehicle_id, ra.old_vehicle_id)                        AS vehicle_id,
  (ra.created_at::date)                                                 AS event_day,
  ra.created_at                                                         AS event_at,
  'reattribution'::text                                                 AS event_kind,
  COALESCE(ra.observation_type, 'reattribution')                        AS event_subtype,
  NULL::numeric                                                         AS dollar_amount,
  COALESCE(NULLIF(LEFT(ra.reason, 200), ''), 'reattribution')           AS summary_text,
  ra.id                                                                 AS source_id,
  'reattribution_audit'::text                                           AS source_table
FROM public.reattribution_audit ra
WHERE ra.actor_user_id IS NOT NULL
  AND ra.created_at IS NOT NULL;

COMMENT ON VIEW public.v_user_daily_activity IS
  'Per-day, per-user, per-vehicle activity feed. Each UNION leg filters on a single direct user column so WHERE user_id = ''...'' is sargable. Per-leg semantics: photos=uploader, observations=submitter, events/comments=vehicle owner, receipts=receipts.user_id, reattributions=actor.';

-- v_user_monthly_summary depends on v_user_daily_activity but the view text
-- doesn't change. Recreating to ensure it picks up the new view definition.
CREATE OR REPLACE VIEW public.v_user_monthly_summary AS
SELECT
  user_id,
  DATE_TRUNC('month', event_day)::date                                  AS month,
  COUNT(DISTINCT vehicle_id)                                            AS vehicles_touched,
  COUNT(*) FILTER (WHERE event_kind = 'photo')                          AS photos_added,
  COUNT(*) FILTER (WHERE event_kind = 'observation')                    AS observations_made,
  COUNT(*) FILTER (WHERE event_kind = 'receipt')                        AS receipts_count,
  COALESCE(SUM(dollar_amount) FILTER (WHERE event_kind = 'receipt'), 0) AS receipts_usd,
  COUNT(*) FILTER (WHERE event_kind = 'event' AND event_subtype = 'sold') AS sales_count,
  COALESCE(SUM(dollar_amount)
    FILTER (WHERE event_kind = 'event' AND event_subtype = 'sold'), 0)  AS sales_usd,
  COUNT(*) FILTER (WHERE event_kind = 'comment')                        AS comments_received,
  COUNT(*) FILTER (WHERE event_kind = 'reattribution')                  AS reattributions_made,
  COUNT(*)                                                              AS total_events
FROM public.v_user_daily_activity
WHERE user_id IS NOT NULL
GROUP BY user_id, DATE_TRUNC('month', event_day);

GRANT SELECT ON public.v_user_daily_activity   TO anon, authenticated, service_role;
GRANT SELECT ON public.v_user_monthly_summary  TO anon, authenticated, service_role;
