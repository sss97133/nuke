-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_trends -f this-file.sql (from supabase/sql)
-- Contract for 20261015235000_market_trends_one_read.sql. Synthetic IDs only; never run in production.
-- Runs the make-resolution contract (the whole market-trends chain, its added make spellings and 20261015233000), records
-- the reader's output for every scope as anon and authenticated, applies the change twice, and requires the same output
-- (clock fields aside), the same settings, owner and grants, and no second read of the candidates. The chain's rows
-- carry a direct-fetch source clock, a cached-snapshot clock, a slash-alias of the direct fetch and rows with no clock,
-- so every branch of the source-read rule is in the compared output.
\set ON_ERROR_STOP on
\ir test_market_trends_make_resolution.sql
RESET ROLE;

-- Three more BaT rows, one per remaining branch of the clock rule: a clock_version other than 1 and a basis the rule does
-- not know read as unknown; a listing_url carrying the trailing slash reads as known.
INSERT INTO vehicles(id, canonical_make_id) SELECT ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001' FROM generate_series(301, 303) i;
INSERT INTO auction_events(id, vehicle_id, source_url, auction_end_date, winning_bid, scraped_at, raw_data)
  SELECT ('50000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
    'https://bringatrailer.com/listing/fixture-clock-' || i, date_trunc('day', now()) - interval '1 day' + i * interval '1 second',
    3000 + i, now() - interval '3 minutes',
    jsonb_build_object('extractor', 'extract-bat-core',
      'listing_url', 'https://bringatrailer.com/listing/fixture-clock-' || i || CASE WHEN i = 303 THEN '/' ELSE '' END,
      'source_read', jsonb_build_object('clock_version', CASE WHEN i = 301 THEN 2 ELSE 1 END,
        'basis', CASE WHEN i = 302 THEN 'live_page' ELSE 'direct_fetch' END,
        'at', to_char((now() - interval '3 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
  FROM generate_series(301, 303) i;

CREATE TEMP TABLE before_read (label text, role text, out jsonb);
GRANT INSERT, SELECT ON before_read TO authenticated, anon;
SET ROLE authenticated;
INSERT INTO before_read SELECT label, 'authenticated', pg_temp.unclocked(get_market_trends(req)) FROM scopes;
SET ROLE anon;
INSERT INTO before_read SELECT label, 'anon', pg_temp.unclocked(get_market_trends(req)) FROM scopes;
RESET ROLE;
CREATE TEMP TABLE before_read_meta AS SELECT proacl, proowner, prosecdef, proconfig
  FROM pg_proc WHERE oid = 'public.get_market_trends(jsonb)'::regprocedure;

\ir ../migrations/20261015235000_market_trends_one_read.sql
\ir ../migrations/20261015235000_market_trends_one_read.sql

CREATE TEMP TABLE after_read (label text, role text, out jsonb);
GRANT INSERT, SELECT ON after_read TO authenticated, anon;
SET ROLE authenticated;
INSERT INTO after_read SELECT label, 'authenticated', pg_temp.unclocked(get_market_trends(req)) FROM scopes;
SET ROLE anon;
INSERT INTO after_read SELECT label, 'anon', pg_temp.unclocked(get_market_trends(req)) FROM scopes;
RESET ROLE;

SELECT assert_count((SELECT count(*) FROM before_read) = 4
    AND (SELECT count(*) FROM before_read, jsonb_array_elements(out->'evidence'->'contributors') c
         WHERE c->>'source_read_basis' IN ('direct_fetch', 'cached_snapshot')) > 0
    AND (SELECT array_agg(right(c->>'auction_event_id', 3) || ':' || (c->>'source_read_basis') ORDER BY c->>'auction_event_id')
         FROM before_read b, jsonb_array_elements(b.out->'evidence'->'contributors') c
         WHERE b.label = 'make' AND b.role = 'anon' AND right(c->>'auction_event_id', 3) IN ('301', '302', '303'))
       = ARRAY['301:unknown', '302:unknown', '303:direct_fetch'],
  'one read: before the change the clock rule reads each of its branches (version, basis, slash) as the chain expects');
SELECT assert_count(NOT EXISTS (SELECT label, role, out FROM before_read EXCEPT SELECT label, role, out FROM after_read)
  AND NOT EXISTS (SELECT label, role, out FROM after_read EXCEPT SELECT label, role, out FROM before_read),
  'one read: every scope and role reads the same output after the change, clock fields aside');
SELECT assert_count((SELECT b.proacl IS NOT DISTINCT FROM p.proacl AND b.proowner = p.proowner AND b.prosecdef = p.prosecdef
    AND b.proconfig = p.proconfig FROM before_read_meta b, pg_proc p WHERE p.oid = 'public.get_market_trends(jsonb)'::regprocedure),
  'one read: settings (statement_timeout 5s), owner, security and grants unchanged');
SELECT assert_count((SELECT prosrc LIKE '%AS rd_listing_url%' AND prosrc NOT LIKE '%JOIN public.auction_events e ON e.id=c.id%'
    AND prosrc LIKE '%make_resolved%'
    FROM pg_proc WHERE oid = 'public.get_market_trends(jsonb)'::regprocedure),
  'one read: the scan carries the source-read fields and no step reads the candidates again');
