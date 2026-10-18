-- Isolated PostgreSQL 17 contract for 20261006212500_guard_vehicle_event_clock_locks.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_clock_lock_guard_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_clock_lock_guard_ci -f supabase/sql/test_vehicle_event_clock_lock_guard.sql
-- Fixture: the vehicle_events columns the guard touches (prod shape 2026-10-06), pipeline_registry as the live table,
-- the two column comments PR #696 writes. The migration is applied as shipped (\ir).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicle_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  source_platform text NOT NULL,
  source_url text,
  source_listing_id text,
  event_type text NOT NULL DEFAULT 'auction',
  event_status text NOT NULL DEFAULT 'ended',
  started_at timestamptz,
  ended_at timestamptz,
  sold_at timestamptz,
  final_price numeric,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
COMMENT ON COLUMN public.vehicle_events.sold_at IS 'When the vehicle sold through this listing (fixture copy of the #696 comment).';
COMMENT ON COLUMN public.vehicle_events.ended_at IS 'When the listing closed (fixture copy of the #696 comment).';

CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description) VALUES
  ('vehicle_events', 'sold_at',  'listing landers', 'Sale instant as the lander read it. Landers write it except on a row whose metadata.clock_locked_by_supersession lists sold_at.'),
  ('vehicle_events', 'ended_at', 'listing landers', 'Close instant as the lander read it. Landers write it except on a row whose metadata.clock_locked_by_supersession lists ended_at.');

\ir ../migrations/20261006212500_guard_vehicle_event_clock_locks.sql

-- Trigger shape
SELECT pg_temp.ok('trigger exists BEFORE UPDATE OF the three columns with a WHEN clause',
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_guard_vehicle_event_clock_locks')
    LIKE 'CREATE TRIGGER trg_guard_vehicle_event_clock_locks BEFORE UPDATE OF sold_at, ended_at, metadata ON public.vehicle_events FOR EACH ROW WHEN (%');

-- Fixture rows
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_listing_id, sold_at, ended_at, metadata) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'pcarmarket', 'lot-1',
    '2026-02-13 02:53:54+00', NULL, '{"source": "import-pcarmarket-listing"}'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'pcarmarket', 'lot-2',
    NULL, '2026-02-10 00:00:00+00',
    '{"source": "supersession", "episode_supersessions": [{"supersedes_event_id": "9e000000-0000-0000-0000-000000000002"}],
      "clock_locked_by_supersession": {"fields": ["sold_at"], "writer": "supersede_vehicle_event_episode"}}'),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'rm-sothebys', 'lot-3',
    '2025-08-15 12:00:00+00', '2025-08-15 12:00:00+00',
    '{"episode_supersessions": [{"supersedes_event_id": "9e000000-0000-0000-0000-000000000003"}],
      "clock_locked_by_supersession": {"fields": ["sold_at", "ended_at"], "writer": "supersede_vehicle_event_episode"}}'),
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'gooding', 'lot-4',
    NULL, '2019-08-16 00:00:00+00',
    '{"episode_supersessions": [{"supersedes_event_id": "9e000000-0000-0000-0000-000000000004"}]}');

-- 1. A row with no supersession keys is untouched by the guard.
UPDATE public.vehicle_events SET sold_at = '2026-03-01 00:00:00+00', metadata = '{"source": "lander-2"}'
WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok('unlocked row: sold_at moves and metadata is whatever the writer wrote',
  (SELECT sold_at = '2026-03-01 00:00:00+00' AND metadata = '{"source": "lander-2"}'::jsonb
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-000000000001'));

-- 2. A locked sold_at keeps its value; an unlocked ended_at on the same row moves; the hit is recorded with app.writer
--    (set for the session here: psql autocommit would end a transaction-local setting before the UPDATE).
SELECT set_config('app.writer', 'import-pcarmarket-listing-test', false);
UPDATE public.vehicle_events SET sold_at = '2026-02-13 02:53:54+00', ended_at = '2026-02-12 00:00:00+00'
WHERE id = '00000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok('locked sold_at stays NULL; ended_at (not locked) moves',
  (SELECT sold_at IS NULL AND ended_at = '2026-02-12 00:00:00+00'
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-000000000002'));
SELECT pg_temp.ok('one clock_lock_hit recorded with fields [sold_at] and the app.writer',
  (SELECT jsonb_array_length(metadata -> 'clock_lock_hits') = 1
      AND metadata -> 'clock_lock_hits' -> 0 -> 'fields' = '["sold_at"]'::jsonb
      AND metadata -> 'clock_lock_hits' -> 0 ->> 'app_writer' = 'import-pcarmarket-listing-test'
      AND (metadata -> 'clock_lock_hits' -> 0 ->> 'at') IS NOT NULL
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-000000000002'));
SELECT pg_temp.ok('the lock and the supersession pointer are still on the row',
  (SELECT metadata ? 'clock_locked_by_supersession' AND metadata ? 'episode_supersessions'
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-000000000002'));

-- 3. A writer that replaces metadata wholesale keeps its own keys and gets the bookkeeping back.
UPDATE public.vehicle_events SET metadata = '{"source": "extract-bat-core", "lot_number": "77"}'
WHERE id = '00000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok('wholesale metadata write: writer keys kept, episode_supersessions / lock / hits re-merged',
  (SELECT metadata ->> 'source' = 'extract-bat-core' AND metadata ->> 'lot_number' = '77'
      AND metadata ? 'episode_supersessions' AND metadata ? 'clock_locked_by_supersession'
      AND jsonb_array_length(metadata -> 'clock_lock_hits') = 1
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-000000000002'));

-- 4. Both clocks locked: neither moves; other columns land.
UPDATE public.vehicle_events SET sold_at = '2025-08-20 00:00:00+00', ended_at = '2025-08-20 00:00:00+00', final_price = 123000
WHERE id = '00000000-0000-0000-0000-000000000003';
SELECT pg_temp.ok('both locked clocks keep their values; final_price lands',
  (SELECT sold_at = '2025-08-15 12:00:00+00' AND ended_at = '2025-08-15 12:00:00+00' AND final_price = 123000
      AND metadata -> 'clock_lock_hits' -> 0 -> 'fields' = '["sold_at", "ended_at"]'::jsonb
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-000000000003'));

-- 5. A write that equals the locked value is not a hit.
UPDATE public.vehicle_events SET sold_at = '2025-08-15 12:00:00+00' WHERE id = '00000000-0000-0000-0000-000000000003';
SELECT pg_temp.ok('writing the same value to a locked clock records no hit',
  (SELECT jsonb_array_length(metadata -> 'clock_lock_hits') = 1
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-000000000003'));

-- 6. The hit log is capped at 20 entries.
DO $$ BEGIN
  FOR i IN 1..25 LOOP
    UPDATE public.vehicle_events SET sold_at = now() - (i || ' days')::interval
    WHERE id = '00000000-0000-0000-0000-000000000003';
  END LOOP;
END $$;
SELECT pg_temp.ok('clock_lock_hits keeps the last 20',
  (SELECT jsonb_array_length(metadata -> 'clock_lock_hits') = 20 AND sold_at = '2025-08-15 12:00:00+00'
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-000000000003'));

-- 7. A row with episode_supersessions but no lock: clocks move, the pointer survives a wholesale write.
UPDATE public.vehicle_events SET ended_at = '2019-08-17 00:00:00+00', metadata = '{"source": "extract-gooding"}'
WHERE id = '00000000-0000-0000-0000-000000000004';
SELECT pg_temp.ok('pointer-only row: ended_at moves, episode_supersessions re-merged, no hits',
  (SELECT ended_at = '2019-08-17 00:00:00+00' AND metadata ? 'episode_supersessions'
      AND metadata ->> 'source' = 'extract-gooding' AND NOT (metadata ? 'clock_lock_hits')
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-000000000004'));

-- 8. An UPDATE that touches none of the three columns does not fire the guard (no hit log on a locked row).
UPDATE public.vehicle_events SET final_price = 1 WHERE id = '00000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok('an update of other columns leaves the hit log alone',
  (SELECT jsonb_array_length(metadata -> 'clock_lock_hits') = 1 AND final_price = 1
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-000000000002'));

-- 9. The rule's statements now name the mechanism.
SELECT pg_temp.ok('pipeline_registry rows for sold_at and ended_at name the trigger',
  (SELECT count(*) = 2 FROM public.pipeline_registry
   WHERE table_name = 'vehicle_events' AND column_name IN ('sold_at', 'ended_at')
     AND description LIKE '%trg_guard_vehicle_event_clock_locks%'));
SELECT pg_temp.ok('column comments on sold_at and ended_at name the trigger',
  (SELECT bool_and(col_description(a.attrelid, a.attnum) LIKE '%trg_guard_vehicle_event_clock_locks%')
   FROM pg_attribute a WHERE a.attrelid = 'public.vehicle_events'::regclass AND a.attname IN ('sold_at', 'ended_at')));

-- 10. Re-applying the migration is a no-op for the texts (idempotent).
\ir ../migrations/20261006212500_guard_vehicle_event_clock_locks.sql
SELECT pg_temp.ok('second apply appends nothing to the registry text',
  (SELECT bool_and(array_length(string_to_array(description, 'trg_guard_vehicle_event_clock_locks'), 1) = 2)
   FROM public.pipeline_registry WHERE table_name = 'vehicle_events' AND column_name IN ('sold_at', 'ended_at')));

SELECT 'test_vehicle_event_clock_lock_guard: all contracts passed' AS result;
