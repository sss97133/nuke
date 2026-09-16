-- Migration: 20260507150200_payment_events_supersession
-- Justification: payment_events is testimony. Per agent-trust-invariants Rule #2, testimony
--   uses the supersession pattern, not UPDATE. Add is_superseded + superseded_by columns
--   to enable correction without DELETE/UPDATE on the original row.

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS is_superseded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES payment_events(id),
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_events_active
  ON payment_events (user_id, paid_at DESC) WHERE is_superseded = false;

COMMENT ON COLUMN payment_events.is_superseded IS
  'Testimony supersession flag (per agent-trust-invariants.md). Setting this to true is the ONLY allowed UPDATE — original amount/method/scope/etc remain immutable. Set superseded_by to point at the corrected row.';

-- Apply supersession to the K10 d7962908 stale doublet:
-- Row a06cb139 ($38,500 from stale vehicles.canonical_sold_price) is superseded by the
-- $78,500 row sourced from the BaT sale_result observation (sale_price=78500, high_bid=78500).
DO $$
DECLARE
  stale_id UUID := 'a06cb139-0b98-42ef-85d9-76080900d6fb';
  authoritative_id UUID;
BEGIN
  SELECT id INTO authoritative_id FROM payment_events
   WHERE scope_id='d7962908-9a01-4082-a85e-6bbe532550b2'
     AND amount_usd=78500.00 AND paid_at='2024-06-10 00:00:00+00'::timestamptz;

  IF authoritative_id IS NOT NULL THEN
    UPDATE payment_events
       SET is_superseded = true,
           superseded_by = authoritative_id,
           superseded_at = NOW()
     WHERE id = stale_id;
  END IF;
END $$;

-- Drop the placeholder amount=0 correction row that was inserted before the supersession columns existed.
-- This is the ONLY allowed DELETE on payment_events: removing a row that itself was a workaround for the
-- missing supersession column. The actual stale data ($38,500) is preserved with is_superseded=true above.
DELETE FROM payment_events
 WHERE amount_usd = 0.00
   AND scope_id = 'd7962908-9a01-4082-a85e-6bbe532550b2'
   AND source_metadata->>'source' = 'correction_v1';

-- Update v_user_daily_activity and v_user_monthly_summary to filter out superseded rows.
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
  WHERE pe.user_id IS NOT NULL AND pe.paid_at IS NOT NULL
    AND COALESCE(pe.is_superseded, false) = false;

COMMENT ON VIEW v_user_daily_activity IS
  'Unified daily activity stream. payment_events leg added 2026-05-07; superseded rows filtered out 2026-05-07.';
