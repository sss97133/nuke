-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_finish_track_record -f this-file.sql
-- Contract for 20261108213000_finish_track_record.sql. Synthetic rows only; never production.
--   * one count per lot and window, from its last estimate in that window;
--   * the final bid is the hammer when sold and the high bid when the reserve was not met; cancelled lots are left out;
--   * rows made after the close, ungraded rows and models other than 32 and 33 are left out;
--   * rows stamped inside the known clock-fault window are held out and counted in held_out;
--   * anon executes it; no lot, vehicle or prediction id leaves it; it is a definer with a pinned path.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.hammer_predictions') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.auction_events (id uuid PRIMARY KEY, winning_bid numeric, high_bid numeric);
CREATE TABLE public.hammer_predictions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, model_version integer,
  predicted_hammer numeric, predicted_low numeric, predicted_high numeric, predicted_at timestamptz, auction_event_id uuid,
  lot_outcome text, lot_close_at timestamptz);
-- As live: anon reads no grade column of hammer_predictions.
ALTER TABLE public.hammer_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_events ENABLE ROW LEVEL SECURITY;

-- Lots: a sold at 100 (closes 10-20 18:00Z), b reserve not met, high bid 50, c cancelled, d sold at 200 (closes 11-09).
INSERT INTO public.auction_events (id, winning_bid, high_bid) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 100, 100),
  ('b0000000-0000-0000-0000-00000000000b', NULL, 50),
  ('c0000000-0000-0000-0000-00000000000c', NULL, 70),
  ('d0000000-0000-0000-0000-00000000000d', 200, 200);
INSERT INTO public.hammer_predictions (model_version, predicted_low, predicted_hammer, predicted_high, predicted_at,
  auction_event_id, lot_outcome, lot_close_at) VALUES
  -- a, model 33, 24-72 h: two rows; the later (inside) counts, the earlier (above it) does not
  (33, 60,  70,  80, '2026-10-18 10:00Z', 'a0000000-0000-0000-0000-00000000000a', 'sold', '2026-10-20 18:00Z'),
  (33, 90, 110, 130, '2026-10-18 20:00Z', 'a0000000-0000-0000-0000-00000000000a', 'sold', '2026-10-20 18:00Z'),
  -- a, model 33, under 1 h: the final bid is above the range
  (33, 80,  85,  90, '2026-10-20 17:30Z', 'a0000000-0000-0000-0000-00000000000a', 'sold', '2026-10-20 18:00Z'),
  -- a, after the close: left out
  (33, 90, 100, 110, '2026-10-20 18:30Z', 'a0000000-0000-0000-0000-00000000000a', 'sold', '2026-10-20 18:00Z'),
  -- a, model 31: left out
  (31, 90, 100, 110, '2026-10-18 20:00Z', 'a0000000-0000-0000-0000-00000000000a', 'sold', '2026-10-20 18:00Z'),
  -- b, model 33, 24-72 h: graded on the high bid (50), below the range
  (33, 60,  70,  80, '2026-10-18 20:00Z', 'b0000000-0000-0000-0000-00000000000b', 'reserve_not_met', '2026-10-20 18:00Z'),
  -- c, cancelled: left out
  (33, 60,  70,  80, '2026-10-18 20:00Z', 'c0000000-0000-0000-0000-00000000000c', 'cancelled', '2026-10-20 18:00Z'),
  -- d, model 32, 1-6 h: inside, but stamped in the clock-fault window: held out
  (32, 150, 200, 250, '2026-11-07 21:24:30Z', 'd0000000-0000-0000-0000-00000000000d', 'sold', '2026-11-08 01:00Z'),
  -- d, model 32, 6-24 h: inside
  (32, 150, 200, 250, '2026-11-08 12:00Z', 'd0000000-0000-0000-0000-00000000000d', 'sold', '2026-11-09 01:00Z'),
  -- an ungraded model 33 row: left out
  (33, 60,  70,  80, '2026-11-08 12:00Z', NULL, NULL, NULL);

\ir ../migrations/20261108213000_finish_track_record.sql

SET ROLE anon;
CREATE TEMP TABLE r AS SELECT public.finish_track_record() AS j;
RESET ROLE;

CREATE TEMP TABLE rows AS
SELECT (x->>0)::int AS model, (x->>1)::int AS from_hours, (x->>2)::int AS to_hours, (x->>3)::int AS lots,
       (x->>4)::int AS inside, (x->>5)::int AS below, (x->>6)::int AS above, (x->>7)::int AS sold,
       (x->>8)::numeric AS median_miss_pct, (x->>9)::timestamptz AS first_close, (x->>10)::timestamptz AS last_close
FROM r, jsonb_array_elements(r.j->'rows') x;

SELECT pg_temp.ok('columns named in order', (SELECT j->'columns' FROM r) = '["model","from_hours","to_hours","lots","inside","below","above","sold","median_miss_pct","first_close","last_close"]'::jsonb);
SELECT pg_temp.ok('three windows graded', (SELECT count(*) FROM rows) = 3);
SELECT pg_temp.ok('model 33 24-72 h: lot a by its last estimate (inside), lot b on its high bid (below)',
  EXISTS (SELECT FROM rows WHERE model = 33 AND from_hours = 24 AND to_hours = 72 AND lots = 2 AND inside = 1 AND below = 1
          AND above = 0 AND sold = 1 AND median_miss_pct = 25.0));
SELECT pg_temp.ok('model 33 under 1 h: above the range, miss 15%',
  EXISTS (SELECT FROM rows WHERE model = 33 AND from_hours = 0 AND to_hours = 1 AND lots = 1 AND above = 1 AND median_miss_pct = 15.0));
SELECT pg_temp.ok('model 32 6-24 h: inside; the clock-fault row is not graded in 1-6 h',
  EXISTS (SELECT FROM rows WHERE model = 32 AND from_hours = 6 AND lots = 1 AND inside = 1)
  AND NOT EXISTS (SELECT FROM rows WHERE model = 32 AND from_hours = 1));
SELECT pg_temp.ok('no window for model 31 or cancelled lots', NOT EXISTS (SELECT FROM rows WHERE model NOT IN (32, 33))
  AND (SELECT sum(lots) FROM rows) = 4);
SELECT pg_temp.ok('close dates span the graded lots',
  (SELECT min(first_close) FROM rows) = '2026-10-20 18:00Z' AND (SELECT max(last_close) FROM rows) = '2026-11-09 01:00Z');
SELECT pg_temp.ok('held_out names the window, its rows and why',
  (SELECT (j->'held_out'->0->>'rows')::int FROM r) = 1
  AND (SELECT (j->'held_out'->0->>'from')::timestamptz FROM r) = '2026-11-07 21:24Z'
  AND (SELECT j->'held_out'->0->>'reason' FROM r) LIKE '%clock%');
SELECT pg_temp.ok('no id leaves the reader',
  (SELECT j::text FROM r) !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
SELECT pg_temp.ok('anon still reads no prediction row directly', NOT has_table_privilege('anon', 'public.hammer_predictions', 'SELECT'));
SELECT pg_temp.ok('definer, stable, pinned path, not public',
  (SELECT prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public, pg_temp']
   FROM pg_proc WHERE oid = 'public.finish_track_record()'::regprocedure)
  AND has_function_privilege('anon', 'public.finish_track_record()', 'EXECUTE'));
