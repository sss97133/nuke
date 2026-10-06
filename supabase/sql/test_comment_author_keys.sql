-- Isolated PostgreSQL 17 contract for 20261006090000_key_auction_comment_authors.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_comment_author_keys_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_comment_author_keys_ci -f supabase/sql/test_comment_author_keys.sql
-- Fixtures: record_write_receipt() and encode_uri_component() are the live bodies (verified 2026-10-06).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.auction_comments') IS NOT NULL
     OR to_regclass('public.external_identities') IS NOT NULL THEN
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

CREATE TABLE public.external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL, handle text NOT NULL, profile_url text,
  first_seen_at timestamptz DEFAULT now(), metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT external_identities_platform_handle_key UNIQUE (platform, handle)
);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text, author_username text, bat_author_id bigint,
  posted_at timestamptz, created_at timestamptz DEFAULT now(), comment_text text,
  external_identity_id uuid REFERENCES public.external_identities(id) ON DELETE SET NULL,
  author_external_identity_id uuid REFERENCES public.external_identities(id) ON DELETE SET NULL
);
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
CREATE FUNCTION public.encode_uri_component(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(replace(replace(replace(replace(
    $1, ' ', '%20'), '!', '%21'), '#', '%23'), '$', '%24'), '&', '%26'), '''', '%27'), '(', '%28'), ')', '%29');
$$;

-- Identities that exist before the migration. 'legacy' backs the retired twin on old rows.
INSERT INTO public.external_identities (platform, handle, profile_url) VALUES
  ('bat', 'Alice', 'https://bringatrailer.com/member/Alice'),
  ('bat', 'legacy', 'https://bringatrailer.com/member/legacy'),
  ('bat', 'anonymous', 'https://bringatrailer.com/member/anonymous'),
  ('cars_and_bids', 'carl', NULL);

-- Rows written before the key-on-insert trigger exists: the backfill population.
-- 2,400 filler rows spread the population over many heap blocks so the block cursor is exercised.
INSERT INTO public.auction_comments (platform, author_username, bat_author_id, posted_at, comment_text,
                                     external_identity_id, author_external_identity_id)
SELECT 'bat',
       CASE g % 4 WHEN 0 THEN 'Alice' WHEN 1 THEN 'bob_new' WHEN 2 THEN 'Carol Two' ELSE 'Alice' END,
       1000 + g % 4, timestamptz '2026-09-28 00:00Z' + make_interval(mins => g), repeat('x', 300), NULL, NULL
FROM generate_series(1, 2400) g;
INSERT INTO public.auction_comments (platform, author_username, bat_author_id, posted_at, comment_text,
                                     external_identity_id, author_external_identity_id)
VALUES
  ('bat', 'alice', 7, '2026-09-28 01:00Z', 'case differs', NULL, NULL),
  ('bat', 'Unknown', NULL, '2026-09-28 01:00Z', 'unknown author', NULL, NULL),
  ('bat', 'anonymous', NULL, '2026-09-28 01:00Z', 'anonymous, no author id', NULL, NULL),
  ('bat', 'anonymous', 99, '2026-09-28 01:00Z', 'anonymous with author id', NULL, NULL),
  ('bat', '   ', 8, '2026-09-28 01:00Z', 'blank author', NULL, NULL),
  ('bat', NULL, NULL, '2026-09-28 01:00Z', 'no author', NULL, NULL),
  ('cars_and_bids', 'Alice', NULL, '2026-09-28 01:00Z', 'other platform, same string', NULL, NULL),
  ('cars_and_bids', 'carl', NULL, '2026-09-28 01:00Z', 'other platform', NULL, NULL);
-- Old rows that carry the retired twin, and one twin-only row (canonical key NULL).
INSERT INTO public.auction_comments (platform, author_username, bat_author_id, posted_at, comment_text,
                                     external_identity_id, author_external_identity_id)
SELECT 'bat', 'legacy', 5, timestamptz '2026-01-10 00:00Z', 'legacy both', e.id, e.id FROM public.external_identities e WHERE e.handle = 'legacy'
UNION ALL
SELECT 'bat', 'legacy', 5, timestamptz '2026-01-11 00:00Z', 'legacy twin only', NULL::uuid, e.id FROM public.external_identities e WHERE e.handle = 'legacy';

CREATE TEMP TABLE twin_before AS SELECT id, author_external_identity_id FROM public.auction_comments;
CREATE TEMP TABLE identities_before AS SELECT * FROM public.external_identities;
-- A stale registration the migration must overwrite, not skip.
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description)
VALUES ('auction_comments', 'external_identity_id', 'stale-owner', 'stale registration');
ANALYZE public.auction_comments;

\ir ../migrations/20261006090000_key_auction_comment_authors.sql

-- Migration itself changes no rows.
SELECT pg_temp.ok('migration keys no row', (SELECT count(*) FROM public.auction_comments WHERE external_identity_id IS NOT NULL) = 1);
SELECT pg_temp.ok('migration mints no identity', (SELECT count(*) FROM public.external_identities) = 4);
SELECT pg_temp.ok('twin column retired by comment',
  col_description('public.auction_comments'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.auction_comments'::regclass AND attname = 'author_external_identity_id'))
  LIKE 'RETIRED 2026-10-06: superseded by external_identity_id; do not write.%');
SELECT pg_temp.ok('registry names the owner and the retired twin, replacing a stale owner',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'auction_comments' AND column_name = 'external_identity_id') = 1
  AND EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'auction_comments' AND column_name = 'external_identity_id'
              AND owned_by = 'key_auction_comment_authors' AND description <> 'stale registration' AND write_via LIKE 'At insert:%')
  AND EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'auction_comments' AND column_name = 'author_external_identity_id' AND owned_by = 'retired' AND do_not_write_directly));
SELECT pg_temp.ok('backfill is not callable by anon or authenticated',
  NOT has_function_privilege('anon', 'public.key_auction_comment_authors(integer, boolean, bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.key_auction_comment_authors(integer, boolean, bigint)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.key_auction_comment_authors(integer, boolean, bigint)', 'EXECUTE'));

-- KEY ON INSERT ---------------------------------------------------------------------------------
INSERT INTO public.auction_comments (platform, author_username, bat_author_id, posted_at, comment_text) VALUES
  ('bat', 'Alice', 1, '2026-10-06 01:00Z', 'ins exact'),
  ('bat', 'ALICE', 1, '2026-10-06 01:00Z', 'ins case differs'),
  ('bat', 'nobody_yet', 2, '2026-10-06 01:00Z', 'ins missing identity'),
  ('cars_and_bids', 'Alice', NULL, '2026-10-06 01:00Z', 'ins other platform'),
  ('bat', 'Unknown', NULL, '2026-10-06 01:00Z', 'ins unknown'),
  ('bat', 'Anonymous', 55, '2026-10-06 01:00Z', 'ins anonymous with author id');
SELECT pg_temp.ok('insert: exact handle keyed',
  (SELECT c.external_identity_id = e.id FROM public.auction_comments c JOIN public.external_identities e ON e.platform = 'bat' AND e.handle = 'Alice' WHERE c.comment_text = 'ins exact'));
SELECT pg_temp.ok('insert: case-different handle not keyed',
  (SELECT external_identity_id IS NULL FROM public.auction_comments WHERE comment_text = 'ins case differs'));
SELECT pg_temp.ok('insert: missing identity left NULL and not minted',
  (SELECT external_identity_id IS NULL FROM public.auction_comments WHERE comment_text = 'ins missing identity')
  AND NOT EXISTS (SELECT 1 FROM public.external_identities WHERE handle = 'nobody_yet'));
SELECT pg_temp.ok('insert: other platform not keyed to a bat identity',
  (SELECT external_identity_id IS NULL FROM public.auction_comments WHERE comment_text = 'ins other platform'));
SELECT pg_temp.ok('insert: Unknown author not keyed',
  (SELECT external_identity_id IS NULL FROM public.auction_comments WHERE comment_text = 'ins unknown'));
SELECT pg_temp.ok('insert: anonymous author not keyed even with an author id',
  (SELECT external_identity_id IS NULL FROM public.auction_comments WHERE comment_text = 'ins anonymous with author id'));

INSERT INTO public.auction_comments (platform, author_username, bat_author_id, posted_at, comment_text, external_identity_id)
SELECT 'bat', 'Alice', 1, '2026-10-06 02:00Z', 'ins writer passed key', id FROM public.external_identities WHERE handle = 'legacy';
SELECT pg_temp.ok('insert: a key passed by the writer is kept',
  (SELECT c.external_identity_id = e.id FROM public.auction_comments c JOIN public.external_identities e ON e.handle = 'legacy' WHERE c.comment_text = 'ins writer passed key'));

-- BATCH BACKFILL --------------------------------------------------------------------------------
-- Refuses an unbounded call.
SET statement_timeout = 0;
DO $$ BEGIN
  PERFORM public.key_auction_comment_authors(500, true, 0);
  RAISE EXCEPTION 'unbounded call was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '30s';
SELECT pg_temp.ok('refusal changed nothing',
  (SELECT count(*) FROM public.auction_comments WHERE external_identity_id IS NOT NULL) = 3);

-- Walk the whole heap without minting: only exact matches are keyed.
CREATE TEMP TABLE walk(run text, step int, result jsonb);
DO $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.key_auction_comment_authors(200, false, b);
    i := i + 1;
    INSERT INTO walk VALUES ('no_mint', i, r);
    EXIT WHEN (r->>'done')::boolean OR i > 1000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
SELECT pg_temp.ok('no-mint walk spans several batches', (SELECT count(*) FROM walk WHERE run = 'no_mint') > 3);
SELECT pg_temp.ok('no-mint walk keys every exact match and nothing else',
  (SELECT sum((result->>'keyed')::int) FROM walk WHERE run = 'no_mint') = 1200  -- the 1,200 Alice rows
  AND (SELECT sum((result->>'minted')::int) FROM walk WHERE run = 'no_mint') = 0);
SELECT pg_temp.ok('twin-only row: the twin is copied, counted apart from handle keys',
  (SELECT sum((result->>'copied_from_twin')::int) FROM walk WHERE run = 'no_mint') = 1
  AND (SELECT external_identity_id = author_external_identity_id FROM public.auction_comments WHERE comment_text = 'legacy twin only'));
SELECT pg_temp.ok('no-mint walk leaves missing identities NULL',
  NOT EXISTS (SELECT 1 FROM public.auction_comments WHERE author_username IN ('bob_new', 'Carol Two') AND external_identity_id IS NOT NULL));
SELECT pg_temp.ok('backfill writes a declared UPDATE receipt',
  EXISTS (SELECT 1 FROM public.write_receipts WHERE tbl = 'auction_comments' AND op = 'UPDATE' AND writer = 'key-comment-authors'));

-- Walk again with minting: missing BaT handles get identities, then keys.
DO $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.key_auction_comment_authors(200, true, b);
    i := i + 1;
    INSERT INTO walk VALUES ('mint', i, r);
    EXIT WHEN (r->>'done')::boolean OR i > 1000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
SELECT pg_temp.ok('mint walk mints exactly the missing identifiable bat handles, exact case like the TS resolver',
  (SELECT sum((result->>'minted')::int) FROM walk WHERE run = 'mint') = 5
  AND (SELECT array_agg(handle ORDER BY handle COLLATE "C") FROM public.external_identities e
       WHERE NOT EXISTS (SELECT 1 FROM identities_before b WHERE b.id = e.id))
      = ARRAY['ALICE', 'Carol Two', 'alice', 'bob_new', 'nobody_yet']);
SELECT pg_temp.ok('minted identity has the member URL, ingest-clock first_seen_at and labelled source',
  (SELECT profile_url = 'https://bringatrailer.com/member/Carol%20Two'
          AND metadata->>'source' = 'auction_comments author'
          AND metadata->>'writer' = 'key_auction_comment_authors'
          AND metadata ? 'earliest_posted_at_in_minting_batch'
          AND first_seen_at >= created_at - interval '1 second'
   FROM public.external_identities WHERE handle = 'Carol Two'));
SELECT pg_temp.ok('mint walk keys the minted handles',
  (SELECT sum((result->>'keyed')::int) FROM walk WHERE run = 'mint') = 1203  -- 600 bob_new + 600 Carol Two + nobody_yet + alice + ALICE
  AND (SELECT sum((result->>'copied_from_twin')::int) FROM walk WHERE run = 'mint') = 0
  AND NOT EXISTS (SELECT 1 FROM public.auction_comments c WHERE c.platform = 'bat'
                  AND c.author_username IN ('bob_new', 'Carol Two', 'nobody_yet') AND c.external_identity_id IS NULL));
SELECT pg_temp.ok('every key points at the exact bat handle',
  NOT EXISTS (SELECT 1 FROM public.auction_comments c JOIN public.external_identities e ON e.id = c.external_identity_id
              WHERE c.comment_text <> 'ins writer passed key' AND (e.platform <> 'bat' OR e.handle <> c.author_username)));
SELECT pg_temp.ok('unidentifiable and other-platform rows stay NULL',
  (SELECT bool_and(external_identity_id IS NULL) FROM public.auction_comments
   WHERE comment_text IN ('unknown author', 'anonymous, no author id', 'anonymous with author id', 'blank author', 'no author',
                          'other platform, same string', 'other platform', 'ins other platform', 'ins unknown',
                          'ins anonymous with author id')));
SELECT pg_temp.ok('case-different handles are never keyed to another case''s identity',
  NOT EXISTS (SELECT 1 FROM public.auction_comments c JOIN public.external_identities e ON e.id = c.external_identity_id
              WHERE c.comment_text IN ('case differs', 'ins case differs') AND e.handle = 'Alice'));
SELECT pg_temp.ok('no comment is keyed to the shared anonymous identity, whatever its author id',
  NOT EXISTS (SELECT 1 FROM public.auction_comments c JOIN public.external_identities e ON e.id = c.external_identity_id
              WHERE lower(e.handle) = 'anonymous' OR lower(c.author_username) = 'anonymous'));
SELECT pg_temp.ok('no identity minted for Unknown, blank, anonymous or other platforms',
  NOT EXISTS (SELECT 1 FROM public.external_identities e WHERE NOT EXISTS (SELECT 1 FROM identities_before b WHERE b.id = e.id)
              AND (e.handle IN ('Unknown', 'anonymous', 'carl') OR btrim(e.handle) = '' OR e.platform <> 'bat')));

-- Idempotent: a second full walk changes nothing.
DO $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.key_auction_comment_authors(200, true, b);
    i := i + 1;
    INSERT INTO walk VALUES ('again', i, r);
    EXIT WHEN (r->>'done')::boolean OR i > 1000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
SELECT pg_temp.ok('second run changes 0 rows',
  (SELECT sum((result->>'keyed')::int) + sum((result->>'minted')::int) + sum((result->>'copied_from_twin')::int)
   FROM walk WHERE run = 'again') = 0);

-- Retired twin untouched, existing identities never rewritten.
SELECT pg_temp.ok('retired column untouched on every pre-existing row',
  NOT EXISTS (SELECT 1 FROM twin_before b JOIN public.auction_comments c USING (id)
              WHERE c.author_external_identity_id IS DISTINCT FROM b.author_external_identity_id));
SELECT pg_temp.ok('retired column never set on new rows',
  NOT EXISTS (SELECT 1 FROM public.auction_comments c WHERE NOT EXISTS (SELECT 1 FROM twin_before b WHERE b.id = c.id)
              AND c.author_external_identity_id IS NOT NULL));
SELECT pg_temp.ok('existing identities never rewritten',
  NOT EXISTS (SELECT 1 FROM identities_before b JOIN public.external_identities e USING (id)
              WHERE (e.platform, e.handle, e.profile_url, e.metadata, e.first_seen_at) IS DISTINCT FROM (b.platform, b.handle, b.profile_url, b.metadata, b.first_seen_at)));

-- A start block at or past the end, or past the largest tid block, is a no-op that reports done (no tid error).
SELECT pg_temp.ok('start blocks at or past the end, and past the tid range, return done without error',
  (SELECT bool_and((r->>'done')::boolean AND (r->>'keyed')::int = 0 AND (r->>'minted')::int = 0
                   AND (r->>'copied_from_twin')::int = 0 AND (r->>'blocks_scanned')::int = 0)
   FROM (SELECT public.key_auction_comment_authors(200, true, b) r
         FROM unnest(ARRAY[pg_relation_size('public.auction_comments') / current_setting('block_size')::bigint,
                           1000000, 4294967294, 4294967295, 5000000000]) b) s));
