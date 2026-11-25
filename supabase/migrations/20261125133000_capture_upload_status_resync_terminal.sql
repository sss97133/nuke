-- Finish the capture_upload_status rows that 20261122030000's terminal rule never reached (data, one call).
--
-- Why. capture_upload_status shows the relay's photos to the owner (iOS ingest status, Live Activity). Since
-- 20261122030000, capture_upload_status_upsert marks a row the classifier will never pick up as finished: a metadata-only
-- record (the on-device triage kept the pixels on the phone, so image_url is the empty sentinel) shows done with
-- terminal 'metadata_only', and a re-sent copy (is_duplicate) shows done with terminal 'duplicate'. Rows written before
-- that rule keep current_step 'queued' forever: measured 2026-11-25, 1,090 owner rows, all capture_relay_ios
-- (117 metadata-only, about 950 duplicates, 24 June rows with the legacy status 'analyzed'). They read as uploads
-- stuck for days; none is waiting on bytes (a pixel upload inserts its row only when its background upload completes).
--
-- What. One call of the existing writer capture_upload_status_resync_v1 for the landing owner since 2026-01-01
-- (dry run: 1,123 rows in 'queued' or 'failed'). It re-runs capture_upload_status_upsert on each row from its current
-- vehicle_images state, so each row shows what the current rule says; capture_analysis_events gains a 'trigger' row
-- for each change. No vehicle_images row is written. The 'analyzed' rows stay queued (the mapping does not read that
-- legacy status); they are named on the board, not guessed at.
-- Guard: both functions as read on 2026-11-25. Idempotent: a replay changes nothing.
-- Contract: supabase/sql/test_capture_upload_status_resync_terminal.sql. No revert: the rows only move to the state the
-- deployed rule computes.

begin;
set local statement_timeout = '45s';
set local lock_timeout = '3s';

do $guard$
declare r record;
begin
  for r in select * from (values
      ('public.capture_upload_status_resync_v1(uuid,timestamp with time zone,boolean,integer)', '11dbc094aeca4b22e239d3aa8c44d2b7'),
      ('public.capture_upload_status_upsert(vehicle_images,text,text)', 'f0102125210bb45a793631ed254c4bdf')) as t(fn, md5_expected) loop
    if coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing') <> r.md5_expected then
      raise exception '% is not the body this resync was written against (md5 %); review before applying', r.fn,
        coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing');
    end if;
  end loop;
end $guard$;

do $resync$
declare v_user uuid := (select user_id from capture_landing_config where id = 1); v jsonb;
begin
  if v_user is null then
    raise notice 'capture_upload_status resync: no landing owner, nothing to do';
    return;
  end if;
  v := public.capture_upload_status_resync_v1(v_user, '2026-01-01'::timestamptz, false, 2000);
  raise notice 'capture_upload_status resync: %', v;
end $resync$;

commit;
