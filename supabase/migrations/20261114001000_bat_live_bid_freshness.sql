-- T7 (paste loop): live BaT bids stay fresh in auction_events, and a live bid is never a "sold price".
--
-- 1. vehicles.canonical_sold_price: trg_resolve_canonical_columns fell through to "best available" for
--    canonical_outcome = 'active' and stored the live high bid (2026-11-09: 2,101 active vehicles carried a
--    canonical_sold_price, 1,689 of them equal to high_bid; the unsold live 2011 GT3 RS #49 read $350,000).
--    A live or upcoming lot now resolves to NULL. Other outcomes are unchanged. Rows are corrected only when
--    they are next written; supabase/sql/backfills/20261114_canonical_sold_price_live_bids.sql (NOT applied
--    by this migration) clears the existing values with before-images.
-- 2. bat_live_bid_lag(): read-only measure of how far auction_events trails BaT's own live board
--    (vehicles.origin_metadata.source_current_bid, read by sync-live-auctions every 15 min).
-- 3. bat_live_bid_catchup(p_max): re-reads, through the existing reader (extract-bat-core, exactly as
--    bat_live_pull_run dispatches it), each live lot whose board bid changed after its stored auction_events
--    row. bat_live_pull_run reads every lot on a 60 min / 6 h / 24 h cadence by time to close; a bid placed on a
--    lot 3 days out waited up to 24 h (#206 stored $20,993 for 18 h while BaT showed $39,993). Changed lots now
--    wait at most one board read (15 min) + one catch-up tick (10 min) + 30 min per-lot spacing.
--    Load: one extract-bat-core read per changed lot, ≤ 20 per tick (≤ 120/h, vs ~257/h today); unchanged lots
--    cost nothing (their stored bid is already right).
-- 4. Cron 'bat-live-bid-catchup' every 10 min, created DISABLED. Enable after review:
--      SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname = 'bat-live-bid-catchup';
--
-- No data rows are changed by this migration.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

-- 1 ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_resolve_canonical_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  raw_source TEXT;
  best_price NUMERIC;
  price_type TEXT;
  sale_basis TEXT;
BEGIN
  -- 1. canonical_platform: resolve from first non-null source column
  raw_source := COALESCE(NEW.source, NEW.listing_source, NEW.discovery_source, NEW.auction_source);
  IF raw_source IS NOT NULL THEN
    NEW.canonical_platform := resolve_platform_slug(raw_source);
  ELSE
    NEW.canonical_platform := 'unknown';
  END IF;

  -- 2. canonical_outcome: a consummated sale is a STATUS, or (pre-2026-09-27 rows only) the
  --    platform's own sale marker. A price alone is a bid, an ask or an estimate
  --    (2026-09-27: 30,612 unsold BaT lots, 4,612 Mecum bid-goes-on lots, 6,155 Cars & Bids
  --    reserve-not-met lots and 82 RM Sotheby's low estimates were all sitting in sale_price).
  sale_basis := vehicle_sale_basis(NEW.sale_status, NEW.auction_outcome, NEW.canonical_platform,
                                   NEW.listing_url, NEW.discovery_url, NEW.sale_price::numeric,
                                   NEW.notes, NEW.import_metadata, NEW.created_at);
  IF sale_basis IS NOT NULL THEN
    NEW.canonical_outcome := 'sold';
  ELSIF NEW.sale_status IN ('not_sold', 'unsold', 'bid_to') OR NEW.reserve_status = 'reserve_not_met'
        OR NEW.auction_outcome IN ('reserve_not_met', 'no_sale') THEN
    NEW.canonical_outcome := 'reserve_not_met';
  ELSIF NEW.sale_status IN ('auction_live', 'upcoming') THEN
    NEW.canonical_outcome := 'active';
  ELSIF NEW.sale_status = 'for_sale' OR (COALESCE(NEW.asking_price, 0) > 0 AND COALESCE(NEW.sale_status, 'available') NOT IN ('ended')) THEN
    NEW.canonical_outcome := 'for_sale';
  ELSIF NEW.sale_status = 'ended' THEN
    NEW.canonical_outcome := 'ended';
  ELSIF NEW.sale_status = 'available' AND (COALESCE(NEW.high_bid, 0) > 0 OR COALESCE(NEW.winning_bid, 0) > 0) THEN
    -- Has bids but no sale price → auction ended without clear outcome
    NEW.canonical_outcome := 'ended';
  ELSE
    NEW.canonical_outcome := 'unknown';
  END IF;

  -- 3. canonical_sold_price: context-aware price resolution
  CASE NEW.canonical_outcome
    WHEN 'sold' THEN
      -- Transaction price priority: sale_price > winning_bid > bat_sold_price > sold_price > high_bid > price
      best_price := COALESCE(
        NULLIF(NEW.sale_price, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.sold_price, 0)::NUMERIC,
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.price, 0)::NUMERIC
      );
    WHEN 'active' THEN
      -- T7 (2026-11-14): a live or upcoming lot has no sold price. Its running high bid lives in
      -- vehicles.high_bid / auction_events.high_bid; it is not a transaction and is never written here.
      best_price := NULL;
    WHEN 'for_sale' THEN
      -- Asking price priority
      best_price := COALESCE(
        NULLIF(NEW.asking_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
    WHEN 'reserve_not_met' THEN
      -- Highest bid reached
      best_price := COALESCE(
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
    ELSE
      -- Best available
      best_price := COALESCE(
        NULLIF(NEW.sale_price, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.sold_price, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.asking_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
  END CASE;

  NEW.canonical_sold_price := best_price;

  RETURN NEW;
END;
$function$;

-- 2 ---------------------------------------------------------------------------------------------------------
-- Live BaT lots whose board bid (BaT's own /auctions/ feed) is ahead of the stored auction_events row.
CREATE OR REPLACE FUNCTION public.bat_live_bid_lag_rows()
RETURNS TABLE (monitor_id uuid, vehicle_id uuid, lot_url text, auction_end_time timestamptz,
               board_bid numeric, board_read_at timestamptz, stored_bid numeric, stored_at timestamptz,
               last_synced_at timestamptz, behind boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT m.id, m.vehicle_id, m.external_auction_url, m.auction_end_time,
         CASE WHEN jsonb_typeof(v.origin_metadata->'source_current_bid') = 'number'
              THEN (v.origin_metadata->>'source_current_bid')::numeric END,
         CASE WHEN pg_input_is_valid(v.origin_metadata->>'source_read_at', 'timestamp with time zone')
              THEN (v.origin_metadata->>'source_read_at')::timestamptz END,
         a.high_bid, a.updated_at, m.last_synced_at,
         coalesce(
           CASE WHEN jsonb_typeof(v.origin_metadata->'source_current_bid') = 'number'
                 AND (v.origin_metadata->>'source_current_bid')::numeric > 0
                THEN (v.origin_metadata->>'source_current_bid')::numeric IS DISTINCT FROM a.high_bid
                 AND (a.updated_at IS NULL
                      OR (pg_input_is_valid(v.origin_metadata->>'source_read_at', 'timestamp with time zone')
                          AND (v.origin_metadata->>'source_read_at')::timestamptz > a.updated_at))
           END, false)
  FROM public.monitored_auctions m
  JOIN public.live_auction_sources s ON s.id = m.source_id AND s.slug = 'bat'
  JOIN public.vehicles v ON v.id = m.vehicle_id AND v.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT e.high_bid, e.updated_at FROM public.auction_events e
    WHERE e.vehicle_id = m.vehicle_id
      AND e.source_url IN (rtrim(m.external_auction_url, '/'), rtrim(m.external_auction_url, '/') || '/')
      AND e.duplicate_of IS NULL
    ORDER BY e.updated_at DESC NULLS LAST LIMIT 1
  ) a ON true
  WHERE m.is_live AND m.auction_end_time > now();
$function$;

CREATE OR REPLACE FUNCTION public.bat_live_bid_lag()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'at', now(),
    'live_lots', count(*),
    'behind', count(*) FILTER (WHERE behind),
    -- the acceptance metric: a board bid change older than 1 h that auction_events still does not show
    'behind_over_1h', count(*) FILTER (WHERE behind AND coalesce(board_read_at, '-infinity') < now() - interval '1 hour'),
    'max_lag_minutes', round(max(extract(epoch FROM now() - board_read_at) / 60) FILTER (WHERE behind)),
    'no_stored_row', count(*) FILTER (WHERE stored_at IS NULL))
  FROM public.bat_live_bid_lag_rows();
$function$;

-- 3 ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bat_live_bid_catchup(p_max integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_now  timestamptz := now();
  v_key  text := get_service_role_key_for_cron();
  v_base text := get_service_url();
  v_sent integer := 0;
  v_ids  uuid[] := '{}';
  r      record;
BEGIN
  FOR r IN
    SELECT m.id, m.external_auction_url, m.poll_interval_ms
    FROM public.bat_live_bid_lag_rows() l
    JOIN public.monitored_auctions m ON m.id = l.monitor_id
    WHERE l.behind
      -- the native closing stream and the pull's 1-minute cadence own the last 15 minutes
      AND l.auction_end_time > v_now + interval '15 minutes'
      -- one catch-up per lot per 30 min, and never a lot the pull dispatched in the last 30 min
      AND (l.last_synced_at IS NULL OR l.last_synced_at < v_now - interval '30 minutes')
      AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions', '{}'::jsonb)) session
        WHERE (session.value->>'connected')::boolean AND (session.value->>'at')::timestamptz > v_now - interval '3 seconds')
    ORDER BY l.auction_end_time
    LIMIT greatest(0, least(coalesce(p_max, 20), 60))
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    PERFORM net.http_post(
      url := v_base || '/functions/v1/extract-bat-core',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('url', r.external_auction_url, 'prefer_snapshot', false),
      timeout_milliseconds := 150000);
    -- Same bookkeeping as a bat_live_pull_run dispatch, so its accounting reads this lot as dispatched/in flight
    -- and does not re-dispatch it on top; the cadence it already had is kept.
    UPDATE public.monitored_auctions
    SET last_synced_at = v_now,
        next_poll_at = v_now + make_interval(secs => coalesce(r.poll_interval_ms, 3600000) / 1000.0)
    WHERE id = r.id;
    v_sent := v_sent + 1;
    v_ids := v_ids || r.id;
  END LOOP;
  RETURN jsonb_build_object('at', v_now, 'dispatched', v_sent, 'monitor_ids', to_jsonb(v_ids), 'lag', public.bat_live_bid_lag());
END;
$function$;

REVOKE ALL ON FUNCTION public.bat_live_bid_lag_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bat_live_bid_lag() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bat_live_bid_catchup(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bat_live_bid_lag_rows() TO service_role;
GRANT EXECUTE ON FUNCTION public.bat_live_bid_lag() TO service_role;
GRANT EXECUTE ON FUNCTION public.bat_live_bid_catchup(integer) TO service_role;

-- 4 ---------------------------------------------------------------------------------------------------------
DO $sched$
DECLARE j bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'bat-live-bid-catchup' LOOP PERFORM cron.unschedule(j); END LOOP;
  j := cron.schedule('bat-live-bid-catchup', '4-59/10 * * * *',
    $cmd$SET statement_timeout = '50s'; SELECT public.bat_live_bid_catchup(20);$cmd$);
  PERFORM cron.alter_job(j, active := false);  -- created disabled: a reviewer enables it (see header)
END $sched$;
