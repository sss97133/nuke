-- capture_set_members: one keyed edge per (capture-set candidate, photo), so a set's photos reach vehicle_images by FK.
--
-- Why. capture_set_candidates (20261023220000) holds a set's photos as image_ids uuid[] with no foreign key, so no
-- photo has a keyed edge to the set that proposed a car for it, and nothing stops an id in the array from naming a
-- photo that is gone. Measured live 2026-11-25 06:00 PT, read-only: 20,162 candidate rows, 8,216 sets (run_id,
-- set_key), 3,006 runs, 113,594 array elements (largest array 262), 0 elements naming a missing vehicle_images row,
-- 0 arrays with a repeated id, 0 sets whose candidate rows carry different arrays.
--
-- Grain: a member is keyed to the candidate row (capture_set_candidates.id), not to the set.
--   * A set has no key row a member can reference: (run_id, set_key) is not unique in capture_set_candidates (one row per
--     candidate vehicle, ranks 1-3), and capture_landing_sets (chunk_id, set_key) misses 29 of the 8,216 sets (86 rows,
--     written 2026-11-04 by a runner before the landing chunks).
--   * Both SQL readers of the array read it per candidate row: capture_sets_apply (imgs <@ c.image_ids) and
--     capture_day_replan_state (v.id = ANY (k.image_ids)). No edge function, frontend or iOS code reads the table.
--   * Cost: about 2.45 member rows per set-photo edge (113,594 rows, not about 46k). "Which sets is this photo in"
--     is SELECT DISTINCT c.run_id, c.set_key over capture_set_members_image.
-- role: the scorer (capture_sets_score) splits a segment's photos into image_ids (unfiled and not blocked) and
--   filed_ids (siblings already filed). Only image_ids reaches a candidate row (capture_landing_finalize_plan ->
--   record_capture_set_candidates), and the writer refuses any photo that is filed, so every member today is 'unfiled'.
--   'filed' joins the CHECK only when a writer stores the scorer's filed_ids.
-- added_run: the run that put the photo in the set (the candidate's run_id, the landing chunk's run). added_via says
--   whether the writer or the backfill wrote the row.
--
-- Writers: record_capture_set_candidates is the only function that writes capture_set_candidates.image_ids (live
-- bodies searched for INSERT/UPDATE of the table; capture_set_candidates_revert sets revoked_at only). It now writes
-- the members of each row it inserts, in the same transaction. Its body is md5-guarded against production.
-- Backfill: capture_set_members_backfill(p_max_elems) by the cron job capture-set-members-backfill, never in this
-- migration. Each call takes candidates that are short (an image_ids element with no member row) in (run_id, set_key,
-- vehicle_id) order (the unique index, so a set's rows are read together) up to p_max_elems array elements (or the one
-- first row, when it alone is larger), inserts the elements whose photo exists (ON CONFLICT DO NOTHING) and counts the
-- rest as dangling. Pass 1 walks every candidate; pass 2 walks again for rows still short (a call of the old writer
-- body in flight at deploy, or a member lost since). Then it checks agreement and unschedules itself, or fails the job
-- while members and image_ids disagree. The job yields while auctions close (it joins the jobs of the shared rule row
-- platform_config 'auction_close_yield', 20261126033500), and it sets no statement_timeout: postgres's 10 s default
-- holds; a 500-element call reads in well under it (measured by the skeptic: 134 ms for a page on prod).
-- image_ids stays: both readers above still read it. capture_set_members_agreement() counts the difference
-- (short_existing and extra must be 0; short_dangling is a photo deleted after its set was written).
-- After the backfill, the hourly job capture-set-members-agreement runs capture_set_members_check(), which writes that
-- count as the job's assay row in job_assay_readings (passed, or failed with members_missing / members_not_in_image_ids),
-- commits it, then runs capture_set_members_check_raise(), which fails the run when that row reads failed: the row
-- stays, and the run is red in v_job_health whether or not it reads the assay row. (COMMIT inside a cron command is a
-- live pattern: pg_cron sends it as one simple query with cron.use_background_workers off, as drain-class-price-queue.)
-- A revoked candidate (capture_set_candidates_revert sets revoked_at) keeps its members, as it keeps its image_ids;
-- a reader of members filters on the candidate's revoked_at exactly as readers of the array do.
--
-- Locks: the FKs take SHARE ROW EXCLUSIVE on vehicle_images and capture_set_candidates for the CREATE TABLE (the new
-- table is empty, so nothing is validated); lock_timeout 3 s makes it fail instead of queueing their writers.
-- Access: owner-private and stricter than capture_set_candidates: RLS on, no policy, nothing granted to anon or
-- authenticated (Supabase's default privileges are revoked), service_role may SELECT; writes go through the
-- SECURITY DEFINER writer and backfill only.
-- Contract: supabase/sql/test_capture_set_members.sql. Revert: supabase/sql/revert_20261126151500_capture_set_members.sql.

begin;
set local statement_timeout = '30s';
set local lock_timeout = '3s';

do $guard$
declare m text;
begin
  m := coalesce((select md5(prosrc) from pg_proc
                  where oid = to_regprocedure('public.record_capture_set_candidates(uuid,uuid,text,jsonb)')), 'missing');
  -- before: production's body of 2026-11-25 06:00 PT; after: this migration's body (a replay of the file)
  if m not in ('ce59756228fdd1f6125e1110a78cecf9', 'a59ee3b14324d7e60204738777046867') then
    raise exception 'record_capture_set_candidates is not the body this migration was written against (md5 %); review before applying', m;
  end if;
end $guard$;

create table if not exists public.capture_set_members (
  candidate_id uuid not null references public.capture_set_candidates(id) on delete cascade,
  image_id     uuid not null references public.vehicle_images(id) on delete cascade,
  role         text not null default 'unfiled' check (role in ('unfiled')),
  added_run    uuid not null,
  added_via    text not null check (added_via in ('writer', 'backfill')),
  added_at     timestamptz not null default now(),
  primary key (candidate_id, image_id)
);
create index if not exists capture_set_members_image on public.capture_set_members (image_id);
comment on table public.capture_set_members is
  'One row per (capture_set_candidates row, photo): the keyed form of capture_set_candidates.image_ids. Written by record_capture_set_candidates and capture_set_members_backfill only.';
comment on column public.capture_set_members.role is
  'The scorer''s class of the photo in its set: unfiled (capture_sets_score image_ids). Its filed_ids never reach a candidate row.';
comment on column public.capture_set_members.added_run is 'The run that put the photo in the set: capture_set_candidates.run_id.';

alter table public.capture_set_members enable row level security;
revoke all on public.capture_set_members from public, anon, authenticated, service_role;
grant select on public.capture_set_members to service_role;

-- The writer: unchanged except that each inserted candidate row also writes its members.
CREATE OR REPLACE FUNCTION public.record_capture_set_candidates(p_run_id uuid, p_user uuid, p_method text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE it jsonb; v_ids uuid[]; v_ok int := 0; v_skip int := 0; v_dup int := 0; v_n int; v_cid uuid; v_members int := 0;
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
    ON CONFLICT (run_id, set_key, vehicle_id) DO NOTHING
    RETURNING id INTO v_cid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN
      v_ok := v_ok + 1;
      -- (20261126151500) the row's photos as keyed edges, in this transaction
      INSERT INTO capture_set_members (candidate_id, image_id, role, added_run, added_via)
      SELECT v_cid, x.img, 'unfiled', p_run_id, 'writer' FROM unnest(v_ids) x(img)
      ON CONFLICT (candidate_id, image_id) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_members := v_members + v_n;
    ELSE
      v_dup := v_dup + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run_id, 'written', v_ok, 'skipped', v_skip, 'duplicate', v_dup, 'members', v_members);
END $function$;

-- Agreement between the array and the edges. short_existing: an array element with no member whose photo exists (a
-- missed write or a pending backfill). short_dangling: the photo is gone. extra: a member not in its row's array.
create or replace function public.capture_set_members_agreement()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with short as (   -- one pass over the short elements; each is looked up in vehicle_images once
    select count(*) n, count(*) filter (where exists (select 1 from vehicle_images vi where vi.id = x.img)) n_existing
      from capture_set_candidates c cross join lateral unnest(c.image_ids) x(img)
     where not exists (select 1 from capture_set_members m where m.candidate_id = c.id and m.image_id = x.img))
  select jsonb_build_object(
    'candidates', (select count(*) from capture_set_candidates),
    'elements', (select coalesce(sum(cardinality(image_ids)), 0) from capture_set_candidates),
    'members', (select count(*) from capture_set_members),
    'short_existing', (select n_existing from short),
    'short_dangling', (select n - n_existing from short),
    'extra', (select count(*) from capture_set_members m join capture_set_candidates c on c.id = m.candidate_id
               where not (m.image_id = any (c.image_ids))),
    'counted_at', now())
$$;

-- The backfill: one bounded batch per call; state in platform_config 'capture_set_members_backfill'.
create or replace function public.capture_set_members_backfill(p_max_elems integer default 500)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb; pass int; c_run uuid; c_key text; c_veh uuid;
  n_c int; n_add int; n_dang int; l_run uuid; l_key text; l_veh uuid; agree jsonb;
  z constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  select config_value into cfg from platform_config where config_key = 'capture_set_members_backfill' for update;
  cfg := coalesce(cfg, '{}'::jsonb);
  if coalesce((cfg->>'done')::boolean, false) then return cfg; end if;
  pass := coalesce((cfg->>'pass')::int, 1);
  c_run := coalesce((cfg #>> '{cursor,run_id}')::uuid, z);
  c_key := coalesce(cfg #>> '{cursor,set_key}', '');
  c_veh := coalesce((cfg #>> '{cursor,vehicle_id}')::uuid, z);

  with page as (
    select c.id, c.run_id, c.set_key, c.vehicle_id, c.image_ids
      from capture_set_candidates c
     where (c.run_id, c.set_key, c.vehicle_id) > (c_run, c_key, c_veh)
       and exists (select 1 from unnest(c.image_ids) x(img)
                    where not exists (select 1 from capture_set_members m where m.candidate_id = c.id and m.image_id = x.img))
     order by c.run_id, c.set_key, c.vehicle_id
     limit 500
  ), b as materialized (
    select p.* from (select page.*, sum(cardinality(page.image_ids)) over (order by page.run_id, page.set_key, page.vehicle_id) cum
                       from page) p
     where p.cum <= greatest(1, p_max_elems) or p.cum = cardinality(p.image_ids)  -- a prefix; at least the first row
  ), e as materialized (
    select b.id, b.run_id, x.img, exists (select 1 from vehicle_images vi where vi.id = x.img) ok
      from b cross join lateral unnest(b.image_ids) x(img)
  ), ins as (
    insert into capture_set_members (candidate_id, image_id, role, added_run, added_via)
    select e.id, e.img, 'unfiled', e.run_id, 'backfill' from e where e.ok
    on conflict (candidate_id, image_id) do nothing
    returning 1
  )
  select (select count(*) from b), (select count(*) from ins), (select count(*) from e where not e.ok),
         l.run_id, l.set_key, l.vehicle_id
    into n_c, n_add, n_dang, l_run, l_key, l_veh
    from (select 1) one
    left join lateral (select b.run_id, b.set_key, b.vehicle_id from b
                        order by b.run_id desc, b.set_key desc, b.vehicle_id desc limit 1) l on true;

  if n_c > 0 then
    cfg := cfg || jsonb_build_object(
      'pass', pass,
      'cursor', jsonb_build_object('run_id', l_run, 'set_key', l_key, 'vehicle_id', l_veh),
      'candidates_visited', coalesce((cfg->>'candidates_visited')::int, 0) + n_c,
      'members_added', coalesce((cfg->>'members_added')::int, 0) + n_add);
    if pass = 1 then
      cfg := cfg || jsonb_build_object('dangling_skipped', coalesce((cfg->>'dangling_skipped')::int, 0) + n_dang);
    else
      cfg := cfg || jsonb_build_object('sweep_dangling_skipped', coalesce((cfg->>'sweep_dangling_skipped')::int, 0) + n_dang);
    end if;
  elsif pass = 1 then
    -- pass 2 walks again for rows still short (written by the old writer body while this migration deployed)
    cfg := cfg || jsonb_build_object('pass', 2, 'cursor', null);
  else
    agree := public.capture_set_members_agreement();
    if (agree->>'short_existing')::bigint > 0 or (agree->>'extra')::bigint > 0 then
      raise exception 'capture_set_members_backfill: members and image_ids disagree after the sweep: %', agree;
    end if;
    cfg := cfg || jsonb_build_object('done', true, 'done_at', now(), 'agreement', agree);
  end if;
  cfg := cfg || jsonb_build_object('last_run', jsonb_build_object('at', now(), 'candidates', n_c, 'added', n_add, 'dangling', n_dang));

  insert into platform_config (config_key, config_value, description, updated_at)
  values ('capture_set_members_backfill', cfg,
          'State of capture_set_members_backfill (20261126151500): pass, cursor over capture_set_candidates (run_id, set_key, vehicle_id), counts.', now())
  on conflict (config_key) do update set config_value = excluded.config_value, updated_at = now();

  if coalesce((cfg->>'done')::boolean, false) and to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'capture-set-members-backfill';
  end if;
  return cfg;
end $$;

-- The standing check, after the backfill: one job_assay_readings row under the job's own name, which v_job_health
-- reads as the job's assay (passed / failed). Until the backfill is done it writes nothing and returns pending.
create or replace function public.capture_set_members_check()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb; t0 timestamptz := clock_timestamp();
begin
  if not coalesce((select (config_value->>'done')::boolean from platform_config
                    where config_key = 'capture_set_members_backfill'), false) then
    return jsonb_build_object('status', 'pending', 'reason', 'backfill_not_done');
  end if;
  a := public.capture_set_members_agreement();
  a := a || jsonb_build_object('status', case when (a->>'short_existing')::bigint = 0 and (a->>'extra')::bigint = 0
                                              then 'passed' else 'failed' end,
                               'reason', case when (a->>'short_existing')::bigint > 0 then 'members_missing'
                                              when (a->>'extra')::bigint > 0 then 'members_not_in_image_ids' end);
  insert into job_assay_readings (jobname, reading, assayed_at, elapsed_ms, attempted_at, attempt_error, refresh_every, fresh_for)
  values ('capture-set-members-agreement', a, now(),
          greatest(round(extract(epoch from clock_timestamp() - t0) * 1000), 0)::integer, now(), null,
          interval '1 hour', interval '3 hours')
  on conflict (jobname) do update
    set reading = excluded.reading, assayed_at = excluded.assayed_at, elapsed_ms = excluded.elapsed_ms,
        attempted_at = excluded.attempted_at, attempt_error = null, refresh_every = excluded.refresh_every,
        fresh_for = excluded.fresh_for;
  return a;
end $$;

-- The job's second statement, after the reading is committed: a failed reading fails the run.
create or replace function public.capture_set_members_check_raise()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  select reading into r from job_assay_readings where jobname = 'capture-set-members-agreement';
  if r->>'status' = 'failed' then
    raise exception 'capture_set_members_check: members and image_ids disagree (%): %', r->>'reason', r;
  end if;
end $$;

revoke all on function public.capture_set_members_backfill(integer) from public, anon, authenticated;
revoke all on function public.capture_set_members_agreement() from public, anon, authenticated;
revoke all on function public.capture_set_members_check() from public, anon, authenticated;
revoke all on function public.capture_set_members_check_raise() from public, anon, authenticated;
grant execute on function public.capture_set_members_backfill(integer), public.capture_set_members_agreement(),
  public.capture_set_members_check(), public.capture_set_members_check_raise() to service_role;

-- The backfill yields while auctions close: it joins the shared rule row's jobs (20261126033500), which must exist.
do $yield$
begin
  if to_regprocedure('public.auction_close_yield(text)') is null
     or not exists (select 1 from platform_config where config_key = 'auction_close_yield'
                                                   and jsonb_typeof(config_value->'jobs') = 'array') then
    raise exception 'capture_set_members: public.auction_close_yield and its rule row (20261126033500) must exist first';
  end if;
  update platform_config
     set config_value = jsonb_set(config_value, '{jobs}', (config_value->'jobs') || '["capture-set-members-backfill"]'::jsonb),
         updated_at = now()
   where config_key = 'auction_close_yield' and not (config_value->'jobs') ? 'capture-set-members-backfill';
end $yield$;

do $cron$
begin
  if to_regclass('cron.job') is null then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'capture-set-members-agreement';
  perform cron.schedule('capture-set-members-agreement', '17 * * * *',
    $cmd$SET client_min_messages = error; SELECT public.capture_set_members_check(); COMMIT; SELECT public.capture_set_members_check_raise();$cmd$);
  if exists (select 1 from platform_config where config_key = 'capture_set_members_backfill'
                                              and coalesce((config_value->>'done')::boolean, false)) then
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'capture-set-members-backfill';
  perform cron.schedule('capture-set-members-backfill', '* * * * *',
    $cmd$SET client_min_messages = error; SET lock_timeout = '5s'; SELECT public.capture_set_members_backfill(500) WHERE NOT public.auction_close_yield('capture-set-members-backfill');$cmd$);
end $cron$;

commit;
