-- project_bat_result_to_vehicle: only the vehicle's latest lot projects onto its vehicles row.
--
-- WHY (2026-10-16, found by the backfill's dry run before any write): vehicles.listing_url can stay on an older lot
-- while the sale columns follow a relist. A 2004 Mercedes-Benz C320 (vehicle ceb4877e) has listing_url = the
-- 2026-09-11 lot (sold 5,300) and sale_price 4,750 from its 2026-10-14 relist (-4-2). 20261018041000 compared only
-- the URL, so it planned 4,750 -> 5,300: an older lot over a newer sale. Now a result for which the same vehicle has a
-- lot ending later returns 'later_lot' and writes nothing. Body otherwise as 20261018041000.
-- Contract: supabase/sql/test_project_bat_result_to_vehicle.sql (extended). Applied by CI, never by hand.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.project_bat_result_to_vehicle(
  p_event_id uuid, p_apply boolean DEFAULT true, p_asserted_by text DEFAULT 'project_bat_result_to_vehicle')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e        auction_events%ROWTYPE;
  v        vehicles%ROWTYPE;
  v_final  numeric;
  v_price  numeric;
  v_corr   jsonb := '{}'::jsonb;
  v_row    jsonb;
  v_result jsonb;
BEGIN
  SELECT * INTO e FROM auction_events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('event_id', p_event_id, 'status', 'missing'); END IF;
  IF e.source IS DISTINCT FROM 'bat' OR e.outcome IS NULL OR e.outcome NOT IN ('sold', 'reserve_not_met') THEN
    RETURN jsonb_build_object('event_id', p_event_id, 'status', 'not_a_result');
  END IF;
  v_final := greatest(coalesce(e.winning_bid, 0), coalesce(e.high_bid, 0));
  IF v_final <= 0 THEN RETURN jsonb_build_object('event_id', p_event_id, 'status', 'no_amount'); END IF;

  SELECT * INTO v FROM vehicles
  WHERE id = e.vehicle_id AND deleted_at IS NULL AND rtrim(listing_url, '/') = rtrim(e.source_url, '/');
  IF NOT FOUND THEN RETURN jsonb_build_object('event_id', p_event_id, 'status', 'other_listing'); END IF;
  -- listing_url can stay on an older lot while the sale columns follow a relist (a 2004 C320: listing_url the
  -- 2026-09-11 lot sold at 5,300, sale_price the 2026-10-14 relist's 4,750): only the vehicle's latest lot projects
  IF EXISTS (SELECT 1 FROM auction_events l WHERE l.vehicle_id = e.vehicle_id AND l.id <> e.id
               AND l.auction_end_date > e.auction_end_date) THEN
    RETURN jsonb_build_object('event_id', p_event_id, 'vehicle_id', v.id, 'status', 'later_lot');
  END IF;

  IF greatest(coalesce(v.high_bid, 0), coalesce(v.sale_price, 0)) > v_final THEN
    RETURN jsonb_build_object('event_id', p_event_id, 'vehicle_id', v.id, 'status', 'vehicle_above_final',
                              'final', v_final, 'high_bid', v.high_bid, 'sale_price', v.sale_price);
  END IF;

  IF coalesce(v.high_bid, 0) < v_final THEN
    v_corr := v_corr || jsonb_build_object('high_bid', jsonb_build_object('value', round(v_final)::bigint::text, 'expected', v.high_bid::text));
  END IF;
  IF e.outcome = 'sold' THEN
    v_price := coalesce(nullif(e.winning_bid, 0), v_final);
    IF v.sale_price IS NULL OR v.sale_price < v_price THEN
      v_corr := v_corr || jsonb_build_object('sale_price', jsonb_build_object('value', round(v_price)::bigint::text, 'expected', v.sale_price::text));
    END IF;
    IF v_corr ? 'sale_price' OR v.sale_status IS DISTINCT FROM 'sold' THEN
      IF v.sale_status IS DISTINCT FROM 'sold' THEN
        v_corr := v_corr || jsonb_build_object('sale_status', jsonb_build_object('value', 'sold', 'expected', v.sale_status));
      END IF;
      IF v.auction_outcome IS DISTINCT FROM 'sold' THEN
        v_corr := v_corr || jsonb_build_object('auction_outcome', jsonb_build_object('value', 'sold', 'expected', v.auction_outcome));
      END IF;
    END IF;
  ELSIF v.auction_outcome IS NULL AND v_corr <> '{}'::jsonb THEN
    v_corr := v_corr || jsonb_build_object('auction_outcome', jsonb_build_object('value', 'reserve_not_met', 'expected', NULL));
  END IF;
  IF v_corr = '{}'::jsonb THEN
    RETURN jsonb_build_object('event_id', p_event_id, 'vehicle_id', v.id, 'status', 'current');
  END IF;

  v_row := jsonb_build_object(
    'vehicle_id', v.id,
    'source', jsonb_build_object(
      'type', 'auction_event', 'ref', 'auction_events/' || e.id, 'url', e.source_url, 'outcome', e.outcome,
      'final', v_final, 'winning_bidder', e.winning_bidder,
      'basis', coalesce(e.raw_data #>> '{live_stream,clock_basis}', 'listing_page_read'),
      'method', 'the lot''s result row (BaT''s own record, native or page)'),
    'corrections', v_corr);
  IF NOT p_apply THEN
    RETURN jsonb_build_object('event_id', p_event_id, 'vehicle_id', v.id, 'status', 'planned', 'row', v_row);
  END IF;
  v_result := correct_vehicle_sale_provenance_batch(jsonb_build_array(v_row), p_asserted_by,
    'BaT result on record in auction_events, not yet on the vehicle row');
  RETURN jsonb_build_object('event_id', p_event_id, 'vehicle_id', v.id,
    'status', CASE WHEN coalesce((v_result ->> 'fields_corrected')::integer, 0) > 0 THEN 'corrected'
                   WHEN jsonb_array_length(coalesce(v_result -> 'stale', '[]'::jsonb)) > 0 THEN 'stale' ELSE 'noop' END,
    'row', v_row, 'writer', v_result);
END;
$function$;

COMMENT ON FUNCTION public.project_bat_result_to_vehicle(uuid, boolean, text) IS
  'Projects one BaT auction_events result (sold / reserve_not_met, amount > 0) onto the vehicles row that is that listing and whose latest lot it is, through correct_vehicle_sale_provenance_batch (cited auction_events/<id>, expected-value guarded). Never lowers a bid or a price; never projects an older lot over a relist; a sold lot gets sale_price with sale_status / auction_outcome sold; p_apply false returns the plan. Service role only (2026-10-16).';

COMMIT;
