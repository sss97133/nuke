-- Revert 20261124042000_model_fold_dead_letter_revive: restore the 20261124040000 bodies.
begin;
set local lock_timeout = '3s';

create or replace function public.model_fold_absorb_signals(p_limit int) returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  with s as (
    delete from public.model_fold_signal where id in (select id from public.model_fold_signal order by id limit p_limit)
    returning vehicle_id, reason, origin_id, at),
  g as (select vehicle_id, array_agg(distinct reason) reasons, min(at) f, max(at) l,
               coalesce(array_agg(distinct origin_id) filter (where origin_id is not null), '{}') edited
          from s group by vehicle_id)
  insert into public.model_fold_work as w (vehicle_id, priority, reasons, first_dirty_at, dirty_at, next_attempt_at, edited_origins)
  select vehicle_id, 1, reasons, f, l, now(), edited from g
  on conflict (vehicle_id) do update set
    priority = 1,
    edited_origins = (select coalesce(array_agg(distinct x), '{}') from unnest(w.edited_origins || excluded.edited_origins) x),
    reasons = case when w.state = 'done' then excluded.reasons
                   else (select array_agg(distinct x order by x) from unnest(w.reasons || excluded.reasons) x) end,
    first_dirty_at = case when w.state = 'done' then excluded.first_dirty_at else least(w.first_dirty_at, excluded.first_dirty_at) end,
    dirty_at = greatest(w.dirty_at, excluded.dirty_at),
    state = case when w.state in ('dead','leased') then w.state else 'pending' end,
    next_attempt_at = case when w.state = 'done' then now() else w.next_attempt_at end,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

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
                         and (w2.state <> 'done' or w2.folded_key is not distinct from p_key))
    on conflict (vehicle_id) do update set state = 'pending', priority = 5, reasons = array['sweep'],
      first_dirty_at = excluded.first_dirty_at, dirty_at = excluded.dirty_at, next_attempt_at = now(), attempts = 0,
      updated_at = now()
     where w.state = 'done';
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

commit;
