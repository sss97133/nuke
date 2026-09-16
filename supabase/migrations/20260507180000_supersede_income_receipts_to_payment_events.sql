-- Move 1: Supersede income-flagged receipts. Their canonical home is payment_events.
-- Trust invariant: never DELETE testimony. Use supersession pattern.
--
-- Five receipts were inserted into `receipts` with direction=income (BaT sale proceeds + Howard
-- Barton interior-work invoice). Each has a paired payment_events row that is the correct
-- testimony of the money-in event. The receipts copies are doublets and must be marked
-- is_superseded=true with superseded_by pointing at the payment_events twin.
--
-- Affected receipts (total $179,925):
--   771746b2 — K10 Cheyenne d7962908 — $78,500 — pe.b41dec8d
--   1c87256a — C10 655f224f         — $51,000 — pe.c3df4e6b
--   cb33699d — K2500 a90c008a       — $31,000 — pe.0a9dca7a
--   228b39da — LX450 4ecc1fa5       — $13,750 — pe.ed890139
--   9e2e82c9 — Hot Rod 21ee373f     — $5,675  — pe.98ede30b

BEGIN;

-- Step 1: Add supersession columns to receipts (testimony invariant infra)
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS is_superseded BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES payment_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_receipts_is_superseded
  ON receipts (is_superseded) WHERE is_superseded = TRUE;

-- Step 2: Mark each income receipt as superseded by its payment_events twin
UPDATE receipts SET
  is_superseded     = TRUE,
  superseded_by     = 'b41dec8d-b765-4e84-845f-d1428ddf2997',
  superseded_at     = NOW(),
  superseded_reason = 'income event — canonical home is payment_events; receipts is for outflows'
WHERE id = '771746b2-1472-450c-a86d-c5a54bd927bb';

UPDATE receipts SET
  is_superseded     = TRUE,
  superseded_by     = 'c3df4e6b-1afc-4334-9f53-fef759856c3f',
  superseded_at     = NOW(),
  superseded_reason = 'income event — canonical home is payment_events; receipts is for outflows'
WHERE id = '1c87256a-d903-4672-bf03-f40bd62cda8f';

UPDATE receipts SET
  is_superseded     = TRUE,
  superseded_by     = '0a9dca7a-e75d-4fa8-a6cb-986d6fd4ea1a',
  superseded_at     = NOW(),
  superseded_reason = 'income event — canonical home is payment_events; receipts is for outflows'
WHERE id = 'cb33699d-f57a-4495-9c25-e52b8cb24417';

UPDATE receipts SET
  is_superseded     = TRUE,
  superseded_by     = 'ed890139-836f-49cb-ae2d-3e56a9a1bf87',
  superseded_at     = NOW(),
  superseded_reason = 'income event — canonical home is payment_events; receipts is for outflows'
WHERE id = '228b39da-42d6-4af8-9ed4-8a04f30d920e';

UPDATE receipts SET
  is_superseded     = TRUE,
  superseded_by     = '98ede30b-8dc2-471d-99d1-1535d1bbcc52',
  superseded_at     = NOW(),
  superseded_reason = 'income event — canonical home is payment_events; receipts is for outflows'
WHERE id = '9e2e82c9-8caf-4017-a371-d8a2ace58391';

-- Step 3: Rebuild v_garage_asset_summary so the receipts CTE gates on is_superseded
CREATE OR REPLACE VIEW v_garage_asset_summary AS
 SELECT v.user_id,
    v.id AS vehicle_id,
    v.year,
    v.make,
    v.model,
    v.vin,
    v.color,
    LEAST(ps.first_photo_at, os.first_ownership_at::date, rs.first_receipt_at) AS acquired_at,
    es.sold_at::date AS disposed_at,
    CASE
        WHEN LEAST(ps.first_photo_at, os.first_ownership_at::date, rs.first_receipt_at) IS NULL
            THEN NULL::integer
        ELSE COALESCE(es.sold_at::date, CURRENT_DATE)
             - LEAST(ps.first_photo_at, os.first_ownership_at::date, rs.first_receipt_at)
    END AS days_held,
    COALESCE(ps.photo_count, 0::bigint) AS photo_count,
    COALESCE(os.observation_count, 0::bigint) AS observation_count,
    COALESCE(rs.receipt_count, 0::bigint) AS receipt_count,
    COALESCE(rs.total_receipts_usd, 0::numeric) AS total_receipts_usd,
    COALESCE(os.observed_purchase_price, v.purchase_price) AS acquisition_cost_usd,
    COALESCE(es.final_sale_price, os.observed_sale_amount, v.bat_sold_price,
             v.canonical_sold_price, v.sold_price::numeric) AS sale_proceeds_usd,
    COALESCE(v.nuke_estimate, v.cz_estimated_value, v.current_value,
             os.observed_valuation) AS estimated_current_value_usd,
    CASE
        WHEN es.sold_at IS NOT NULL THEN
            COALESCE(es.final_sale_price, os.observed_sale_amount, v.bat_sold_price,
                     v.canonical_sold_price, v.sold_price::numeric, 0::numeric)
            - COALESCE(rs.total_receipts_usd, 0::numeric)
        ELSE
            COALESCE(v.nuke_estimate, v.cz_estimated_value, v.current_value,
                     os.observed_valuation, 0::numeric)
            - COALESCE(rs.total_receipts_usd, 0::numeric)
    END AS net_position_usd,
    GREATEST(ps.last_photo_at, os.last_observation_at, rs.last_receipt_at,
             es.last_event_at) AS last_activity_at
   FROM vehicles v
     LEFT JOIN LATERAL (
       SELECT count(*) AS photo_count,
              min(COALESCE(vi.taken_at, vi.created_at))::date AS first_photo_at,
              max(COALESCE(vi.taken_at, vi.created_at)) AS last_photo_at
       FROM vehicle_images vi
       WHERE vi.vehicle_id = v.id
         AND COALESCE(vi.is_duplicate, false) = false
         AND COALESCE(vi.is_superseded, false) = false
     ) ps ON true
     LEFT JOIN LATERAL (
       SELECT count(*) AS observation_count,
              max(vo.observed_at) AS last_observation_at,
              max((vo.structured_data ->> 'purchase_price'::text)::numeric)
                FILTER (WHERE (vo.kind::text = ANY (ARRAY['ownership'::text, 'provenance'::text]))
                        AND vo.structured_data ? 'purchase_price'::text) AS observed_purchase_price,
              max((vo.structured_data ->> 'value_usd'::text)::numeric)
                FILTER (WHERE (vo.kind::text = ANY (ARRAY['valuation'::text, 'market_value'::text]))
                        AND vo.structured_data ? 'value_usd'::text) AS observed_valuation,
              max((vo.structured_data ->> 'amount_usd'::text)::numeric)
                FILTER (WHERE vo.kind::text = 'sale_result'::text
                        AND vo.structured_data ? 'amount_usd'::text) AS observed_sale_amount,
              min(vo.observed_at) FILTER (WHERE vo.kind::text = 'ownership'::text) AS first_ownership_at
       FROM vehicle_observations vo
       WHERE vo.vehicle_id = v.id
         AND COALESCE(vo.is_superseded, false) = false
     ) os ON true
     LEFT JOIN LATERAL (
       SELECT count(*) AS receipt_count,
              sum(COALESCE(r.total, r.total_amount, r.subtotal)) AS total_receipts_usd,
              min(COALESCE(r.purchase_date, r.transaction_date, r.receipt_date)) AS first_receipt_at,
              max(COALESCE(r.purchase_date::timestamptz, r.transaction_date::timestamptz,
                           r.receipt_date::timestamptz, r.created_at)) AS last_receipt_at
       FROM receipts r
       WHERE r.vehicle_id = v.id
         AND COALESCE(r.is_active, true) = true
         AND COALESCE(r.is_superseded, false) = false   -- NEW: exclude superseded doublets
     ) rs ON true
     LEFT JOIN LATERAL (
       SELECT max(ve.final_price) FILTER (WHERE ve.event_status = 'sold'::text) AS final_sale_price,
              max(ve.sold_at) FILTER (WHERE ve.event_status = 'sold'::text) AS sold_at,
              max(COALESCE(ve.sold_at, ve.ended_at, ve.started_at)) AS last_event_at
       FROM vehicle_events ve
       WHERE ve.vehicle_id = v.id
     ) es ON true
  WHERE v.user_id IS NOT NULL;

-- Step 4: Rebuild v_user_daily_activity so the receipts UNION leg gates on is_superseded
CREATE OR REPLACE VIEW v_user_daily_activity AS
 SELECT vi.user_id,
    vi.vehicle_id,
    COALESCE(vi.taken_at, vi.created_at)::date AS event_day,
    COALESCE(vi.taken_at, vi.created_at) AS event_at,
    'photo'::text AS event_kind,
    COALESCE(vi.image_category, vi.category, vi.image_type, 'photo'::text) AS event_subtype,
    NULL::numeric AS dollar_amount,
    'added photo to ' || COALESCE(v.year::text,'?') || ' ' || COALESCE(v.make,'?') || ' ' || COALESCE(v.model,'?') AS summary_text,
    vi.id AS source_id,
    'vehicle_images'::text AS source_table
   FROM vehicle_images vi
   LEFT JOIN vehicles v ON v.id = vi.vehicle_id
   WHERE vi.user_id IS NOT NULL AND vi.vehicle_id IS NOT NULL
     AND COALESCE(vi.taken_at, vi.created_at) IS NOT NULL
     AND COALESCE(vi.is_duplicate, false) = false
     AND COALESCE(vi.is_superseded, false) = false
 UNION ALL
 SELECT vo.submitted_by_user_id AS user_id,
    vo.vehicle_id,
    vo.observed_at::date AS event_day,
    vo.observed_at AS event_at,
    'observation'::text AS event_kind,
    vo.kind::text AS event_subtype,
    COALESCE((vo.structured_data ->> 'amount_usd'::text)::numeric,
             (vo.structured_data ->> 'purchase_price'::text)::numeric,
             (vo.structured_data ->> 'sale_price'::text)::numeric,
             (vo.structured_data ->> 'value_usd'::text)::numeric) AS dollar_amount,
    COALESCE(NULLIF(left(vo.content_text, 200), ''::text), vo.kind::text || ' observation') AS summary_text,
    vo.id AS source_id,
    'vehicle_observations'::text AS source_table
   FROM vehicle_observations vo
   WHERE vo.submitted_by_user_id IS NOT NULL
     AND vo.observed_at IS NOT NULL
     AND COALESCE(vo.is_superseded, false) = false
 UNION ALL
 SELECT v.user_id,
    ve.vehicle_id,
    COALESCE(ve.sold_at, ve.ended_at, ve.started_at)::date AS event_day,
    COALESCE(ve.sold_at, ve.ended_at, ve.started_at) AS event_at,
    'event'::text AS event_kind,
    COALESCE(ve.event_type, 'listing'::text) AS event_subtype,
    COALESCE(ve.final_price, ve.current_price, ve.starting_price) AS dollar_amount,
    COALESCE(ve.event_type, 'listing'::text) || ' on ' || COALESCE(ve.source_platform, 'unknown'::text)
        || CASE WHEN ve.final_price IS NOT NULL THEN ' - $' || ve.final_price::text ELSE '' END AS summary_text,
    ve.id AS source_id,
    'vehicle_events'::text AS source_table
   FROM vehicles v
   JOIN vehicle_events ve ON ve.vehicle_id = v.id
   WHERE v.user_id IS NOT NULL
     AND COALESCE(ve.sold_at, ve.ended_at, ve.started_at) IS NOT NULL
 UNION ALL
 SELECT v.user_id,
    ac.vehicle_id,
    ac.posted_at::date AS event_day,
    ac.posted_at AS event_at,
    'comment'::text AS event_kind,
    COALESCE(ac.platform, 'auction'::text) AS event_subtype,
    ac.bid_amount AS dollar_amount,
    COALESCE(NULLIF(left(ac.comment_text, 200), ''::text), 'comment'::text) AS summary_text,
    ac.id AS source_id,
    'auction_comments'::text AS source_table
   FROM vehicles v
   JOIN auction_comments ac ON ac.vehicle_id = v.id
   WHERE v.user_id IS NOT NULL AND ac.posted_at IS NOT NULL
 UNION ALL
 SELECT r.user_id,
    r.vehicle_id,
    COALESCE(r.purchase_date, r.transaction_date, r.receipt_date, r.created_at::date) AS event_day,
    COALESCE(r.purchase_date::timestamptz, r.transaction_date::timestamptz,
             r.receipt_date::timestamptz, r.created_at) AS event_at,
    'receipt'::text AS event_kind,
    COALESCE(r.scope_type, 'vehicle'::text) AS event_subtype,
    COALESCE(r.total, r.total_amount, r.subtotal) AS dollar_amount,
    COALESCE(r.vendor_name, 'vendor'::text)
        || CASE WHEN COALESCE(r.total, r.total_amount) IS NOT NULL
                THEN ' - $' || COALESCE(r.total, r.total_amount)::text ELSE '' END AS summary_text,
    r.id AS source_id,
    'receipts'::text AS source_table
   FROM receipts r
   WHERE r.user_id IS NOT NULL
     AND COALESCE(r.is_superseded, false) = false   -- NEW: exclude superseded doublets
 UNION ALL
 SELECT pe.user_id,
    pe.scope_id AS vehicle_id,
    pe.paid_at::date AS event_day,
    pe.paid_at AS event_at,
    CASE WHEN pe.direction = 'in'::text THEN 'payment'::text ELSE 'payment_out'::text END AS event_kind,
    COALESCE(pe.method, pe.scope_type) AS event_subtype,
    pe.amount_usd AS dollar_amount,
    (CASE WHEN pe.direction = 'in'::text THEN 'received $' ELSE 'paid $' END
        || pe.amount_usd::text
        || COALESCE(' from ' || NULLIF(pe.counterparty_name, ''::text), ''::text)
        || COALESCE(' (' || pe.method || ')', ''::text)
        || COALESCE(' — ' || NULLIF(left(pe.description, 160), ''::text), ''::text)) AS summary_text,
    pe.id AS source_id,
    'payment_events'::text AS source_table
   FROM payment_events pe
   WHERE pe.user_id IS NOT NULL AND pe.paid_at IS NOT NULL
     AND COALESCE(pe.is_superseded, false) = false;

COMMENT ON VIEW v_garage_asset_summary IS
  'Per-vehicle summary. Receipts CTE excludes is_superseded=true (income receipts now live in payment_events).';
COMMENT ON VIEW v_user_daily_activity IS
  'Per-user per-day activity stream. Receipts and payment_events legs both gate on is_superseded.';

COMMIT;
