-- Isolated PostgreSQL 17 contract for 20261007123000_live_lot_temperature_at.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_live_lot_reader_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_live_lot_reader_ci -f supabase/sql/test_live_lot_reader.sql
-- Fixture: the minimal shape of the tables the reader touches (vehicles, auction_events, auction_comments,
-- vehicle_observations, hammer_predictions, monitored_auctions). The migration is applied as shipped (\ir), twice
-- (CREATE OR REPLACE and the guarded grants make it idempotent).
--
-- What this proves, each with a value computed by hand below:
--   1. Position: where a live bid and bidder count sit among the cohort's comparables the same time before THEIR close.
--   2. Band: from the standing bid (the hammer is never below it) to the k-th smallest hammer/bid ratio of the
--      comparables, k = ceil(0.8 (n + 1)); with 12 comparables k = 11.
--   3. Point in time: a bid posted after p_at, a live frame observed after p_at, a prediction made after p_at, and a lot
--      that closed after p_at (or inside the 1 hour settle window) change nothing in the read.
--   4. Cohort miss: no lot has the model text -> the reason and the denominators; the model family resolves another.
--   5. Minutes regime: lots with a recorded clock, read the same time before their SCHEDULED close, not before the
--      close the soft-close extension moved; a lot that was extended before that moment drops out (no extension yet).
--   6. Soft-close extension seen: no band, the reason and the floor.
--   7. Grants (service_role only), STABLE, SECURITY INVOKER, writes nothing (read-only transaction and no xid).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- The three Supabase API roles must exist before the migration applies, so its REVOKE/GRANT block runs and the
-- ACL assertions below read real grants. A freshly CREATEd function gets EXECUTE for PUBLIC by default.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, make text, model text, normalized_model text, year integer,
  deleted_at timestamptz, merged_into_vehicle_id uuid
);
-- The family level reads vehicles by (lower(make), lower(normalized_model)), as the production index does.
CREATE INDEX ON public.vehicles (lower(make), lower(normalized_model));
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY, vehicle_id uuid NOT NULL REFERENCES public.vehicles(id), source text, source_url text,
  outcome text, auction_end_date timestamptz, winning_bid numeric, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auction_event_id uuid, comment_type text, posted_at timestamptz,
  bid_amount numeric, author_username text, hours_until_close numeric
);
CREATE INDEX ON public.auction_comments (auction_event_id);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, extraction_method text,
  observed_at timestamptz, ingested_at timestamptz
);
CREATE TABLE public.hammer_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, model_version integer NOT NULL,
  predicted_low numeric, predicted_hammer numeric NOT NULL, predicted_high numeric, price_tier text,
  comp_count integer, predicted_at timestamptz NOT NULL
);
CREATE TABLE public.monitored_auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, external_auction_id text, stream_state jsonb DEFAULT '{}'::jsonb
);

\ir ../migrations/20261007123000_live_lot_temperature_at.sql
\ir ../migrations/20261007123000_live_lot_temperature_at.sql

-- ---------------------------------------------------------------------------------------------------------------
-- Fixture builders
-- ---------------------------------------------------------------------------------------------------------------
-- One lot: a vehicle, its auction_events row (BaT URL from the slug), and the event id back.
CREATE FUNCTION pg_temp.mk_lot(p_make text, p_model text, p_slug text, p_end timestamptz, p_outcome text, p_hammer numeric,
                               p_family text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid(); e uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.vehicles (id, make, model, normalized_model, year) VALUES (v, p_make, p_model, p_family, 2000);
  INSERT INTO public.auction_events (id, vehicle_id, source, source_url, outcome, auction_end_date, winning_bid, updated_at)
    VALUES (e, v, 'bat', 'https://bringatrailer.com/listing/' || p_slug, p_outcome, p_end, p_hammer, p_end);
  RETURN e;
END $$;
CREATE FUNCTION pg_temp.mk_bid(p_event uuid, p_at timestamptz, p_amount numeric, p_user text, p_huc numeric DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.auction_comments (auction_event_id, comment_type, posted_at, bid_amount, author_username, hours_until_close)
  VALUES (p_event, 'bid', p_at, p_amount, p_user, p_huc);
$$;
CREATE FUNCTION pg_temp.vehicle_of(p_event uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT vehicle_id FROM public.auction_events WHERE id = p_event;
$$;
-- A lot the public live collector followed: three bid rows long before the scheduled close O (their hours_until_close
-- count to O, as the collector writes them), the pre-window high bid p_pre, and, when p_hammer > p_pre, one bid inside
-- the last 2 minutes (60 s before O) that extended the close to O + 60 s. Its hours_until_close counts to that
-- extended close (120 s), not to O.
-- A followed lot whose chain bids were written by a read AFTER the close: four bids at O - 100 s, O - 40 s, O + 30 s and
-- O + 110 s (the close moved to the last plus 120 s, O + 230 s), each with hours_until_close counting to that FINAL close,
-- so four rows agree on the final close and only the three early rows agree on O. A vote that took the most agreed
-- value would read O + 230 s as the scheduled close and see the lot's last bid at 120 s before it.
CREATE FUNCTION pg_temp.mk_reread_lot(p_slug text, p_sched timestamptz, p_pre numeric, p_hammer numeric)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e uuid; f timestamptz := p_sched + interval '230 seconds';
BEGIN
  e := pg_temp.mk_lot('StreamMake', 'reread', p_slug, f, 'sold', p_hammer);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '3 hours', p_pre - 200, 'a', 3);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '2 hours', p_pre - 100, 'b', 2);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '30 minutes', p_pre, 'c', 0.5);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '100 seconds', p_pre + 100, 'd', 330.0 / 3600);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '40 seconds', p_pre + 300, 'e', 270.0 / 3600);
  PERFORM pg_temp.mk_bid(e, p_sched + interval '30 seconds', p_pre + 600, 'f', 200.0 / 3600);
  PERFORM pg_temp.mk_bid(e, p_sched + interval '110 seconds', p_hammer, 'g', 120.0 / 3600);
  INSERT INTO public.monitored_auctions (vehicle_id, external_auction_id, stream_state)
    VALUES (pg_temp.vehicle_of(e), p_slug, jsonb_build_object('last_frame_received_at', p_sched::text));
  RETURN e;
END $$;
-- A followed lot with three bids inside the last 120 s, written live (each counts its hours_until_close to its own
-- bid time + 120 s): c1 at O - 100 s, c2 at O - 50 s, c3 at O + 10 s (the hammer). The close ends at O + 130 s.
CREATE FUNCTION pg_temp.mk_chain_lot(p_slug text, p_sched timestamptz, p_pre numeric, p_c1 numeric, p_c2 numeric, p_c3 numeric)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e uuid;
BEGIN
  e := pg_temp.mk_lot('StreamMake', 'chain', p_slug, p_sched + interval '130 seconds', 'sold', p_c3);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '3 hours', p_pre - 200, 'a', 3);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '2 hours', p_pre - 100, 'b', 2);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '30 minutes', p_pre, 'c', 0.5);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '100 seconds', p_c1, 'd', 120.0 / 3600);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '50 seconds', p_c2, 'e', 120.0 / 3600);
  PERFORM pg_temp.mk_bid(e, p_sched + interval '10 seconds', p_c3, 'f', 120.0 / 3600);
  INSERT INTO public.monitored_auctions (vehicle_id, external_auction_id, stream_state)
    VALUES (pg_temp.vehicle_of(e), p_slug, jsonb_build_object('last_frame_received_at', p_sched::text));
  RETURN e;
END $$;
CREATE FUNCTION pg_temp.mk_stream_lot(p_make text, p_model text, p_slug text, p_sched timestamptz, p_pre numeric, p_hammer numeric)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e uuid; f timestamptz := CASE WHEN p_hammer > p_pre THEN p_sched + interval '60 seconds' ELSE p_sched END;
BEGIN
  e := pg_temp.mk_lot(p_make, p_model, p_slug, f, 'sold', p_hammer);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '3 hours', p_pre - 200, 'a', 3);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '2 hours', p_pre - 100, 'b', 2);
  PERFORM pg_temp.mk_bid(e, p_sched - interval '30 minutes', p_pre, 'c', 0.5);
  IF p_hammer > p_pre THEN
    PERFORM pg_temp.mk_bid(e, p_sched - interval '60 seconds', p_hammer, 'd', 120.0 / 3600);
  END IF;
  INSERT INTO public.monitored_auctions (vehicle_id, external_auction_id, stream_state)
    VALUES (pg_temp.vehicle_of(e), p_slug, jsonb_build_object('last_frame_received_at', p_sched::text));
  RETURN e;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Fixture 1, the hours regime. Cohort TestMake / Alpha: 12 sold lots, lot j closes 2026-01-01 12:00 + j days.
-- Lot j had b1 = 1000 + 100 j and k = 2 + (j mod 4) distinct bidders 26 h before its close; its hammer is
-- b1 * ratio_j. Later bids (2 h and 10 min before the close) exist and must not count at 24 h.
--   ratio_j: 1.2 1.25 1.3 1.35 1.4 1.45 1.5 1.55 1.6 1.7 1.8 2.0
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  j int; n int; e uuid; f timestamptz; b1 numeric; h numeric; k int;
  ratios numeric[] := ARRAY[1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6, 1.7, 1.8, 2.0];
BEGIN
  FOR j IN 1..12 LOOP
    f := timestamptz '2026-01-01 12:00:00+00' + j * interval '1 day';
    b1 := 1000 + 100 * j; h := b1 * ratios[j]; k := 2 + (j % 4);
    e := pg_temp.mk_lot('TestMake', 'Alpha', 'alpha-' || j, f, 'sold', h);
    FOR n IN 1..k LOOP
      PERFORM pg_temp.mk_bid(e, f - interval '48 hours' + n * interval '10 minutes', b1 - 50 * (k - n), 'bidder' || n);
    END LOOP;
    PERFORM pg_temp.mk_bid(e, f - interval '2 hours', h - 100, 'late1');
    PERFORM pg_temp.mk_bid(e, f - interval '10 minutes', h, 'late2');
  END LOOP;
END $$;

-- The live lot: closes 2026-02-01 12:00; read 24 h before. Its rows: two before p_at, one after.
SELECT pg_temp.mk_lot('TestMake', 'Alpha', 'alpha-live', timestamptz '2026-02-01 12:00:00+00', 'live', NULL) AS live_e \gset
SELECT pg_temp.vehicle_of(:'live_e') AS live_v \gset
SELECT pg_temp.mk_bid(:'live_e', timestamptz '2026-01-30 09:00:00+00', 1500, 'x1');
SELECT pg_temp.mk_bid(:'live_e', timestamptz '2026-01-30 09:30:00+00', 1650, 'x2');

-- Decoys that must never enter the read at p_at = 2026-01-31 12:00:
--   a lot that closed 3 h AFTER p_at (not yet closed), and one that closed 30 min before it (inside the 1 h settle
--   window). Both are sold with bid logs that reproduce the hammer and an absurd ratio (50x).
DO $$
DECLARE e uuid;
BEGIN
  e := pg_temp.mk_lot('TestMake', 'Alpha', 'alpha-decoy-after', timestamptz '2026-01-31 15:00:00+00', 'sold', 100000);
  PERFORM pg_temp.mk_bid(e, timestamptz '2026-01-30 12:00:00+00', 2000, 'dd1');
  PERFORM pg_temp.mk_bid(e, timestamptz '2026-01-31 14:00:00+00', 100000, 'dd2');
  e := pg_temp.mk_lot('TestMake', 'Alpha', 'alpha-decoy-settle', timestamptz '2026-01-31 11:30:00+00', 'sold', 100000);
  PERFORM pg_temp.mk_bid(e, timestamptz '2026-01-30 10:00:00+00', 2000, 'ds1');
  PERFORM pg_temp.mk_bid(e, timestamptz '2026-01-31 11:00:00+00', 100000, 'ds2');
END $$;
-- A lot that closed more than 365 days before every read below (2024-12-01; the earliest read is 2026-01-09): sold, its
-- log reproduces its hammer, ratio 50. The window leaves it out of the cohort and of its counts.
DO $$
DECLARE e uuid;
BEGIN
  e := pg_temp.mk_lot('TestMake', 'Alpha', 'alpha-old', timestamptz '2024-12-01 12:00:00+00', 'sold', 100000);
  PERFORM pg_temp.mk_bid(e, timestamptz '2024-11-26 12:00:00+00', 2000, 'old1');
  PERFORM pg_temp.mk_bid(e, timestamptz '2024-12-01 11:00:00+00', 100000, 'old2');
END $$;
-- Another model's lot (never in this cohort) and a lot that did not sell (never a comparable).
DO $$
DECLARE e uuid;
BEGIN
  e := pg_temp.mk_lot('TestMake', 'Other', 'other-1', timestamptz '2026-01-20 12:00:00+00', 'sold', 90000);
  PERFORM pg_temp.mk_bid(e, timestamptz '2026-01-10 12:00:00+00', 1000, 'o1');
  PERFORM pg_temp.mk_bid(e, timestamptz '2026-01-20 11:00:00+00', 90000, 'o2');
  e := pg_temp.mk_lot('TestMake', 'Alpha', 'alpha-rnm', timestamptz '2026-01-20 12:00:00+00', 'reserve_not_met', NULL);
  PERFORM pg_temp.mk_bid(e, timestamptz '2026-01-19 12:00:00+00', 1800, 'r1');
END $$;
-- The stored model-31 band for the live lot: one made before p_at, one after.
INSERT INTO public.hammer_predictions (vehicle_id, model_version, predicted_low, predicted_hammer, predicted_high, price_tier, comp_count, predicted_at)
VALUES (:'live_v', 31, 2000, 2800, 4200, 'a', 400, timestamptz '2026-01-28 08:00:00+00'),
       (:'live_v', 31, 9000, 9500, 9900, 'a', 400, timestamptz '2026-02-01 08:00:00+00'),
       (:'live_v', 24, 1, 2, 3, 'a', 1, timestamptz '2026-01-29 08:00:00+00');

-- One live frame held before the read (observed and ingested before p_at): the coverage block counts it.
INSERT INTO public.vehicle_observations (vehicle_id, extraction_method, observed_at, ingested_at)
VALUES (:'live_v', 'bat_public_live_v1', timestamptz '2026-01-31 11:50:00+00', timestamptz '2026-01-31 11:50:30+00');

-- ---------------------------------------------------------------------------------------------------------------
-- 1 + 2. The read at 24 h before the close: bid 1650, 4 bidders.
--   Comparables' bids at 24 h before their close: 1100 1200 ... 2200 (12 lots).
--     below 1650: 1100 1200 1300 1400 1500 1600 = 6; same 0; above 6; percentile (6 + 0)/12 = 0.5.
--   Comparables' bidders at 24 h: lot j has 2 + (j mod 4) = 3 4 5 2 3 4 5 2 3 4 5 2.
--     below 4: 3 2 3 2 3 2 = 6; same 4: 3; above 3; percentile (6 + 1.5)/12 = 0.625.
--   Ratios sorted: 1.2 ... 2.0. The hammer is never below the standing bid, so the band runs from the bid up to the
--     k-th smallest ratio, k = ceil(0.8 (n + 1)); n = 12: k = ceil(10.4) = 11, the 11th is 1.8.
--     low = 1650 (the bid); high = ceil(1650 * 1.8) = 2970;
--     median of the 12 = (1.45 + 1.5)/2 = 1.475, mid = round(1650 * 1.475) = round(2433.75) = 2434;
--     coverage if exchangeable k/(n + 1) = 11/13 = 0.8462.
-- ---------------------------------------------------------------------------------------------------------------
SELECT public.live_lot_temperature_at(:'live_e', 1650, 4, timestamptz '2026-01-31 12:00:00+00') AS r0 \gset
SELECT pg_temp.ok('status ok in the hours regime',
  :'r0'::jsonb ->> 'status' = 'ok' AND :'r0'::jsonb #>> '{clock,regime}' = 'hours');
SELECT pg_temp.ok('clock: 24 h left, the close comes from auction_events',
  (:'r0'::jsonb #>> '{clock,seconds_left}')::numeric = 86400 AND :'r0'::jsonb #>> '{clock,ends_at_source}' = 'auction_events.auction_end_date');
SELECT pg_temp.ok('cohort: exact make and model text, level 1, key shown',
  (:'r0'::jsonb #>> '{cohort,level}')::int = 1 AND :'r0'::jsonb #>> '{cohort,key,model}' = 'Alpha' AND :'r0'::jsonb #>> '{cohort,key,make}' = 'TestMake');
SELECT pg_temp.ok('cohort: 12 comparables of a denominator of 12 sold lots (decoys, the unsold and other models out)',
  (:'r0'::jsonb #>> '{cohort,n_comparables}')::int = 12 AND (:'r0'::jsonb #>> '{cohort,denominator}')::int = 12
  AND (:'r0'::jsonb #>> '{cohort,funnel,closed_lots}')::int = 13 AND (:'r0'::jsonb #>> '{cohort,funnel,sold_with_hammer}')::int = 12);
SELECT pg_temp.ok('position price: 6 below, 0 same, 6 above, percentile 0.5 (hand computed)',
  (:'r0'::jsonb #>> '{position,price,n}')::int = 12 AND (:'r0'::jsonb #>> '{position,price,below}')::int = 6
  AND (:'r0'::jsonb #>> '{position,price,same}')::int = 0 AND (:'r0'::jsonb #>> '{position,price,above}')::int = 6
  AND (:'r0'::jsonb #>> '{position,price,percentile}')::numeric = 0.5);
SELECT pg_temp.ok('position bidders: 6 below, 3 same, 3 above, percentile 0.625 (hand computed)',
  (:'r0'::jsonb #>> '{position,bidders,below}')::int = 6 AND (:'r0'::jsonb #>> '{position,bidders,same}')::int = 3
  AND (:'r0'::jsonb #>> '{position,bidders,above}')::int = 3 AND (:'r0'::jsonb #>> '{position,bidders,percentile}')::numeric = 0.625);
SELECT pg_temp.ok('band: ratio 1 (the bid) up to the 11th of 12 ratios, 1.8; n 12 of 12; method named',
  (:'r0'::jsonb #>> '{band,ratio_low}')::numeric = 1 AND (:'r0'::jsonb #>> '{band,ratio_high}')::numeric = 1.8
  AND (:'r0'::jsonb #>> '{band,rank_high}')::int = 11
  AND (:'r0'::jsonb #>> '{band,n}')::int = 12 AND (:'r0'::jsonb #>> '{band,denominator}')::int = 12
  AND :'r0'::jsonb #>> '{band,method}' = 'cohort_ratio_upper_order_statistic' AND (:'r0'::jsonb #>> '{band,level}')::numeric = 0.8);
SELECT pg_temp.ok('band dollars: low 1650 (the bid), mid 2434, high 2970 (hand computed)',
  (:'r0'::jsonb #>> '{band,low}')::numeric = 1650 AND (:'r0'::jsonb #>> '{band,mid}')::numeric = 2434 AND (:'r0'::jsonb #>> '{band,high}')::numeric = 2970);
SELECT pg_temp.ok('band: coverage if exchangeable is 11/13',
  (:'r0'::jsonb #>> '{band,coverage_if_exchangeable}')::numeric = 0.8462);
SELECT pg_temp.ok('band as of the clock it was read at',
  (:'r0'::jsonb #>> '{band,as_of}')::timestamptz = timestamptz '2026-01-31 12:00:00+00');
SELECT pg_temp.ok('no cohort miss, no band_unavailable',
  :'r0'::jsonb -> 'cohort_miss' = 'null'::jsonb AND :'r0'::jsonb -> 'band_unavailable' = 'null'::jsonb);
SELECT pg_temp.ok('prior: the model-31 row made before p_at, not the later one and not model 24',
  (:'r0'::jsonb #>> '{prior,low}')::numeric = 2000 AND (:'r0'::jsonb #>> '{prior,high}')::numeric = 4200
  AND (:'r0'::jsonb #>> '{prior,model_version}')::int = 31);
SELECT pg_temp.ok('coverage: the lot''s own two bid rows at or before p_at, max bid 1650, agrees with the input',
  (:'r0'::jsonb #>> '{coverage,bid_rows,n}')::int = 2 AND (:'r0'::jsonb #>> '{coverage,bid_rows,max_bid}')::numeric = 1650
  AND (:'r0'::jsonb #>> '{coverage,bid_rows,agrees_with_input_bid}')::boolean);
SELECT pg_temp.ok('coverage: one live frame held, in one of the last 15 minutes',
  (:'r0'::jsonb #>> '{coverage,live_frames,n}')::int = 1 AND (:'r0'::jsonb #>> '{coverage,live_frames,minutes_with_a_frame_of_last_15}')::int = 1);

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Point in time: add what did not exist at p_at; the read is identical.
-- ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.mk_bid(:'live_e', timestamptz '2026-01-31 12:00:01+00', 99999, 'future');   -- one second after p_at
INSERT INTO public.vehicle_observations (vehicle_id, extraction_method, observed_at, ingested_at) VALUES
  (:'live_v', 'bat_public_live_v1', timestamptz '2026-01-31 12:05:00+00', timestamptz '2026-01-31 12:05:01+00'),  -- observed after
  (:'live_v', 'bat_public_live_v1', timestamptz '2026-01-31 11:59:00+00', timestamptz '2026-01-31 12:30:00+00');  -- observed before, ingested after
INSERT INTO public.hammer_predictions (vehicle_id, model_version, predicted_low, predicted_hammer, predicted_high, price_tier, comp_count, predicted_at)
VALUES (:'live_v', 31, 1, 2, 3, 'a', 1, timestamptz '2026-01-31 12:00:01+00');
SELECT public.live_lot_temperature_at(:'live_e', 1650, 4, timestamptz '2026-01-31 12:00:00+00') AS r1 \gset
SELECT pg_temp.ok('a bid, a frame, a frame ingested later and a prediction after p_at change nothing in the read',
  :'r0'::jsonb = :'r1'::jsonb);

-- The same lot, read earlier: lots 11 and 12 had not closed an hour before p_at, so n is 10 (ratios 1.2 .. 1.7).
--   p_at = lot 10's close + 2 h = 2026-01-11 14:00 (lot 11 closes 01-12 12:00, so lots 1..10 are settled);
--   the clock given 24 h ahead. n = 10: k = ceil(11 * 0.8) = ceil(8.8) = 9, the 9th ratio is 1.6.
SELECT public.live_lot_temperature_at(:'live_e', 1650, 4, timestamptz '2026-01-11 14:00:00+00', timestamptz '2026-01-12 14:00:00+00') AS r2 \gset
SELECT pg_temp.ok('read earlier: 10 comparables, rank 9, ratio_high 1.6, high ceil(1650 * 1.6) = 2640, the clock came from the argument',
  (:'r2'::jsonb #>> '{band,n}')::int = 10 AND (:'r2'::jsonb #>> '{band,rank_high}')::int = 9
  AND (:'r2'::jsonb #>> '{band,ratio_high}')::numeric = 1.6 AND (:'r2'::jsonb #>> '{band,high}')::numeric = 2640
  AND :'r2'::jsonb #>> '{clock,ends_at_source}' = 'argument');
-- Earlier still: only lots 1..8 are settled (8 < 9 sold lots): no band; the miss names the count it found.
SELECT public.live_lot_temperature_at(:'live_e', 1650, 4, timestamptz '2026-01-09 14:00:00+00', timestamptz '2026-01-10 14:00:00+00') AS r3 \gset
SELECT pg_temp.ok('8 sold lots: no band, the miss says fewer than 9 and counts them, band_unavailable carries the minimum',
  :'r3'::jsonb -> 'band' = 'null'::jsonb
  AND :'r3'::jsonb #>> '{cohort_miss,reason}' = 'fewer than 9 sold BaT lots have this make and model text'
  AND (:'r3'::jsonb #>> '{cohort_miss,denominator,sold_with_this_text}')::int = 8
  AND (:'r3'::jsonb #>> '{band_unavailable,min_n}')::int = 9 AND (:'r3'::jsonb #>> '{band_unavailable,sold_lots_found}')::int = 8);

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Cohort miss. (a) a model text no lot has, on a vehicle with no normalized_model: nothing wider to try;
--    (b) a model text no lot has, in a model family of 10 sold lots (level 2); (c) a family of only 3 sold lots.
-- ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.mk_lot('TestMake', 'Zeta 9000 Special Edition', 'zeta-live', timestamptz '2026-02-01 12:00:00+00', 'live', NULL) AS zeta_e \gset
SELECT public.live_lot_temperature_at(:'zeta_e', 5000, 3, timestamptz '2026-01-31 12:00:00+00') AS rz \gset
SELECT pg_temp.ok('miss (a): status ok, no band, the reason and the denominators, nothing resolved it, no family to widen to',
  :'rz'::jsonb ->> 'status' = 'ok' AND :'rz'::jsonb -> 'band' = 'null'::jsonb
  AND :'rz'::jsonb #>> '{cohort_miss,reason}' = 'no closed BaT lot has this make and model text'
  AND (:'rz'::jsonb #>> '{cohort_miss,denominator,closed_lots_with_this_text}')::int = 0
  AND (:'rz'::jsonb #>> '{cohort_miss,denominator,sold_with_this_text}')::int = 0
  AND (:'rz'::jsonb #>> '{cohort_miss,denominator,closed_lots_in_the_model_family}')::int = 0
  AND (:'rz'::jsonb #>> '{cohort_miss,denominator,vehicles_with_this_make_to_10000}')::int =
      (SELECT count(*)::int FROM public.vehicles WHERE make = 'TestMake')
  AND :'rz'::jsonb #> '{cohort_miss,resolved_by}' = 'null'::jsonb
  AND :'rz'::jsonb #> '{cohort_miss,model_family}' = 'null'::jsonb
  AND :'rz'::jsonb #>> '{cohort_miss,family_note}' LIKE '%no normalized_model%'
  AND :'rz'::jsonb #> '{cohort,level}' = 'null'::jsonb
  AND :'rz'::jsonb #>> '{band_unavailable,reason}' = 'no cohort: see cohort_miss');

DO $$
DECLARE j int; e uuid; f timestamptz;
BEGIN
  FOR j IN 1..10 LOOP
    f := timestamptz '2026-01-02 12:00:00+00' + j * interval '1 day';
    e := pg_temp.mk_lot('TestMake', CASE WHEN j % 2 = 0 THEN 'Omega Crew' ELSE 'Omega' END, 'omega-' || j, f, 'sold', 3000 + 100 * j, 'Omega');
    PERFORM pg_temp.mk_bid(e, f - interval '30 hours', 2000, 'p' || j);       -- 2000 by 24 h before the close
    PERFORM pg_temp.mk_bid(e, f - interval '1 hour', 3000 + 100 * j, 'q' || j); -- the hammer
  END LOOP;
  FOR j IN 1..3 LOOP    -- a family of three
    f := timestamptz '2026-01-02 12:00:00+00' + j * interval '1 day';
    e := pg_temp.mk_lot('TestMake', 'Sigma ' || j, 'sigma-' || j, f, 'sold', 3000, 'Sigma');
    PERFORM pg_temp.mk_bid(e, f - interval '30 hours', 2000, 's' || j);
    PERFORM pg_temp.mk_bid(e, f - interval '1 hour', 3000, 't' || j);
  END LOOP;
END $$;
SELECT pg_temp.mk_lot('TestMake', 'Omega Crew Cab Duramax', 'omega-live', timestamptz '2026-02-01 12:00:00+00', 'live', NULL, 'Omega') AS omega_e \gset
SELECT public.live_lot_temperature_at(:'omega_e', 2000, 2, timestamptz '2026-01-31 12:00:00+00') AS ro \gset
-- ratios (3000 + 100 j)/2000 for j = 1..10: 1.55 1.6 1.65 ... 2.0; n = 10: k = 9, the 9th is 1.95; low = the bid 2000, high = 3900.
SELECT pg_temp.ok('miss (b): the model family resolves it (case-insensitive), the miss is still reported with what resolved it',
  :'ro'::jsonb #>> '{cohort_miss,reason}' = 'no closed BaT lot has this make and model text'
  AND :'ro'::jsonb #>> '{cohort_miss,resolved_by}' = 'make and model family (normalized_model)'
  AND :'ro'::jsonb #>> '{cohort,key,model_family}' = 'omega'
  AND (:'ro'::jsonb #>> '{cohort,level}')::int = 2 AND (:'ro'::jsonb #>> '{cohort,n_comparables}')::int = 10
  AND (:'ro'::jsonb #>> '{cohort_miss,denominator,sold_in_the_model_family}')::int = 10);
SELECT pg_temp.ok('miss (b): the band comes from the 10 family comparables, 2000 .. 3900',
  (:'ro'::jsonb #>> '{band,low}')::numeric = 2000 AND (:'ro'::jsonb #>> '{band,high}')::numeric = 3900);
SELECT pg_temp.mk_lot('TestMake', 'Sigma Special', 'sigma-live', timestamptz '2026-02-01 12:00:00+00', 'live', NULL, 'Sigma') AS sigma_e \gset
SELECT public.live_lot_temperature_at(:'sigma_e', 2000, 2, timestamptz '2026-01-31 12:00:00+00') AS rs \gset
SELECT pg_temp.ok('miss (c): a family of 3 sold lots is too few: no band, both counts shown, nothing resolved it',
  :'rs'::jsonb -> 'band' = 'null'::jsonb AND :'rs'::jsonb #>> '{cohort_miss,resolved_by}' IS NULL
  AND (:'rs'::jsonb #>> '{cohort_miss,denominator,sold_in_the_model_family}')::int = 3
  AND (:'rs'::jsonb #>> '{cohort_miss,denominator,sold_with_this_text}')::int = 0
  AND :'rs'::jsonb #>> '{cohort_miss,family_note}' IS NULL);

-- A cohort of more than 6,000 vehicles is read through its newest lots, not through its vehicles. Two of them, one per
-- level: model family 'Giant' (the live lot's exact text has no lot) and exact text 'Colossus'. Each has 3,060 vehicles
-- and 160 sold lots closing 6 h apart from 2026-01-02 18:00; lot j had 2000 by 24 h before its close and hammer 2200 + 10 j,
-- ratio 1.1 + 0.005 j. The 150 newest are j = 11 .. 160; n = 150, k = ceil(151 * 0.8) = ceil(120.8) = 121, the 121st
-- smallest is j = 131, ratio 1.755: low 2000, high ceil(2000 * 1.755) = 3510; the median is the mean of j = 85 and 86,
-- (1.525 + 1.53)/2 = 1.5275: mid round(3055) = 3055. The denominator is 160 and a floor.
INSERT INTO public.vehicles (id, make, model, normalized_model, year)
SELECT gen_random_uuid(), 'BigMake', 'Giant filler ' || g, 'Giant', 2000 FROM generate_series(1, 5900) g;
INSERT INTO public.vehicles (id, make, model, normalized_model, year)
SELECT gen_random_uuid(), 'BigMake', 'Colossus', NULL, 2000 FROM generate_series(1, 5900) g;
DO $$
DECLARE j int; f timestamptz; e uuid;
BEGIN
  FOR j IN 1..160 LOOP
    f := timestamptz '2026-01-02 12:00:00+00' + j * interval '6 hours';
    e := pg_temp.mk_lot('BigMake', 'Giant ' || j, 'giant-' || j, f, 'sold', 2200 + 10 * j, 'Giant');
    PERFORM pg_temp.mk_bid(e, f - interval '30 hours', 2000, 'g' || j);
    PERFORM pg_temp.mk_bid(e, f - interval '1 hour', 2200 + 10 * j, 'h' || j);
    e := pg_temp.mk_lot('BigMake', 'Colossus', 'colossus-' || j, f, 'sold', 2200 + 10 * j);
    PERFORM pg_temp.mk_bid(e, f - interval '30 hours', 2000, 'c' || j);
    PERFORM pg_temp.mk_bid(e, f - interval '1 hour', 2200 + 10 * j, 'd' || j);
  END LOOP;
END $$;
SELECT pg_temp.mk_lot('BigMake', 'Giant Special 4x4', 'giant-live', timestamptz '2026-02-21 12:00:00+00', 'live', NULL, 'Giant') AS gi_e \gset
SELECT public.live_lot_temperature_at(:'gi_e', 2000, 3, timestamptz '2026-02-20 12:00:00+00') AS rg \gset
SELECT pg_temp.ok('big family (6,000+ vehicles): read through the newest lots, level 2, n 150 of a floor of 160, band 2000 .. 3510, mid 3055',
  (:'rg'::jsonb #>> '{cohort,level}')::int = 2 AND (:'rg'::jsonb #>> '{cohort,n_comparables}')::int = 150
  AND (:'rg'::jsonb #>> '{cohort,denominator}')::int = 160 AND (:'rg'::jsonb #>> '{cohort,denominator_is_a_floor}')::boolean
  AND (:'rg'::jsonb #>> '{band,rank_high}')::int = 121 AND (:'rg'::jsonb #>> '{band,ratio_high}')::numeric = 1.755
  AND (:'rg'::jsonb #>> '{band,low}')::numeric = 2000 AND (:'rg'::jsonb #>> '{band,high}')::numeric = 3510
  AND (:'rg'::jsonb #>> '{band,mid}')::numeric = 3055 AND (:'rg'::jsonb #>> '{band,denominator_is_a_floor}')::boolean);
SELECT pg_temp.mk_lot('BigMake', 'Colossus', 'colossus-live', timestamptz '2026-02-21 12:00:00+00', 'live', NULL) AS co_e \gset
SELECT public.live_lot_temperature_at(:'co_e', 2000, 3, timestamptz '2026-02-20 12:00:00+00') AS rc \gset
SELECT pg_temp.ok('big exact text (6,000+ vehicles): read through the newest lots, level 1, same band, a floor',
  (:'rc'::jsonb #>> '{cohort,level}')::int = 1 AND (:'rc'::jsonb #>> '{cohort,n_comparables}')::int = 150
  AND (:'rc'::jsonb #>> '{cohort,denominator}')::int = 160 AND (:'rc'::jsonb #>> '{cohort,denominator_is_a_floor}')::boolean
  AND (:'rc'::jsonb #>> '{band,low}')::numeric = 2000 AND (:'rc'::jsonb #>> '{band,high}')::numeric = 3510
  AND :'rc'::jsonb -> 'cohort_miss' = 'null'::jsonb);
SELECT pg_temp.ok('a small cohort is not a floor', NOT (:'r0'::jsonb #>> '{cohort,denominator_is_a_floor}')::boolean);

-- A lot with no make is a miss with its own reason; unknown id, ended clock and a missing bid say so.
SELECT pg_temp.mk_lot(NULL, NULL, 'nomake-live', timestamptz '2026-02-01 12:00:00+00', 'live', NULL) AS nomake_e \gset
SELECT public.live_lot_temperature_at(:'nomake_e', 5000, 3, timestamptz '2026-01-31 12:00:00+00') #>> '{cohort_miss,reason}' AS rn \gset
SELECT pg_temp.ok('a lot with no make or model: the miss says so', :'rn' = 'the lot''s vehicle has no make or no model');
SELECT pg_temp.ok('unknown lot id',
  public.live_lot_temperature_at('00000000-0000-4000-8000-0000000000ff', 1, 1, timestamptz '2026-01-31 12:00:00+00') ->> 'status' = 'unknown_lot');
SELECT pg_temp.ok('clock at or before the read: ended',
  public.live_lot_temperature_at(:'live_e', 1650, 4, timestamptz '2026-02-01 12:00:00+00') ->> 'status' = 'ended');
SELECT pg_temp.ok('no bid given: no_bid',
  public.live_lot_temperature_at(:'live_e', NULL, 4, timestamptz '2026-01-31 12:00:00+00') ->> 'status' = 'no_bid');
SELECT pg_temp.ok('no time given: no_time, not a guess',
  public.live_lot_temperature_at(:'live_e', 1650, 4, NULL) ->> 'status' = 'no_time');

-- ---------------------------------------------------------------------------------------------------------------
-- 5. The minutes regime. 12 lots with a recorded clock, scheduled close O_j = 2026-02-j 17:00 (j = 1..12), every one
-- at 2000 before the last 2 minutes; hammers 2000 2040 2080 2100 2160 2200 2240 2300 2400 2500 2600 3000, so the
-- ratios at T-2 are 1.0 1.02 1.04 1.05 1.08 1.1 1.12 1.15 1.2 1.25 1.3 1.5. Lot 1 never extended (hammer = 2000);
-- the other 11 took one bid at O - 60 s, so their stored close is O + 60 s. Decoys: a lot with a clock that closes
-- after p_at, and a lot with extreme ratio that no collector followed.
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE j int; hs numeric[] := ARRAY[2000, 2040, 2080, 2100, 2160, 2200, 2240, 2300, 2400, 2500, 2600, 3000];
BEGIN
  FOR j IN 1..12 LOOP
    PERFORM pg_temp.mk_stream_lot('StreamMake', 'M' || j, 'stream-' || j, timestamptz '2026-02-01 17:00:00+00' + (j - 1) * interval '1 day', 2000, hs[j]);
  END LOOP;
  -- a lot whose chain rows were written after the close (ratio 1.8 at T-2)
  PERFORM pg_temp.mk_reread_lot('stream-reread', timestamptz '2026-02-25 17:00:00+00', 2000, 3600);
  -- closes after p_at = 2026-03-01 16:58
  PERFORM pg_temp.mk_stream_lot('StreamMake', 'late', 'stream-late', timestamptz '2026-03-01 17:30:00+00', 2000, 20000);
  -- not followed by the collector: the same shape, extreme ratio, no monitored_auctions row
  PERFORM pg_temp.mk_lot('StreamMake', 'unfollowed', 'unfollowed-1', timestamptz '2026-02-20 17:01:00+00', 'sold', 20000);
END $$;
SELECT e.id AS unf_e FROM public.auction_events e WHERE e.source_url LIKE '%unfollowed-1' \gset
SELECT pg_temp.mk_bid(:'unf_e', timestamptz '2026-02-20 16:00:00+00', 2000, 'u1', 1.0);
SELECT pg_temp.mk_bid(:'unf_e', timestamptz '2026-02-20 16:30:00+00', 2000, 'u2', 0.5);
SELECT pg_temp.mk_bid(:'unf_e', timestamptz '2026-02-20 16:59:00+00', 20000, 'u3', 0.03);

-- The live lot: scheduled close 2026-03-01 17:00, three bid rows (hours_until_close to that close), high bid 2000 at
-- T-2. One more bid at O - 60 s exists but is posted after the T-2 read.
SELECT pg_temp.mk_lot('StreamMake', 'Live', 'stream-live', timestamptz '2026-03-01 17:00:00+00', 'live', NULL) AS sl_e \gset
SELECT pg_temp.mk_bid(:'sl_e', timestamptz '2026-03-01 14:00:00+00', 1800, 'a', 3);
SELECT pg_temp.mk_bid(:'sl_e', timestamptz '2026-03-01 15:00:00+00', 1900, 'b', 2);
SELECT pg_temp.mk_bid(:'sl_e', timestamptz '2026-03-01 16:30:00+00', 2000, 'c', 0.5);
SELECT pg_temp.mk_bid(:'sl_e', timestamptz '2026-03-01 16:59:00+00', 2400, 'd', 120.0 / 3600);

-- T-2: p_at = O - 120 s, the clock given as O.
--   n = 13: the 12 lots above and the lot whose chain rows were written after the close (hammer 3600, ratio 1.8).
--   All tier 'a' (fewer than 30, so every tier pooled; there is no other). k = ceil(14 * 0.8) = ceil(11.2) = 12.
--   Sorted ratios 1.0 1.02 1.04 1.05 1.08 1.1 1.12 1.15 1.2 1.25 1.3 1.5 1.8: the 12th is 1.5, the median (7th) 1.12.
--   Bid 2000: low 2000 (the bid), mid 2240, high 3000. Had the re-read lot been read against its final close
--   (O + 230 s), its ratio would be 1.0 and the 12th ratio 1.3, high 2600.
SELECT public.live_lot_temperature_at(:'sl_e', 2000, 3, timestamptz '2026-03-01 16:58:00+00', timestamptz '2026-03-01 17:00:00+00') AS m0 \gset
SELECT pg_temp.ok('minutes: regime, no extension possible at 120 s, no cohort read',
  :'m0'::jsonb #>> '{clock,regime}' = 'minutes' AND (:'m0'::jsonb #>> '{clock,extensions}')::int = 0
  AND :'m0'::jsonb #> '{position}' = 'null'::jsonb AND :'m0'::jsonb #> '{cohort,n_comparables}' = 'null'::jsonb);
SELECT pg_temp.ok('minutes: 13 lots with a clock (decoys out), rank 12 of 13, ratio 1 up to 1.5',
  :'m0'::jsonb #>> '{band,method}' = 'clocked_lots_ratio_upper_order_statistic'
  AND (:'m0'::jsonb #>> '{band,n}')::int = 13 AND (:'m0'::jsonb #>> '{band,denominator}')::int = 13
  AND (:'m0'::jsonb #>> '{band,rank_high}')::int = 12 AND (:'m0'::jsonb #>> '{band,coverage_if_exchangeable}')::numeric = 0.8571
  AND (:'m0'::jsonb #>> '{band,ratio_low}')::numeric = 1 AND (:'m0'::jsonb #>> '{band,ratio_high}')::numeric = 1.5);
SELECT pg_temp.ok('minutes: band dollars low 2000, mid 2240, high 3000 (hand computed); read at T-2, clock O',
  (:'m0'::jsonb #>> '{band,low}')::numeric = 2000 AND (:'m0'::jsonb #>> '{band,mid}')::numeric = 2240
  AND (:'m0'::jsonb #>> '{band,high}')::numeric = 3000 AND (:'m0'::jsonb #>> '{band,seconds_left}')::numeric = 120);
SELECT pg_temp.ok('minutes: the funnel counts the lots read, the scheduled closes known, the logs that reproduce the hammer',
  (:'m0'::jsonb #>> '{band,pool,funnel,clocked_sold_lots_read}')::int = 13
  AND (:'m0'::jsonb #>> '{band,pool,funnel,scheduled_close_known}')::int = 13
  AND (:'m0'::jsonb #>> '{band,pool,funnel,bid_log_reproduces_hammer}')::int = 13
  AND :'m0'::jsonb #>> '{band,pool,price_tier}' = 'a' AND (:'m0'::jsonb #>> '{band,pool,tier_alone}')::boolean = false);
-- The state that would be wrong if the extended close were the clock: read at 120 s before each lot's STORED close
-- (O + 60 s for the 11 extended lots) their bid is the hammer, so every ratio would be 1.0. The reader does not do that.
SELECT pg_temp.ok('minutes: the ratios are against the scheduled close (not all 1.0)',
  (:'m0'::jsonb #>> '{band,ratio_high}')::numeric > 1.4);
-- Point in time: the bid at O - 60 s (posted after the T-2 read) is not in the lot's own coverage.
SELECT pg_temp.ok('minutes coverage: 3 bid rows at or before the read, the one after is not counted',
  (:'m0'::jsonb #>> '{coverage,bid_rows,n}')::int = 3 AND (:'m0'::jsonb #>> '{coverage,bid_rows,max_bid}')::numeric = 2000);

-- 30 s left, no extension yet: the 11 lots that took a bid at O - 60 s were already extended at that moment, so only
-- lot 1 is in the pool; one lot is below the minimum, so no band.
SELECT pg_temp.mk_lot('StreamMake', 'Live2', 'stream-live-2', timestamptz '2026-03-01 17:00:00+00', 'live', NULL) AS sl2_e \gset
SELECT pg_temp.mk_bid(:'sl2_e', timestamptz '2026-03-01 14:00:00+00', 1800, 'a', 3);
SELECT pg_temp.mk_bid(:'sl2_e', timestamptz '2026-03-01 15:00:00+00', 1900, 'b', 2);
SELECT pg_temp.mk_bid(:'sl2_e', timestamptz '2026-03-01 16:30:00+00', 2000, 'c', 0.5);
SELECT public.live_lot_temperature_at(:'sl2_e', 2000, 3, timestamptz '2026-03-01 16:59:30+00', timestamptz '2026-03-01 17:00:00+00') AS m1 \gset
SELECT pg_temp.ok('30 s left, not extended yet: only lots with no extension by then count (1), so no band, the count shown',
  :'m1'::jsonb -> 'band' = 'null'::jsonb AND (:'m1'::jsonb #>> '{band_unavailable,n}')::int = 1
  AND (:'m1'::jsonb #>> '{band_unavailable,funnel,in_the_same_state_with_a_bid}')::int = 1);
-- The clock moved (the page shows O + 60 s; the lot's own bid row at O - 60 s is in the rows at p_at = O - 30 s):
-- the reader sees one extension from the rows, 30 s since that bid (120 - the 90 s left), and reads the lots that
-- took exactly one bid inside the last 120 s and no second within 30 s: the 11 extended lots of fixture 5 (their
-- one chain bid IS the hammer, ratio 1.0) and the re-read lot (after its first chain bid 2100, hammer 3600, ratio
-- 1.7143; its second chain bid came 60 s later). n = 12, k = ceil(13 * 0.8) = 11, the 11th is 1.0: the band is the bid.
SELECT public.live_lot_temperature_at(:'sl_e', 2400, 4, timestamptz '2026-03-01 16:59:30+00', timestamptz '2026-03-01 17:01:00+00') AS m2 \gset
SELECT pg_temp.ok('one extension seen: derived from the rows, the lots in the same state (1 chain bid, none for 30 s) give n 12, the band is the bid',
  (:'m2'::jsonb #>> '{clock,extensions}')::int = 1 AND (:'m2'::jsonb #>> '{band,pool,extensions}')::int = 1
  AND (:'m2'::jsonb #>> '{band,pool,seconds_since_last_bid}')::numeric = 30
  AND (:'m2'::jsonb #>> '{band,n}')::int = 12 AND (:'m2'::jsonb #>> '{band,rank_high}')::int = 11
  AND (:'m2'::jsonb #>> '{band,low}')::numeric = 2400 AND (:'m2'::jsonb #>> '{band,high}')::numeric = 2400);
-- The caller can say how many extensions it has seen. Two, at the opening of the second: only the re-read lot has
-- two chain bids, so 1 lot, no band, the floor.
SELECT public.live_lot_temperature_at(:'sl_e', 2400, 4, timestamptz '2026-03-01 16:58:00+00', timestamptz '2026-03-01 17:00:00+00', 2) AS m3 \gset
SELECT pg_temp.ok('extensions given by the caller: used, basis says so; one lot reached a second extension, so no band and the floor',
  (:'m3'::jsonb #>> '{clock,extensions}')::int = 2 AND :'m3'::jsonb #>> '{clock,extensions_basis}' = 'argument'
  AND :'m3'::jsonb -> 'band' = 'null'::jsonb AND (:'m3'::jsonb #>> '{band_unavailable,n}')::int = 1
  AND (:'m3'::jsonb #>> '{band_unavailable,floor}')::numeric = 2400 AND (:'m3'::jsonb #>> '{band_unavailable,extensions}')::int = 2);

-- A lot with fewer than 3 bid rows under 120 s and no count given: the state is unknown, said so.
SELECT pg_temp.mk_lot('StreamMake', 'Thin', 'stream-thin', timestamptz '2026-03-01 17:00:00+00', 'live', NULL) AS th_e \gset
SELECT pg_temp.mk_bid(:'th_e', timestamptz '2026-03-01 16:00:00+00', 1000, 'a', 1);
SELECT public.live_lot_temperature_at(:'th_e', 1000, 1, timestamptz '2026-03-01 16:59:00+00', timestamptz '2026-03-01 17:00:00+00') AS m4 \gset
SELECT pg_temp.ok('under 120 s with fewer than 3 agreeing rows and no count: the soft-close state is unknown, no band',
  :'m4'::jsonb -> 'band' = 'null'::jsonb AND :'m4'::jsonb #>> '{band_unavailable,reason}' LIKE '%soft-close state is unknown%');

-- Tier: 30 lots with a clock at 30000 (tier b), every ratio 1.3. A bid of 30000 reads tier b alone (30 lots):
--   k = ceil(31 * 0.8) = ceil(24.8) = 25, the 25th ratio is 1.3: low 30000, high 39000, mid 39000.
-- The 2000 bid still reads every tier (13 + 30 = 43 lots): k = ceil(44 * 0.8) = ceil(35.2) = 36.
--   sorted ratios: 1.0 1.02 1.04 1.05 1.08 1.1 1.12 1.15 1.2 1.25 | 1.3 x 31 | 1.5 1.8 -> the 36th is 1.3: low 2000, high 2600.
DO $$
DECLARE j int;
BEGIN
  FOR j IN 1..30 LOOP
    PERFORM pg_temp.mk_stream_lot('StreamMake', 'B' || j, 'streamb-' || j, timestamptz '2026-02-14 20:00:00+00' + j * interval '1 hour', 30000, 39000);
  END LOOP;
END $$;
SELECT pg_temp.mk_lot('StreamMake', 'LiveB', 'stream-live-b', timestamptz '2026-03-01 17:00:00+00', 'live', NULL) AS slb_e \gset
SELECT pg_temp.mk_bid(:'slb_e', timestamptz '2026-03-01 14:00:00+00', 29800, 'a', 3);
SELECT pg_temp.mk_bid(:'slb_e', timestamptz '2026-03-01 15:00:00+00', 29900, 'b', 2);
SELECT pg_temp.mk_bid(:'slb_e', timestamptz '2026-03-01 16:30:00+00', 30000, 'c', 0.5);
SELECT public.live_lot_temperature_at(:'slb_e', 30000, 3, timestamptz '2026-03-01 16:58:00+00', timestamptz '2026-03-01 17:00:00+00') AS mb \gset
SELECT pg_temp.ok('tier b stands alone with 30 lots: n 30, rank 25, band 30000 .. 39000, tier_alone true',
  (:'mb'::jsonb #>> '{band,n}')::int = 30 AND (:'mb'::jsonb #>> '{band,pool,tier_alone}')::boolean AND (:'mb'::jsonb #>> '{band,rank_high}')::int = 25
  AND (:'mb'::jsonb #>> '{band,low}')::numeric = 30000 AND (:'mb'::jsonb #>> '{band,high}')::numeric = 39000);
SELECT public.live_lot_temperature_at(:'sl_e', 2000, 3, timestamptz '2026-03-01 16:58:00+00', timestamptz '2026-03-01 17:00:00+00') AS mc \gset
SELECT pg_temp.ok('tier a has 13 lots (under 30): every tier pooled, n 43, rank 36, band 2000 .. 2600',
  (:'mc'::jsonb #>> '{band,n}')::int = 43 AND (:'mc'::jsonb #>> '{band,rank_high}')::int = 36
  AND (:'mc'::jsonb #>> '{band,low}')::numeric = 2000 AND (:'mc'::jsonb #>> '{band,high}')::numeric = 2600
  AND NOT (:'mc'::jsonb #>> '{band,pool,tier_alone}')::boolean);

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Inside the extension chain. 10 lots with three bids inside the last 120 s (closing 2026-03-05, one hour apart):
-- c1 2950 at O - 100 s, c2 3000 at O - 50 s, c3 = 3000 + 30 j at O + 10 s. A live lot reads after its second bid
-- (3000, 30 s ago, two extensions, the clock O + 70 s) at p_at = O - 20 s. The lots in that state are those with at
-- least two chain bids and no third within 30 s of the second: the 10 above (ratios 1.01 .. 1.10) and the re-read lot
-- (bid 2300 after its second, hammer 3600, ratio 1.5652); lots with one chain bid do not qualify.
--   n = 11, k = ceil(12 * 0.8) = ceil(9.6) = 10: the 10th is 1.10: low 3000, high 3300; median (6th) 1.06: mid 3180.
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE j int;
BEGIN
  FOR j IN 1..10 LOOP
    PERFORM pg_temp.mk_chain_lot('chain-' || j, timestamptz '2026-03-05 17:00:00+00' + j * interval '1 hour', 2900, 2950, 3000, 3000 + 30 * j);
  END LOOP;
END $$;
SELECT pg_temp.mk_lot('StreamMake', 'LiveOT', 'stream-live-ot', timestamptz '2026-03-10 17:00:00+00', 'live', NULL) AS ot_e \gset
SELECT pg_temp.mk_bid(:'ot_e', timestamptz '2026-03-10 14:00:00+00', 2700, 'a', 3);
SELECT pg_temp.mk_bid(:'ot_e', timestamptz '2026-03-10 15:00:00+00', 2800, 'b', 2);
SELECT pg_temp.mk_bid(:'ot_e', timestamptz '2026-03-10 16:30:00+00', 2900, 'c', 0.5);
SELECT pg_temp.mk_bid(:'ot_e', timestamptz '2026-03-10 16:58:20+00', 2950, 'd', 120.0 / 3600);
SELECT pg_temp.mk_bid(:'ot_e', timestamptz '2026-03-10 16:59:10+00', 3000, 'e', 120.0 / 3600);
SELECT public.live_lot_temperature_at(:'ot_e', 3000, 5, timestamptz '2026-03-10 16:59:40+00', timestamptz '2026-03-10 17:01:10+00') AS o0 \gset
SELECT pg_temp.ok('chain: two extensions read from the bid rows, 30 s since the last bid',
  (:'o0'::jsonb #>> '{clock,extensions}')::int = 2 AND (:'o0'::jsonb #>> '{band,pool,seconds_since_last_bid}')::numeric = 30
  AND (:'o0'::jsonb #>> '{clock,seconds_left}')::numeric = 90);
SELECT pg_temp.ok('chain: n 11 (lots with two chain bids and none in the next 30 s), rank 10, band 3000 .. 3300, mid 3180 (hand computed)',
  (:'o0'::jsonb #>> '{band,n}')::int = 11 AND (:'o0'::jsonb #>> '{band,rank_high}')::int = 10
  AND (:'o0'::jsonb #>> '{band,low}')::numeric = 3000 AND (:'o0'::jsonb #>> '{band,high}')::numeric = 3300
  AND (:'o0'::jsonb #>> '{band,mid}')::numeric = 3180 AND (:'o0'::jsonb #>> '{band,ratio_high}')::numeric = 1.1);
-- 100 s after the second bid with no third: every lot in the pool had its third within 100 s, so none is in this state.
SELECT public.live_lot_temperature_at(:'ot_e', 3000, 5, timestamptz '2026-03-10 17:00:50+00', timestamptz '2026-03-10 17:01:10+00') AS o1 \gset
SELECT pg_temp.ok('chain: 100 s after the second bid, no lot was still waiting: no band, 0 lots, the floor',
  :'o1'::jsonb -> 'band' = 'null'::jsonb AND (:'o1'::jsonb #>> '{band_unavailable,n}')::int = 0
  AND (:'o1'::jsonb #>> '{band_unavailable,floor}')::numeric = 3000 AND (:'o1'::jsonb #>> '{band_unavailable,extensions}')::int = 2);
-- A later bid of the live lot (after p_at) changes nothing.
SELECT pg_temp.mk_bid(:'ot_e', timestamptz '2026-03-10 16:59:41+00', 3100, 'f', 120.0 / 3600);
SELECT public.live_lot_temperature_at(:'ot_e', 3000, 5, timestamptz '2026-03-10 16:59:40+00', timestamptz '2026-03-10 17:01:10+00') AS o2 \gset
SELECT pg_temp.ok('chain: a bid posted one second after p_at changes nothing in the read', :'o0'::jsonb = :'o2'::jsonb);

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Grants, volatility, security, writes.
-- ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('ACL: anon cannot EXECUTE the reader',
  has_function_privilege('anon', 'public.live_lot_temperature_at(uuid, numeric, integer, timestamptz, timestamptz, integer)', 'EXECUTE') = false);
SELECT pg_temp.ok('ACL: authenticated cannot EXECUTE the reader',
  has_function_privilege('authenticated', 'public.live_lot_temperature_at(uuid, numeric, integer, timestamptz, timestamptz, integer)', 'EXECUTE') = false);
SELECT pg_temp.ok('ACL: PUBLIC cannot EXECUTE the reader (only service_role and the owner hold it)',
  NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = 'public.live_lot_temperature_at(uuid, numeric, integer, timestamptz, timestamptz, integer)'::regprocedure
                AND a.grantee = 0));
SELECT pg_temp.ok('ACL: service_role can EXECUTE the reader',
  has_function_privilege('service_role', 'public.live_lot_temperature_at(uuid, numeric, integer, timestamptz, timestamptz, integer)', 'EXECUTE') = true);
SELECT pg_temp.ok('the reader is STABLE, SECURITY INVOKER, and sets no custom GUC in its header',
  (SELECT p.provolatile = 's' AND NOT p.prosecdef
          AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE '%.%=%')
   FROM pg_proc p WHERE p.oid = 'public.live_lot_temperature_at(uuid, numeric, integer, timestamptz, timestamptz, integer)'::regprocedure));

-- Writes nothing: runs in a read-only transaction and leaves no transaction id assigned.
SELECT (SELECT count(*) FROM public.auction_comments) AS n_comments, (SELECT count(*) FROM public.auction_events) AS n_events,
       (SELECT count(*) FROM public.vehicle_observations) AS n_obs, (SELECT count(*) FROM public.hammer_predictions) AS n_pred \gset
BEGIN READ ONLY;
SELECT public.live_lot_temperature_at(:'live_e', 1650, 4, timestamptz '2026-01-31 12:00:00+00') AS rr \gset
SELECT public.live_lot_temperature_at(:'sl_e', 2000, 3, timestamptz '2026-03-01 16:58:00+00', timestamptz '2026-03-01 17:00:00+00') AS rm \gset
SELECT pg_temp.ok('read-only transaction: both regimes ran, no transaction id was assigned',
  :'rr'::jsonb ->> 'status' = 'ok' AND :'rm'::jsonb ->> 'status' = 'ok' AND txid_current_if_assigned() IS NULL);
COMMIT;
SELECT pg_temp.ok('no table changed by the reads',
  (SELECT count(*) FROM public.auction_comments) = :n_comments AND (SELECT count(*) FROM public.auction_events) = :n_events
  AND (SELECT count(*) FROM public.vehicle_observations) = :n_obs AND (SELECT count(*) FROM public.hammer_predictions) = :n_pred);

DO $$ BEGIN RAISE NOTICE 'ALL CONTRACTS PASSED: live_lot_temperature_at'; END $$;
