-- Migration: 20260507150100_add_payment_events_to_activity_views
-- Justification:
--   v_user_daily_activity has receipt leg (money OUT) but no payment_events leg (money IN).
--   v_user_monthly_summary aggregates from v_user_daily_activity, so adding a payment leg there
--   automatically gives us payments_in_usd and payments_out_usd in the rollup.
-- Strategy:
--   CREATE OR REPLACE VIEW (no breaking change). All existing leg semantics preserved.
--   Add new UNION ALL leg sourced from payment_events.

CREATE OR REPLACE VIEW v_user_daily_activity AS
 SELECT vi.user_id,
    vi.vehicle_id,
    (COALESCE(vi.taken_at, vi.created_at))::date AS event_day,
    COALESCE(vi.taken_at, vi.created_at) AS event_at,
    'photo'::text AS event_kind,
    COALESCE(vi.image_category, vi.category, vi.image_type, 'photo'::text) AS event_subtype,
    NULL::numeric AS dollar_amount,
    ((((('added photo to '::text || COALESCE((v.year)::text, '?'::text)) || ' '::text) || COALESCE(v.make, '?'::text)) || ' '::text) || COALESCE(v.model, '?'::text)) AS summary_text,
    vi.id AS source_id,
    'vehicle_images'::text AS source_table
   FROM (vehicle_images vi
     LEFT JOIN vehicles v ON ((v.id = vi.vehicle_id)))
  WHERE ((vi.user_id IS NOT NULL) AND (vi.vehicle_id IS NOT NULL) AND (COALESCE(vi.taken_at, vi.created_at) IS NOT NULL) AND (COALESCE(vi.is_duplicate, false) = false) AND (COALESCE(vi.is_superseded, false) = false))
UNION ALL
 SELECT vo.submitted_by_user_id AS user_id,
    vo.vehicle_id,
    (vo.observed_at)::date AS event_day,
    vo.observed_at AS event_at,
    'observation'::text AS event_kind,
    (vo.kind)::text AS event_subtype,
    COALESCE(((vo.structured_data ->> 'amount_usd'::text))::numeric, ((vo.structured_data ->> 'purchase_price'::text))::numeric, ((vo.structured_data ->> 'sale_price'::text))::numeric, ((vo.structured_data ->> 'value_usd'::text))::numeric) AS dollar_amount,
    COALESCE(NULLIF("left"(vo.content_text, 200), ''::text), ((vo.kind)::text || ' observation'::text)) AS summary_text,
    vo.id AS source_id,
    'vehicle_observations'::text AS source_table
   FROM vehicle_observations vo
  WHERE ((vo.submitted_by_user_id IS NOT NULL) AND (vo.observed_at IS NOT NULL) AND (COALESCE(vo.is_superseded, false) = false))
UNION ALL
 SELECT v.user_id,
    ve.vehicle_id,
    (COALESCE(ve.sold_at, ve.ended_at, ve.started_at))::date AS event_day,
    COALESCE(ve.sold_at, ve.ended_at, ve.started_at) AS event_at,
    'event'::text AS event_kind,
    COALESCE(ve.event_type, 'listing'::text) AS event_subtype,
    COALESCE(ve.final_price, ve.current_price, ve.starting_price) AS dollar_amount,
    (((COALESCE(ve.event_type, 'listing'::text) || ' on '::text) || COALESCE(ve.source_platform, 'unknown'::text)) ||
        CASE
            WHEN (ve.final_price IS NOT NULL) THEN (' - $'::text || (ve.final_price)::text)
            ELSE ''::text
        END) AS summary_text,
    ve.id AS source_id,
    'vehicle_events'::text AS source_table
   FROM (vehicles v
     JOIN vehicle_events ve ON ((ve.vehicle_id = v.id)))
  WHERE ((v.user_id IS NOT NULL) AND (COALESCE(ve.sold_at, ve.ended_at, ve.started_at) IS NOT NULL))
UNION ALL
 SELECT v.user_id,
    ac.vehicle_id,
    (ac.posted_at)::date AS event_day,
    ac.posted_at AS event_at,
    'comment'::text AS event_kind,
    COALESCE(ac.platform, 'auction'::text) AS event_subtype,
    ac.bid_amount AS dollar_amount,
    COALESCE(NULLIF("left"(ac.comment_text, 200), ''::text), 'comment'::text) AS summary_text,
    ac.id AS source_id,
    'auction_comments'::text AS source_table
   FROM (vehicles v
     JOIN auction_comments ac ON ((ac.vehicle_id = v.id)))
  WHERE ((v.user_id IS NOT NULL) AND (ac.posted_at IS NOT NULL))
UNION ALL
 SELECT r.user_id,
    r.vehicle_id,
    COALESCE(r.purchase_date, r.transaction_date, r.receipt_date, (r.created_at)::date) AS event_day,
    COALESCE((r.purchase_date)::timestamp with time zone, (r.transaction_date)::timestamp with time zone, (r.receipt_date)::timestamp with time zone, r.created_at) AS event_at,
    'receipt'::text AS event_kind,
    COALESCE(r.scope_type, 'vehicle'::text) AS event_subtype,
    COALESCE(r.total, r.total_amount, r.subtotal) AS dollar_amount,
    (COALESCE(r.vendor_name, 'vendor'::text) ||
        CASE
            WHEN (COALESCE(r.total, r.total_amount) IS NOT NULL) THEN (' - $'::text || (COALESCE(r.total, r.total_amount))::text)
            ELSE ''::text
        END) AS summary_text,
    r.id AS source_id,
    'receipts'::text AS source_table
   FROM receipts r
  WHERE (r.user_id IS NOT NULL)
UNION ALL
 -- NEW LEG: payment_events. direction='in' → 'payment' kind; direction='out' → 'payment_out' kind.
 SELECT pe.user_id,
    pe.scope_id AS vehicle_id,
    (pe.paid_at)::date AS event_day,
    pe.paid_at AS event_at,
    CASE WHEN pe.direction = 'in' THEN 'payment' ELSE 'payment_out' END AS event_kind,
    COALESCE(pe.method, pe.scope_type) AS event_subtype,
    pe.amount_usd AS dollar_amount,
    (CASE WHEN pe.direction = 'in' THEN 'received $' ELSE 'paid $' END
       || pe.amount_usd::text
       || COALESCE(' from ' || NULLIF(pe.counterparty_name,''), '')
       || COALESCE(' (' || pe.method || ')', '')
       || COALESCE(' — ' || NULLIF(LEFT(pe.description,160),''), '')
    ) AS summary_text,
    pe.id AS source_id,
    'payment_events'::text AS source_table
   FROM payment_events pe
  WHERE pe.user_id IS NOT NULL AND pe.paid_at IS NOT NULL;

COMMENT ON VIEW v_user_daily_activity IS
  'Unified daily activity stream. Added payment_events leg 2026-05-07 — event_kind=payment (in) / payment_out (out). vehicle_id is set from payment_events.scope_id (NULL for personal/tax/org scope).';

-- Drop and recreate to allow new columns at end (existing column order must be preserved on REPLACE).
DROP VIEW IF EXISTS v_user_monthly_summary;

CREATE VIEW v_user_monthly_summary AS
 SELECT user_id,
    (date_trunc('month'::text, (event_day)::timestamp with time zone))::date AS month,
    count(DISTINCT vehicle_id) AS vehicles_touched,
    count(*) FILTER (WHERE (event_kind = 'photo'::text)) AS photos_added,
    count(*) FILTER (WHERE (event_kind = 'observation'::text)) AS observations_made,
    count(*) FILTER (WHERE (event_kind = 'receipt'::text)) AS receipts_count,
    COALESCE(sum(dollar_amount) FILTER (WHERE (event_kind = 'receipt'::text)), (0)::numeric) AS receipts_usd,
    count(*) FILTER (WHERE ((event_kind = 'event'::text) AND (event_subtype = 'sold'::text))) AS sales_count,
    COALESCE(sum(dollar_amount) FILTER (WHERE ((event_kind = 'event'::text) AND (event_subtype = 'sold'::text))), (0)::numeric) AS sales_usd,
    count(*) FILTER (WHERE (event_kind = 'comment'::text)) AS comments_received,
    count(*) FILTER (WHERE (event_kind = 'reattribution'::text)) AS reattributions_made,
    count(*) AS total_events,
    -- NEW columns appended at end (2026-05-07)
    count(*) FILTER (WHERE event_kind = 'payment') AS payments_in_count,
    COALESCE(sum(dollar_amount) FILTER (WHERE event_kind = 'payment'), 0::numeric) AS payments_in_usd,
    count(*) FILTER (WHERE event_kind = 'payment_out') AS payments_out_count,
    COALESCE(sum(dollar_amount) FILTER (WHERE event_kind = 'payment_out'), 0::numeric) AS payments_out_usd,
    -- Net cash: money in (payments_in + sales) minus money out (receipts + payments_out)
    (COALESCE(sum(dollar_amount) FILTER (WHERE event_kind = 'payment'), 0::numeric)
     + COALESCE(sum(dollar_amount) FILTER (WHERE event_kind = 'event' AND event_subtype = 'sold'), 0::numeric))
    -
    (COALESCE(sum(dollar_amount) FILTER (WHERE event_kind = 'receipt'), 0::numeric)
     + COALESCE(sum(dollar_amount) FILTER (WHERE event_kind = 'payment_out'), 0::numeric)) AS net_cash_usd
   FROM v_user_daily_activity
  WHERE (user_id IS NOT NULL)
  GROUP BY user_id, (date_trunc('month'::text, (event_day)::timestamp with time zone));

COMMENT ON VIEW v_user_monthly_summary IS
  'Monthly rollup with payments_in_usd, payments_out_usd, net_cash_usd added 2026-05-07. net_cash = (payments_in + sales) - (receipts + payments_out). Note: sales_usd from vehicle_events.sold may double-count payments_in for the same sale — read both columns with that asymmetry in mind, or filter to one source per analysis.';
