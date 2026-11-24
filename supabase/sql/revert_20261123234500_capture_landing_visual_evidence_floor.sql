-- Restore capture_landing_plan_step to the 2026-11-23 live body (md5 6f8a5cef85f325e4fced48023908b4a9).
-- Does not drop capture_landing_visual_evidence_redecide_* or the log: a live redecide is still
-- undone with capture_landing_visual_evidence_redecide_revert_v1(run).
-- Refuses if plan_step is neither the 20261123234500 body nor the parent.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $do$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.capture_landing_plan_step(uuid,integer)');
  if v_md5 is null then
    raise exception 'public.capture_landing_plan_step(uuid,integer) is not live';
  end if;
  if v_md5 = '6f8a5cef85f325e4fced48023908b4a9' then
    raise notice 'capture_landing_plan_step is already the pre-20261123234500 body';
    return;
  end if;
  if v_md5 <> '6ef112d20600756350a78e4deb0ef93b' then
    raise exception 'capture_landing_plan_step is not the 20261123234500 body (md5 %); refusing to revert it', v_md5;
  end if;
end $do$;

\i supabase/sql/helpers/capture_landing_plan_step_parent_20261123234500.sql

do $do$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.capture_landing_plan_step(uuid,integer)');
  if v_md5 is distinct from '6f8a5cef85f325e4fced48023908b4a9' then
    raise exception 'revert did not restore the parent capture_landing_plan_step (md5 %)', coalesce(v_md5, 'null');
  end if;
end $do$;

commit;
