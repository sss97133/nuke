-- Revert 20261124044000_model_fold_review_fixes: restore the previous sweep and tick bodies.
begin;
set local lock_timeout = '3s';

create or replace function public.model_fold_sweep(p_key text, p_cfg jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  s text; c public.model_fold_cursor; v_ids uuid[]; v_last uuid; n_q int; total int := 0; out jsonb := '{}';
  v_step int; v_gen int; v_lo int; v_hi int;
  v_scan int := coalesce((p_cfg ->> 'sweep_scan')::int, 2000);
  v_settle int := coalesce((p_cfg ->> 'settle_seconds')::int, 300);
begin
  for s in select jsonb_array_elements_text(p_cfg -> 'scopes') loop
    insert into public.model_fold_cursor (scope) values (s) on conflict do nothing;
    select * into c from public.model_fold_cursor where scope = s for update;
    -- Snapshot refresh is chunked by model-year bucket (the (lower(make), year) index) so one step stays well under the
    -- cron statement timeout; the new generation replaces the old one only after its last bucket.
    if c.snap_step is not null or (c.cursor is null and (c.snapshot_at is null
        or c.snapshot_at < now() - make_interval(hours => coalesce((p_cfg ->> 'snapshot_max_age_hours')::int, 6)))) then
      v_step := coalesce(c.snap_step, 0);
      v_gen := case when c.snap_step is null then c.snap_gen + 1 else c.snap_gen end;
      v_lo := (array[-32768, 1960, 1968, 1971, 1974, 1977, 1980, 1984, 1993, null])[v_step + 1];
      v_hi := (array[1959, 1967, 1970, 1973, 1976, 1979, 1983, 1992, 32767, null])[v_step + 1];
      insert into public.model_fold_scope_members as m (scope, vehicle_id, gen)
      select s, v.id, v_gen from public.vehicles v
       where lower(v.make) = public.model_fold_scope_make(s)
         and (case when v_step = 9 then v.year is null else v.year between v_lo and v_hi end)
         and v.id::text not like '9cf5b7a4%'
         and public.model_fold_scope_of(v.make, v.model, v.vin, v.year) = s
      on conflict (scope, vehicle_id) do update set gen = excluded.gen;
      get diagnostics n_q = row_count;
      if v_step < 9 then
        update public.model_fold_cursor set snap_step = v_step + 1, snap_gen = v_gen, updated_at = now() where scope = s;
      else
        delete from public.model_fold_scope_members where scope = s and gen <> v_gen;
        update public.model_fold_cursor set snap_step = null, snap_gen = v_gen, snapshot_at = now(), verified_key = null,
               snapshot_n = (select count(*) from public.model_fold_scope_members where scope = s), updated_at = now()
         where scope = s;
      end if;
      out := out || jsonb_build_object(s, jsonb_build_object('snapshot_step', v_step, 'rows', n_q));
      return out || jsonb_build_object('_queued', total, '_snapshot', true);
    end if;
    if c.cursor is null and c.verified_key is not distinct from p_key then continue; end if;
    -- A new full pass (logic changed) starts at most every min_pass_hours; signalled vehicles still fold right away.
    if c.cursor is null and c.pass_started_at > now() - make_interval(hours => coalesce((p_cfg ->> 'min_pass_hours')::int, 6)) then
      continue;
    end if;
    if (select count(*) from public.model_fold_work where state = 'pending' and priority >= 5)
       >= coalesce((p_cfg ->> 'sweep_pending_cap')::int, 1000) then continue; end if;
    select array_agg(vehicle_id order by vehicle_id) into v_ids from (
      select m.vehicle_id from public.model_fold_scope_members m
       where m.scope = s and m.vehicle_id > coalesce(c.cursor, '00000000-0000-0000-0000-000000000000'::uuid)
       order by m.vehicle_id limit v_scan) z;
    v_last := v_ids[cardinality(v_ids)];
    insert into public.model_fold_work as w (vehicle_id, priority, reasons, first_dirty_at, dirty_at, next_attempt_at)
    select x, 5, array['sweep'], now() - make_interval(secs => v_settle), now() - make_interval(secs => v_settle), now()
      from unnest(coalesce(v_ids, '{}')) x
     where not exists (select 1 from public.model_fold_work w2 where w2.vehicle_id = x
                         and (w2.state in ('pending','leased') or w2.folded_key is not distinct from p_key
                              or (w2.state = 'dead' and w2.updated_at > now() - interval '1 day')))
    on conflict (vehicle_id) do update set state = 'pending', priority = 5, reasons = array['sweep'],
      first_dirty_at = excluded.first_dirty_at, dirty_at = excluded.dirty_at, next_attempt_at = now(), attempts = 0,
      updated_at = now()
     where w.state = 'done' or (w.state = 'dead' and w.updated_at <= now() - interval '1 day');
    get diagnostics n_q = row_count;
    total := total + n_q;
    if coalesce(cardinality(v_ids), 0) < v_scan then
      update public.model_fold_cursor set cursor = null, cycle = cycle + 1, wrapped_at = now(),
             verified_key = case when pass_key is not distinct from p_key then p_key end,
             pass_key = null, enqueued_total = enqueued_total + n_q, updated_at = now() where scope = s;
    else
      update public.model_fold_cursor set cursor = v_last,
             pass_key = case when c.cursor is null then p_key when pass_key is distinct from p_key then null else pass_key end,
             pass_started_at = case when c.cursor is null then now() else pass_started_at end,
             enqueued_total = enqueued_total + n_q, updated_at = now() where scope = s;
    end if;
    out := out || jsonb_build_object(s, jsonb_build_object('scanned', coalesce(cardinality(v_ids), 0), 'queued', n_q));
  end loop;
  return out || jsonb_build_object('_queued', total);
end $$;

create or replace procedure public.model_fold_tick()
language plpgsql as $$
declare
  cfg jsonb := public.model_fold_config();
  v_tick uuid := gen_random_uuid(); t0 timestamptz := clock_timestamp();
  v_budget interval := make_interval(secs => coalesce((cfg ->> 'budget_ms')::numeric, 40000) / 1000.0);
  v_max int := coalesce((cfg ->> 'max_vehicles')::int, 200);
  v_settle interval := make_interval(secs => coalesce((cfg ->> 'settle_seconds')::int, 300));
  v_maxdelay interval := make_interval(secs => coalesce((cfg ->> 'max_delay_seconds')::int, 1800));
  v_lease interval := make_interval(secs => coalesce((cfg ->> 'lease_seconds')::int, 300));
  v_maxatt int := coalesce((cfg ->> 'max_attempts')::int, 5);
  v_key text; v_reason text; v_sig int := 0; v_sweep jsonb; v_veh uuid; v_dirty timestamptz; v_att int; r jsonb; v_err text;
  n_claim int := 0; n_ok int := 0; n_fail int := 0; n_dead int := 0; n_add int := 0; n_inv int := 0; n_app int := 0; n_sup int := 0;
  v_stuck record; v_edited uuid[];
begin
  if not coalesce((cfg ->> 'enabled')::boolean, false) then return; end if;
  -- A tick that died on this same session (error or timeout after COMMIT) left its session lock and in_tick flag behind;
  -- drop them before trying again. Cron runs this CALL alone on its connection, so this session holds no other advisory lock.
  if coalesce(current_setting('model_fold.in_tick', true), '') = 'on' then
    perform pg_advisory_unlock_all();
    perform set_config('model_fold.in_tick', '', false);
  end if;
  if not pg_try_advisory_lock(hashtext('public.model_fold_tick')) then
    -- Another tick holds the lock. Cancel it only if it has overrun the stuck limit.
    for v_stuck in select t.tick_id, t.pid from public.model_fold_ticks t
                    where t.status = 'running' and t.started_at < now() - make_interval(secs => coalesce((cfg ->> 'stuck_tick_seconds')::int, 180))
    loop
      perform pg_cancel_backend(v_stuck.pid) from pg_stat_activity a where a.pid = v_stuck.pid and a.query ilike '%model_fold_tick%';
      update public.model_fold_ticks set status = 'stale', finished_at = clock_timestamp(), error = 'cancelled: overran stuck_tick_seconds'
       where tick_id = v_stuck.tick_id and status = 'running';
    end loop;
    insert into public.model_fold_ticks (tick_id, status, skip_reason, finished_at, pid)
    values (v_tick, 'skipped', 'previous tick still running', clock_timestamp(), pg_backend_pid());
    commit;
    return;
  end if;
  perform set_config('model_fold.in_tick', 'on', false);
  perform set_config('lock_timeout', coalesce(cfg ->> 'lock_timeout', '2s'), false);
  -- A tick that ended without finishing (cancelled, timed out) is stale; the vehicle it held backs off and counts an attempt.
  with st as (update public.model_fold_ticks set status = 'stale', finished_at = clock_timestamp(),
                     error = coalesce(error, 'tick ended without finishing (timeout or cancel)')
               where status = 'running' returning tick_id)
  update public.model_fold_work w set state = case when w.attempts >= v_maxatt then 'dead' else 'pending' end,
         next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, w.attempts)::int)),
         leased_until = null, lease_tick = null, last_error = 'tick ended while folding this vehicle (timeout or cancel)', updated_at = now()
    from st where w.state = 'leased' and w.lease_tick = st.tick_id;
  insert into public.model_fold_ticks (tick_id, status, pid) values (v_tick, 'running', pg_backend_pid());
  commit;

  v_reason := public.model_fold_backpressure(cfg);
  if v_reason is not null then
    update public.model_fold_ticks set status = 'skipped', skip_reason = v_reason, finished_at = clock_timestamp(),
           ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int where tick_id = v_tick;
    commit;
    perform set_config('model_fold.in_tick', '', false);
    perform pg_advisory_unlock(hashtext('public.model_fold_tick'));
    return;
  end if;

  v_sig := public.model_fold_absorb_signals(coalesce((cfg ->> 'signal_batch')::int, 50000));
  -- Leases left by a tick that died: back to pending (their attempt already counted).
  update public.model_fold_work set state = case when attempts >= v_maxatt then 'dead' else 'pending' end,
         leased_until = null, last_error = coalesce(last_error, 'lease expired'), updated_at = now()
   where state = 'leased' and leased_until < now();
  v_key := public.model_fold_logic_key();
  update public.model_fold_ticks set signals = v_sig, logic_key = v_key where tick_id = v_tick;
  commit;

  v_sweep := public.model_fold_sweep(v_key, cfg);
  update public.model_fold_ticks set swept = coalesce((v_sweep ->> '_queued')::int, 0) where tick_id = v_tick;
  commit;

  loop
    exit when n_claim >= v_max or clock_timestamp() - t0 > v_budget;
    select w.vehicle_id, w.dirty_at, w.edited_origins into v_veh, v_dirty, v_edited from public.model_fold_work w
     where w.state = 'pending' and w.next_attempt_at <= now()
       and (w.dirty_at <= now() - v_settle or w.first_dirty_at <= now() - v_maxdelay)
     order by w.priority, w.dirty_at limit 1 for update skip locked;
    exit when not found;
    update public.model_fold_work set state = 'leased', attempts = attempts + 1, leased_until = now() + v_lease,
           lease_tick = v_tick, updated_at = now() where vehicle_id = v_veh returning attempts into v_att;
    commit;
    n_claim := n_claim + 1;
    begin
      r := public.model_fold_one(v_tick, v_veh, cfg, v_edited);
      update public.model_fold_work set state = case when dirty_at > v_dirty then 'pending' else 'done' end,
             attempts = 0, leased_until = null, lease_tick = null, last_error = null, folded_at = now(), folded_key = v_key,
             edited_origins = array(select unnest(edited_origins) except select unnest(v_edited)),
             priority = case when dirty_at > v_dirty then priority else 5 end, updated_at = now()
       where vehicle_id = v_veh;
      n_ok := n_ok + 1;
      n_add := n_add + coalesce((r ->> 'readings_added')::int, 0);
      n_inv := n_inv + coalesce((r ->> 'invalidated')::int, 0);
      n_app := n_app + coalesce((r ->> 'applied')::int, 0);
      n_sup := n_sup + coalesce((r ->> 'superseded')::int, 0);
    exception when others then
      get stacked diagnostics v_err = message_text;
      update public.model_fold_work set state = case when attempts >= v_maxatt then 'dead' else 'pending' end,
             next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, attempts)::int)),
             leased_until = null, lease_tick = null, last_error = left(v_err, 500), updated_at = now()
       where vehicle_id = v_veh;
      n_fail := n_fail + 1;
      if v_att >= v_maxatt then n_dead := n_dead + 1; end if;
    end;
    update public.model_fold_ticks set claimed = n_claim, folded = n_ok, failed = n_fail, dead = n_dead,
           readings_added = n_add, readings_invalidated = n_inv, members_applied = n_app, members_superseded = n_sup,
           ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int
     where tick_id = v_tick;
    commit;
  end loop;

  update public.model_fold_ticks set status = 'ok', finished_at = clock_timestamp(), claimed = n_claim, folded = n_ok,
         failed = n_fail, dead = n_dead, readings_added = n_add, readings_invalidated = n_inv, members_applied = n_app,
         members_superseded = n_sup, ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int
   where tick_id = v_tick;
  commit;
  perform set_config('model_fold.in_tick', '', false);
  perform pg_advisory_unlock(hashtext('public.model_fold_tick'));
end $$;

commit;
