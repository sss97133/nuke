-- Isolated PostgreSQL 17 contract for 20261006110000_key_auction_comment_lots.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_comment_lot_keys_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_comment_lot_keys_ci -f supabase/sql/test_comment_lot_keys.sql
-- Fixtures: record_write_receipt() is the live body; trg_write_receipt_upd is the live trigger (20261006090000).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.auction_comments') IS NOT NULL
     OR to_regclass('public.auction_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid, source text NOT NULL, source_url text, outcome text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX idx_auction_events_vehicle_source_url ON public.auction_events (vehicle_id, source_url);
CREATE INDEX idx_auction_events_vehicle ON public.auction_events (vehicle_id);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE CASCADE,
  vehicle_id uuid, platform text, source_url text, content_hash text,
  author_username text, posted_at timestamptz, comment_text text, created_at timestamptz DEFAULT now(),
  CONSTRAINT auction_comments_vehicle_content_hash_key UNIQUE (vehicle_id, content_hash)
);
CREATE INDEX idx_auction_comments_auction ON public.auction_comments (auction_event_id);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);
CREATE TABLE public.write_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, op text NOT NULL,
  rows integer NOT NULL, writer text NOT NULL, db_role text NOT NULL,
  app_name text, txid bigint NOT NULL
);
CREATE FUNCTION public.record_write_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN SELECT count(*) INTO n FROM new_rows;
    ELSIF TG_OP = 'UPDATE' THEN SELECT count(*) INTO n FROM new_rows;
    ELSIF TG_OP = 'DELETE' THEN SELECT count(*) INTO n FROM old_rows;
    END IF;
    IF n > 0 THEN
      INSERT INTO write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
      VALUES (TG_TABLE_NAME, TG_OP, n,
        COALESCE(NULLIF(current_setting('app.writer', true), ''),
          NULLIF(current_setting('request.headers', true)::json->>'x-nuke-writer', ''),
          'undeclared'),
        current_user, current_setting('application_name', true), txid_current());
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_write_receipt_upd AFTER UPDATE ON public.auction_comments
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.record_write_receipt();

-- Vehicles (no vehicles table needed: auction_comments.vehicle_id is NOT VALID on prod and unused here).
--   v1: one lot, URL stored without the trailing slash (extract-bat-core's canonicalUrl).
--   v2: two lots, both slash spellings of one URL (the only way the unique index allows two).
--   v3: one lot, but its comments carry another lot's URL.
--   v4: no lot at all; its URL's lot row exists on another vehicle v5.
--   v6: a Cars and Bids lot.
--   v7: one lot whose comments sit at the first and the last heap block (a group straddling batch boundaries).
--   v8: a Cars and Bids comment whose (vehicle, URL) lot row carries source 'bat' (another platform's lot).
--   v9: one lot with the older source spelling 'bringatrailer'.
--   v10: one lot stored with two trailing slashes (the lander's rtrim strips all of them).
CREATE TEMP TABLE v(name text PRIMARY KEY, id uuid);
INSERT INTO v SELECT 'v' || i, gen_random_uuid() FROM generate_series(1, 10) i;
INSERT INTO public.auction_events (vehicle_id, source, source_url, outcome)
SELECT id, 'bat', 'https://bringatrailer.com/listing/lot-a', 'sold' FROM v WHERE name = 'v1'
UNION ALL SELECT id, 'bat', 'https://bringatrailer.com/listing/lot-b', 'sold' FROM v WHERE name = 'v2'
UNION ALL SELECT id, 'bat', 'https://bringatrailer.com/listing/lot-b/', 'sold' FROM v WHERE name = 'v2'
UNION ALL SELECT id, 'bat', 'https://bringatrailer.com/listing/lot-c', 'sold' FROM v WHERE name = 'v3'
UNION ALL SELECT id, 'bat', 'https://bringatrailer.com/listing/lot-e', 'sold' FROM v WHERE name = 'v5'
UNION ALL SELECT id, 'cars_and_bids', 'https://carsandbids.com/auctions/xyz/2001-bmw-m3', 'sold' FROM v WHERE name = 'v6'
UNION ALL SELECT id, 'bat', 'https://bringatrailer.com/listing/lot-s', 'sold' FROM v WHERE name = 'v7'
UNION ALL SELECT id, 'bat', 'https://carsandbids.com/auctions/abc/1999-porsche-911', 'sold' FROM v WHERE name = 'v8'
UNION ALL SELECT id, 'bringatrailer', 'https://bringatrailer.com/listing/lot-r', 'sold' FROM v WHERE name = 'v9'
UNION ALL SELECT id, 'bat', 'https://bringatrailer.com/listing/lot-h//', 'sold' FROM v WHERE name = 'v10'
UNION ALL SELECT NULL::uuid, 'bat', 'https://bringatrailer.com/listing/lot-f', 'sold';

-- First straddling row: lands in heap block 0.
INSERT INTO public.auction_comments (vehicle_id, platform, source_url, content_hash, author_username, posted_at, comment_text)
SELECT id, 'bat', 'https://bringatrailer.com/listing/lot-s/', 'h-straddle-1', 'x', '2026-09-28', 'straddle first' FROM v WHERE name = 'v7';

-- The backfill population: 2,400 filler rows over many heap blocks so the block cursor is exercised.
--   g%4 = 0: v1, lot-a/ (one lot)           -> keyed
--   g%4 = 1: v2, lot-b/ (two lots)          -> NULL
--   g%4 = 2: v4, lot-e/ (no lot on v4)      -> NULL
--   g%4 = 3: v3, lot-d/ (v3's lot is lot-c) -> NULL
INSERT INTO public.auction_comments (vehicle_id, platform, source_url, content_hash, author_username, posted_at, comment_text)
SELECT (SELECT id FROM v WHERE name = CASE g % 4 WHEN 0 THEN 'v1' WHEN 1 THEN 'v2' WHEN 2 THEN 'v4' ELSE 'v3' END),
       'bat',
       'https://bringatrailer.com/listing/' || CASE g % 4 WHEN 0 THEN 'lot-a' WHEN 1 THEN 'lot-b' WHEN 2 THEN 'lot-e' ELSE 'lot-d' END || '/',
       md5(g::text), 'author' || (g % 7), timestamptz '2026-09-28 00:00Z' + make_interval(mins => g), repeat('x', 300)
FROM generate_series(1, 2400) g;
INSERT INTO public.auction_comments (vehicle_id, platform, source_url, content_hash, author_username, posted_at, comment_text)
VALUES
  ((SELECT id FROM v WHERE name = 'v1'), 'bat', 'https://bringatrailer.com/listing/lot-a', 'h-noslash', 'x', '2026-09-28', 'no trailing slash'),
  ((SELECT id FROM v WHERE name = 'v1'), 'bat', 'https://bringatrailer.com/listing/LOT-A/', 'h-case', 'x', '2026-09-28', 'case differs'),
  ((SELECT id FROM v WHERE name = 'v1'), 'bat', NULL, 'h-nourl', 'x', '2026-09-28', 'no url'),
  (NULL, 'bat', 'https://bringatrailer.com/listing/lot-a/', 'h-novehicle', 'x', '2026-09-28', 'no vehicle'),
  (NULL, 'bat', 'https://bringatrailer.com/listing/lot-f/', 'h-novehicle-f', 'x', '2026-09-28', 'no vehicle, lot with no vehicle'),
  ((SELECT id FROM v WHERE name = 'v6'), 'cars_and_bids', 'https://carsandbids.com/auctions/xyz/2001-bmw-m3/', 'h-cab', 'x', '2026-09-28', 'cars and bids'),
  ((SELECT id FROM v WHERE name = 'v8'), 'cars_and_bids', 'https://carsandbids.com/auctions/abc/1999-porsche-911/', 'h-xplat', 'x', '2026-09-28', 'lot of another platform'),
  ((SELECT id FROM v WHERE name = 'v9'), 'bat', 'https://bringatrailer.com/listing/lot-r/', 'h-alias', 'x', '2026-09-28', 'bringatrailer alias'),
  ((SELECT id FROM v WHERE name = 'v10'), 'bat', 'https://bringatrailer.com/listing/lot-h/', 'h-slashes', 'x', '2026-09-28', 'lot stored with two slashes');
-- A comment already keyed (to another lot than the rule would pick): never changed.
INSERT INTO public.auction_comments (vehicle_id, platform, source_url, content_hash, author_username, posted_at, comment_text, auction_event_id)
SELECT (SELECT id FROM v WHERE name = 'v1'), 'bat', 'https://bringatrailer.com/listing/lot-a/', 'h-prekeyed', 'x', '2026-09-28', 'pre-keyed',
       (SELECT a.id FROM public.auction_events a JOIN v ON v.id = a.vehicle_id AND v.name = 'v3');
-- Second straddling row: lands in the last heap block.
INSERT INTO public.auction_comments (vehicle_id, platform, source_url, content_hash, author_username, posted_at, comment_text)
SELECT id, 'bat', 'https://bringatrailer.com/listing/lot-s', 'h-straddle-2', 'x', '2026-09-28', 'straddle last' FROM v WHERE name = 'v7';

CREATE TEMP TABLE comments_before AS SELECT * FROM public.auction_comments;
CREATE TEMP TABLE lots_before AS SELECT * FROM public.auction_events;
CREATE TEMP TABLE straddle_blocks AS
  SELECT id, ((ctid::text)::point)[0]::bigint AS blk FROM public.auction_comments WHERE content_hash LIKE 'h-straddle-%';
-- A stale registration the migration must overwrite, not skip.
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description)
VALUES ('auction_comments', 'auction_event_id', 'stale-owner', 'stale registration');
ANALYZE public.auction_comments;

\ir ../migrations/20261006110000_key_auction_comment_lots.sql

-- The migration itself changes no row.
SELECT pg_temp.ok('migration keys no row',
  (SELECT count(*) FROM public.auction_comments WHERE auction_event_id IS NOT NULL) = 1);
SELECT pg_temp.ok('registry names the backfill as owner, replacing a stale owner',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'auction_comments' AND column_name = 'auction_event_id') = 1
  AND EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'auction_comments' AND column_name = 'auction_event_id'
              AND owned_by = 'key_auction_comment_lots' AND description <> 'stale registration' AND write_via LIKE 'At insert:%'));
SELECT pg_temp.ok('column comment names the rule and the backfill',
  col_description('public.auction_comments'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.auction_comments'::regclass AND attname = 'auction_event_id'))
  LIKE '%ignoring trailing slashes%key_auction_comment_lots()%');
SELECT pg_temp.ok('backfill is not callable by anon or authenticated',
  NOT has_function_privilege('anon', 'public.key_auction_comment_lots(integer, bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.key_auction_comment_lots(integer, bigint)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.key_auction_comment_lots(integer, bigint)', 'EXECUTE'));
SELECT pg_temp.ok('function runs with a fixed search_path ending in pg_temp',
  (SELECT proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc
   WHERE oid = 'public.key_auction_comment_lots(integer, bigint)'::regprocedure));

-- Guards ----------------------------------------------------------------------------------------------
SET statement_timeout = 0;
DO $$ BEGIN
  PERFORM public.key_auction_comment_lots(500, 0);
  RAISE EXCEPTION 'unbounded call was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '61s';
DO $$ BEGIN
  PERFORM public.key_auction_comment_lots(500, 0);
  RAISE EXCEPTION 'a statement_timeout above 60 s was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '30s';
DO $$ BEGIN
  PERFORM public.key_auction_comment_lots(0, 0);
  RAISE EXCEPTION 'p_batch 0 was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%p_batch must be%' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  PERFORM public.key_auction_comment_lots(500, -1);
  RAISE EXCEPTION 'a negative start block was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%p_from_block must be%' THEN RAISE; END IF;
END $$;
SELECT pg_temp.ok('refused calls changed nothing',
  (SELECT count(*) FROM public.auction_comments WHERE auction_event_id IS NOT NULL) = 1);
SELECT pg_temp.ok('start blocks at or past the end, and past the tid range, return done without error',
  (SELECT bool_and((r->>'done')::boolean AND (r->>'keyed')::int = 0 AND (r->>'blocks_scanned')::int = 0)
   FROM (SELECT public.key_auction_comment_lots(200, b) r
         FROM unnest(ARRAY[pg_relation_size('public.auction_comments') / current_setting('block_size')::bigint,
                           1000000, 4294967294, 4294967295, 5000000000]) b) s));

-- Walk the whole heap, one block per call ----------------------------------------------------------------
-- p_batch 1 makes every call scan exactly one block whatever the planner statistics say
-- (greatest(1, ceil(1 / rows_per_page)) = 1), so the cursor arithmetic is asserted, not a batch count.
SELECT pg_temp.ok('straddling group sits in two different heap blocks before the walk',
  (SELECT count(DISTINCT blk) FROM straddle_blocks) = 2 AND (SELECT min(blk) FROM straddle_blocks) = 0);
CREATE TEMP TABLE walk(run text, step int, result jsonb);
DO $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.key_auction_comment_lots(1, b);
    i := i + 1;
    INSERT INTO walk VALUES ('first', i, r);
    EXIT WHEN (r->>'done')::boolean OR i > 100000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
SELECT pg_temp.ok('cursor: starts at block 0; each call starts where the last ended; one block per call',
  (SELECT (result->>'from_block')::bigint FROM walk WHERE run = 'first' AND step = 1) = 0
  AND NOT EXISTS (SELECT 1 FROM walk w JOIN walk p ON p.run = w.run AND p.step = w.step - 1
                  WHERE w.run = 'first' AND (w.result->>'from_block')::bigint <> (p.result->>'next_block')::bigint)
  AND NOT EXISTS (SELECT 1 FROM walk WHERE run = 'first'
                  AND ((result->>'next_block')::bigint - (result->>'from_block')::bigint <> 1
                       OR (result->>'blocks_scanned')::bigint
                          <> least((result->>'next_block')::bigint, (result->>'table_blocks')::bigint) - (result->>'from_block')::bigint
                       OR (result->>'remaining_blocks')::bigint
                          <> greatest(0, (result->>'table_blocks')::bigint - (result->>'next_block')::bigint))));
SELECT pg_temp.ok('cursor: only the last call reports done, at the table end',
  (SELECT count(*) FROM walk WHERE run = 'first' AND (result->>'done')::boolean) = 1
  AND (SELECT (result->>'done')::boolean AND (result->>'next_block')::bigint >= (result->>'table_blocks')::bigint
       FROM walk WHERE run = 'first' ORDER BY step DESC LIMIT 1)
  AND (SELECT count(*) FROM walk WHERE run = 'first') >= (SELECT max(blk) FROM straddle_blocks) + 1);
SELECT pg_temp.ok('a (vehicle, URL) group straddling batch boundaries is keyed in each batch, to the same lot',
  (SELECT count(DISTINCT w.step) FROM straddle_blocks s JOIN walk w ON w.run = 'first'
     AND s.blk >= (w.result->>'from_block')::bigint AND s.blk < (w.result->>'next_block')::bigint) = 2
  AND (SELECT count(*) FROM public.auction_comments c JOIN public.auction_events a ON a.id = c.auction_event_id
       WHERE c.content_hash LIKE 'h-straddle-%' AND a.source_url = 'https://bringatrailer.com/listing/lot-s') = 2);
SELECT pg_temp.ok('unambiguous: every comment with exactly one lot by (vehicle, platform, URL ignoring slashes) is keyed',
  -- 600 lot-a/ + no trailing slash + cars and bids + 2 straddling + bringatrailer alias + lot stored with two slashes
  (SELECT sum((result->>'keyed')::int) FROM walk WHERE run = 'first') = 606
  AND NOT EXISTS (SELECT 1 FROM public.auction_comments c JOIN v ON v.id = c.vehicle_id AND v.name = 'v1'
                  WHERE c.source_url IN ('https://bringatrailer.com/listing/lot-a/', 'https://bringatrailer.com/listing/lot-a')
                    AND c.auction_event_id IS NULL)
  AND (SELECT bool_and(auction_event_id IS NOT NULL) FROM public.auction_comments
       WHERE comment_text IN ('bringatrailer alias', 'lot stored with two slashes', 'cars and bids', 'no trailing slash')));
SELECT pg_temp.ok('every key set by the walk points at the lot with the same vehicle, URL and platform',
  NOT EXISTS (SELECT 1 FROM public.auction_comments c JOIN comments_before b USING (id)
              JOIN public.auction_events a ON a.id = c.auction_event_id
              WHERE b.auction_event_id IS NULL
                AND (a.vehicle_id <> c.vehicle_id OR rtrim(a.source_url, '/') <> rtrim(c.source_url, '/')
                     OR NOT (a.source = c.platform OR (c.platform = 'bat' AND a.source = 'bringatrailer')))));
SELECT pg_temp.ok('a lot of another platform at the same (vehicle, URL) is never assigned',
  (SELECT auction_event_id IS NULL FROM public.auction_comments WHERE comment_text = 'lot of another platform'));
SELECT pg_temp.ok('two candidate lots: left NULL and counted',
  NOT EXISTS (SELECT 1 FROM public.auction_comments c JOIN v ON v.id = c.vehicle_id AND v.name = 'v2' WHERE c.auction_event_id IS NOT NULL)
  AND (SELECT sum((result->>'left_several_lots')::int) FROM walk WHERE run = 'first') = 600);
SELECT pg_temp.ok('no lot: left NULL, even when the URL''s lot exists on another vehicle',
  NOT EXISTS (SELECT 1 FROM public.auction_comments c JOIN v ON v.id = c.vehicle_id AND v.name = 'v4' WHERE c.auction_event_id IS NOT NULL));
SELECT pg_temp.ok('the vehicle''s only lot is never assigned to comments of another lot',
  NOT EXISTS (SELECT 1 FROM public.auction_comments c JOIN v ON v.id = c.vehicle_id AND v.name = 'v3' WHERE c.auction_event_id IS NOT NULL));
SELECT pg_temp.ok('no vehicle, no URL and a case-different URL stay NULL',
  (SELECT bool_and(auction_event_id IS NULL) FROM public.auction_comments
   WHERE comment_text IN ('no url', 'no vehicle', 'no vehicle, lot with no vehicle', 'case differs')));
SELECT pg_temp.ok('left_no_lot counts every unkeyed row with no candidate',
  -- 600 v4 + 600 v3 + case differs + no url + no vehicle + no vehicle (lot-f) + lot of another platform
  (SELECT sum((result->>'left_no_lot')::int) FROM walk WHERE run = 'first') = 1200 + 5);
SELECT pg_temp.ok('a key already set is never changed',
  (SELECT c.auction_event_id = b.auction_event_id FROM public.auction_comments c JOIN comments_before b USING (id)
   WHERE c.comment_text = 'pre-keyed'));
SELECT pg_temp.ok('only auction_event_id changes',
  NOT EXISTS (SELECT 1 FROM public.auction_comments c JOIN comments_before b USING (id)
              WHERE (c.vehicle_id, c.platform, c.source_url, c.content_hash, c.author_username, c.posted_at, c.comment_text, c.created_at)
                    IS DISTINCT FROM (b.vehicle_id, b.platform, b.source_url, b.content_hash, b.author_username, b.posted_at, b.comment_text, b.created_at))
  AND (SELECT count(*) FROM public.auction_comments) = (SELECT count(*) FROM comments_before));
SELECT pg_temp.ok('no auction_events row created or changed',
  (SELECT count(*) FROM public.auction_events) = (SELECT count(*) FROM lots_before)
  AND NOT EXISTS (SELECT 1 FROM lots_before b JOIN public.auction_events a USING (id)
                  WHERE (a.vehicle_id, a.source, a.source_url, a.outcome, a.updated_at)
                        IS DISTINCT FROM (b.vehicle_id, b.source, b.source_url, b.outcome, b.updated_at)));
SELECT pg_temp.ok('backfill writes declared UPDATE receipts that sum to the rows keyed',
  (SELECT sum(rows) FROM public.write_receipts WHERE tbl = 'auction_comments' AND op = 'UPDATE' AND writer = 'key-comment-lots') = 606
  AND NOT EXISTS (SELECT 1 FROM public.write_receipts WHERE tbl = 'auction_comments' AND op = 'UPDATE' AND writer <> 'key-comment-lots'));

-- Idempotent: a second full walk, with multi-block batches, changes nothing.
DO $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.key_auction_comment_lots(200, b);
    i := i + 1;
    INSERT INTO walk VALUES ('again', i, r);
    EXIT WHEN (r->>'done')::boolean OR i > 1000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
SELECT pg_temp.ok('second run keys 0 rows',
  (SELECT sum((result->>'keyed')::int) FROM walk WHERE run = 'again') = 0
  AND (SELECT sum(rows) FROM public.write_receipts WHERE writer = 'key-comment-lots') = 606);
