-- project_bat_result_to_vehicle + trigger: a BaT lot's result in auction_events reaches its vehicles row at close.
--
-- WHY (2026-10-16): since 2026-09-01, 83 of 6,877 BaT sold / reserve-not-met lots whose vehicles row is that listing
-- carry greatest(vehicles.high_bid, vehicles.sale_price) below the lot's final in auction_events (43 sold, 40 RNM,
-- median 9.7% short; prod, bounded auction_end_date windows, 00:00-00:20Z). 63 of them had the final and lost it to
-- the live-list upsert (20261018040000). 20 never got it: the vehicle sale cache was written only by an HTML read of
-- the lot page (extract-bat-core -> correct_vehicle_sale_provenance_batch). ingest_bat_live_events asks for one such
-- "final read" the moment the native result frame lands, and the page BaT serves then still shows the running auction.
-- Example: ejection-seat-12 closed at 19:19:13Z on 10-15 and sold for $2,700. Its final read (pg_net 91019, 19:19:14Z)
-- got HTTP 200 with record sold=false and close basis 'running', and nothing read the lot again. vehicles still says
-- 'ended', no sale price, high bid $2,600. auction_events said sold at $2,700 from 19:22:39Z.
--
-- SHAPE: no new writer. The result row already carries BaT's own record (the native system comment, or the page's
-- record on an HTML read), and correct_vehicle_sale_provenance_batch remains the only writer of the vehicle sale
-- cache: it keeps each original and cites the source. project_bat_result_to_vehicle(event_id) plans the
-- correction from one auction_events row and calls that writer. A trigger runs it when a BaT row becomes or stays a
-- result (outcome / winning_bid / high_bid change).
--
-- RULES:
--   * Only source 'bat', outcome sold or reserve_not_met, an amount > 0, and a vehicles row that IS that listing
--     (listing_url = source_url, slash-tolerant, not deleted). A vehicle summarizing another of its listings is left.
--   * Never lowers: high_bid moves only up to the final; a sold lot's sale_price is set when it is empty or below the
--     record's price, with sale_status / auction_outcome 'sold' in the same writer call (guard_vehicle_sale_price).
--     reserve_not_met fills auction_outcome only when it is empty. A vehicle above the final is reported, not touched.
--   * Each field carries the live value as its expected value, so a concurrent writer wins and this call reports stale.
--     Amounts are whole dollars (the vehicles columns are integers; auction_events keeps numeric).
--   * The trigger never fails the result write: an error is raised as a WARNING (the backfill runner and the lag
--     query in the PR re-find any lot it missed). EXECUTE on the function: service_role only.
-- Contract: supabase/sql/test_project_bat_result_to_vehicle.sql (PG17). Applied by CI, never by hand.
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

REVOKE ALL ON FUNCTION public.project_bat_result_to_vehicle(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_bat_result_to_vehicle(uuid, boolean, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_bat_result_to_vehicle(uuid, boolean, text) TO service_role;
COMMENT ON FUNCTION public.project_bat_result_to_vehicle(uuid, boolean, text) IS
  'Projects one BaT auction_events result (sold / reserve_not_met, amount > 0) onto the vehicles row that is that listing, through correct_vehicle_sale_provenance_batch (cited auction_events/<id>, expected-value guarded). Never lowers a bid or a price; a sold lot gets sale_price with sale_status / auction_outcome sold; p_apply false returns the plan. Service role only (2026-10-16).';

CREATE OR REPLACE FUNCTION public.trg_project_bat_result_to_vehicle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    PERFORM project_bat_result_to_vehicle(NEW.id, true, 'trg_project_bat_result_to_vehicle');
  EXCEPTION WHEN OTHERS THEN
    -- the result row stands whatever happens to its projection; the lag query finds a lot this missed
    RAISE WARNING 'project_bat_result_to_vehicle(%) failed: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_project_bat_result_to_vehicle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_project_bat_result_to_vehicle() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_project_bat_result_to_vehicle ON public.auction_events;
CREATE TRIGGER trg_project_bat_result_to_vehicle
  AFTER INSERT OR UPDATE OF outcome, winning_bid, high_bid ON public.auction_events
  FOR EACH ROW WHEN (NEW.source = 'bat' AND NEW.outcome IN ('sold', 'reserve_not_met'))
  EXECUTE FUNCTION public.trg_project_bat_result_to_vehicle();

COMMIT;
