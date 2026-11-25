-- Revert 20261126151500_capture_set_members: stop the backfill job, put back production's writer body of 2026-11-25
-- (md5(prosrc) ce59756228fdd1f6125e1110a78cecf9), drop the backfill, agreement and check functions, the member table and the check's assay row.
-- LOCKS: DROP TABLE takes ACCESS EXCLUSIVE on capture_set_members and, through its foreign keys, on vehicle_images and
-- capture_set_candidates, which stops every reader and writer of both until it commits. Run it only in a quiet window
-- (v_job_health: fewest lots near close), with the lock_timeout below.
-- The member rows are derived from capture_set_candidates.image_ids, which this migration never changed, so dropping
-- them loses nothing the array does not hold. Run by hand only, reviewed; never by a job.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '3s';

do $cron$
begin
  if to_regclass('cron.job') is null then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('capture-set-members-backfill', 'capture-set-members-agreement');
end $cron$;

CREATE OR REPLACE FUNCTION public.record_capture_set_candidates(p_run_id uuid, p_user uuid, p_method text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE it jsonb; v_ids uuid[]; v_ok int := 0; v_skip int := 0; v_dup int := 0; v_n int;
BEGIN
  IF p_run_id IS NULL OR p_user IS NULL OR coalesce(p_method, '') = '' OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'record_capture_set_candidates: run, user, method and an items array are required';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ids := ARRAY(SELECT jsonb_array_elements_text(it->'image_ids')::uuid);
    IF NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = (it->>'vehicle_id')::uuid AND v.deleted_at IS NULL
                     AND v.merged_into_vehicle_id IS NULL)
       OR (SELECT count(*) FROM vehicle_images vi WHERE vi.id = ANY(v_ids) AND vi.user_id = p_user AND vi.vehicle_id IS NULL)
          <> cardinality(v_ids) THEN
      v_skip := v_skip + 1; CONTINUE;
    END IF;
    INSERT INTO capture_set_candidates (run_id, user_id, set_key, image_ids, vehicle_id, rank, combined, margin, band,
                                        signals, method, created_by)
    VALUES (p_run_id, p_user, it->>'set_key', v_ids, (it->>'vehicle_id')::uuid, (it->>'rank')::smallint,
            (it->>'combined')::numeric, (it->>'margin')::numeric, it->>'band', it->'signals', p_method, 'agent:grok-bot')
    ON CONFLICT (run_id, set_key, vehicle_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_dup := v_dup + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run_id, 'written', v_ok, 'skipped', v_skip, 'duplicate', v_dup);
END $function$;

drop function if exists public.capture_set_members_backfill(integer);
drop function if exists public.capture_set_members_check_raise();
drop function if exists public.capture_set_members_check();
drop function if exists public.capture_set_members_agreement();
drop table if exists public.capture_set_members;
delete from public.platform_config where config_key = 'capture_set_members_backfill';
delete from public.job_assay_readings where jobname = 'capture-set-members-agreement';
update public.platform_config
   set config_value = jsonb_set(config_value, '{jobs}', (config_value->'jobs') - 'capture-set-members-backfill'), updated_at = now()
 where config_key = 'auction_close_yield' and jsonb_typeof(config_value->'jobs') = 'array';

do $check$
begin
  if (select md5(prosrc) from pg_proc
       where oid = to_regprocedure('public.record_capture_set_candidates(uuid,uuid,text,jsonb)'))
     <> 'ce59756228fdd1f6125e1110a78cecf9' then
    raise exception 'revert did not restore record_capture_set_candidates to production''s body';
  end if;
end $check$;

commit;
