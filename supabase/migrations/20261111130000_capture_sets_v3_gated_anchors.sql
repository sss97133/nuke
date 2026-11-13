-- Gate-passed filings are visual anchors for capture_sets_score (v3).
--
-- Why (owner, 2026-11-07): the visual leg (CLIP kNN against a vehicle's anchors) could not name the 1973 Pontiac Firebird
-- on days without lettering, because the anchor rule (anc) accepted only web uploads and iOS frames with no machine
-- provenance: measured 6 Firebird anchors against 417 filings, 409 of them written by landing runs whose viewed gate
-- sample passed (filing_run_gate.passed). The 1966 Mustang (517 anchors) took the visual leg instead: the 2026-08-15 set
-- scored the Firebird 1.000 (model lettering only, visual 0) and the Mustang 0.969 (visual 1.288).
-- Measured with the rule below (owner's roster): Firebird 6 -> 414 anchors, black 1966 Mustang 517 -> 611, gold 1966
-- Mustang 0 -> 65; every other vehicle unchanged (no gate-passed filings).
--
-- Change: anc also accepts a frame whose unreverted capture_set_links row belongs to a run with filing_run_gate.passed
-- (the gate is a viewed, stratified sample with <= 5% wrong), and refuses any frame an auditor marked wrong in
-- auto_filing_audit_queue. The vsim leg already excludes a set's own frames from its anchors, so a filing never
-- anchors itself. Nothing else in v3 changes.
--
-- Applied by replacing the live body, recorded here as read on 2026-11-07 (md5 of pg_get_functiondef below): the
-- migration refuses on drift (a different live body) and skips when the body already carries its marker.
-- Revert: supabase/sql/revert_20261111130000_capture_sets_v3_gated_anchors.sql (the pre-patch live body).
-- Proof after deploy: capture_sets_score(owner, 2026-08-15, +1 day, 'dry', null, null) gives the Firebird a non-zero
-- signals.visual on the 20:53Z set.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $do$
DECLARE v_live text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_live FROM pg_proc WHERE proname = 'capture_sets_score' AND pronargs = 6 AND pronamespace = 'public'::regnamespace;
  IF v_live IS NULL THEN RAISE EXCEPTION 'capture_sets_score v3 (6 args) is not live'; END IF;
  IF position('(20261111130000)' in v_live) > 0 THEN RAISE NOTICE 'capture_sets_score v3 already carries the gated-anchor rule'; RETURN; END IF;
  IF md5(v_live) <> '2501c3d815d4b5d38a133a4c7d081e22' THEN
    RAISE EXCEPTION 'capture_sets_score v3 drifted from the body this migration was written against (md5 %); re-record before patching', md5(v_live);
  END IF;
  EXECUTE $body$
CREATE OR REPLACE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_mode text DEFAULT 'live'::text, p_only_imgs uuid[] DEFAULT NULL::uuid[], p_prov jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(set_key text, t0 timestamp with time zone, t1 timestamp with time zone, image_ids uuid[], filed_ids uuid[], vehicle_id uuid, rank integer, signals jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return query
  with p as materialized (
    select vi.id, vi.taken_at, vi.latitude::float8 lat, vi.longitude::float8 lon,
           case when vi.vehicle_id = '14447ecd-293e-4203-9045-90102559c904'::uuid then null else vi.vehicle_id end vid,
           vi.vehicle_vin, coalesce(vi.vehicle_vin_confidence,0) vconf, coalesce(vi.is_document,false) or coalesce(vi.doc_flag,false) is_doc,
           coalesce(vi.is_duplicate,false) or coalesce(vi.is_superseded,false) or coalesce(vi.is_sensitive,false)
             or coalesce(vi.vision_gate_status::text,'') in ('rejected_personal','rejected_misattributed') blocked,
           vi.ai_scan_metadata#>'{classification,v2,vehicle_fields}' vf,
           (select io.embedding_clip_vitb32 from image_observations io where io.image_id = vi.id and io.is_active
              and io.embedding_clip_vitb32 is not null order by io.observed_at desc limit 1) emb,
           lag(vi.taken_at) over w pt, lag(vi.latitude::float8) over w plat, lag(vi.longitude::float8) over w plon
    from vehicle_images vi
    where vi.user_id = p_user and vi.source = ANY (public.capture_set_photo_sources()) and vi.taken_at is not null
      and nullif(vi.image_url,'') is not null
      and (p_only_imgs is null or vi.id = any(p_only_imgs))
      and (p_only_imgs is not null or (vi.taken_at >= p_from and vi.taken_at < p_to))
      and not exists (select 1 from capture_document_pages dp where dp.image_id = vi.id and dp.revoked_at is null)
      -- no ping-pong: a photo whose capture-set filing was already reverted twice is left for a human
      and (select count(*) from capture_set_links rl where rl.image_id = vi.id and rl.reverted_at is not null) < 2
    window w as (order by vi.taken_at, vi.id)
  ), g as materialized (
    select p.*, case when p_only_imgs is not null then 0 else sum(case when p.pt is null or extract(epoch from p.taken_at - p.pt) > 1200
          or (p.lat is not null and p.plat is not null and 6371000*2*asin(sqrt(least(1, power(sin(radians(p.lat-p.plat)/2),2)
             + cos(radians(p.lat))*cos(radians(p.plat))*power(sin(radians(p.lon-p.plon)/2),2)))) > 300)
        then 1 else 0 end) over (order by p.taken_at, p.id) end sid
    from p
  ), seg as materialized (
    select g.sid, min(g.taken_at) st0, max(g.taken_at) st1,
           array_agg(g.id order by g.taken_at) filter (where g.vid is null and not g.blocked) unl,
           array_agg(g.id order by g.taken_at) filter (where g.vid is not null) fil,
           array_agg(distinct (round(g.lat::numeric,3)::text||','||round(g.lon::numeric,3)::text)) filter (where g.lat is not null) cells
    from g group by g.sid
  ), roster as materialized (
    select v.id, lower(btrim(coalesce(v.make,''))) mk, lower(btrim(coalesce(v.model,''))) md, v.year yr, lower(coalesce(v.color,'')) col,
           vin_match_key(v.vin) k, regexp_replace(upper(coalesce(v.license_plate,'')),'[^A-Z0-9]','','g') pk,
           vehicle_model_family(v.make, v.model) fam
    from vehicles v where (v.owner_id = p_user or v.user_id = p_user) and v.deleted_at is null and v.merged_into_vehicle_id is null
      and coalesce(v.status,'active') not in ('discovered','merged','inactive','archived','rejected')   -- v3: stubs/dups are not candidates
      and v.id <> '14447ecd-293e-4203-9045-90102559c904'::uuid
      and v.id not in ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid,'1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid)  -- Viva cars: never auto-landed
  ), anc as materialized (   -- confirmed anchors: web uploads Skylar filed himself, iOS filed with no machine provenance,
                             -- and (20261111130000) filings of a landing run whose viewed gate sample passed
    select a.id aid, a.vehicle_id av, a.taken_at at_, e.embedding_clip_vitb32 ae
    from vehicle_images a join roster r on r.id = a.vehicle_id
    cross join lateral (select io.embedding_clip_vitb32 from image_observations io where io.image_id = a.id and io.is_active
                          and io.embedding_clip_vitb32 is not null order by io.observed_at desc limit 1) e
    where a.user_id = p_user and a.merged_from_vehicle_id is null
      and not coalesce(a.is_duplicate,false) and not coalesce(a.is_superseded,false)
      and (a.source in ('user_upload','owner_upload')
           or (a.source = ANY (public.capture_set_photo_sources())
               and not exists (select 1 from capture_set_links l where l.image_id = a.id and l.reverted_at is null)
               and not exists (select 1 from image_observations o where o.image_id = a.id and o.is_active and o.vehicle_id = a.vehicle_id
                                 and o.observed_by not like 'human:%'))
           -- gate-passed machine filings anchor too: filing_gate_eval passed the run's viewed sample (<= 5% wrong), so the
           -- run's filings stand as confirmed; a frame an auditor marked wrong never anchors, whatever its run did
           or exists (select 1 from capture_set_links l join filing_run_gate fg on fg.run_id = l.run_id::text and fg.passed
                       where l.image_id = a.id and l.vehicle_id = a.vehicle_id and l.reverted_at is null))
      and not exists (select 1 from auto_filing_audit_queue q where q.image_id = a.id and q.status = 'wrong')
      and not exists (select 1 from image_observations o where o.image_id = a.id and o.observed_by in ('merge_carry_v1','capture_sets_landing_v1'))
  ), vsim as (
    select x.sid, x.id, x.av, avg(x.sim) m from (
      select g.sid, g.id, a.av, 1 - (g.emb <=> a.ae) sim,
             row_number() over (partition by g.id, a.av order by g.emb <=> a.ae) rn
      from (   -- perf: visual similarity is estimated from at most 12 evenly spaced embedded photos per set
        select g0.*, row_number() over (partition by g0.sid order by g0.taken_at, g0.id) vr, count(*) over (partition by g0.sid) vn
          from g g0 where g0.emb is not null and not g0.blocked) g
      join seg s on s.sid = g.sid join anc a on a.aid <> g.id
      where (g.vr - 1) % greatest(1, ceil(g.vn / 12.0)::int) = 0
        and (p_mode <> 'strip' or a.at_ is null or a.at_ < s.st0 - interval '6 hours' or a.at_ > s.st1 + interval '6 hours')
        -- perf (equivalent): segment members all have taken_at inside [st0,st1], so only anchors in that range need the array test
        and (a.at_ is null or a.at_ < s.st0 or a.at_ > s.st1 or not (a.aid = any(coalesce(s.unl,'{}') || coalesce(s.fil,'{}'))))) x
    where x.rn <= 3 group by 1,2,3
  ), vveh as (
    select sid, av, avg(m) vm, row_number() over (partition by sid order by avg(m) desc) rk from vsim group by 1,2
  ), vis as (
    select a.sid, a.av cv, (a.vm - coalesce(b.vm,0))::numeric vmargin,
           (2.5 * least(1, greatest(0, (a.vm - coalesce(b.vm,0)) / 0.08)))::numeric pts
    from vveh a left join vveh b on b.sid = a.sid and b.rk = 2 where a.rk = 1
  ), plate as (
    select g.sid, r.id cv, max(x.pts) pts, array_agg(distinct x.oid) filter (where x.oid is not null) obs_ids
    from g join roster r on length(r.pk) >= 5
    cross join lateral (
      select 3.0::numeric pts, null::uuid oid
       where exists (select 1 from image_text_reads tr cross join lateral jsonb_array_elements(tr.lines) ln
                      where tr.image_id = g.id and tr.revoked_at is null
                        and regexp_replace(upper(ln->>0),'[^A-Z0-9]','','g') = r.pk)
      union all   -- v3: classifier-read plates stored as candidate identifier observations
      select (3.0 * least(1, o.confidence / 0.9))::numeric, o.id
        from vehicle_identifier_observations o
       where o.image_id = g.id and o.kind = 'plate' and o.value_norm = r.pk and o.status <> 'rejected' and o.confidence >= 0.5
    ) x
    where p_mode <> 'strip' and not g.blocked
    group by g.sid, r.id
  ), hist as materialized (   -- confirmed filings of this user before the window, any source
    select h.vehicle_id hv, h.taken_at ht, round(h.latitude::numeric,3)::text||','||round(h.longitude::numeric,3)::text cell
    from vehicle_images h join roster r on r.id = h.vehicle_id
    where h.user_id = p_user and h.taken_at is not null and not coalesce(h.is_duplicate,false)
      and h.taken_at < coalesce(p_from, (select min(st0) from seg)) + interval '0 s'
  ), sess as (   -- filed siblings in the segment
    select s.sid, g.vid cv, count(*)::numeric c, sum(count(*)) over (partition by s.sid) tot
    from seg s join g on g.sid = s.sid and g.vid is not null
    where p_mode = 'live' group by s.sid, g.vid
  ), cell as (
    select s.sid, h.hv cv, count(*)::numeric c, sum(count(*)) over (partition by s.sid) tot
    from seg s join hist h on h.cell = any(s.cells) and h.ht < s.st0 - interval '20 minutes'
    group by s.sid, h.hv
  ), recent as (   -- v3: bonus cut 0.5 -> 0.15 and only when the last confirmed filing is < 48h old
    select s.sid, (select h.hv from hist h where h.ht < s.st0 - interval '20 minutes' and h.ht > s.st0 - interval '48 hours' order by h.ht desc limit 1) cv from seg s
  ),
  wsx as (   -- v3: work sessions (time windows per vehicle) are *cited evidence*, never a hard assignment
    select s.sid, w.id wid, w.vehicle_id cv, w.status wstatus,
           ((case when w.owner_confirmed_at is not null then 1.0
                  when w.metadata#>>'{auto_resolution,status}' = 'auto_confirmed' then 0.8
                  when w.metadata#>>'{auto_resolution,status}' = 'system_hold' then 0.4
                  else 0.6 end)
            * (case when w.session_type in ('baseline_backfill','photo_interpolated') then 0.6 else 1.0 end)
            * (case when coalesce(w.end_time, w.start_time) >= s.st0 and w.start_time <= s.st1 then 1.0 else 0.5 end))::numeric pts
    from seg s join work_sessions w on w.user_id = p_user and w.start_time is not null
         and w.vehicle_id in (select id from roster)
         and w.start_time <= s.st1 + interval '1 hour' and coalesce(w.end_time, w.start_time) >= s.st0 - interval '1 hour'
         and coalesce(w.end_time, w.start_time) - w.start_time <= interval '16 hours'
    where coalesce(w.metadata#>>'{auto_resolution,status}','') not in ('closed_obsolete','rejected')
  ), wsn as (select sid, count(distinct cv) n from wsx group by sid
  ), wsp as (
    select x.sid, x.cv, least(1.0, max(x.pts) / greatest(1, n.n))::numeric pts,
           (array_agg(x.wid order by x.pts desc))[1:5] ids
    from wsx x join wsn n on n.sid = x.sid group by x.sid, x.cv, n.n
  ), ctxrows as (   -- v3: temporal continuity. Resolved days before this segment (filed history, still-unapplied
                    -- 'clear' proposals passed in p_prov, and prior work sessions) raise the prior for the same
                    -- vehicle/location. Weight halves every ~1.4 days; same-location rows count fully, others 0.35.
    select s.sid, h.hv cv, h.ht t, 'filed'::text src,
           exp(-extract(epoch from s.st0 - h.ht) / 86400.0 / 2.0) * case when h.cell = any(s.cells) then 1.0 else 0.35 end w
    from seg s join hist h on h.ht >= s.st0 - interval '72 hours' and h.ht < s.st0 - interval '20 minutes'
    union all
    select s.sid, (pv->>'vid')::uuid, (pv->>'t1')::timestamptz, 'provisional',
           exp(-extract(epoch from s.st0 - (pv->>'t1')::timestamptz) / 86400.0 / 2.0)
             * case when exists (select 1 from jsonb_array_elements_text(coalesce(pv->'cells','[]')) c where c = any(s.cells)) then 1.0 else 0.35 end
    from seg s cross join lateral jsonb_array_elements(coalesce(p_prov,'[]'::jsonb)) pv
    where (pv->>'t1')::timestamptz < s.st0 - interval '20 minutes' and (pv->>'t1')::timestamptz >= s.st0 - interval '72 hours'
      and (pv->>'vid')::uuid in (select id from roster)
    union all
    select s.sid, w.vehicle_id, coalesce(w.end_time, w.start_time), 'work_session',
           0.6 * exp(-extract(epoch from s.st0 - coalesce(w.end_time, w.start_time)) / 86400.0 / 2.0)
    from seg s join work_sessions w on w.user_id = p_user and w.start_time is not null and w.vehicle_id in (select id from roster)
         and coalesce(w.end_time, w.start_time) < s.st0 - interval '1 hour' and coalesce(w.end_time, w.start_time) >= s.st0 - interval '72 hours'
    where coalesce(w.metadata#>>'{auto_resolution,status}','') not in ('closed_obsolete','rejected','system_hold')
  ), prevsc as (
    select c.sid, c.cv, sum(c.w) sw, count(*) n, max(c.t) last_t,
           (select sum(c2.w) from ctxrows c2 where c2.sid = c.sid) tw,
           (select max(c3.w) from ctxrows c3 where c3.sid = c.sid) mw
    from ctxrows c group by c.sid, c.cv
  ), vin as (
    select g.sid, r.id cv, max(x.pts) pts, array_agg(distinct x.oid) filter (where x.oid is not null) obs_ids
    from g join roster r on r.k is not null and length(r.k) >= 5
    cross join lateral (
      select (case when g.is_doc then 2.0 else 3.0 end)::numeric pts, null::uuid oid
       where (length(coalesce(g.vehicle_vin,'')) >= 8 and vin_match_key(g.vehicle_vin) = r.k)
          or exists (select 1 from image_text_reads tr cross join lateral jsonb_array_elements(tr.vin_candidates) c
                     where tr.image_id = g.id and tr.revoked_at is null and vin_match_key(c->>'vin') = r.k)
      union all   -- v3: classifier/OCR-read VINs stored as candidate identifier observations
      select ((case when g.is_doc then 2.0 else 3.0 end) * least(1, o.confidence / 0.9))::numeric, o.id
        from vehicle_identifier_observations o
       where o.image_id = g.id and o.kind = 'vin' and o.value_norm = r.k and o.status <> 'rejected' and o.confidence >= 0.5
    ) x
    where not g.blocked and p_mode <> 'strip' group by g.sid, r.id
  ), cls as (    -- segment consensus per classifier field: value with highest summed confidence
    select x.sid, x.fn, x.val, x.cmax from (
      select g.sid, f->>'field_name' fn, lower(btrim(f->>'value')) val, sum(coalesce((f->>'confidence')::numeric,0.5)) w,
             max(coalesce((f->>'confidence')::numeric,0.5)) cmax,
             row_number() over (partition by g.sid, f->>'field_name' order by sum(coalesce((f->>'confidence')::numeric,0.5)) desc) rn
      from g cross join lateral jsonb_array_elements(coalesce(g.vf,'[]')) f
      where f->>'field_name' in ('make','model','year','color') and nullif(btrim(f->>'value'),'') is not null
        and (p_mode = 'live' or g.vid is null or true)
      group by 1,2,3) x where x.rn = 1
  ), lines as materialized (   -- OCR lines read from the segment's photos, normalized (20261111120000)
    select g.sid, g.id, regexp_replace(lower(ln->>0),'[^a-z0-9]','','g') t
    from g join image_text_reads tr on tr.image_id = g.id and tr.revoked_at is null
    cross join lateral jsonb_array_elements(tr.lines) ln
    where not g.blocked and p_mode <> 'strip' and coalesce((ln->>1)::numeric, 0) >= 0.7
  ), badge as (   -- a family name (vehicle_model_aliases, length >= 5) lettered on the car: TRANS AM, FIREBIRD, CHEVELLE
    select l.sid, r.id cv, count(distinct l.id) n
    from lines l join vehicle_model_aliases a on length(a.alias_norm) >= 5
      and (l.t = a.alias_norm or (length(a.alias_norm) >= 7 and position(a.alias_norm in l.t) > 0))
    join roster r on r.fam = a.family
    group by l.sid, r.id
  ), makeocr as (   -- the make lettered on the car (PONTIAC)
    select distinct l.sid, r.id cv from lines l join roster r on r.mk <> '' and l.t = regexp_replace(r.mk,'[^a-z0-9]','','g')
  ), cand as (
    select sid, cv from sess union select sid, cv from cell union select sid, cv from recent where cv is not null
    union select sid, cv from vin union select sid, cv from vis union select sid, cv from plate
    union select sid, cv from wsp union select sid, cv from prevsc
    union select c.sid, r.id from cls c join roster r on c.fn = 'model' and r.md <> '' and (position(c.val in r.md) > 0 or position(r.md in c.val) > 0)
    union select c.sid, r.id from cls c join roster r on c.fn = 'model' and r.fam is not null and vehicle_model_family(r.mk, c.val) = r.fam
    union select sid, cv from badge
  ), sc as (
    select s.sid, r.id cv,
      coalesce((select v.pts from vin v where v.sid = s.sid and v.cv = r.id), 0) s_vin,
      coalesce((select v.pts from vis v where v.sid = s.sid and v.cv = r.id), 0) s_vis,
      coalesce((select v.vmargin from vis v where v.sid = s.sid and v.cv = r.id), 0) s_vmargin,
      coalesce((select v.pts from plate v where v.sid = s.sid and v.cv = r.id), 0) s_plate,
      coalesce((select 2.5 * ss.c/ss.tot * least(1, ss.tot/2) from sess ss where ss.sid = s.sid and ss.cv = r.id), 0) s_sess,
      coalesce((select 1.0 * ce.c/ce.tot from cell ce where ce.sid = s.sid and ce.cv = r.id), 0) s_cell,
      case when (select re.cv from recent re where re.sid = s.sid) = r.id then 0.15 else 0 end s_recent,
      coalesce((select v.pts from wsp v where v.sid = s.sid and v.cv = r.id), 0) s_ws,
      coalesce((select 0.8 * (p.sw / nullif(p.tw,0)) * least(1, p.mw) from prevsc p where p.sid = s.sid and p.cv = r.id), 0) s_prev,
      coalesce((select case when r.mk = '' then 0
                  when c.val = r.mk or (c.val in ('chevrolet','chevy','gmc') and r.mk in ('chevrolet','chevy','gmc')) then 0.6
                  when c.cmax >= 0.7 then -1.5 else -0.3 end from cls c where c.sid = s.sid and c.fn = 'make'), 0) s_make,
      coalesce((select case when r.md = '' then 0
                  when position(c.val in r.md) > 0 or position(r.md in c.val) > 0 then 1.0
                  when r.fam is not null and vehicle_model_family(r.mk, c.val) = r.fam then 1.0
                  when c.cmax >= 0.7 then -0.8 else 0 end from cls c where c.sid = s.sid and c.fn = 'model'), 0) s_model,
      coalesce((select case when r.yr is null or c.val !~ '^\d{4}$' then 0 when abs(c.val::int - r.yr) <= 1 then 0.4
                  when abs(c.val::int - r.yr) > 5 then -0.4 else 0 end from cls c where c.sid = s.sid and c.fn = 'year'), 0) s_year,
      coalesce((select case when r.col <> '' and (position(c.val in r.col) > 0 or position(r.col in c.val) > 0) then 0.3 else 0 end
                from cls c where c.sid = s.sid and c.fn = 'color'), 0) s_color,
      case when exists (select 1 from badge b where b.sid = s.sid and b.cv = r.id)
            and (exists (select 1 from makeocr m where m.sid = s.sid and m.cv = r.id)
                 or exists (select 1 from cls c where c.sid = s.sid and c.fn = 'make'
                              and (c.val = r.mk or (c.val in ('chevrolet','chevy','gmc') and r.mk in ('chevrolet','chevy','gmc')))))
           then 1.0 else 0 end s_badge,
      jsonb_strip_nulls(jsonb_build_object(
        'work_sessions', (select to_jsonb(v.ids) from wsp v where v.sid = s.sid and v.cv = r.id),
        'continuity', (select jsonb_build_object('rows', p.n, 'last', p.last_t, 'share', round(p.sw / nullif(p.tw,0), 3), 'max_w', round(p.mw, 3)) from prevsc p where p.sid = s.sid and p.cv = r.id),
        'vin_obs', (select to_jsonb(v.obs_ids) from vin v where v.sid = s.sid and v.cv = r.id),
        'plate_obs', (select to_jsonb(v.obs_ids) from plate v where v.sid = s.sid and v.cv = r.id))) cites
    from seg s join cand k on k.sid = s.sid join roster r on r.id = k.cv
  ), tot as (
    select sc.*, s_vin+s_vis+s_plate+s_sess+s_cell+s_recent+s_ws+s_prev+s_make+s_model+s_year+s_color+s_badge score,
           row_number() over (partition by sc.sid order by s_vin+s_vis+s_plate+s_sess+s_cell+s_recent+s_ws+s_prev+s_make+s_model+s_year+s_color+s_badge desc, sc.cv) rk
    from sc
  ), tm as (
    select t.*, t.score - coalesce(lead(t.score) over (partition by t.sid order by t.rk), 0) mraw from tot t
  )
  select 'ios:' || p_user || ':' || to_char(s.st0 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'), s.st0, s.st1,
         coalesce(s.unl,'{}'), coalesce(s.fil,'{}'), t.cv, t.rk::int,
         jsonb_build_object('score', round(t.score,3), 'margin_raw', round(case when t.rk = 1 then t.mraw else t.score - (select t2.score from tot t2 where t2.sid = t.sid and t2.rk = 1) end,3),
           'vin', t.s_vin, 'visual', round(t.s_vis,3), 'visual_margin', round(t.s_vmargin,4), 'plate', t.s_plate, 'session', round(t.s_sess,3), 'cell', round(t.s_cell,3), 'recent', t.s_recent, 'work_session', round(t.s_ws,3), 'prev_day', round(t.s_prev,3), 'cites', t.cites, 'scorer', 'v3',
           'make', t.s_make, 'model', t.s_model, 'year', t.s_year, 'color', t.s_color, 'badge', t.s_badge, 'mode', p_mode)
  from seg s join tm t on t.sid = s.sid where t.rk <= 3;
end $function$

$body$;
END $do$;

DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE proname = 'capture_sets_score' AND pronargs = 6 AND pronamespace = 'public'::regnamespace;
  IF position('(20261111130000)' in d) = 0 OR position('filing_run_gate fg on fg.run_id = l.run_id::text and fg.passed' in d) = 0
     OR position('auto_filing_audit_queue q where q.image_id = a.id and q.status = ''wrong''' in d) = 0
     OR position('badge as (' in d) = 0 THEN
    RAISE EXCEPTION 'capture_sets_score v3: gated-anchor rule not in the live body';
  END IF;
END $$;
