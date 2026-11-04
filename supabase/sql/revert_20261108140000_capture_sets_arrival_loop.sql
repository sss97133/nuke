-- Revert 20261108140000_capture_sets_arrival_loop: stop the drainer, drop the arrival triggers, restore the 2026-11-04 live
-- bodies of capture_sets_score and capture_sets_landing_run. Filings stay; undo a run with capture_sets_revert(run, actor).
SET lock_timeout = '5s';
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'capture-sets-drain';
DROP TABLE IF EXISTS public.capture_sets_arm_cursor;
DROP TRIGGER IF EXISTS capture_sets_arm_on_text_read ON public.image_text_reads;
DROP FUNCTION IF EXISTS public.capture_sets_drain(integer);
DROP FUNCTION IF EXISTS public.capture_sets_arm_new_photos();
DROP FUNCTION IF EXISTS public.capture_sets_arm_on_text_read();
CREATE OR REPLACE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_mode text DEFAULT 'live'::text, p_only_imgs uuid[] DEFAULT NULL::uuid[])
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
    where vi.user_id = p_user and vi.source = 'capture_relay_ios' and vi.taken_at is not null
      and nullif(vi.image_url,'') is not null
      and (p_only_imgs is null or vi.id = any(p_only_imgs))
      and (p_only_imgs is not null or (vi.taken_at >= p_from and vi.taken_at < p_to))
      and not exists (select 1 from capture_document_pages dp where dp.image_id = vi.id and dp.revoked_at is null)
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
           vin_match_key(v.vin) k, regexp_replace(upper(coalesce(v.license_plate,'')),'[^A-Z0-9]','','g') pk
    from vehicles v where (v.owner_id = p_user or v.user_id = p_user) and v.deleted_at is null and v.merged_into_vehicle_id is null
      and v.id <> '14447ecd-293e-4203-9045-90102559c904'::uuid
      and v.id not in ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid,'1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid)  -- Viva cars: never auto-landed
  ), anc as materialized (   -- human-confirmed anchors only: web uploads Skylar filed himself + iOS filed with no machine provenance
    select a.id aid, a.vehicle_id av, a.taken_at at_, e.embedding_clip_vitb32 ae
    from vehicle_images a join roster r on r.id = a.vehicle_id
    cross join lateral (select io.embedding_clip_vitb32 from image_observations io where io.image_id = a.id and io.is_active
                          and io.embedding_clip_vitb32 is not null order by io.observed_at desc limit 1) e
    where a.user_id = p_user and a.merged_from_vehicle_id is null
      and not coalesce(a.is_duplicate,false) and not coalesce(a.is_superseded,false)
      and (a.source in ('user_upload','owner_upload')
           or (a.source = 'capture_relay_ios'
               and not exists (select 1 from capture_set_links l where l.image_id = a.id and l.reverted_at is null)
               and not exists (select 1 from image_observations o where o.image_id = a.id and o.is_active and o.vehicle_id = a.vehicle_id
                                 and o.observed_by not like 'human:%')))
      and not exists (select 1 from image_observations o where o.image_id = a.id and o.observed_by in ('merge_carry_v1','capture_sets_landing_v1'))
  ), vsim as (
    select x.sid, x.id, x.av, avg(x.sim) m from (
      select g.sid, g.id, a.av, 1 - (g.emb <=> a.ae) sim,
             row_number() over (partition by g.id, a.av order by g.emb <=> a.ae) rn
      from g join seg s on s.sid = g.sid join anc a on a.aid <> g.id
      where g.emb is not null and not g.blocked
        and (p_mode <> 'strip' or a.at_ is null or a.at_ < s.st0 - interval '6 hours' or a.at_ > s.st1 + interval '6 hours')
        and not (a.aid = any(coalesce(s.unl,'{}') || coalesce(s.fil,'{}')))) x
    where x.rn <= 3 group by 1,2,3
  ), vveh as (
    select sid, av, avg(m) vm, row_number() over (partition by sid order by avg(m) desc) rk from vsim group by 1,2
  ), vis as (
    select a.sid, a.av cv, (a.vm - coalesce(b.vm,0))::numeric vmargin,
           (2.5 * least(1, greatest(0, (a.vm - coalesce(b.vm,0)) / 0.08)))::numeric pts
    from vveh a left join vveh b on b.sid = a.sid and b.rk = 2 where a.rk = 1
  ), plate as (
    select g.sid, r.id cv, 3.0 pts from g join roster r on length(r.pk) >= 5
    where p_mode <> 'strip' and not g.blocked and exists (select 1 from image_text_reads tr cross join lateral jsonb_array_elements(tr.lines) ln
                  where tr.image_id = g.id and tr.revoked_at is null
                    and regexp_replace(upper(ln->>0),'[^A-Z0-9]','','g') = r.pk)
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
  ), recent as (
    select s.sid, (select h.hv from hist h where h.ht < s.st0 - interval '20 minutes' order by h.ht desc limit 1) cv from seg s
  ), vin as (
    select g.sid, r.id cv, max(case when g.is_doc then 2.0 else 3.0 end) pts
    from g join roster r on r.k is not null and length(r.k) >= 5 and (
         (length(coalesce(g.vehicle_vin,'')) >= 8 and vin_match_key(g.vehicle_vin) = r.k)
      or exists (select 1 from image_text_reads tr cross join lateral jsonb_array_elements(tr.vin_candidates) c
                 where tr.image_id = g.id and tr.revoked_at is null and vin_match_key(c->>'vin') = r.k))
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
  ), cand as (
    select sid, cv from sess union select sid, cv from cell union select sid, cv from recent where cv is not null
    union select sid, cv from vin union select sid, cv from vis union select sid, cv from plate
    union select c.sid, r.id from cls c join roster r on c.fn = 'model' and r.md <> '' and (position(c.val in r.md) > 0 or position(r.md in c.val) > 0)
  ), sc as (
    select s.sid, r.id cv,
      coalesce((select v.pts from vin v where v.sid = s.sid and v.cv = r.id), 0) s_vin,
      coalesce((select v.pts from vis v where v.sid = s.sid and v.cv = r.id), 0) s_vis,
      coalesce((select v.vmargin from vis v where v.sid = s.sid and v.cv = r.id), 0) s_vmargin,
      coalesce((select v.pts from plate v where v.sid = s.sid and v.cv = r.id), 0) s_plate,
      coalesce((select 2.5 * ss.c/ss.tot * least(1, ss.tot/2) from sess ss where ss.sid = s.sid and ss.cv = r.id), 0) s_sess,
      coalesce((select 1.0 * ce.c/ce.tot from cell ce where ce.sid = s.sid and ce.cv = r.id), 0) s_cell,
      case when (select re.cv from recent re where re.sid = s.sid) = r.id then 0.5 else 0 end s_recent,
      coalesce((select case when r.mk = '' then 0
                  when c.val = r.mk or (c.val in ('chevrolet','chevy','gmc') and r.mk in ('chevrolet','chevy','gmc')) then 0.6
                  when c.cmax >= 0.7 then -1.5 else -0.3 end from cls c where c.sid = s.sid and c.fn = 'make'), 0) s_make,
      coalesce((select case when r.md = '' then 0
                  when position(c.val in r.md) > 0 or position(r.md in c.val) > 0 then 1.0
                  when c.cmax >= 0.7 then -0.8 else 0 end from cls c where c.sid = s.sid and c.fn = 'model'), 0) s_model,
      coalesce((select case when r.yr is null or c.val !~ '^\d{4}$' then 0 when abs(c.val::int - r.yr) <= 1 then 0.4
                  when abs(c.val::int - r.yr) > 5 then -0.4 else 0 end from cls c where c.sid = s.sid and c.fn = 'year'), 0) s_year,
      coalesce((select case when r.col <> '' and (position(c.val in r.col) > 0 or position(r.col in c.val) > 0) then 0.3 else 0 end
                from cls c where c.sid = s.sid and c.fn = 'color'), 0) s_color
    from seg s join cand k on k.sid = s.sid join roster r on r.id = k.cv
  ), tot as (
    select sc.*, s_vin+s_vis+s_plate+s_sess+s_cell+s_recent+s_make+s_model+s_year+s_color score,
           row_number() over (partition by sc.sid order by s_vin+s_vis+s_plate+s_sess+s_cell+s_recent+s_make+s_model+s_year+s_color desc, sc.cv) rk
    from sc
  ), tm as (
    select t.*, t.score - coalesce(lead(t.score) over (partition by t.sid order by t.rk), 0) mraw from tot t
  )
  select 'ios:' || p_user || ':' || to_char(s.st0 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'), s.st0, s.st1,
         coalesce(s.unl,'{}'), coalesce(s.fil,'{}'), t.cv, t.rk::int,
         jsonb_build_object('score', round(t.score,3), 'margin_raw', round(case when t.rk = 1 then t.mraw else t.score - (select t2.score from tot t2 where t2.sid = t.sid and t2.rk = 1) end,3),
           'vin', t.s_vin, 'visual', round(t.s_vis,3), 'visual_margin', round(t.s_vmargin,4), 'plate', t.s_plate, 'session', round(t.s_sess,3), 'cell', round(t.s_cell,3), 'recent', t.s_recent,
           'make', t.s_make, 'model', t.s_model, 'year', t.s_year, 'color', t.s_color, 'mode', p_mode)
  from seg s join tm t on t.sid = s.sid where t.rk <= 3;
end $function$

;
CREATE OR REPLACE FUNCTION public.capture_sets_landing_run(p_user uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_run uuid, p_dry boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '600s'
AS $function$
declare r record; items jsonb := '[]'; cands jsonb := '[]'; nrev int := 0; nclaim_vin int := 0; nclaim_sugg int := 0; nclaim_plate int := 0; v_basis text;
  would_file int := 0; held int := 0; res jsonb := null; rc jsonb := null; img uuid; seg_ids uuid[]; vin_veh uuid; c numeric;
begin
  if p_run is null then raise exception 'run id required'; end if;
  create temp table if not exists _cs on commit drop as select * from capture_sets_score(p_user, p_from, p_to, 'live') limit 0;
  truncate _cs; insert into _cs select * from capture_sets_score(p_user, p_from, p_to, 'live');
  for r in select s1.*, (s1.signals->>'score')::numeric sc, (s1.signals->>'margin_raw')::numeric mg,
                  (select jsonb_agg(jsonb_build_object('vehicle_id', s2.vehicle_id, 'rank', s2.rank, 'signals', s2.signals) order by s2.rank)
                     from _cs s2 where s2.set_key = s1.set_key) top3
           from _cs s1 where s1.rank = 1 and cardinality(s1.image_ids) > 0 order by s1.t0 desc loop   -- newest first
    cands := cands || (select jsonb_agg(jsonb_build_object('set_key', s2.set_key, 'image_ids', to_jsonb(s2.image_ids), 'vehicle_id', s2.vehicle_id,
        'rank', s2.rank, 'combined', round(1/(1+exp(-((s2.signals->>'score')::numeric - 2))),4),
        'margin', greatest(-1, least(1, round(case when s2.rank = 1 then 1/(1+exp(-(r.sc-2))) - 1/(1+exp(-((r.sc - r.mg) - 2)))
                  else 1/(1+exp(-((s2.signals->>'score')::numeric - 2))) - 1/(1+exp(-(r.sc-2))) end, 4))),
        'band', case when s2.rank = 1 and r.sc >= 2.5 and r.mg >= 1 then 'clear' when s2.rank = 1 and r.mg < 0.25 then 'tie'
                     when (s2.signals->>'score')::numeric >= 1.5 then 'likely' else 'weak' end,
        'signals', s2.signals)) from _cs s2 where s2.set_key = r.set_key);
    if r.sc >= 2.5 and r.mg >= 1 then
      would_file := would_file + cardinality(r.image_ids);
      select array_agg(g.id) into seg_ids from vehicle_images g where g.id = any(r.image_ids || r.filed_ids);
      items := items || jsonb_build_array(jsonb_build_object('set_key', r.set_key, 'vehicle_id', r.vehicle_id, 'image_ids', to_jsonb(r.image_ids),
               'segment_ids', to_jsonb(seg_ids), 'confidence', round(1/(1+exp(-(r.sc - 2))),3), 'basis', 'scored_session', 'evidence', r.signals));
    else
      held := held + cardinality(r.image_ids); nrev := nrev + 1;
      if not p_dry then
        insert into capture_set_review(run_id, user_id, set_key, image_ids, to_vehicle_id, confidence, basis, evidence, reason)
        values (p_run, p_user, r.set_key, r.image_ids, r.vehicle_id, round(1/(1+exp(-(r.sc - 2))),3), 'scored_session',
                jsonb_build_object('top3', r.top3), case when r.mg < 1 then 'no_clear_lead' else 'score_below_2.5' end)
        on conflict (run_id, set_key) do nothing;
      end if;
    end if;
    -- per-photo claims: VIN exact on the owner's roster -> 0.97 (files via derive cron); else suggestion capped at 0.84
    foreach img in array r.image_ids loop
      select v.id into vin_veh from vehicle_images g join vehicles v on (v.owner_id = p_user or v.user_id = p_user) and v.deleted_at is null
         and v.merged_into_vehicle_id is null and length(coalesce(vin_match_key(v.vin),'')) >= 11 and v.id not in ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid,'1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid)
       where g.id = img and not coalesce(g.is_document,false) and (vin_match_key(g.vehicle_vin) = vin_match_key(v.vin)
         or exists (select 1 from image_text_reads tr cross join lateral jsonb_array_elements(tr.vin_candidates) x
                    where tr.image_id = img and tr.revoked_at is null and vin_match_key(x->>'vin') = vin_match_key(v.vin))) limit 1;
      v_basis := case when vin_veh is not null then 'vin_exact' end;
      if vin_veh is null then
        select v.id into vin_veh from vehicles v
         where (v.owner_id = p_user or v.user_id = p_user) and v.deleted_at is null and v.merged_into_vehicle_id is null
           and length(regexp_replace(upper(coalesce(v.license_plate,'')),'[^A-Z0-9]','','g')) >= 5
           and v.id not in ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid,'1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid)
           and exists (select 1 from image_text_reads tr cross join lateral jsonb_array_elements(tr.lines) ln
                        where tr.image_id = img and tr.revoked_at is null
                          and regexp_replace(upper(ln->>0),'[^A-Z0-9]','','g') = regexp_replace(upper(v.license_plate),'[^A-Z0-9]','','g'))
         limit 1;
        if vin_veh is not null then v_basis := 'plate_exact'; nclaim_plate := nclaim_plate + 1; nclaim_vin := nclaim_vin - 1; end if;
      end if;
      if vin_veh is not null then nclaim_vin := nclaim_vin + 1; c := 0.97; else nclaim_sugg := nclaim_sugg + 1; c := least(0.84, round(1/(1+exp(-(r.sc - 2))),3)); end if;
      if not p_dry then
        perform ingest_image_observation(img, coalesce(vin_veh, r.vehicle_id), 'subject', c, 'capture_sets_landing_v1', 'scored_session_v1',
          jsonb_build_object('run_id', p_run, 'set_key', r.set_key, 'basis', coalesce(v_basis, 'scored_session_suggestion'), 'signals', r.signals));
      end if;
      vin_veh := null;
    end loop;
  end loop;
  if not p_dry then
    rc := record_capture_set_candidates(p_run, p_user, 'scored_session_v1', coalesce(cands,'[]'));
    if jsonb_array_length(items) > 0 then res := capture_sets_apply(p_run, p_user, items, 0.6); end if;
  end if;
  return jsonb_build_object('run_id', p_run, 'dry', p_dry, 'sets_scored', (select count(distinct set_key) from _cs),
    'would_file_photos', would_file, 'clear_sets', jsonb_array_length(items), 'review_sets', nrev, 'held_photos', held,
    'claims_vin_0_97', nclaim_vin, 'claims_plate_0_97', nclaim_plate, 'claims_suggestion_le_0_84', nclaim_sugg, 'candidates', rc, 'apply', res, 'items', items);
end $function$

;
DROP FUNCTION IF EXISTS public.capture_sets_enqueue(uuid, date, jsonb);
DROP FUNCTION IF EXISTS public.vehicle_model_family(text, text);
-- Grants stay narrowed (service_role only); the PUBLIC grant was a defect, not a feature.
