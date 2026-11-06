-- Photo-landing v3 (4/6): timeline grouping per capture SESSION, not per photo.
--
-- Bug: auto_group_photos_into_events looked up `vehicle_id = NEW.vehicle_id`; for unfiled photos NEW.vehicle_id is NULL,
-- `NULL = NULL` is never true, so every unfiled photo created its own 'pending_analysis' event (11.7k single-photo events).
-- Fix: unfiled photos join the pending event of a neighbouring photo of the same user within 20 minutes (same session);
-- filed photos keep the original per-vehicle/day behaviour.
-- Plus: timeline_consolidate_pending_sessions (soft, reversible, logged) and timeline_resolve_pending_for_images
-- (re-points pending events to the vehicle when photos land). Only dependant-free empty pending events are ever deleted.

create or replace function public.auto_group_photos_into_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare ev uuid; photo_date date; existing_count int; nb uuid;
begin
  if NEW.taken_at is null then return NEW; end if;
  photo_date := date(NEW.taken_at);

  if NEW.vehicle_id is null then
    -- session grouping: nearest same-user unfiled neighbour within 20 min that already has a pending event
    select vi.timeline_event_id into nb
      from vehicle_images vi
     where NEW.user_id is not null and vi.user_id = NEW.user_id and vi.vehicle_id is null and vi.timeline_event_id is not null
       and vi.taken_at between NEW.taken_at - interval '20 minutes' and NEW.taken_at + interval '20 minutes'
     order by abs(extract(epoch from vi.taken_at - NEW.taken_at)) limit 1;
    if nb is not null then
      select te.id into ev from timeline_events te where te.id = nb and te.vehicle_id is null and te.event_type = 'pending_analysis';
    end if;
  else
    select id into ev from timeline_events where vehicle_id = NEW.vehicle_id and event_date = photo_date limit 1;
  end if;

  if ev is not null then
    select coalesce(array_length(coalesce(image_urls, array[]::text[]), 1), 0) into existing_count from timeline_events where id = ev;
    update timeline_events set
      image_urls = coalesce(image_urls, array[]::text[]) || array[NEW.image_url],
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('photo_count', existing_count + 1, 'last_photo_added', now(),
                   'session_start', least(coalesce((metadata->>'session_start')::timestamptz, NEW.taken_at), NEW.taken_at),
                   'session_end', greatest(coalesce((metadata->>'session_end')::timestamptz, NEW.taken_at), NEW.taken_at)),
      title = (existing_count + 1) || ' photos from ' || to_char(photo_date, 'Mon DD, YYYY')
    where id = ev;
    NEW.timeline_event_id := ev;
  else
    insert into timeline_events (vehicle_id, user_id, event_type, source, event_date, title, description, image_urls, metadata)
    values (NEW.vehicle_id, NEW.user_id, 'pending_analysis', 'photo_upload', photo_date,
            '1 photo from ' || to_char(photo_date, 'Mon DD, YYYY'), 'AI analysis pending', array[NEW.image_url],
            jsonb_build_object('photo_count', 1, 'needs_ai_analysis', true, 'device_fingerprint', NEW.exif_data->'camera', 'created_at', now(),
                               'session_start', NEW.taken_at, 'session_end', NEW.taken_at,
                               'unresolved', NEW.vehicle_id is null))
    returning id into ev;
    NEW.timeline_event_id := ev;
  end if;
  return NEW;
end $$;

create table if not exists backup_20261104_timeline_pending_consolidated (
  run_id uuid not null, event_id uuid not null, row_json jsonb not null, backed_up_at timestamptz not null default now(),
  primary key (run_id, event_id)
);

-- Consolidate existing single-photo pending events of one user into one event per session (gap <= 20 min).
-- Photos are re-pointed to the session's keeper event; the now-empty surplus events are deleted after a full-row backup.
-- Photo/keeper changes are profile_fix_log 'update' rows; use timeline_consolidate_revert(run) (restores deleted events first).
create or replace function public.timeline_consolidate_pending_sessions(p_user uuid, p_run uuid, p_from timestamptz default null, p_to timestamptz default null, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '170s' as $$
declare n_events int; n_sessions int; n_photos int; n_merge int;
begin
  create temp table _tc on commit drop as
    select e.id eid, e.created_at ecreated, e.event_date, e.title, e.image_urls, e.metadata, vi.id img, vi.taken_at, vi.image_url
    from timeline_events e join vehicle_images vi on vi.user_id = p_user and vi.timeline_event_id = e.id
    where e.user_id = p_user and e.vehicle_id is null and e.event_type = 'pending_analysis'
      and coalesce((e.metadata->>'photo_count')::int, 1) = 1 and vi.vehicle_id is null and vi.taken_at is not null
      and (p_from is null or vi.taken_at >= p_from) and (p_to is null or vi.taken_at < p_to)
      and not exists (select 1 from image_tags x where x.timeline_event_id = e.id)
      and not exists (select 1 from device_attributions x where x.timeline_event_id = e.id)
      and not exists (select 1 from timeline_event_comments x where x.event_id = e.id)
      and not exists (select 1 from work_order_parts x where x.timeline_event_id = e.id)
      and not exists (select 1 from work_order_labor x where x.timeline_event_id = e.id)
      and not exists (select 1 from generated_invoices x where x.event_id = e.id)
      and not exists (select 1 from image_sets x where x.timeline_event_id = e.id);
  create temp table _ts on commit drop as
    select q.*, sum(case when q.gap is null or q.gap > 1200 then 1 else 0 end) over (order by q.taken_at, q.img) sid
    from (select t.*, extract(epoch from t.taken_at - lag(t.taken_at) over (order by t.taken_at, t.img)) gap from _tc t) q;
  create temp table _tk on commit drop as
    select s.*, count(*) over (partition by sid) n,
           first_value(eid) over (partition by sid order by taken_at, img) keeper,
           min(taken_at) over (partition by sid) s0, max(taken_at) over (partition by sid) s1
    from _ts s;
  select count(distinct eid), count(distinct sid) filter (where n > 1), count(*) filter (where n > 1), count(distinct eid) filter (where n > 1 and eid <> keeper)
    into n_events, n_sessions, n_photos, n_merge from _tk;
  if p_dry then
    return jsonb_build_object('dry', true, 'single_photo_events', n_events, 'multi_photo_sessions', n_sessions, 'photos_in_those_sessions', n_photos, 'events_to_merge_away', n_merge);
  end if;
  -- backup (full rows) of every event touched
  insert into backup_20261104_timeline_pending_consolidated (run_id, event_id, row_json)
    select p_run, te.id, to_jsonb(te) from timeline_events te where te.id in (select eid from _tk where n > 1) on conflict do nothing;
  -- 1) re-point photos to the session keeper
  insert into profile_fix_log (run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
    select p_run, 'timeline_consolidate_session', null, 'vehicle_images', img, 'timeline_event_id', 'update', to_jsonb(eid), to_jsonb(keeper),
           jsonb_build_object('session', sid, 'gap_s', 1200) from _tk where n > 1 and eid <> keeper;
  update vehicle_images vi set timeline_event_id = k.keeper from _tk k where vi.id = k.img and k.n > 1 and k.eid <> k.keeper and vi.user_id = p_user;
  -- 2) keeper events: aggregate urls / count / session window
  create temp table _kv on commit drop as
    select k.keeper, k.sid, k.n, k.s0, k.s1, array_agg(k.image_url order by k.taken_at, k.img) urls, array_agg(k.eid) filter (where k.eid <> k.keeper) merged, min(k.event_date) ed
    from _tk k where k.n > 1 group by k.keeper, k.sid, k.n, k.s0, k.s1;
  insert into profile_fix_log (run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
    select p_run, 'timeline_consolidate_session', null, 'timeline_events', te.id, c.col, 'update', to_jsonb(case c.col when 'image_urls' then to_jsonb(te.image_urls) when 'metadata' then te.metadata else to_jsonb(te.title) end),
           case c.col when 'image_urls' then to_jsonb(kv.urls) when 'metadata' then te.metadata || jsonb_build_object('photo_count', kv.n, 'session_start', kv.s0, 'session_end', kv.s1, 'consolidated_from', to_jsonb(kv.merged), 'consolidation_run', p_run)
                      else to_jsonb(kv.n || ' photos from ' || to_char(kv.ed, 'Mon DD, YYYY')) end,
           jsonb_build_object('session', kv.sid)
    from _kv kv join timeline_events te on te.id = kv.keeper cross join (values ('image_urls'), ('metadata'), ('title')) c(col);
  update timeline_events te set image_urls = kv.urls,
         metadata = te.metadata || jsonb_build_object('photo_count', kv.n, 'session_start', kv.s0, 'session_end', kv.s1, 'consolidated_from', to_jsonb(kv.merged), 'consolidation_run', p_run),
         title = kv.n || ' photos from ' || to_char(kv.ed, 'Mon DD, YYYY')
    from _kv kv where te.id = kv.keeper;
  -- 3) surplus events are now empty single-photo pending events without dependants (filtered above): delete them.
  --    Full rows are in backup_20261104_timeline_pending_consolidated; timeline_consolidate_revert(run) re-inserts them.
  delete from timeline_events te using (select distinct eid from _tk where n > 1 and eid <> keeper) k where te.id = k.eid and te.vehicle_id is null and te.event_type = 'pending_analysis';
  return jsonb_build_object('dry', false, 'run_id', p_run, 'single_photo_events', n_events, 'sessions_consolidated', n_sessions, 'photos_regrouped', n_photos,
                            'events_deleted', n_merge, 'revert', 'select timeline_consolidate_revert(''' || p_run || ''')');
end $$;

-- When photos land on a vehicle, re-point their pending event: whole event -> set vehicle; partial -> move photos to that
-- vehicle's pending event for the day (created if missing). All changes logged in profile_fix_log under p_run.
create or replace function public.timeline_resolve_pending_for_images(p_images uuid[], p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare g record; tgt uuid; nid uuid; moved int := 0; whole int := 0; made int := 0; old_urls text[]; new_old text[]; cnt int;
begin
  if p_images is null or cardinality(p_images) = 0 then return jsonb_build_object('moved', 0); end if;
  for g in
    select vi.timeline_event_id eid, vi.vehicle_id vid, vi.user_id uid, e.event_date, e.image_urls, array_agg(vi.id) imgs, array_agg(vi.image_url) urls, count(*) n
    from vehicle_images vi join timeline_events e on e.id = vi.timeline_event_id
    where vi.id = any(p_images) and vi.vehicle_id is not null and e.vehicle_id is null and e.event_type = 'pending_analysis'
    group by vi.timeline_event_id, vi.vehicle_id, vi.user_id, e.event_date, e.image_urls
  loop
    if g.n >= coalesce(cardinality(g.image_urls), 0) then
      insert into profile_fix_log (run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
        values (p_run, 'timeline_resolve_pending', g.vid, 'timeline_events', g.eid, 'vehicle_id', 'update', 'null'::jsonb, to_jsonb(g.vid), jsonb_build_object('images', g.n));
      update timeline_events set vehicle_id = g.vid, metadata = metadata || jsonb_build_object('unresolved', false, 'resolved_run', p_run) where id = g.eid;
      whole := whole + 1;
    else
      select id into nid from timeline_events where vehicle_id = g.vid and event_date = g.event_date and event_type = 'pending_analysis' limit 1;
      if nid is null then
        insert into timeline_events (vehicle_id, user_id, event_type, source, event_date, title, description, image_urls, metadata)
        values (g.vid, g.uid, 'pending_analysis', 'photo_upload', g.event_date, g.n || ' photos from ' || to_char(g.event_date, 'Mon DD, YYYY'), 'AI analysis pending', g.urls,
                jsonb_build_object('photo_count', g.n, 'needs_ai_analysis', true, 'split_from', g.eid, 'resolved_run', p_run)) returning id into nid;
        insert into profile_fix_log (run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
          values (p_run, 'timeline_resolve_pending', g.vid, 'timeline_events', nid, 'id', 'insert', null, to_jsonb(nid), jsonb_build_object('split_from', g.eid));
        made := made + 1;
      else
        select coalesce(cardinality(image_urls),0) into cnt from timeline_events where id = nid;
        insert into profile_fix_log (run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
          select p_run, 'timeline_resolve_pending', g.vid, 'timeline_events', te.id, 'image_urls', 'update', to_jsonb(te.image_urls), to_jsonb(te.image_urls || g.urls), '{}'::jsonb from timeline_events te where te.id = nid;
        update timeline_events set image_urls = coalesce(image_urls, '{}') || g.urls,
          metadata = metadata || jsonb_build_object('photo_count', cnt + g.n), title = (cnt + g.n) || ' photos from ' || to_char(g.event_date, 'Mon DD, YYYY') where id = nid;
      end if;
      insert into profile_fix_log (run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
        select p_run, 'timeline_resolve_pending', g.vid, 'vehicle_images', x, 'timeline_event_id', 'update', to_jsonb(g.eid), to_jsonb(nid), '{}'::jsonb from unnest(g.imgs) x;
      update vehicle_images set timeline_event_id = nid where id = any(g.imgs) and user_id = g.uid;
      -- remove the moved photos from the old pending event
      select array(select u from unnest(g.image_urls) u where u <> all (g.urls)) into new_old;
      insert into profile_fix_log (run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
        values (p_run, 'timeline_resolve_pending', g.vid, 'timeline_events', g.eid, 'image_urls', 'update', to_jsonb(g.image_urls), to_jsonb(new_old), '{}'::jsonb);
      update timeline_events set image_urls = new_old, metadata = metadata || jsonb_build_object('photo_count', cardinality(new_old)),
        title = cardinality(new_old) || ' photos from ' || to_char(g.event_date, 'Mon DD, YYYY') where id = g.eid;
      moved := moved + g.n;
    end if;
  end loop;
  return jsonb_build_object('events_resolved_whole', whole, 'photos_moved', moved, 'events_created', made, 'run_id', p_run);
end $$;

create or replace function public.timeline_consolidate_revert(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n_re int;
begin
  insert into timeline_events select (jsonb_populate_record(null::timeline_events, b.row_json)).* from backup_20261104_timeline_pending_consolidated b
   where b.run_id = p_run and not exists (select 1 from timeline_events t where t.id = b.event_id);
  get diagnostics n_re = row_count;
  return jsonb_build_object('events_restored', n_re) || profile_fix_revert(p_run);
end $$;
