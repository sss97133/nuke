-- Photo-landing v3 (3/6): bounded, gated, chronological landing pipeline (two tracks) + cron.
--
-- Tracks:  'forward' = oldest-unresolved-first, one chunk (default 30 days) at a time, a chunk must pass the
--                      visual gate AND finish applying before the next chunk is planned.
--          'recent'  = rolling window over the last N days (default 7) for incoming photos; same gate / rules.
--          'manual'  = ad-hoc windows created via capture_sets_landing_run(...,dry=false).
-- Nothing is filed without filing_run_gate.passed (enforced twice: here and by trg_filing_gate on capture_set_links).
-- Rules: the scorer only ever considers UNFILED photos (vehicle_id null / placeholder) so an already-filed photo is
-- never moved; photos with >=2 reverted filings are skipped (no ping-pong); every filing is a capture_set_links row.
-- A failed gate (error rate > 5%) halts the whole pipeline (config.halted=true) and deactivates the cron job.

create table if not exists capture_landing_config (
  id int primary key default 1 check (id = 1),
  user_id uuid not null,
  enabled boolean not null default false,
  halted boolean not null default false,
  halt_reason text,
  forward_cursor timestamptz,                         -- start of the next forward chunk (null = from the beginning)
  chunk_days int not null default 30,
  recent_days int not null default 7,
  min_score numeric not null default 2.5,            -- never below 2.5 / margin 1 (enforced by capture_sets_apply as well)
  min_margin numeric not null default 1.0,
  plan_budget_seconds int not null default 40,
  apply_batch_sets int not null default 10,
  protected_vehicle_ids uuid[] not null default array['7b0e02b9-42af-4998-b27d-69e3459b452b','1e9fdf16-b453-44a9-8b74-46bbe886625a']::uuid[],
  updated_at timestamptz not null default now()
);

create table if not exists capture_landing_chunks (
  id uuid primary key default gen_random_uuid(),
  track text not null check (track in ('forward','recent','manual')),
  pass int not null default 1,                         -- re-evaluation passes over the same window
  user_id uuid not null,
  t_from timestamptz not null,
  t_to timestamptz not null,
  dry boolean not null default false,
  state text not null default 'planning' check (state in ('planning','planned','awaiting_gate','applying','applied','gate_failed','empty','superseded')),
  run_id uuid not null default gen_random_uuid(),     -- doubles as capture-set run id and gate run id (text)
  plan_cursor timestamptz,
  stats jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track, pass, user_id, t_from, t_to)
);
create index if not exists capture_landing_chunks_state on capture_landing_chunks (state, track);

create table if not exists capture_landing_sets (
  chunk_id uuid not null references capture_landing_chunks(id) on delete cascade,
  set_key text not null,
  t0 timestamptz not null, t1 timestamptz not null,
  vehicle_id uuid,
  image_ids uuid[] not null, filed_ids uuid[] not null default '{}',
  cells text[] not null default '{}',
  score numeric, margin numeric,
  decision text not null check (decision in ('clear','review')),
  reason text,
  top3 jsonb,
  applied_at timestamptz, apply_result text,
  primary key (chunk_id, set_key)
);

-- ---------------------------------------------------------------- plan
create or replace function capture_landing_plan_step(p_chunk uuid, p_budget_s int default 40)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
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
    )
    insert into capture_landing_sets (chunk_id, set_key, t0, t1, vehicle_id, image_ids, filed_ids, cells, score, margin, decision, reason, top3)
    select c.id, t.set_key, t.t0, t.t1, t.vehicle_id, t.image_ids, t.filed_ids,
           coalesce((select array_agg(distinct round(vi.latitude::numeric,3)::text || ',' || round(vi.longitude::numeric,3)::text)
                      from vehicle_images vi where vi.id = any(t.image_ids) and vi.latitude is not null), '{}'),
           (t.signals->>'score')::numeric, (t.signals->>'margin_raw')::numeric,
           case when t.vehicle_id is not null and t.vehicle_id <> all (cfg.protected_vehicle_ids)
                 and (t.signals->>'score')::numeric >= greatest(2.5, cfg.min_score)
                 and (t.signals->>'margin_raw')::numeric >= greatest(1, cfg.min_margin) then 'clear' else 'review' end,
           case when t.vehicle_id is null then 'no_candidate'
                when t.vehicle_id = any (cfg.protected_vehicle_ids) then 'protected_vehicle'
                when (t.signals->>'margin_raw')::numeric < greatest(1, cfg.min_margin) then 'no_clear_lead'
                when (t.signals->>'score')::numeric < greatest(2.5, cfg.min_score) then 'score_below_threshold' end,
           (select jsonb_agg(jsonb_build_object('vehicle_id', y.vehicle_id, 'rank', y.rank, 'signals', y.signals) order by y.rank) from sc y where y.set_key = t.set_key)
    from sc t where t.rank = 1
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
end $$;

-- planned -> (dry: stays planned, stats only) | (live: candidates + review rows + gate enqueue -> awaiting_gate | applied(empty))
create or replace function capture_landing_finalize_plan(p_chunk uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare c capture_landing_chunks; cands jsonb; n_clear int; n_ph int; req int; q int; g jsonb;
begin
  select * into c from capture_landing_chunks where id = p_chunk for update;
  if c.state <> 'planned' or c.dry then return jsonb_build_object('chunk', p_chunk, 'state', c.state, 'skipped', true); end if;
  select count(*), coalesce(sum(cardinality(image_ids)),0) into n_clear, n_ph from capture_landing_sets where chunk_id = c.id and decision = 'clear';
  insert into capture_set_review (run_id, user_id, set_key, image_ids, to_vehicle_id, confidence, basis, evidence, reason)
  select c.run_id, c.user_id, s.set_key, s.image_ids, s.vehicle_id, round(1/(1+exp(-coalesce(s.score,0)+2)),3), 'scored_session',
         jsonb_build_object('top3', s.top3, 'scorer', 'v3'), s.reason
  from capture_landing_sets s where s.chunk_id = c.id and s.decision = 'review'
  on conflict (run_id, set_key) do nothing;
  -- candidates (top-3 per clear set) are what capture_sets_apply re-checks at apply time
  select coalesce(jsonb_agg(jsonb_build_object('set_key', s.set_key, 'image_ids', to_jsonb(s.image_ids), 'vehicle_id', t->>'vehicle_id',
        'rank', (t->>'rank')::int,
        'combined', round(1/(1+exp(-((t->'signals'->>'score')::numeric - 2))),4),
        'margin', greatest(-1, least(1, round(case when (t->>'rank')::int = 1
              then 1/(1+exp(-(s.score-2))) - 1/(1+exp(-((s.score - s.margin) - 2)))
              else 1/(1+exp(-((t->'signals'->>'score')::numeric - 2))) - 1/(1+exp(-(s.score-2))) end, 4))),
        'band', case when (t->>'rank')::int = 1 and s.decision = 'clear' then 'clear' when (t->>'rank')::int = 1 and s.margin < 0.25 then 'tie'
                     when (t->'signals'->>'score')::numeric >= 1.5 then 'likely' else 'weak' end,
        'signals', t->'signals')), '[]'::jsonb) into cands
  from capture_landing_sets s cross join lateral jsonb_array_elements(s.top3) t where s.chunk_id = c.id;
  perform record_capture_set_candidates(c.run_id, c.user_id, 'scored_session_v1', cands);
  if n_clear = 0 then
    update capture_landing_chunks set state = 'applied', note = 'no set passed the score threshold; all held as proposals (capture_set_review)', updated_at = now() where id = c.id;
    return jsonb_build_object('chunk', c.id, 'state', 'applied', 'clear_sets', 0);
  end if;
  -- stratified gate sample: one photo per set first (round-robin), min(10, n) photos, each to be VIEWED and marked
  req := least(10, n_ph::int);
  insert into auto_filing_audit_queue (image_id, vehicle_id, source, run_id, reason)
  select z.img, z.vid, 'pre_gate', c.run_id::text, z.set_key || ' score=' || z.score
  from (select i.img, s.vehicle_id vid, s.set_key, round(s.score,2) score,
               row_number() over (partition by s.set_key order by random()) rn
        from capture_landing_sets s cross join lateral unnest(s.image_ids) i(img)
        where s.chunk_id = c.id and s.decision = 'clear') z
  order by z.rn, random() limit req
  on conflict do nothing;
  get diagnostics q = row_count;
  insert into filing_run_gate (run_id, planned_n, required_n, note) values (c.run_id::text, n_ph::int, req, 'awaiting visual verification')
  on conflict (run_id) do update set planned_n = excluded.planned_n, required_n = excluded.required_n, passed = false, note = 're-enqueued';
  update capture_landing_chunks set state = 'awaiting_gate', updated_at = now() where id = c.id;
  return jsonb_build_object('chunk', c.id, 'state', 'awaiting_gate', 'clear_sets', n_clear, 'clear_photos', n_ph, 'gate_sample', q, 'gate_run', c.run_id);
end $$;

-- gate evaluation + halting
create or replace function capture_landing_gate_check(p_chunk uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c capture_landing_chunks; g jsonb; er numeric; w int; cr int; job bigint;
begin
  select * into c from capture_landing_chunks where id = p_chunk for update;
  g := filing_gate_eval(c.run_id::text);
  er := nullif(g->>'error_rate','')::numeric;
  if (g->>'passed')::boolean then
    update capture_landing_chunks set state = 'applying', note = 'visual gate passed', stats = stats || jsonb_build_object('gate', g), updated_at = now() where id = c.id;
  elsif er is not null and er > 0.05 then
    update capture_landing_chunks set state = 'gate_failed', note = 'visual gate failed: error rate ' || round(er,3) || ' > 0.05', stats = stats || jsonb_build_object('gate', g), updated_at = now() where id = c.id;
    update capture_landing_config set halted = true, halt_reason = 'gate failed on chunk ' || c.id || ' (' || c.track || ' ' || c.t_from || ' .. ' || c.t_to || ')', updated_at = now() where id = 1;
    begin
      select jobid into job from cron.job where jobname = 'capture-sets-landing-tick';
      if job is not null then perform cron.alter_job(job, active := false); end if;
    exception when others then null; end;
  end if;
  return g;
end $$;

-- apply (only after gate pass), in batches, chronological
create or replace function capture_landing_apply_chunk(p_chunk uuid, p_budget_s int default 60)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '170s' as $$
declare c capture_landing_chunks; cfg capture_landing_config; items jsonb; res jsonb; started timestamptz := clock_timestamp(); keys text[];
  filed int := 0; refused int := 0; remaining int; r jsonb;
begin
  select * into c from capture_landing_chunks where id = p_chunk for update;
  if c.state <> 'applying' then return jsonb_build_object('chunk', p_chunk, 'state', c.state, 'skipped', true); end if;
  if not exists (select 1 from filing_run_gate where run_id = c.run_id::text and passed) then raise exception 'visual gate not passed for chunk %', c.id; end if;
  select * into cfg from capture_landing_config where id = 1;
  loop
    select jsonb_agg(jsonb_build_object('set_key', s.set_key, 'vehicle_id', s.vehicle_id, 'image_ids', to_jsonb(s.image_ids),
           'segment_ids', to_jsonb(s.image_ids || s.filed_ids), 'confidence', round(1/(1+exp(-(s.score - 2))),3), 'basis', 'scored_session',
           'evidence', jsonb_build_object('scorer','v3','chunk',c.id,'track',c.track,'top3',s.top3)) order by s.t0),
           array_agg(s.set_key order by s.t0)
      into items, keys
      from (select * from capture_landing_sets where chunk_id = c.id and decision = 'clear' and applied_at is null order by t0 limit cfg.apply_batch_sets) s;
    exit when items is null;
    res := capture_sets_apply(c.run_id, c.user_id, items, 0.6);
    -- provenance for already-filed siblings that agree with the target (success=false => never unfiled by capture_sets_revert)
    insert into capture_set_links (run_id, set_key, image_id, vehicle_id, confidence, evidence, before_image, result)
    select c.run_id, s.set_key, f.id, s.vehicle_id, round(1/(1+exp(-(s.score - 2))),3),
           jsonb_build_object('basis', 'scored_session', 'provenance_only', true, 'segment_ids', to_jsonb(s.image_ids || s.filed_ids)),
           jsonb_build_object('vehicle_id', f.vehicle_id), jsonb_build_object('success', false, 'provenance', true)
    from capture_landing_sets s join vehicle_images f on f.id = any(s.filed_ids) and f.vehicle_id = s.vehicle_id
    where s.chunk_id = c.id and s.set_key = any(keys)
      and exists (select 1 from capture_set_links l where l.run_id = c.run_id and l.set_key = s.set_key and l.image_id = any(s.image_ids))
    on conflict do nothing;
    update capture_landing_sets s set applied_at = now(),
           apply_result = case when (res->'sets_refused') ? s.set_key then 'refused' else 'filed' end
     where s.chunk_id = c.id and s.set_key = any(keys);
    filed := filed + coalesce((res->>'photos_filed')::int, 0);
    exit when extract(epoch from clock_timestamp() - started) > p_budget_s;
  end loop;
  select count(*) into remaining from capture_landing_sets where chunk_id = c.id and decision = 'clear' and applied_at is null;
  if remaining = 0 then
    -- resolve the per-photo/pending timeline events for what landed (defined in migration 4), best effort
    if to_regprocedure('public.timeline_resolve_pending_for_images(uuid[], uuid)') is not null then
      perform timeline_resolve_pending_for_images(
        (select array_agg(l.image_id) from capture_set_links l where l.run_id = c.run_id and coalesce((l.result->>'success')::boolean,false)), c.run_id);
    end if;
    update capture_landing_chunks set state = 'applied', updated_at = now(),
       stats = stats || jsonb_build_object('applied', jsonb_build_object(
         'photos_filed', (select count(*) from capture_set_links l where l.run_id = c.run_id and coalesce((l.result->>'success')::boolean,false)),
         'links', (select count(*) from capture_set_links l where l.run_id = c.run_id),
         'sets_refused', (select count(*) from capture_landing_sets where chunk_id = c.id and apply_result = 'refused'))),
       note = 'applied after visual gate; revert with capture_sets_revert(run_id, user)'
     where id = c.id;
    if c.track = 'forward' then update capture_landing_config set forward_cursor = c.t_to, updated_at = now() where id = 1; end if;
  end if;
  return jsonb_build_object('chunk', c.id, 'photos_filed_this_call', filed, 'remaining_sets', remaining);
end $$;

-- ---------------------------------------------------------------- chunk creation
create or replace function capture_landing_new_chunk(p_user uuid, p_track text, p_from timestamptz, p_to timestamptz, p_dry boolean default false, p_run uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pass int; v_id uuid;
begin
  select coalesce(max(pass),0) + 1 into v_pass from capture_landing_chunks where track = p_track and user_id = p_user and t_from = p_from and t_to = p_to;
  insert into capture_landing_chunks (track, pass, user_id, t_from, t_to, dry, run_id)
  values (p_track, v_pass, p_user, p_from, p_to, p_dry, coalesce(p_run, gen_random_uuid())) returning id into v_id;
  return v_id;
end $$;

create or replace function capture_landing_unfiled_exists(p_user uuid, p_from timestamptz, p_to timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from vehicle_images vi where vi.user_id = p_user and vi.source = 'capture_relay_ios'
    and vi.taken_at >= p_from and vi.taken_at < p_to and nullif(vi.image_url,'') is not null
    and (vi.vehicle_id is null or vi.vehicle_id = '14447ecd-293e-4203-9045-90102559c904'::uuid))
$$;

-- one step of one chunk's state machine
create or replace function capture_landing_advance(p_chunk uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare c capture_landing_chunks; cfg capture_landing_config; out jsonb;
begin
  select * into c from capture_landing_chunks where id = p_chunk;
  select * into cfg from capture_landing_config where id = 1;
  if c.state = 'planning' then out := capture_landing_plan_step(c.id, cfg.plan_budget_seconds);
  elsif c.state = 'planned' and not c.dry then out := capture_landing_finalize_plan(c.id);
  elsif c.state = 'awaiting_gate' then out := capture_landing_gate_check(c.id);
  elsif c.state = 'applying' then out := capture_landing_apply_chunk(c.id, 50);
  else out := jsonb_build_object('state', c.state, 'noop', true); end if;
  return coalesce(out, '{}'::jsonb) || jsonb_build_object('chunk', c.id, 'track', c.track);
end $$;

-- ---------------------------------------------------------------- cron entry point
create or replace function capture_landing_tick()
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare cfg capture_landing_config; c capture_landing_chunks; log jsonb := '[]'; ceiling timestamptz; first_ts timestamptz; a timestamptz; prev capture_landing_chunks;
begin
  if not pg_try_advisory_xact_lock(hashtext('capture_landing_tick')) then return jsonb_build_object('skipped', 'locked'); end if;
  select * into cfg from capture_landing_config where id = 1;
  if not found or not cfg.enabled then return jsonb_build_object('skipped', 'disabled'); end if;
  if cfg.halted then return jsonb_build_object('skipped', 'halted', 'reason', cfg.halt_reason); end if;
  ceiling := date_trunc('day', now() - make_interval(days => cfg.recent_days) - interval '10 hours') + interval '10 hours';

  -- track 2: recent / newest first (priority)
  select * into c from capture_landing_chunks where track = 'recent' and not dry and state in ('planning','planned','awaiting_gate','applying') order by created_at limit 1;
  if not found then
    select * into prev from capture_landing_chunks where track = 'recent' and not dry order by t_to desc limit 1;
    a := greatest(now() - make_interval(days => cfg.recent_days), coalesce(prev.t_to, '-infinity'::timestamptz));
    if (prev.id is null or prev.created_at < now() - interval '2 hours') and capture_landing_unfiled_exists(cfg.user_id, a, now() - interval '30 minutes') then
      c.id := capture_landing_new_chunk(cfg.user_id, 'recent', a, now() - interval '30 minutes');
    else c.id := null; end if;
  end if;
  if c.id is not null then log := log || jsonb_build_array(capture_landing_advance(c.id)); end if;

  -- track 1: forward pass, oldest unresolved first, strictly one open chunk at a time
  select * into c from capture_landing_chunks where track = 'forward' and not dry and state in ('planning','planned','awaiting_gate','applying') order by created_at limit 1;
  if not found then
    a := coalesce(cfg.forward_cursor, '1970-01-01'::timestamptz);
    select min(vi.taken_at) into first_ts from vehicle_images vi
     where vi.user_id = cfg.user_id and vi.source = 'capture_relay_ios' and vi.taken_at >= a and vi.taken_at < ceiling and nullif(vi.image_url,'') is not null
       and (vi.vehicle_id is null or vi.vehicle_id = '14447ecd-293e-4203-9045-90102559c904'::uuid);
    if first_ts is not null then
      a := date_trunc('day', first_ts - interval '10 hours') + interval '10 hours';
      c.id := capture_landing_new_chunk(cfg.user_id, 'forward', a, least(a + make_interval(days => cfg.chunk_days), ceiling));
    else c.id := null; end if;
  end if;
  if c.id is not null then log := log || jsonb_build_array(capture_landing_advance(c.id)); end if;

  -- manual chunks
  for c in select * from capture_landing_chunks where track = 'manual' and not dry and state in ('planning','planned','awaiting_gate','applying') order by created_at limit 2 loop
    log := log || jsonb_build_array(capture_landing_advance(c.id));
  end loop;
  return jsonb_build_object('at', now(), 'advanced', log);
end $$;

-- ---------------------------------------------------------------- compatibility wrapper
-- Was: score + (non-dry) attribute directly + write 0.97 VIN/plate observations that bypassed the gate.
-- Now: dry => chronological dry chunk + stats. live => manual chunk planned + gate enqueued; filing only via the gated state machine.
create or replace function capture_sets_landing_run(p_user uuid, p_from timestamptz, p_to timestamptz, p_run uuid, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare cid uuid; st text; i int := 0; out jsonb; cfg capture_landing_config;
begin
  if p_run is null then raise exception 'run id required'; end if;
  select * into cfg from capture_landing_config where id = 1;
  cid := capture_landing_new_chunk(p_user, 'manual', p_from, p_to, p_dry, p_run);
  perform capture_landing_plan_step(cid, 70);
  select state into st from capture_landing_chunks where id = cid;
  if st = 'planned' and not p_dry then perform capture_landing_finalize_plan(cid); end if;
  select jsonb_build_object('run_id', p_run, 'chunk', id, 'dry', dry, 'state', state, 'stats', stats, 'note', 'live runs only propose + enqueue the visual gate; apply happens via capture_landing_tick/capture_landing_apply_chunk after the gate passes')
    into out from capture_landing_chunks where id = cid;
  return out;
end $$;

-- ---------------------------------------------------------------- config + cron
insert into capture_landing_config (user_id) values ('0b9f107a-d124-49de-9ded-94698f63c1c4') on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'capture-sets-landing-tick') then
    perform cron.schedule('capture-sets-landing-tick', '*/10 * * * *', $c$select public.capture_landing_tick()$c$);
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm; end $$;
