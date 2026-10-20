-- Live board: AllCollectorCars' ACC Auctions and Iconic Motorbike Auctions, read every five minutes.
--
-- Both houses run the WordPress auction plugin Ultimate WooCommerce Auction, which server-renders every open lot (id,
-- link, title, image, current or starting bid, close moved by soft-close extensions, categories). One reader in
-- sync-live-auctions (syncUwaHouse; parsers parseUwaBoard / parseUwaLot in boards.ts) writes their open vehicle lots
-- through upsert_live_auction_vehicles with platform_source = the slugs below, ends a house's live rows that left its
-- list ('ended', no outcome claimed), and hands the complete board to live_auction_board_sync, which refuses a slug
-- without a live_auction_sources row.
-- Read 2026-10-20 ~20:00Z: ACC 63 open lots, 58 vehicles (5 automobilia items left out), 56 with a bid, USD, 7-day lots;
-- Iconic 24 open lots, 21 motorcycles (a signed helmet, team leathers and a watch left out), 18 with a bid, USD, 7-day lots.
-- Motorcycles are vehicles here as they are on BaT (60 live BaT rows have canonical_vehicle_type MOTORCYCLE that day).
-- This migration:
--   * declares Iconic's source species before its first row lands (observation_sources; ACC's row has had one since
--     2026-10-18);
--   * adds a live_auction_sources row per house;
--   * adds both platforms to the sync-live-auctions-houses job, keeping every platform it already posts;
--   * enables both houses on the live board (live_board_houses).
-- Contract: supabase/sql/test_live_board_uwa_houses.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.observation_sources (slug, display_name, category, base_url, species, species_set, species_evidence, notes)
VALUES ('iconic-motorbike-auctions', 'Iconic Motorbike Auctions', 'auction', 'https://iconicmotorbikeauctions.com',
  'timed_auction', ARRAY['timed_auction', 'classifieds']::public.source_species[],
  jsonb_build_object(
    'examined_at', '2026-10-20',
    'examined', jsonb_build_array(
      'https://iconicmotorbikeauctions.com/ fetched 2026-10-20',
      'https://iconicmotorbikeauctions.com/auction/1993-muzzy-kawasaki-zx-7r-scott-russell-wsbk/ fetched 2026-10-20'),
    'seen', 'The homepage (its Current auctions) lists 24 lots, each with "Current bid: $11,600 I RESERVE MET" or "Bidding '
            'Open" and a countdown; the 1991 Bimota YB10 Dieci read a close of 13:01:16 PT for a 13:00 slot (soft close). '
            'A lot page carries its bid history and "Reserve price has been met." The menu also offers Classifieds.',
    'extractor', 'sync-live-auctions (syncUwaHouse)'),
  'Motorcycle auctions on Ultimate WooCommerce Auction (WordPress).')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.live_auction_sources
  (slug, display_name, base_url, sync_method, default_poll_interval_ms, auction_duration_typical, has_soft_close,
   is_active, health_status, notes)
VALUES
  ('allcollectorcars', 'ACC Auctions (AllCollectorCars)', 'https://www.allcollectorcars.com/classic-car-auctions/',
   'polling_scrape', 300000, '7 days', true, true, 'unknown',
   'Ultimate WooCommerce Auction (WordPress). sync-live-auctions reads /classic-car-auctions/auctions/ every five minutes '
   'and up to six lot pages a run (bid count, reserve) for lots that are new or whose bid moved.'),
  ('iconic-motorbike-auctions', 'Iconic Motorbike Auctions', 'https://iconicmotorbikeauctions.com/',
   'polling_scrape', 300000, '7 days', true, true, 'unknown',
   'Ultimate WooCommerce Auction (WordPress), motorcycles. sync-live-auctions reads the homepage (its current auctions) '
   'every five minutes and up to two lot pages a run (bid count, reserve) for lots that are new or whose bid moved.')
ON CONFLICT (slug) DO UPDATE SET is_active = true;

-- The job's platforms, read from its own body and extended in place: whatever another reader's migration added stays.
DO $cron$
DECLARE
  v_job  bigint;
  v_cmd  text;
  v_body jsonb;
BEGIN
  SELECT jobid, command INTO v_job, v_cmd FROM cron.job WHERE jobname = 'sync-live-auctions-houses';
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'sync-live-auctions-houses is not scheduled';
  END IF;
  v_body := substring(v_cmd FROM $re$body := '(\{[^']*\})'::jsonb$re$)::jsonb;
  IF v_body IS NULL OR jsonb_typeof(v_body -> 'platforms') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'sync-live-auctions-houses: no platforms list in its command: %', left(v_cmd, 400);
  END IF;
  v_body := jsonb_set(v_body, '{platforms}', (
    SELECT jsonb_agg(p ORDER BY first_seen)
    FROM (SELECT p, min(n) AS first_seen
          FROM (SELECT e.p, e.n FROM jsonb_array_elements_text(v_body -> 'platforms') WITH ORDINALITY AS e(p, n)
                UNION ALL
                SELECT a.p, 1000 + a.n FROM unnest(ARRAY['allcollectorcars', 'iconic-motorbike-auctions']) WITH ORDINALITY AS a(p, n)) s
          GROUP BY p) q));
  PERFORM cron.alter_job(job_id := v_job, command := format($cmd$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/sync-live-auctions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
    body := %L::jsonb,
    timeout_milliseconds := 150000
  );
$cmd$, v_body::text));
END
$cron$;

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note) VALUES
  ('allcollectorcars', 'ACC Auctions', '^https?://([a-z0-9-]+\.)*allcollectorcars\.com/classic-car-auctions/', true,
   'sync-live-auctions-houses, every five minutes (Ultimate WooCommerce Auction reader)'),
  ('iconic-motorbike-auctions', 'Iconic Motorbike Auctions', '^https?://([a-z0-9-]+\.)*iconicmotorbikeauctions\.com/', true,
   'sync-live-auctions-houses, every five minutes (Ultimate WooCommerce Auction reader); motorcycles')
ON CONFLICT (house) DO UPDATE SET enabled = true;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-live-auctions-houses'
                 AND command LIKE '%"allcollectorcars"%' AND command LIKE '%"iconic-motorbike-auctions"%') THEN
    RAISE EXCEPTION 'sync-live-auctions-houses does not post the plugin houses';
  END IF;
  IF (SELECT count(*) FROM public.live_board_houses WHERE enabled AND house IN ('allcollectorcars', 'iconic-motorbike-auctions')) <> 2
     OR (SELECT count(*) FROM public.live_auction_sources WHERE is_active AND slug IN ('allcollectorcars', 'iconic-motorbike-auctions')) <> 2 THEN
    RAISE EXCEPTION 'plugin houses are not enabled on the board and in live_auction_sources';
  END IF;
END
$check$;

COMMIT;
