-- Same current consumer definitions as production, read2026-11-26. No source data.
CREATE TABLE public.model_fold_priority_tiers(tier integer,min_keyed_witnesses integer,counted_classes text[],min_photos integer);
CREATE OR REPLACE FUNCTION public.model_fold_revert_v1(p_tick uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare x record; n_runs int := 0; n_restored int := 0; n int; v_veh uuid[] := '{}';
begin
  if not exists (select 1 from public.model_fold_ticks where tick_id = p_tick) then raise exception 'unknown tick %', p_tick; end if;
  perform set_config('model_fold.in_tick', 'on', true);
  for x in select * from public.model_fold_tick_runs where tick_id = p_tick and reverted_at is null order by id desc loop
    if x.membership_run_id is not null and exists (select 1 from public.data_set_runs where run_id = x.membership_run_id::text and status <> 'reverted') then
      perform public.data_set_membership_revert_v1(x.membership_run_id);
    end if;
    if x.decode_run_id is not null and exists (select 1 from public.vehicle_code_reading_runs where run_id = x.decode_run_id::text and status <> 'reverted') then
      perform public.text_code_decode_revert_v1(x.decode_run_id);
    end if;
    update public.vehicle_code_readings r set state = 'active', reverted_at = null
     where r.id = any (x.invalidated_reading_ids) and r.state = 'reverted'
       and not exists (select 1 from public.vehicle_code_readings a where a.state = 'active' and a.vehicle_id = r.vehicle_id
                         and a.kind = r.kind and a.code = r.code and a.origin_table = r.origin_table
                         and a.origin_id is not distinct from r.origin_id and a.origin_column is not distinct from r.origin_column);
    get diagnostics n = row_count;
    n_restored := n_restored + n;
    v_veh := v_veh || x.vehicle_id;
    update public.model_fold_tick_runs set reverted_at = now() where id = x.id;
    n_runs := n_runs + 1;
  end loop;
  if n_restored > 0 then perform public.text_code_rescore_v1(v_veh); end if;
  update public.model_fold_work set state = 'pending', priority = 5, folded_key = null, reasons = array['reverted'],
         updated_at = now(), next_attempt_at = now() + interval '1 day'
   where vehicle_id = any (v_veh) and state = 'done';
  update public.model_fold_ticks set status = 'reverted', reverted_at = now(),
         revert_summary = jsonb_build_object('vehicles', n_runs, 'readings_restored', n_restored)
   where tick_id = p_tick;
  return jsonb_build_object('tick_id', p_tick, 'vehicles', n_runs, 'readings_restored', n_restored);
end $function$;

CREATE OR REPLACE FUNCTION public.model_fold_queue_gauge()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '8s'
AS $function$
  SELECT jsonb_build_object(
    'signal_tiers_max', coalesce((public.model_fold_config() ->> 'signal_tiers_max')::int, 1),
    'tiers', (SELECT jsonb_agg(jsonb_build_object('tier', tier, 'min_keyed_witnesses', min_keyed_witnesses,
                                                   'counted_classes', counted_classes, 'min_photos', min_photos) ORDER BY tier)
                FROM public.model_fold_priority_tiers),
    'queue', (SELECT jsonb_object_agg(q.priority::text, jsonb_build_object('pending', q.pending, 'leased', q.leased, 'dead', q.dead,
                       'done', q.done, 'oldest_pending_dirty_at', q.oldest))
                FROM (SELECT priority, count(*) FILTER (WHERE state = 'pending') pending, count(*) FILTER (WHERE state = 'leased') leased,
                             count(*) FILTER (WHERE state = 'dead') dead, count(*) FILTER (WHERE state = 'done') done,
                             min(dirty_at) FILTER (WHERE state = 'pending') oldest
                        FROM public.model_fold_work GROUP BY priority) q),
    'signals_waiting', (SELECT count(*) FROM public.model_fold_signal),
    'ticks_24h', (SELECT jsonb_build_object('runs', count(*), 'folded', sum(folded), 'signals', sum(signals),
                           'ms_avg', round(avg(ms)), 'skipped', count(*) FILTER (WHERE status = 'skipped'))
                    FROM public.model_fold_ticks WHERE started_at > now() - interval '24 hours'),
    'fold_ms_24h', (SELECT jsonb_build_object('n', count(*), 'avg', round(avg(r.ms)),
                             'p90', percentile_disc(0.9) WITHIN GROUP (ORDER BY r.ms))
                      FROM public.model_fold_tick_runs r JOIN public.model_fold_ticks t ON t.tick_id = r.tick_id
                     WHERE t.started_at > now() - interval '24 hours'),
    'counted_at', now())
$function$;
