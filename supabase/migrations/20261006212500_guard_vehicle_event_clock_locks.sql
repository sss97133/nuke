-- 20261006212500_guard_vehicle_event_clock_locks.sql
--
-- The mechanism behind a rule PR #696 states only in prose: a vehicle_events episode whose sale clocks were corrected
-- by supersession (metadata.clock_locked_by_supersession = {fields, superseded_row_id, writer, at, rule}) must not have
-- those clocks rewritten in place by a lander, and the supersession bookkeeping (metadata.episode_supersessions,
-- metadata.clock_locked_by_supersession, metadata.clock_lock_hits) must survive a lander that replaces metadata wholesale.
--
-- Why a trigger (review of #696, 2026-10-06): on main only extract-gooding and extract-rmsothebys read the lock
-- (_shared/vehicleEventWrite.ts clocksLocked()). import-pcarmarket-listing UPDATEs sold_at and ended_at by
-- (vehicle_id, platform) with no lock check; extract-bat-core UPDATEs the clocks with a fresh metadata object;
-- ingest_bat_live_events sets sold_at without reading the lock. AGENTS.md: a stated invariant must name the
-- constraint, permission, test or gate that implements it. This trigger is that mechanism, for every writer at once.
--
-- What it does, BEFORE UPDATE OF sold_at, ended_at, metadata, only on rows that carry the supersession keys (WHEN):
--   1. re-merges episode_supersessions, clock_locked_by_supersession and clock_lock_hits into NEW.metadata when the
--      write dropped them (a lander that builds metadata from scratch);
--   2. for each field named in clock_locked_by_supersession.fields, keeps OLD's value when the write would change it,
--      and records the blocked write in metadata.clock_lock_hits[] (at, fields, app.writer, db role; the last 20 kept).
-- The rest of the row lands as written. Nothing is raised: a lander must not fail on a corrected episode, it must
-- simply not win. The only sanctioned path that moves a locked clock is supersede_vehicle_event_episode, which
-- retires the row and inserts a replacement (DELETE + INSERT, no UPDATE), so this trigger never sees it.
--
-- Cost: the WHEN clause is two jsonb key tests on OLD.metadata; every row without the keys pays only that.
-- No index, no table rewrite, no row replay. BEFORE UPDATE triggers fire in name order: preserve_bat_live_projection
-- runs first, this one last, so the lock has the final word on the two clocks.
--
-- Contract: supabase/sql/test_vehicle_event_clock_lock_guard.sql (PostgreSQL 17, CI job metric-fold-health-contract).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_vehicle_event_clock_locks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_meta jsonb := coalesce(OLD.metadata, '{}'::jsonb);
  v_new_meta jsonb := coalesce(NEW.metadata, '{}'::jsonb);
  v_lock     jsonb := v_old_meta -> 'clock_locked_by_supersession';
  v_fields   text[] := '{}';
  v_blocked  text[] := '{}';
  v_hits     jsonb;
  v_key      text;
BEGIN
  -- 1. The supersession bookkeeping survives a wholesale metadata replacement.
  FOREACH v_key IN ARRAY ARRAY['episode_supersessions', 'clock_locked_by_supersession', 'clock_lock_hits'] LOOP
    IF (v_old_meta ? v_key) AND NOT (v_new_meta ? v_key) THEN
      v_new_meta := v_new_meta || jsonb_build_object(v_key, v_old_meta -> v_key);
    END IF;
  END LOOP;

  -- 2. A locked clock keeps its superseded value; the write is recorded, not refused.
  IF v_lock IS NOT NULL THEN
    IF jsonb_typeof(v_lock -> 'fields') = 'array' THEN
      SELECT coalesce(array_agg(f), '{}') INTO v_fields FROM jsonb_array_elements_text(v_lock -> 'fields') AS t(f);
    END IF;
    IF 'sold_at' = ANY (v_fields) AND NEW.sold_at IS DISTINCT FROM OLD.sold_at THEN
      NEW.sold_at := OLD.sold_at;
      v_blocked := array_append(v_blocked, 'sold_at');
    END IF;
    IF 'ended_at' = ANY (v_fields) AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
      NEW.ended_at := OLD.ended_at;
      v_blocked := array_append(v_blocked, 'ended_at');
    END IF;
    IF cardinality(v_blocked) > 0 THEN
      v_hits := CASE WHEN jsonb_typeof(v_new_meta -> 'clock_lock_hits') = 'array'
                     THEN v_new_meta -> 'clock_lock_hits' ELSE '[]'::jsonb END;
      IF jsonb_array_length(v_hits) >= 20 THEN v_hits := v_hits - 0; END IF;
      v_new_meta := v_new_meta || jsonb_build_object('clock_lock_hits', v_hits || jsonb_build_object(
        'at', now(),
        'fields', to_jsonb(v_blocked),
        'app_writer', nullif(current_setting('app.writer', true), ''),
        'db_role', current_user::text));
    END IF;
  END IF;

  NEW.metadata := v_new_meta;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_vehicle_event_clock_locks ON public.vehicle_events;
CREATE TRIGGER trg_guard_vehicle_event_clock_locks
BEFORE UPDATE OF sold_at, ended_at, metadata ON public.vehicle_events
FOR EACH ROW
WHEN (OLD.metadata ? 'clock_locked_by_supersession' OR OLD.metadata ? 'episode_supersessions')
EXECUTE FUNCTION public.guard_vehicle_event_clock_locks();

COMMENT ON FUNCTION public.guard_vehicle_event_clock_locks() IS
'BEFORE UPDATE guard for vehicle_events episodes corrected by supersession (supersede_vehicle_event_episode, 20261006141500). Keeps OLD sold_at / ended_at when metadata.clock_locked_by_supersession.fields names the field and the write would change it; records each blocked write in metadata.clock_lock_hits[] {at, fields, app_writer, db_role} (last 20); re-merges episode_supersessions, clock_locked_by_supersession and clock_lock_hits into NEW.metadata when a writer replaced metadata wholesale. Never raises: the lander''s other columns land. The only path that moves a locked clock is the supersession writer (DELETE + INSERT, not seen here). Fires only on rows carrying the supersession keys (trigger WHEN clause). Assay: rows with jsonb_array_length(metadata->''clock_lock_hits'') > 0 are landers still trying to rewrite corrected clocks; fix that lander (see _shared/vehicleEventWrite.ts clocksLocked()).';

COMMENT ON TRIGGER trg_guard_vehicle_event_clock_locks ON public.vehicle_events IS
'Enforces the supersession lock on sold_at / ended_at (metadata.clock_locked_by_supersession) against every in-place writer; see guard_vehicle_event_clock_locks(). Fires BEFORE UPDATE OF sold_at, ended_at, metadata, only when OLD.metadata carries clock_locked_by_supersession or episode_supersessions.';

-- Name the mechanism where the rule is stated: the registry rows and column comments PR #696 wrote (no-op if absent).
UPDATE public.pipeline_registry
SET description = description || ' Enforced by trg_guard_vehicle_event_clock_locks (BEFORE UPDATE, migration 20261006212500): a locked clock keeps its superseded value, the supersession metadata survives a wholesale metadata replacement, and each blocked write is recorded in metadata.clock_lock_hits.',
    updated_at = now()
WHERE table_name = 'vehicle_events'
  AND column_name IN ('sold_at', 'ended_at')
  AND description NOT LIKE '%trg_guard_vehicle_event_clock_locks%';

DO $$
DECLARE col text; cur text;
BEGIN
  FOREACH col IN ARRAY ARRAY['sold_at', 'ended_at'] LOOP
    SELECT col_description(a.attrelid, a.attnum) INTO cur
    FROM pg_attribute a WHERE a.attrelid = 'public.vehicle_events'::regclass AND a.attname = col AND NOT a.attisdropped;
    IF cur IS NOT NULL AND cur NOT LIKE '%trg_guard_vehicle_event_clock_locks%' THEN
      EXECUTE format('COMMENT ON COLUMN public.vehicle_events.%I IS %L', col,
        cur || ' Enforced by trg_guard_vehicle_event_clock_locks (BEFORE UPDATE): a locked clock keeps its value in place; blocked writes land in metadata.clock_lock_hits.');
    END IF;
  END LOOP;
END $$;

COMMIT;
