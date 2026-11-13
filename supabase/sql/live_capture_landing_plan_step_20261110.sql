CREATE OR REPLACE FUNCTION public.capture_landing_plan_step(p_chunk uuid, p_budget_s integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '120s'
AS $function$
declare c capture_landing_chunks; cfg capture_landing_config; d timestamptz; d_end timestamptz; prov jsonb; n_sets int := 0; started timestamptz := clock_timestamp();
begin
  select * into c from capture_landing_chunks where id = p_chunk for update;
  if not found or c.state <> 'planning' then return jsonb_build_object('chunk', p_chunk, 'state', c.state, 'skipped', true); end if;
  select * into cfg from capture_landing_config where id = 1;
  d := coalesce(c.plan_cursor, c.t_from);
  while d < c.t_to loop
    d_end := least(d + interval '1 day', c.t_to);
    -- chronological context: clear proposals made earlier in this same chunk feed later days (not yet filed)
    select coalesce(jsonb_agg(jsonb_build_object('vid', s.vehicle_id, 't1', s.t1, 'cells', to_jsonb(s.cells))), '[]'::jsonb) into prov
      from capture_landing_sets s where s.chunk_id = c.id and s.decision = 'clear' and s.t1 >= d - interval '3 days';
    with sc as materialized (
      select * from capture_sets_score(c.user_id, d, d_end, 'live', null, prov) x where cardinality(x.image_ids) > 0
    ), w as (
      -- priors_only (20261111200000): a set clears only when the winner's frames carry an evidence leg. session, cell,
      -- recent, work_session and prev_day are priors from the day's pattern; visual, vin, plate, badge and model are read
      -- from the photos themselves.
      select t.*,
             (coalesce((t.signals->>'visual')::numeric, 0) > 0 or coalesce((t.signals->>'vin')::numeric, 0) > 0
              or coalesce((t.signals->>'plate')::numeric, 0) > 0 or coalesce((t.signals->>'badge')::numeric, 0) > 0
              or coalesce((t.signals->>'model')::numeric, 0) > 0) as has_evidence
      from sc t where t.rank = 1
    )
    insert into capture_landing_sets (chunk_id, set_key, t0, t1, vehicle_id, image_ids, filed_ids, cells, score, margin, decision, reason, top3)
    select c.id, t.set_key, t.t0, t.t1, t.vehicle_id, t.image_ids, t.filed_ids,
           coalesce((select array_agg(distinct round(vi.latitude::numeric,3)::text || ',' || round(vi.longitude::numeric,3)::text)
                      from vehicle_images vi where vi.id = any(t.image_ids) and vi.latitude is not null), '{}'),
           (t.signals->>'score')::numeric, (t.signals->>'margin_raw')::numeric,
           case when t.vehicle_id is not null and t.vehicle_id <> all (cfg.protected_vehicle_ids)
                 and (t.signals->>'score')::numeric >= greatest(2.5, cfg.min_score)
                 and (t.signals->>'margin_raw')::numeric >= greatest(1, cfg.min_margin)
                 and t.has_evidence then 'clear' else 'review' end,
           case when t.vehicle_id is null then 'no_candidate'
                when t.vehicle_id = any (cfg.protected_vehicle_ids) then 'protected_vehicle'
                when (t.signals->>'margin_raw')::numeric < greatest(1, cfg.min_margin) then 'no_clear_lead'
                when (t.signals->>'score')::numeric < greatest(2.5, cfg.min_score) then 'score_below_threshold'
                when not t.has_evidence then 'priors_only' end,
           (select jsonb_agg(jsonb_build_object('vehicle_id', y.vehicle_id, 'rank', y.rank, 'signals', y.signals) order by y.rank) from sc y where y.set_key = t.set_key)
    from w t
    on conflict (chunk_id, set_key) do nothing;
    get diagnostics n_sets = row_count;
    d := d_end;
    update capture_landing_chunks set plan_cursor = d, updated_at = now() where id = c.id;
    exit when extract(epoch from clock_timestamp() - started) > p_budget_s;
  end loop;
  if d >= c.t_to then
    update capture_landing_chunks set state = 'planned', updated_at = now(),
      stats = jsonb_build_object('sets', (select count(*) from capture_landing_sets where chunk_id = c.id),
        'clear_sets', (select count(*) from capture_landing_sets where chunk_id = c.id and decision = 'clear'),
        'clear_photos', (select coalesce(sum(cardinality(image_ids)),0) from capture_landing_sets where chunk_id = c.id and decision = 'clear'),
        'review_sets', (select count(*) from capture_landing_sets where chunk_id = c.id and decision = 'review'),
        'review_photos', (select coalesce(sum(cardinality(image_ids)),0) from capture_landing_sets where chunk_id = c.id and decision = 'review'),
        'review_reasons', (select coalesce(jsonb_object_agg(reason, n), '{}') from (select reason, count(*) n from capture_landing_sets where chunk_id = c.id and decision = 'review' group by 1) q))
    where id = c.id;
  end if;
  return jsonb_build_object('chunk', c.id, 'cursor', d, 'done', d >= c.t_to);
end $function$;
