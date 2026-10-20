-- Mecum on the live board, inside its sales' run days only.
--
-- WHY (measured 2026-10-20 19:40Z): live_auction_sources 'mecum' held no open monitored lot and last synced 2026-02-18;
-- sync-live-auctions' Mecum reader was a Firecrawl page scrape no job called. Mecum's public lot index (the Algolia
-- index its own site search reads, which extract-mecum already lands from) is current to the minute: on Nashville 2026's
-- 24 Sep run day its rows changed in docket order as each lot crossed the block (lot T1 first, 411 that day). The next
-- sale, Dallas/Fort Worth 2026, runs 21-24 Oct (1,258 lots, 1,119 vehicles); nothing else is bid-open (the 139 lots
-- taking online pre-bids are Road Art, not vehicles).
--
-- WHAT: sync-live-auctions reads the index's calendar every five minutes (one request). Inside a sale's run days it reads
-- the lots of yesterday, today and tomorrow: a car is live on its run day (from the day's start the index states until 24
-- hours later) until the index records it crossed the block, sold or the bid goes on; a lot with an online pre-bid is
-- live before its day. Live lots go through upsert_live_auction_vehicles and live_auction_board_sync as for the other
-- houses. This migration
--   * adds end_live_auction_lots(p_lots): lots the house itself reports closed (crossed the block, sold, passed, their day
--     over). Each vehicles row of those URLs that is auction_live becomes ended; it takes the closing bid in high_bid when
--     one is stated (a bid, never a sale price; the result is settlement's) and its auction_end_date becomes the stated
--     close time, else the earlier of its scheduled close and this read. Rows in any other state, and URLs with no row, are
--     untouched; nothing is inserted. It is the evidence-led sibling of end_live_auctions_absent, which ends by absence
--     from a complete list and only rows carrying the platform_source: Mecum's lots in vehicles were landed without one
--     (the 1955 Thunderbird of 21 Oct, lot W290, reads platform_source null), and a run day's live list empties as its
--     lots cross;
--   * adds Mecum to live_board_houses (enabled), so market_pulse_live_houses reads its live lots;
--   * adds 'mecum' to the platforms the sync-live-auctions-houses job posts, appended to whatever list the job carries now.
-- Contract: supabase/sql/test_mecum_live_board.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.end_live_auction_lots(p_lots jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '30s'
AS $fn$
DECLARE
  v_now text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_n   integer := 0;
BEGIN
  WITH closed AS (
    SELECT DISTINCT ON (rtrim(l.url, '/')) rtrim(l.url, '/') AS u,
           CASE WHEN l.closing_bid > 0 AND l.closing_bid < 2147483647 THEN round(l.closing_bid)::integer END AS bid,
           CASE WHEN l.ended_at ~ '^\d{4}-\d{2}-\d{2}T' THEN l.ended_at END AS ended_at
    FROM jsonb_to_recordset(coalesce(p_lots, '[]'::jsonb)) AS l(url text, closing_bid numeric, ended_at text)
    WHERE coalesce(l.url, '') <> ''
    ORDER BY rtrim(l.url, '/')
  ), gone AS (
    UPDATE vehicles v
       SET sale_status      = 'ended',
           auction_status   = 'ended',
           high_bid         = coalesce(c.bid, v.high_bid),
           auction_end_date = coalesce(c.ended_at, least(v.auction_end_date, v_now)),
           updated_at       = now()
      FROM closed c
     WHERE v.listing_url = ANY (ARRAY[c.u, c.u || '/'])
       AND v.sale_status = 'auction_live'
       AND v.deleted_at IS NULL
    RETURNING v.id
  )
  SELECT count(*) INTO v_n FROM gone;
  RETURN v_n;
END
$fn$;
REVOKE ALL ON FUNCTION public.end_live_auction_lots(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_live_auction_lots(jsonb) TO service_role;
COMMENT ON FUNCTION public.end_live_auction_lots(jsonb) IS
  'sync-live-auctions, for houses that report each lot''s close (Mecum: crossed the block or its run day over). '
  'p_lots: [{url, closing_bid, ended_at}]. Each auction_live vehicles row of those URLs (with or without a trailing '
  'slash) becomes ended, high_bid takes the closing bid when stated (a bid, not a sale price), auction_end_date the '
  'stated close or the earlier of its scheduled close and now. Other rows untouched, nothing inserted. Returns rows ended.';

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note)
VALUES ('mecum', 'Mecum Auctions', '^https?://([a-z0-9-]+\.)*mecum\.com/', true,
        'sync-live-auctions-houses, every five minutes: the public lot index; live only on a lot''s run day (or with an online pre-bid)')
ON CONFLICT (house) DO UPDATE SET enabled = true;

DO $job$
DECLARE
  v_job  bigint;
  v_cmd  text;
  v_old  text;
  v_body jsonb;
BEGIN
  SELECT jobid, command INTO v_job, v_cmd FROM cron.job WHERE jobname = 'sync-live-auctions-houses';
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'sync-live-auctions-houses is not scheduled (20261019021000_live_auction_board_sync_health)';
  END IF;
  v_old := substring(v_cmd FROM $re$body := '(\{[^']*\})'::jsonb$re$);
  IF v_old IS NULL OR jsonb_typeof(v_old::jsonb -> 'platforms') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'sync-live-auctions-houses: no platforms list in its body';
  END IF;
  v_body := v_old::jsonb;
  IF NOT (v_body -> 'platforms') ? 'mecum' THEN
    v_body := jsonb_set(v_body, '{platforms}', (v_body -> 'platforms') || '["mecum"]'::jsonb);
    PERFORM cron.alter_job(job_id := v_job, command := replace(v_cmd, v_old, v_body::text));
  END IF;
END
$job$;

COMMIT;
