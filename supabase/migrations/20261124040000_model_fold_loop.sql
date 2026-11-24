-- Model fold loop (20261124040000)
-- Why: raw rows (listing text, auction comments, photo moves) land around the clock, but the fold from raw into the data
-- model (text code readings, then data-set membership) ran only when someone ran it by hand. This makes that fold
-- continuous and bounded:
--  1. Triggers append a cheap signal row (vehicle id + reason) when a vehicle's VIN/year/make/model/listing text changes,
--     when its auction comments or auction events change, when a photo moves between vehicles (a09, beside a08; a08 is not
--     edited) and when new observations or field evidence land. A trigger never fails the write it rides on, never signals
--     for the loop's own writes, and only signals for vehicles in the configured scopes.
--  2. model_fold_tick(), one pg_cron CALL every 30 seconds (the cron role's 10s statement_timeout bounds a whole CALL,
--     so each tick works ~6s; same duty cycle as ~40s every 2 minutes): session advisory lock (a second tick skips), backpressure
--     (lock waiters, busy backends, an open circuit after repeated bad ticks), signals folded into the model_fold_work
--     queue with a settle window, a cursor sweep (model_fold_cursor) that re-queues every in-scope vehicle whose fold
--     logic changed (logic key = the producers' source + the active decode rules), then leases (SKIP LOCKED) and folds one
--     vehicle per commit until ~6s or N vehicles. Failures back off and dead-letter after max_attempts.
--  3. Folding one vehicle = invalidate its text readings whose origin row is gone, moved, withdrawn, or no longer contains
--     the matched text, then the current text decoder (config 'decoder', today text_code_decode_v2, called by its existing
--     signature with scope 'vehicle') and data_set_membership_plan_v1/apply_v1(run, 'vehicle', ...) with fresh run ids, so
--     the existing text_code_decode_revert_v1 / data_set_membership_revert_v1 undo any fold. (plan_v1's per-vehicle
--     candidates include every code kind, so it keeps the v2 code memberships.) Every run id is
--     logged in model_fold_tick_runs; model_fold_revert_v1(tick) undoes a whole tick (newest tick first).
--  4. model_fold_freshness (view) and assay_model_fold() (raises when the loop is stale, backlog is old or dead letters
--     pile up), checked hourly by cron.
-- What this does not do: no paid or network lanes (SQL only); no edits to the producers, matchers or decode rules; no
-- photo bytes or EXIF are read; no writes to vehicle_images; the excluded vehicle prefix stays excluded.
-- Disable: UPDATE platform_config SET config_value = jsonb_set(config_value, '{enabled}', 'false') WHERE config_key = 'model_fold';
--          (signals too: '{signals_enabled}' false). Full removal: supabase/sql/revert_20261124040000_model_fold_loop.sql.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── config ──────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.platform_config (config_key, config_value, description)
select 'model_fold',
       jsonb_build_object(
         'enabled', true, 'signals_enabled', true,
         'scopes', jsonb_build_array('pontiac_f_body'), 'decode_scopes', jsonb_build_array('pontiac_f_body'),
         'decoder', 'text_code_decode_v2', 'min_pass_hours', 6,
         'budget_ms', 6000, 'max_vehicles', 200, 'lease_seconds', 300,
         'settle_seconds', 300, 'max_delay_seconds', 1800, 'max_attempts', 5,
         'signal_batch', 50000, 'sweep_scan', 2000, 'sweep_pending_cap', 1000, 'snapshot_max_age_hours', 6,
         'max_lock_waiters', 20, 'max_active_backends', 60, 'circuit_bad_ticks', 3, 'stuck_tick_seconds', 60,
         'lock_timeout', '2s'),
       'Model fold loop (raw -> readings -> data-set membership). enabled=false stops folding; signals_enabled=false stops trigger signals.'
 where not exists (select 1 from public.platform_config where config_key = 'model_fold');

create or replace function public.model_fold_config() returns jsonb
language sql stable set search_path = public as $$
  select coalesce((select config_value from public.platform_config where config_key = 'model_fold' limit 1), '{}'::jsonb)
$$;

-- ── tables ──────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.model_fold_signal (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null,
  reason text not null,
  origin_id uuid,
  at timestamptz not null default now());

create table if not exists public.model_fold_work (
  vehicle_id uuid primary key,
  state text not null default 'pending' check (state in ('pending','leased','done','dead')),
  priority smallint not null default 5,
  reasons text[] not null default '{}',
  first_dirty_at timestamptz not null default now(),
  dirty_at timestamptz not null default now(),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  leased_until timestamptz,
  lease_tick uuid,
  last_error text,
  folded_at timestamptz,
  folded_key text,
  edited_origins uuid[] not null default '{}',
  updated_at timestamptz not null default now());
create index if not exists model_fold_work_pending_idx on public.model_fold_work (priority, dirty_at) where state = 'pending';
create index if not exists model_fold_work_leased_idx on public.model_fold_work (leased_until) where state = 'leased';

create table if not exists public.model_fold_scope_members (
  scope text not null,
  vehicle_id uuid not null,
  gen int not null default 0,
  primary key (scope, vehicle_id));

create table if not exists public.model_fold_cursor (
  scope text primary key,
  cursor uuid,
  pass_key text,
  verified_key text,
  cycle int not null default 0,
  snapshot_at timestamptz,
  snapshot_n int,
  snap_gen int not null default 0,
  snap_step int,
  pass_started_at timestamptz,
  wrapped_at timestamptz,
  enqueued_total bigint not null default 0,
  updated_at timestamptz not null default now());

create table if not exists public.model_fold_ticks (
  tick_id uuid primary key,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  pid int,
  status text not null check (status in ('running','ok','skipped','error','stale','reverted')),
  skip_reason text,
  logic_key text,
  signals int not null default 0,
  swept int not null default 0,
  claimed int not null default 0,
  folded int not null default 0,
  failed int not null default 0,
  dead int not null default 0,
  readings_added int not null default 0,
  readings_invalidated int not null default 0,
  members_applied int not null default 0,
  members_superseded int not null default 0,
  ms int,
  error text,
  reverted_at timestamptz,
  revert_summary jsonb);
create index if not exists model_fold_ticks_started_idx on public.model_fold_ticks (started_at desc);

create table if not exists public.model_fold_tick_runs (
  id bigint generated always as identity primary key,
  tick_id uuid not null,
  vehicle_id uuid not null,
  decode_run_id uuid,
  membership_run_id uuid,
  invalidated_reading_ids uuid[] not null default '{}',
  readings_added int not null default 0,
  members_applied int not null default 0,
  members_superseded int not null default 0,
  ms int,
  at timestamptz not null default now(),
  reverted_at timestamptz);
create index if not exists model_fold_tick_runs_tick_idx on public.model_fold_tick_runs (tick_id);
create index if not exists model_fold_tick_runs_vehicle_idx on public.model_fold_tick_runs (vehicle_id, at desc);

do $$
declare t text;
begin
  foreach t in array array['model_fold_signal','model_fold_work','model_fold_scope_members','model_fold_cursor',
                           'model_fold_ticks','model_fold_tick_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ── scope + signals ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Same predicates as data_set_scope_vehicles(), evaluated on one row so triggers need no lookups.
create or replace function public.model_fold_scope_of(p_make text, p_model text, p_vin text, p_year int) returns text
language sql immutable set search_path = public as $$
  select case
    when lower(p_make) = 'pontiac' and (coalesce(p_model, '') ~* 'firebird|trans ?am'
         or upper(btrim(coalesce(p_vin, ''))) ~ '^2[A-Z]87[A-Z][2-9A][A-Z][0-9]{6}$'
         or upper(btrim(coalesce(p_vin, ''))) ~ '^22[3468]87[01][A-Z][0-9]{6}$'
         or upper(btrim(coalesce(p_vin, ''))) ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$') then 'pontiac_f_body'
    when lower(p_make) = 'ford' and p_year between 1965 and 1973 and coalesce(p_model, '') ~* 'mustang' then 'ford_mustang_65_73'
    when lower(p_make) = 'chevrolet' and p_year between 1967 and 1969 and coalesce(p_model, '') ~* 'camaro' then 'chevrolet_camaro_67_69'
  end
$$;

create or replace function public.model_fold_scope_make(p_scope text) returns text
language sql immutable set search_path = public as $$
  select case p_scope when 'pontiac_f_body' then 'pontiac' when 'ford_mustang_65_73' then 'ford'
                      when 'chevrolet_camaro_67_69' then 'chevrolet' end
$$;

create or replace function public.model_fold_signals_on() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('model_fold.in_tick', true), '') <> 'on'
     and coalesce((public.model_fold_config() ->> 'signals_enabled')::boolean, false)
$$;

create or replace function public.model_fold_in_scope(p_make text, p_model text, p_vin text, p_year int, p_id uuid) returns boolean
language sql stable set search_path = public as $$
  select p_id is not null and p_id::text not like '9cf5b7a4%'
     and public.model_fold_scope_of(p_make, p_model, p_vin, p_year) in
         (select jsonb_array_elements_text(public.model_fold_config() -> 'scopes'))
$$;

-- Signal by vehicle id (looks the vehicle up by primary key; out-of-scope and excluded ids are dropped).
create or replace function public.model_fold_signal_ids(p_ids uuid[], p_reason text) returns void
language plpgsql set search_path = public as $$
begin
  if p_ids is null or cardinality(p_ids) = 0 or not public.model_fold_signals_on() then return; end if;
  insert into public.model_fold_signal (vehicle_id, reason)
  select v.id, p_reason from public.vehicles v
   where v.id = any (p_ids) and public.model_fold_in_scope(v.make, v.model, v.vin, v.year, v.id);
end $$;

create or replace function public.model_fold_vehicles_signal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if public.model_fold_signals_on() and (public.model_fold_in_scope(new.make, new.model, new.vin, new.year, new.id)
       or (tg_op = 'UPDATE' and public.model_fold_in_scope(old.make, old.model, old.vin, old.year, old.id))) then
      insert into public.model_fold_signal (vehicle_id, reason) values (new.id, 'vehicle_' || lower(tg_op));
    end if;
  exception when others then
    raise warning 'model_fold signal skipped (vehicles): %', sqlerrm;
  end;
  return null;
end $$;

create or replace function public.model_fold_rows_signal() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  begin
    if not public.model_fold_signals_on() then return null; end if;
    -- Static SQL per branch: a branch is planned only when it runs, so new_rows/old_rows exist whenever referenced.
    if tg_op = 'INSERT' then
      select array_agg(distinct n.vehicle_id) into v_ids from new_rows n where n.vehicle_id is not null;
    elsif tg_op = 'DELETE' then
      select array_agg(distinct o.vehicle_id) into v_ids from old_rows o where o.vehicle_id is not null;
    elsif tg_table_name = 'auction_comments' then
      select array_agg(distinct x) into v_ids from (
        select unnest(array[o.vehicle_id, n.vehicle_id]) x from old_rows o join new_rows n on n.id = o.id
         where o.vehicle_id is distinct from n.vehicle_id or o.comment_text is distinct from n.comment_text
            or o.comment_type is distinct from n.comment_type or o.has_question is distinct from n.has_question) z
       where x is not null;
      -- An edited comment's readings carry no match text, so the fold needs to know which comments changed.
      insert into public.model_fold_signal (vehicle_id, reason, origin_id)
      select n.vehicle_id, 'auction_comment_edit', n.id
        from old_rows o join new_rows n on n.id = o.id join public.vehicles v on v.id = n.vehicle_id
       where o.comment_text is distinct from n.comment_text
         and public.model_fold_in_scope(v.make, v.model, v.vin, v.year, v.id);
    else
      select array_agg(distinct x) into v_ids from (
        select unnest(array[o.vehicle_id, n.vehicle_id]) x from old_rows o join new_rows n on n.id = o.id
         where o.vehicle_id is distinct from n.vehicle_id) z where x is not null;
    end if;
    perform public.model_fold_signal_ids(v_ids, tg_table_name || '_' || lower(tg_op));
  exception when others then
    raise warning 'model_fold signal skipped (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

-- Photo moved between vehicles or its gate changed: both the old and the new vehicle need a re-fold.
create or replace function public.model_fold_image_signal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.model_fold_signal_ids(array_remove(array[old.vehicle_id, new.vehicle_id], null), 'photo_move');
  exception when others then
    raise warning 'model_fold signal skipped (vehicle_images): %', sqlerrm;
  end;
  return null;
end $$;


-- ── logic key, sweep, signals -> work ───────────────────────────────────────────────────────────────────────────────
-- Changes whenever a producer/matcher body or the active decode rules change, so the sweep re-folds every vehicle.
create or replace function public.model_fold_logic_key() returns text
language sql stable set search_path = public as $$
  select md5(coalesce((select string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text)
                         from pg_proc p
                        where p.pronamespace = 'public'::regnamespace
                          and (p.proname ~ '^(text_code_decode_v|text_code_matches_v|text_spec_matches_v|text_rpo_known_v)[0-9]+$'
                               or p.proname in ('data_set_candidates_v1','data_set_code_candidates_v1','data_set_basis_live',
                                                'data_set_membership_plan_v1','observation_is_public','model_fold_invalidate_readings'))), '')
          || '|' || coalesce(public.model_fold_config() ->> 'decoder', '')
          || '|' || coalesce((select md5(string_agg(r.id::text || ':' || coalesce(r.superseded_at::text, ''), ',' order by r.id))
                                from public.vehicle_decode_rules r), ''))
$$;

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

-- One sweep step per scope: refresh the scope snapshot when due (that alone is the step), else scan the next cursor
-- slice and queue vehicles never folded or folded under an older logic key.
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

-- ── folding one vehicle ─────────────────────────────────────────────────────────────────────────────────────────────
-- A text reading stays active only while its origin row still exists on this vehicle and is still eligible (comment not a
-- bid/sold/question, observation not superseded, evidence not rejected/superseded, vehicle not deleted/merged) and, when
-- the reading kept its match text, that text is still in the origin column. v1 comment readings (no match text kept)
-- are re-checked through text_code_matches_v1, the matcher that produced them; other readings without match text are
-- retired when their origin comment was edited (p_edited) and re-read by the decode that follows.
create or replace function public.model_fold_invalidate_readings(p_vehicle uuid, p_edited uuid[] default '{}') returns uuid[]
language plpgsql set search_path = public as $$
declare v_ids uuid[];
begin
  with o as (
    select r.id, r.kind, r.code, r.rule_version, r.match_text, r.origin_id, z.alive, z.txt
      from public.vehicle_code_readings r
     cross join lateral (
       select v.id = r.vehicle_id and v.deleted_at is null and v.merged_into_vehicle_id is null as alive,
              case r.origin_column when 'description' then v.description when 'highlights' then v.highlights
                when 'equipment' then v.equipment when 'modifications' then v.modifications
                when 'numbers_quote' then v.numbers_quote when 'title' then v.title when 'listing_title' then v.listing_title
                when 'bat_listing_title' then v.bat_listing_title end as txt
         from public.vehicles v where r.origin_table = 'vehicles' and v.id = r.origin_id
       union all
       select ac.vehicle_id = r.vehicle_id and coalesce(ac.comment_type, '') not in ('bid','sold')
              and (r.rule_version = 'text_code_decode_v1' or ac.has_question is not true), ac.comment_text
         from public.auction_comments ac where r.origin_table = 'auction_comments' and ac.id = r.origin_id
       union all
       select ob.vehicle_id = r.vehicle_id and not coalesce(ob.is_superseded, false), ob.content_text
         from public.vehicle_observations ob where r.origin_table = 'vehicle_observations' and ob.id = r.origin_id
       union all
       select f.vehicle_id = r.vehicle_id and coalesce(f.status, '') not in ('rejected','superseded'), f.proposed_value
         from public.field_evidence f where r.origin_table = 'field_evidence' and f.id = r.origin_id
       union all
       select false, null::text) z
     where r.vehicle_id = p_vehicle and r.state = 'active' and r.rule_version ~ '^text_code_decode_v[0-9]+$'
       -- only origins this check knows how to read; anything else is left alone
       and ((r.origin_table = 'vehicles' and r.origin_column in ('description','highlights','equipment','modifications',
                                                                  'numbers_quote','title','listing_title','bat_listing_title'))
            or (r.origin_table = 'auction_comments' and r.origin_column = 'comment_text')
            or (r.origin_table = 'vehicle_observations' and r.origin_column = 'content_text')
            or (r.origin_table = 'field_evidence' and r.origin_column = 'proposed_value'))),
  -- the trailing (false, null) row only counts when no origin row was found
  per as (select id, kind, code, rule_version, match_text, origin_id, bool_or(alive) as alive, max(txt) as txt
            from o group by 1, 2, 3, 4, 5, 6),
  stale as (
    select p.id from per p
     where not coalesce(p.alive, false) or p.txt is null
        or (p.match_text is not null and strpos(p.txt, p.match_text) = 0)
        or (p.match_text is null and p.rule_version = 'text_code_decode_v1'
            and not exists (select 1 from public.text_code_matches_v1(p.txt) m where m.kind = p.kind and m.code = p.code))
        -- no match text kept (comments) and the origin text was edited: retire it; the decode right after re-reads
        -- the current text, so whatever it still says comes back as a fresh reading
        or (p.match_text is null and p.origin_id = any (coalesce(p_edited, '{}')))),
  u as (update public.vehicle_code_readings r set state = 'reverted', reverted_at = now()
         from stale where r.id = stale.id returning r.id)
  select coalesce(array_agg(id), '{}') into v_ids from u;
  return v_ids;
end $$;

create or replace function public.model_fold_one(p_tick uuid, p_vehicle uuid, p_cfg jsonb, p_edited uuid[] default '{}') returns jsonb
language plpgsql set search_path = public as $$
declare
  t0 timestamptz := clock_timestamp(); v_inv uuid[]; v_dec uuid; v_mem uuid := gen_random_uuid();
  r jsonb; p jsonb; a jsonb; v public.vehicles; v_exists boolean; n_add int := 0; v_decoder text;
begin
  if p_vehicle::text like '9cf5b7a4%' then return jsonb_build_object('skipped', 'excluded'); end if;
  select * into v from public.vehicles where id = p_vehicle;
  v_exists := found;
  v_inv := public.model_fold_invalidate_readings(p_vehicle, p_edited);
  if v_exists and public.model_fold_scope_of(v.make, v.model, v.vin, v.year) in
       (select jsonb_array_elements_text(p_cfg -> 'decode_scopes')) then
    v_dec := gen_random_uuid();
    v_decoder := coalesce(p_cfg ->> 'decoder', 'text_code_decode_v2');
    if v_decoder !~ '^text_code_decode_v[0-9]+$'
       or to_regprocedure(format('public.%s(uuid,text,uuid,integer,integer,integer)', v_decoder)) is null then
      raise exception 'model_fold: decoder % is not an existing text_code_decode_vN(uuid,text,uuid,int,int,int)', v_decoder;
    end if;
    execute format('select public.%I($1, $2, $3, $4, $5, $6)', v_decoder)
      into r using v_dec, 'vehicle'::text, p_vehicle, 50, 1, null::int;
    n_add := coalesce((r ->> 'inserted_this_slice')::int, 0);
  elsif cardinality(v_inv) > 0 then
    perform public.text_code_rescore_v1(array[p_vehicle]);
  end if;
  if not v_exists then
    -- Vehicle row gone: nothing to plan from; any members it had stay for the membership producer's own scopes.
    insert into public.model_fold_tick_runs (tick_id, vehicle_id, decode_run_id, membership_run_id, invalidated_reading_ids, ms)
    values (p_tick, p_vehicle, null, null, v_inv, (extract(epoch from clock_timestamp() - t0) * 1000)::int);
    return jsonb_build_object('vehicle_missing', true, 'invalidated', cardinality(v_inv));
  end if;
  p := public.data_set_membership_plan_v1(v_mem, 'vehicle', p_vehicle);
  a := public.data_set_membership_apply_v1(v_mem, 500, 200, false);
  insert into public.model_fold_tick_runs (tick_id, vehicle_id, decode_run_id, membership_run_id, invalidated_reading_ids,
                                           readings_added, members_applied, members_superseded, ms)
  values (p_tick, p_vehicle, v_dec, v_mem, v_inv, n_add, coalesce((a ->> 'applied')::int, 0),
          coalesce((p ->> 'planned_supersede')::int, 0), (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  return jsonb_build_object('decode_run', v_dec, 'membership_run', v_mem, 'invalidated', cardinality(v_inv),
                            'readings_added', n_add, 'applied', coalesce((a ->> 'applied')::int, 0),
                            'superseded', coalesce((p ->> 'planned_supersede')::int, 0));
end $$;

-- ── backpressure ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.model_fold_backpressure(p_cfg jsonb) returns text
language plpgsql set search_path = public as $$
declare n_lock int; n_act int; n_bad int;
begin
  select count(*) filter (where wait_event_type = 'Lock'), count(*) filter (where state = 'active')
    into n_lock, n_act from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid();
  if n_lock > coalesce((p_cfg ->> 'max_lock_waiters')::int, 20) then return format('lock waiters %s', n_lock); end if;
  if n_act > coalesce((p_cfg ->> 'max_active_backends')::int, 60) then return format('active backends %s', n_act); end if;
  -- Circuit: the last N finished ticks (30 min window) all bad and the newest bad one under 10 minutes old -> skip.
  -- After 10 quiet minutes one tick is let through (half-open); if it fails the circuit stays open another 10 minutes.
  select count(*) filter (where status in ('error','stale')), count(*) into n_bad, n_act from (
    select status from public.model_fold_ticks where status in ('ok','error','stale') and started_at > now() - interval '30 minutes'
     order by started_at desc limit coalesce((p_cfg ->> 'circuit_bad_ticks')::int, 3)) z;
  if n_act >= coalesce((p_cfg ->> 'circuit_bad_ticks')::int, 3) and n_bad = n_act
     and exists (select 1 from public.model_fold_ticks where status in ('error','stale') and started_at > now() - interval '10 minutes') then
    return format('circuit open: last %s ticks failed', n_bad);
  end if;
  return null;
end $$;

-- ── the tick ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Called only as `CALL public.model_fold_tick()` (a lone CALL, so it can COMMIT per vehicle).
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

-- ── revert ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Undo one tick: membership runs, then decode runs (existing revert producers), then restore invalidated readings.
-- Revert newest ticks first (model_fold_revert_since does that); disable the loop before reverting.
create or replace function public.model_fold_revert_v1(p_tick uuid) returns jsonb
language plpgsql set search_path = public as $$
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
end $$;

create or replace function public.model_fold_revert_since(p_since timestamptz) returns jsonb
language plpgsql set search_path = public as $$
declare t record; out jsonb := '[]';
begin
  for t in select tick_id from public.model_fold_ticks where started_at >= p_since and status in ('ok','error','stale')
            order by started_at desc loop
    out := out || jsonb_build_array(public.model_fold_revert_v1(t.tick_id));
  end loop;
  return jsonb_build_object('ticks', jsonb_array_length(out), 'detail', out);
end $$;

-- ── freshness + watch ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace view public.model_fold_freshness with (security_invoker = true) as
select coalesce((public.model_fold_config() ->> 'enabled')::boolean, false) as enabled,
       (select count(*) from public.model_fold_signal) as signals_waiting,
       (select min(at) from public.model_fold_signal) as oldest_signal_at,
       count(*) filter (where w.state = 'pending') as pending,
       count(*) filter (where w.state = 'pending' and w.next_attempt_at <= now()) as due,
       count(*) filter (where w.state = 'leased') as leased,
       count(*) filter (where w.state = 'done') as done,
       count(*) filter (where w.state = 'dead') as dead,
       min(w.first_dirty_at) filter (where w.state in ('pending','leased') and w.priority < 5) as oldest_signal_dirty_at,
       count(*) filter (where w.folded_at > now() - interval '1 hour') as folded_last_hour,
       (select max(finished_at) from public.model_fold_ticks where status = 'ok') as last_ok_tick_at,
       (select count(*) from public.model_fold_ticks where started_at > now() - interval '1 hour' and status = 'ok') as ok_ticks_1h,
       (select count(*) from public.model_fold_ticks where started_at > now() - interval '1 hour' and status = 'skipped') as skipped_ticks_1h,
       (select count(*) from public.model_fold_ticks where started_at > now() - interval '1 hour' and status in ('error','stale')) as bad_ticks_1h,
       (select jsonb_agg(jsonb_build_object('scope', c.scope, 'cursor_set', c.cursor is not null, 'cycle', c.cycle,
                'snapshot_n', c.snapshot_n, 'snapshot_at', c.snapshot_at, 'verified_current', c.verified_key = public.model_fold_logic_key(),
                'wrapped_at', c.wrapped_at)) from public.model_fold_cursor c) as sweep
  from public.model_fold_work w;
revoke all on public.model_fold_freshness from public, anon, authenticated;
grant select on public.model_fold_freshness to service_role;

create or replace function public.assay_model_fold() returns jsonb
language plpgsql set search_path = public as $$
declare f record;
begin
  select * into f from public.model_fold_freshness;
  if not f.enabled then return jsonb_build_object('enabled', false); end if;
  if f.last_ok_tick_at is null or f.last_ok_tick_at < now() - interval '15 minutes' then
    raise exception 'model_fold stale: last ok tick %', coalesce(f.last_ok_tick_at::text, 'never');
  end if;
  if f.oldest_signal_dirty_at < now() - interval '3 hours' then
    raise exception 'model_fold backlog: signalled work dirty since %', f.oldest_signal_dirty_at;
  end if;
  if f.dead > 50 then raise exception 'model_fold dead letters: %', f.dead; end if;
  if f.bad_ticks_1h >= 5 then raise exception 'model_fold bad ticks in last hour: %', f.bad_ticks_1h; end if;
  return jsonb_build_object('ok', true, 'pending', f.pending, 'dead', f.dead, 'folded_last_hour', f.folded_last_hour,
                            'signals_waiting', f.signals_waiting, 'last_ok_tick_at', f.last_ok_tick_at);
end $$;

do $$
declare f text;
begin
  foreach f in array array['model_fold_config()','model_fold_scope_of(text,text,text,integer)','model_fold_scope_make(text)','model_fold_signals_on()',
    'model_fold_in_scope(text,text,text,integer,uuid)','model_fold_signal_ids(uuid[],text)','model_fold_vehicles_signal()',
    'model_fold_rows_signal()','model_fold_image_signal()','model_fold_logic_key()','model_fold_absorb_signals(integer)',
    'model_fold_sweep(text,jsonb)','model_fold_invalidate_readings(uuid,uuid[])','model_fold_one(uuid,uuid,jsonb,uuid[])',
    'model_fold_backpressure(jsonb)','model_fold_revert_v1(uuid)','model_fold_revert_since(timestamptz)','assay_model_fold()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  revoke all on procedure public.model_fold_tick() from public, anon, authenticated;
  grant execute on procedure public.model_fold_tick() to service_role;
end $$;

-- ── triggers (last, so the hot-table locks are held only for the end of this transaction) ─────────────────────────────
drop trigger if exists model_fold_signal_ins on public.vehicles;
create trigger model_fold_signal_ins after insert on public.vehicles
  for each row execute function public.model_fold_vehicles_signal();
drop trigger if exists model_fold_signal_upd on public.vehicles;
create trigger model_fold_signal_upd
  after update of vin, year, make, model, description, highlights, equipment, modifications, numbers_quote, title,
                  listing_title, bat_listing_title, deleted_at, merged_into_vehicle_id on public.vehicles
  for each row when (old.vin is distinct from new.vin or old.year is distinct from new.year or old.make is distinct from new.make
    or old.model is distinct from new.model or old.description is distinct from new.description
    or old.highlights is distinct from new.highlights or old.equipment is distinct from new.equipment
    or old.modifications is distinct from new.modifications or old.numbers_quote is distinct from new.numbers_quote
    or old.title is distinct from new.title or old.listing_title is distinct from new.listing_title
    or old.bat_listing_title is distinct from new.bat_listing_title
    or old.deleted_at is distinct from new.deleted_at or old.merged_into_vehicle_id is distinct from new.merged_into_vehicle_id)
  execute function public.model_fold_vehicles_signal();

drop trigger if exists model_fold_signal_ins on public.auction_comments;
create trigger model_fold_signal_ins after insert on public.auction_comments
  referencing new table as new_rows for each statement execute function public.model_fold_rows_signal();
drop trigger if exists model_fold_signal_upd on public.auction_comments;
create trigger model_fold_signal_upd after update on public.auction_comments
  referencing old table as old_rows new table as new_rows for each statement execute function public.model_fold_rows_signal();
drop trigger if exists model_fold_signal_del on public.auction_comments;
create trigger model_fold_signal_del after delete on public.auction_comments
  referencing old table as old_rows for each statement execute function public.model_fold_rows_signal();

drop trigger if exists model_fold_signal_ins on public.auction_events;
create trigger model_fold_signal_ins after insert on public.auction_events
  referencing new table as new_rows for each statement execute function public.model_fold_rows_signal();
drop trigger if exists model_fold_signal_upd on public.auction_events;
create trigger model_fold_signal_upd after update on public.auction_events
  referencing old table as old_rows new table as new_rows for each statement execute function public.model_fold_rows_signal();

drop trigger if exists model_fold_signal_ins on public.vehicle_observations;
create trigger model_fold_signal_ins after insert on public.vehicle_observations
  referencing new table as new_rows for each statement execute function public.model_fold_rows_signal();
drop trigger if exists model_fold_signal_ins on public.field_evidence;
create trigger model_fold_signal_ins after insert on public.field_evidence
  referencing new table as new_rows for each statement execute function public.model_fold_rows_signal();

-- Beside a08_trg_land_child_vehicle_sync (same columns, same guard); a08 itself is not touched.
drop trigger if exists a09_model_fold_signal on public.vehicle_images;
create trigger a09_model_fold_signal after update of vehicle_id, vision_gate_status on public.vehicle_images
  for each row when (old.vehicle_id is distinct from new.vehicle_id or old.vision_gate_status is distinct from new.vision_gate_status)
  execute function public.model_fold_image_signal();

-- ── schedule (only where pg_cron exists) ────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname in ('model-fold-tick','model-fold-watch');
    perform cron.schedule('model-fold-tick', '30 seconds', 'CALL public.model_fold_tick()');
    perform cron.schedule('model-fold-watch', '17 * * * *', 'SELECT public.assay_model_fold()');
  end if;
end $$;

commit;
