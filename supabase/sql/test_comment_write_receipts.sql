-- Run only in a disposable PG17 database named dm_refinement_*:
-- psql -X -v ON_ERROR_STOP=1 -d dm_refinement_receipts -f this-file.sql
-- Not idempotent: requires empty stubs; recreate the disposable database to rerun.
-- Exercises the real migration with the existing production observer, whose
-- body was verified live 2026-10-02 and recovered from commit 13d780885.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.auction_comments') IS NOT NULL
     OR to_regclass('public.write_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;

CREATE TABLE public.auction_comments (
  source_key text PRIMARY KEY, source text NOT NULL, method text NOT NULL,
  observed_at timestamptz NOT NULL, ingested_at timestamptz NOT NULL,
  content text NOT NULL
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

\ir ../migrations/20261002000100_observe_fresh_auction_comment_writes.sql

BEGIN;
SET LOCAL request.headers = '{"x-nuke-writer":"extract-bat-core"}';
INSERT INTO public.auction_comments
SELECT 'batch-' || i, 'bat', 'listing_html', '2026-10-01T12:00:00Z',
       '2026-10-02T12:00:00Z', 'original testimony ' || i
FROM generate_series(1,200) i;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.write_receipts) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.write_receipts
       WHERE tbl='auction_comments' AND op='INSERT' AND rows=200
         AND writer='extract-bat-core' AND txid=txid_current()) THEN
    RAISE EXCEPTION 'Batch must leave one attributed receipt with actual row count';
  END IF;
END $$;

-- A replay containing only conflicts and an empty insert emit no receipt.
INSERT INTO public.auction_comments
SELECT 'batch-' || i, 'other', 'replay', now(), now(), 'overwrite attempt'
FROM generate_series(1,200) i ON CONFLICT (source_key) DO NOTHING;
INSERT INTO public.auction_comments SELECT * FROM public.auction_comments WHERE false;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.write_receipts) <> 1
     OR (SELECT count(*) FROM public.auction_comments
       WHERE source='bat' AND method='listing_html'
         AND observed_at='2026-10-01T12:00:00Z'
         AND ingested_at='2026-10-02T12:00:00Z'
         AND content='original testimony ' || split_part(source_key,'-',2)) <> 200 THEN
    RAISE EXCEPTION 'Replay/observer must preserve testimony and both times';
  END IF;
END $$;

-- Mixed replay reports only the newly inserted row, never the conflicts.
INSERT INTO public.auction_comments
SELECT 'batch-' || i, 'bat', 'listing_html', '2026-10-01T12:00:00Z',
       '2026-10-02T12:00:00Z', 'original testimony ' || i
FROM generate_series(200,201) i ON CONFLICT (source_key) DO NOTHING;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.write_receipts) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.write_receipts WHERE rows=1) THEN
    RAISE EXCEPTION 'Mixed replay must count only the fresh row';
  END IF;
END $$;

SET LOCAL request.headers = '{}';
INSERT INTO public.auction_comments VALUES ('unknown','bat','listing_html',now(),now(),'unknown writer');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.write_receipts WHERE writer='undeclared' AND rows=1) THEN
    RAISE EXCEPTION 'Absent declaration must remain unknown';
  END IF;
END $$;

SET LOCAL request.headers = '{"x-nuke-writer":"extract-bat-core"}';
SET LOCAL app.writer = 'sql-writer';
INSERT INTO public.auction_comments VALUES ('sql','bat','listing_html',now(),now(),'SQL writer');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.write_receipts WHERE writer='sql-writer' AND rows=1) THEN
    RAISE EXCEPTION 'SQL declaration must retain precedence';
  END IF;
END $$;

-- Existing observer failure policy: the sensor cannot break ingestion.
ALTER TABLE public.write_receipts RENAME TO held_write_receipts;
INSERT INTO public.auction_comments VALUES ('sensor-error','bat','listing_html',now(),now(),'still landed');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auction_comments WHERE source_key='sensor-error') THEN
    RAISE EXCEPTION 'Observer failure must not prevent ingestion';
  END IF;
END $$;
ALTER TABLE public.held_write_receipts RENAME TO write_receipts;
COMMIT;
SELECT 'PASS: batch, empty insert, conflict replay, mixed replay, testimony/times, undeclared writer, SQL precedence, sensor failure' AS result;
