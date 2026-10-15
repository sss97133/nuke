-- Isolated PostgreSQL 17 contract for market_venue_label (20261016150000). Synthetic values only; never production.
-- Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_venue && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_venue -f supabase/sql/test_market_venue_label.sql
-- Covered: every spelling the map's fold (20261014063000) labels keeps its label; the slugs it missed gain one;
-- auction_source wins over canonical_platform; non-houses stay null; both forms are immutable and inline into a query.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regprocedure('public.market_venue_label(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

\ir ../migrations/20261016150000_market_venue_label.sql
\ir ../migrations/20261016150000_market_venue_label.sql

-- The fold's CASE as of 20261014063000, verbatim, so the regression check reads the old rule, not a paraphrase.
CREATE FUNCTION pg_temp.old_label(auction_source text) RETURNS text LANGUAGE sql AS $$
  SELECT CASE
    WHEN (lower(auction_source) = ANY (ARRAY['bat'::text, 'bringatrailer'::text, 'bring a trailer'::text])) THEN 'Bring a Trailer'::text
    WHEN (lower(auction_source) = ANY (ARRAY['gooding'::text, 'gooding & co'::text])) THEN 'Gooding & Co'::text
    WHEN (lower(auction_source) = ANY (ARRAY['rm sothebys'::text, 'rm sotheby''s'::text])) THEN 'RM Sotheby''s'::text
    WHEN (lower(auction_source) = ANY (ARRAY['cars & bids'::text, 'cars-and-bids'::text])) THEN 'Cars & Bids'::text
    WHEN (lower(auction_source) = 'mecum'::text) THEN 'Mecum'::text
    WHEN (lower(auction_source) = 'bonhams'::text) THEN 'Bonhams'::text
    WHEN (lower(auction_source) = 'broad arrow'::text) THEN 'Broad Arrow'::text
    WHEN (lower(auction_source) = ANY (ARRAY['collecting_cars'::text, 'collecting cars'::text])) THEN 'Collecting Cars'::text
    WHEN (lower(auction_source) = 'sbx cars'::text) THEN 'SBX Cars'::text
    WHEN (lower(auction_source) = 'pcarmarket'::text) THEN 'PCarMarket'::text
    WHEN (lower(auction_source) = 'classic.com'::text) THEN 'Classic.com'::text
    ELSE NULL::text
  END $$;

SELECT pg_temp.ok('every spelling the fold labels keeps its label, with or without a platform',
  (SELECT bool_and(public.market_venue_label(s) = pg_temp.old_label(s)
                   AND public.market_venue_label(s, p) = pg_temp.old_label(s))
   FROM unnest(ARRAY['bat', 'BaT', 'bringatrailer', 'Bring a Trailer', 'gooding', 'Gooding & Co', 'RM Sothebys',
                     'RM Sotheby''s', 'Cars & Bids', 'cars-and-bids', 'mecum', 'Mecum', 'bonhams', 'Broad Arrow',
                     'collecting_cars', 'Collecting Cars', 'SBX Cars', 'pcarmarket', 'Classic.com']) s,
        unnest(ARRAY[NULL, 'mecum', 'barrett-jackson', 'unknown']) p));

SELECT pg_temp.ok('the slugs the fold missed name their house',
  (SELECT bool_and(public.market_venue_label(s) = want) FROM (VALUES
    ('cars_and_bids', 'Cars & Bids'), ('barrett-jackson', 'Barrett-Jackson'), ('barrettjackson', 'Barrett-Jackson'),
    ('Barrett-Jackson', 'Barrett-Jackson'), ('barrett_jackson', 'Barrett-Jackson'), ('rm-sothebys', 'RM Sotheby''s'),
    ('sbx-cars', 'SBX Cars'), ('broad_arrow', 'Broad Arrow'), ('broad-arrow', 'Broad Arrow'),
    ('collecting-cars', 'Collecting Cars'), ('classic-com', 'Classic.com'), ('Mecum Auctions', 'Mecum'),
    ('Gooding & Company', 'Gooding & Co')) AS t(s, want)));

SELECT pg_temp.ok('auction_source first, canonical_platform when the source names no house',
  public.market_venue_label('barrett-jackson', 'mecum') = 'Barrett-Jackson'
  AND public.market_venue_label(NULL, 'barrett-jackson') = 'Barrett-Jackson'
  AND public.market_venue_label('unknown', 'rm-sothebys') = 'RM Sotheby''s'
  AND public.market_venue_label('', 'cars-and-bids') = 'Cars & Bids');

SELECT pg_temp.ok('sources that are not a listed house stay null',
  (SELECT bool_and(public.market_venue_label(s, p) IS NULL) FROM (VALUES
    (NULL, NULL), ('unknown', 'unknown'), ('craigslist', 'craigslist'), ('classiccars', 'classiccars-com'),
    ('Collective Auto', 'dealer'), ('hagerty', 'hagerty'), ('historics', 'historics'), ('', '')) AS t(s, p)));

SELECT pg_temp.ok('both forms are immutable, parallel safe and carry no SET clause (so they inline into a fold)',
  (SELECT count(*) = 2 AND bool_and(provolatile = 'i' AND proparallel = 's' AND proconfig IS NULL AND prolang =
     (SELECT oid FROM pg_language WHERE lanname = 'sql'))
   FROM pg_proc WHERE proname = 'market_venue_label' AND pronamespace = 'public'::regnamespace));

CREATE TEMP TABLE plan_out (line text);
CREATE TEMP TABLE src (s text, p text);
DO $$ DECLARE r record; BEGIN
  FOR r IN EXECUTE 'EXPLAIN (VERBOSE, COSTS OFF) SELECT public.market_venue_label(s, p) FROM pg_temp.src' LOOP
    INSERT INTO plan_out VALUES (r."QUERY PLAN");
  END LOOP;
END $$;
SELECT pg_temp.ok('the two-argument form inlines (the plan shows the CASE, not a function call)',
  (SELECT bool_or(line LIKE '%CASE%') AND NOT bool_or(line LIKE '%market_venue_label%') FROM plan_out));
