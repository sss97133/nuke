-- scorecard perf: analyze temp tables so the planner uses index paths (hourly cron hit the 10s statement cap)
do $$
declare d text;
begin
  select pg_get_functiondef('public.profile_quality_snapshot_v1(uuid,uuid,text,text,boolean)'::regprocedure) into d;
  if position('analyze _pq_v;' in d) = 0 then
    d := replace(d, 'create temp table _pq_img on commit drop', 'analyze _pq_v;' || chr(10) || '  create temp table _pq_img on commit drop');
    d := replace(d, 'create temp table _pq_ev on commit drop', 'analyze _pq_img;' || chr(10) || '  create temp table _pq_ev on commit drop');
    d := replace(d, 'create temp table _pq_evagg on commit drop', 'analyze _pq_ev;' || chr(10) || '  create temp table _pq_evagg on commit drop');
    execute d;
  end if;
end $$;
revoke all on function public.profile_quality_snapshot_v1(uuid,uuid,text,text,boolean) from public, anon, authenticated;
