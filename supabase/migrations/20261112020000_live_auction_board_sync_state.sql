-- live_auction_board_sync records what a board's read found, not only its count: p_state (optional) lands in
-- live_auction_sources.scraping_config.live_board.last_run.state, so an empty board says why it is empty.
--
-- Gooding, measured 2026-11-08: every houses run since 2026-10-28 04:50Z failed on "dns error" for bid.goodingco.com
-- (consecutive_failures 3,101). The host's CNAME, goodingco-webmodule.auctionmobility.com, now points to "nowhere.":
-- the house's Auction Mobility bidding site is gone. The house catalog (cdn.goodingco.com/graphql) still answers: its
-- newest Online Only sale is Geared Online | Spring Automobilia (2025-04-11..18, sale 1-9QGHT2), and its sales still
-- ahead are in-room (Geneva, 8 Nov; Retromobile New York, 20-21 Nov), registered through christies.com. syncGooding
-- now asks the catalog first and reads the bidding site only when an Online Only sale is still ahead; otherwise it
-- hands an empty, complete board with p_state 'no timed sale open: ...'. A timed sale ahead with the site still
-- unreachable stays a failure: that is the source having moved.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.live_auction_board_sync(text, jsonb, boolean, text);

CREATE FUNCTION public.live_auction_board_sync(
  p_slug text,
  p_lots jsonb,
  p_complete boolean DEFAULT true,
  p_error text DEFAULT NULL,
  p_state text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '45s'
AS $fn$
DECLARE
  v_src     uuid;
  v_cfg     jsonb;
  v_now     timestamptz := now();
  v_poll_ms integer;
  v_upsert  integer := 0;
  v_ended   integer := 0;
  v_linked  integer := 0;
  v_moved   jsonb := '[]'::jsonb;
BEGIN
  IF p_slug IS NULL OR p_slug = 'bat' THEN
    RAISE EXCEPTION 'live_auction_board_sync: % is not a board-synced source (BaT is bat_live_pull_run''s)', coalesce(p_slug, 'null');
  END IF;
  SELECT id, coalesce(scraping_config, '{}'::jsonb), coalesce(default_poll_interval_ms, 300000)
    INTO v_src, v_cfg, v_poll_ms
  FROM live_auction_sources WHERE slug = p_slug;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'live_auction_board_sync: live_auction_sources has no % row', p_slug;
  END IF;
  v_poll_ms := greatest(v_poll_ms, 300000);

  IF p_error IS NOT NULL THEN
    UPDATE live_auction_sources
    SET consecutive_failures = coalesce(consecutive_failures, 0) + 1,
        last_sync_error      = left(p_error, 500),
        health_status        = CASE WHEN coalesce(consecutive_failures, 0) + 1 >= 3 THEN 'unhealthy' ELSE 'degraded' END,
        updated_at           = v_now
    WHERE id = v_src;
    RETURN jsonb_build_object('slug', p_slug, 'error', left(p_error, 500));
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _board_lots (
    url text, external_id text, ends timestamptz, bid_cents bigint, bid_count integer, currency text, vehicle_id uuid
  ) ON COMMIT DROP;
  TRUNCATE _board_lots;
  INSERT INTO _board_lots (url, external_id, ends, bid_cents, bid_count, currency)
  SELECT DISTINCT ON (l.external_id) l.url, l.external_id,
         CASE WHEN l.ends ~ '^\d{4}-\d{2}-\d{2}' THEN l.ends::timestamptz END,
         CASE WHEN l.current_bid IS NOT NULL THEN round(l.current_bid * 100)::bigint END,
         l.bid_count, nullif(upper(l.currency), '')
  FROM jsonb_to_recordset(coalesce(p_lots, '[]'::jsonb))
       AS l(url text, external_id text, ends text, current_bid numeric, bid_count integer, currency text)
  WHERE coalesce(l.url, '') <> '' AND coalesce(l.external_id, '') <> ''
  ORDER BY l.external_id;

  UPDATE _board_lots b SET vehicle_id = v.id
  FROM vehicles v
  WHERE v.listing_url = b.url AND v.deleted_at IS NULL;
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  -- lots whose bid count moved since the last read (a first read of a lot with bids counts as moved)
  SELECT coalesce(jsonb_agg(jsonb_build_object('url', b.url, 'external_id', b.external_id, 'vehicle_id', b.vehicle_id,
                                               'bid_count', b.bid_count, 'prev_bid_count', m.bid_count)), '[]'::jsonb)
    INTO v_moved
  FROM _board_lots b
  LEFT JOIN monitored_auctions m ON m.source_id = v_src AND m.external_auction_id = b.external_id
  WHERE coalesce(b.bid_count, 0) > 0 AND b.bid_count IS DISTINCT FROM m.bid_count;

  INSERT INTO monitored_auctions AS m
    (source_id, external_auction_id, external_auction_url, vehicle_id, auction_end_time, is_live,
     current_bid_cents, bid_count, last_synced_at, poll_interval_ms, next_poll_at, priority, stream_state)
  SELECT v_src, b.external_id, b.url, b.vehicle_id, b.ends, coalesce(b.ends > v_now, false),
         b.bid_cents, b.bid_count, v_now, v_poll_ms, v_now + make_interval(secs => v_poll_ms / 1000),
         CASE WHEN b.ends <= v_now + interval '48 hours' THEN 1 ELSE 2 END,
         jsonb_build_object('board', p_slug, 'currency', b.currency, 'bid_changed_at', v_now)
  FROM _board_lots b
  ON CONFLICT (source_id, external_auction_id) DO UPDATE SET
    external_auction_url = excluded.external_auction_url,
    vehicle_id           = coalesce(excluded.vehicle_id, m.vehicle_id),
    auction_end_time     = coalesce(excluded.auction_end_time, m.auction_end_time),
    is_live              = excluded.is_live,
    current_bid_cents    = excluded.current_bid_cents,
    bid_count            = excluded.bid_count,
    last_synced_at       = excluded.last_synced_at,
    poll_interval_ms     = excluded.poll_interval_ms,
    next_poll_at         = excluded.next_poll_at,
    priority             = excluded.priority,
    stream_state         = coalesce(m.stream_state, '{}'::jsonb)
                           || jsonb_build_object('board', p_slug, 'currency', excluded.stream_state ->> 'currency')
                           || CASE WHEN m.current_bid_cents IS DISTINCT FROM excluded.current_bid_cents
                                     OR m.bid_count IS DISTINCT FROM excluded.bid_count
                                   THEN jsonb_build_object('bid_changed_at', v_now) ELSE '{}'::jsonb END;
  GET DIAGNOSTICS v_upsert = ROW_COUNT;

  -- a lot past its end, or absent from a complete board, is off the schedule
  UPDATE monitored_auctions m SET is_live = false
  WHERE m.source_id = v_src AND m.is_live
    AND (m.auction_end_time IS NULL OR m.auction_end_time <= v_now
         OR (p_complete AND NOT EXISTS (SELECT 1 FROM _board_lots b WHERE b.external_id = m.external_auction_id)));
  GET DIAGNOSTICS v_ended = ROW_COUNT;

  UPDATE live_auction_sources
  SET last_successful_sync = v_now,
      consecutive_failures = 0,
      last_sync_error      = NULL,
      health_status        = 'healthy',
      updated_at           = v_now,
      scraping_config      = v_cfg || jsonb_build_object('live_board', coalesce(v_cfg -> 'live_board', '{}'::jsonb) || jsonb_build_object(
                               'writer', 'sync-live-auctions -> live_auction_board_sync',
                               'migration', '20261019020000_live_auction_board_sync',
                               'last_run', jsonb_build_object('at', v_now, 'lots', (SELECT count(*) FROM _board_lots),
                                                              'linked', v_linked, 'upserted', v_upsert, 'ended', v_ended,
                                                              'bid_moved', jsonb_array_length(v_moved), 'complete', p_complete)
                                           || CASE WHEN p_state IS NULL THEN '{}'::jsonb
                                                   ELSE jsonb_build_object('state', left(p_state, 500)) END))
  WHERE id = v_src;

  RETURN jsonb_build_object('slug', p_slug, 'lots', (SELECT count(*) FROM _board_lots), 'linked', v_linked,
                            'upserted', v_upsert, 'ended', v_ended, 'moved', v_moved, 'state', p_state);
END
$fn$;

COMMENT ON FUNCTION public.live_auction_board_sync(text, jsonb, boolean, text, text) IS
  'Schedule writer of monitored_auctions for board-synced houses (collecting-cars, pcarmarket, bonhams, broad-arrow, '
  'gooding; never bat). p_lots: [{url, external_id, ends, current_bid, bid_count, currency}] from one complete read of '
  'the house''s open board; upserts one row per lot (current_bid_cents in the house currency, last_synced_at = this '
  'read), takes lots past their end or absent from a complete board off the schedule, records health on '
  'live_auction_sources, and returns the lots whose bid count moved. p_error records a failed read instead; p_state '
  '(optional) says what the read found, kept as live_board.last_run.state. Called by sync-live-auctions.';
REVOKE ALL ON FUNCTION public.live_auction_board_sync(text, jsonb, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_auction_board_sync(text, jsonb, boolean, text, text) TO service_role;

UPDATE live_auction_sources
SET notes = coalesce(notes || ' ', '') || '2026-11-08: bid.goodingco.com no longer resolves (its CNAME '
            || 'goodingco-webmodule.auctionmobility.com points to "nowhere."; reads failing since 2026-10-28). The catalog '
            || 'lists no Online Only sale ahead (newest: Geared Online | Spring Automobilia, ended 2025-04-18); sales ahead '
            || 'are in-room, bid through christies.com. syncGooding reads the bidding site only when the catalog lists an '
            || 'Online Only sale ahead.',
    scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_board,gate}',
            to_jsonb('cdn.goodingco.com/graphql getVehicles auctionType Online Only, ENDING_SOONEST'::text)),
    updated_at = now()
WHERE slug = 'gooding';

COMMIT;
