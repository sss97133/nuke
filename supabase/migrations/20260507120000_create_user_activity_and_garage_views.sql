-- 20260507120000_create_user_activity_and_garage_views.sql
--
-- Purpose: ship the substrate for "what did I do today / this month / this year"
-- views in Nuke. Three read-only views over existing testimony tables.
--
-- v_user_daily_activity   - per-day, per-user, per-vehicle activity row (UNION
--                           across images, observations, events, comments,
--                           receipts, reattributions). One row per source event.
-- v_garage_asset_summary  - one row per (user, vehicle) lifetime ledger.
-- v_user_monthly_summary  - month roll-up of v_user_daily_activity.
--
-- Read-only views; no testimony violation risk. Per-leg user_id filter is
-- pushed inside each UNION leg so `WHERE user_id = '...'` is sargable per
-- the relevant index (vehicle_images.user_id, vehicles.user_id, etc.).
--
-- Note: payment_events table does NOT exist (only irs_payments,
-- payment_card_attribution, payment_processors, work_order_payments). The
-- "payment" leg is omitted; can be added later if/when payment_events lands.

-- ---------------------------------------------------------------------------
-- VIEW 1: v_user_daily_activity
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_user_daily_activity AS
SELECT
  COALESCE(vi.user_id, v.user_id)                                       AS user_id,
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
WHERE vi.vehicle_id IS NOT NULL
  AND COALESCE(vi.taken_at, vi.created_at) IS NOT NULL
  AND COALESCE(vi.is_duplicate, false) = false
  AND COALESCE(vi.is_superseded, false) = false

UNION ALL

SELECT
  COALESCE(vo.submitted_by_user_id, v.user_id)                          AS user_id,
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
LEFT JOIN public.vehicles v ON v.id = vo.vehicle_id
WHERE vo.vehicle_id IS NOT NULL
  AND vo.observed_at IS NOT NULL
  AND COALESCE(vo.is_superseded, false) = false

UNION ALL

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
FROM public.vehicle_events ve
JOIN public.vehicles v ON v.id = ve.vehicle_id
WHERE v.user_id IS NOT NULL
  AND COALESCE(ve.sold_at, ve.ended_at, ve.started_at) IS NOT NULL

UNION ALL

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
FROM public.auction_comments ac
JOIN public.vehicles v ON v.id = ac.vehicle_id
WHERE v.user_id IS NOT NULL
  AND ac.posted_at IS NOT NULL

UNION ALL

SELECT
  COALESCE(r.user_id, r.created_by, v.user_id)                          AS user_id,
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
LEFT JOIN public.vehicles v ON v.id = r.vehicle_id
WHERE COALESCE(r.is_active, true) = true
  AND COALESCE(r.purchase_date, r.transaction_date, r.receipt_date,
               r.created_at::date) IS NOT NULL

UNION ALL

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
  'Per-day, per-user, per-vehicle activity feed. UNION across vehicle_images, vehicle_observations, vehicle_events, auction_comments, receipts, reattribution_audit. Filter on user_id is pushed into each leg so it is sargable.';

-- ---------------------------------------------------------------------------
-- VIEW 2: v_garage_asset_summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_garage_asset_summary AS
WITH
  photo_stats AS (
    SELECT
      vi.vehicle_id,
      COUNT(*)                          AS photo_count,
      MIN(COALESCE(vi.taken_at, vi.created_at))::date AS first_photo_at,
      MAX(COALESCE(vi.taken_at, vi.created_at))       AS last_photo_at
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id IS NOT NULL
      AND COALESCE(vi.is_duplicate, false) = false
      AND COALESCE(vi.is_superseded, false) = false
    GROUP BY vi.vehicle_id
  ),
  observation_stats AS (
    SELECT
      vo.vehicle_id,
      COUNT(*)                          AS observation_count,
      MAX(vo.observed_at)               AS last_observation_at,
      MAX((vo.structured_data->>'purchase_price')::numeric)
        FILTER (WHERE vo.kind::text IN ('ownership','provenance')
                  AND (vo.structured_data ? 'purchase_price')) AS observed_purchase_price,
      MAX((vo.structured_data->>'value_usd')::numeric)
        FILTER (WHERE vo.kind::text IN ('valuation','market_value')
                  AND (vo.structured_data ? 'value_usd')) AS observed_valuation,
      MAX((vo.structured_data->>'amount_usd')::numeric)
        FILTER (WHERE vo.kind::text = 'sale_result'
                  AND (vo.structured_data ? 'amount_usd')) AS observed_sale_amount,
      MIN(vo.observed_at) FILTER (WHERE vo.kind::text = 'ownership') AS first_ownership_at
    FROM public.vehicle_observations vo
    WHERE vo.vehicle_id IS NOT NULL
      AND COALESCE(vo.is_superseded, false) = false
    GROUP BY vo.vehicle_id
  ),
  receipt_stats AS (
    SELECT
      r.vehicle_id,
      COUNT(*)                          AS receipt_count,
      SUM(COALESCE(r.total, r.total_amount, r.subtotal)) AS total_receipts_usd,
      MIN(COALESCE(r.purchase_date, r.transaction_date, r.receipt_date)) AS first_receipt_at,
      MAX(COALESCE(r.purchase_date::timestamptz,
                   r.transaction_date::timestamptz,
                   r.receipt_date::timestamptz,
                   r.created_at)) AS last_receipt_at
    FROM public.receipts r
    WHERE r.vehicle_id IS NOT NULL
      AND COALESCE(r.is_active, true) = true
    GROUP BY r.vehicle_id
  ),
  event_stats AS (
    SELECT
      ve.vehicle_id,
      MAX(ve.final_price) FILTER (WHERE ve.event_status = 'sold') AS final_sale_price,
      MAX(ve.sold_at)     FILTER (WHERE ve.event_status = 'sold') AS sold_at,
      MAX(COALESCE(ve.sold_at, ve.ended_at, ve.started_at))       AS last_event_at,
      BOOL_OR(ve.event_status = 'sold')                           AS has_sale
    FROM public.vehicle_events ve
    WHERE ve.vehicle_id IS NOT NULL
    GROUP BY ve.vehicle_id
  ),
  combined AS (
    SELECT
      v.user_id,
      v.id                          AS vehicle_id,
      v.year, v.make, v.model, v.vin, v.color,
      LEAST(
        ps.first_photo_at,
        os.first_ownership_at::date,
        rs.first_receipt_at
      )                             AS acquired_at,
      es.sold_at::date              AS disposed_at,
      COALESCE(ps.photo_count, 0)        AS photo_count,
      COALESCE(os.observation_count, 0)  AS observation_count,
      COALESCE(rs.receipt_count, 0)      AS receipt_count,
      COALESCE(rs.total_receipts_usd, 0) AS total_receipts_usd,
      COALESCE(os.observed_purchase_price, v.purchase_price)       AS acquisition_cost_usd,
      COALESCE(es.final_sale_price, os.observed_sale_amount,
               v.bat_sold_price, v.canonical_sold_price, v.sold_price) AS sale_proceeds_usd,
      COALESCE(v.nuke_estimate, v.cz_estimated_value, v.current_value,
               os.observed_valuation)                              AS estimated_current_value_usd,
      GREATEST(
        ps.last_photo_at,
        os.last_observation_at,
        rs.last_receipt_at,
        es.last_event_at
      )                                                            AS last_activity_at
    FROM public.vehicles v
    LEFT JOIN photo_stats       ps ON ps.vehicle_id = v.id
    LEFT JOIN observation_stats os ON os.vehicle_id = v.id
    LEFT JOIN receipt_stats     rs ON rs.vehicle_id = v.id
    LEFT JOIN event_stats       es ON es.vehicle_id = v.id
    WHERE v.user_id IS NOT NULL
  )
SELECT
  c.user_id,
  c.vehicle_id,
  c.year, c.make, c.model, c.vin, c.color,
  c.acquired_at,
  c.disposed_at,
  CASE
    WHEN c.acquired_at IS NULL THEN NULL
    ELSE (COALESCE(c.disposed_at, CURRENT_DATE) - c.acquired_at)::int
  END                                                        AS days_held,
  c.photo_count,
  c.observation_count,
  c.receipt_count,
  c.total_receipts_usd,
  c.acquisition_cost_usd,
  c.sale_proceeds_usd,
  c.estimated_current_value_usd,
  CASE
    WHEN c.disposed_at IS NOT NULL
      THEN COALESCE(c.sale_proceeds_usd, 0) - COALESCE(c.total_receipts_usd, 0)
    ELSE COALESCE(c.estimated_current_value_usd, 0) - COALESCE(c.total_receipts_usd, 0)
  END                                                        AS net_position_usd,
  c.last_activity_at
FROM combined c;

COMMENT ON VIEW public.v_garage_asset_summary IS
  'One row per (user_id, vehicle_id). Lifetime ledger: photos, observations, receipts, sale proceeds, estimated value, days held, net position.';

-- ---------------------------------------------------------------------------
-- VIEW 3: v_user_monthly_summary
-- ---------------------------------------------------------------------------
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

COMMENT ON VIEW public.v_user_monthly_summary IS
  'Month roll-up of v_user_daily_activity. One row per (user_id, month).';

GRANT SELECT ON public.v_user_daily_activity   TO anon, authenticated, service_role;
GRANT SELECT ON public.v_garage_asset_summary  TO anon, authenticated, service_role;
GRANT SELECT ON public.v_user_monthly_summary  TO anon, authenticated, service_role;
