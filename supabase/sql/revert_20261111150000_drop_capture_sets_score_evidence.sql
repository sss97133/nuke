-- Revert of 20261111150000: recreate capture_sets_score_evidence as read live on 2026-11-07 (md5 of pg_get_functiondef = cf554d6db0e50ba884b3787c9509a683).
-- Run by hand through the sanctioned deploy path only; it is not a migration. Nothing called it when it was dropped.
CREATE OR REPLACE FUNCTION public.capture_sets_score_evidence(p_user uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_mode text DEFAULT 'live'::text, p_only_imgs uuid[] DEFAULT NULL::uuid[])
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
      and v.id <> '14447ecd-293e-4203-9045-90102559c904'::uuid
      and v.id not in ('7b0e02b9-42af-4998-b27d-69e3459b452b'::uuid,'1e9fdf16-b453-44a9-8b74-46bbe886625a'::uuid)  -- Viva cars: never auto-landed
  ), anc as materialized (   -- human-confirmed anchors: web uploads Skylar filed himself + iOS filed with no machine provenance
    select a.id aid, a.vehicle_id av, a.taken_at at_, e.embedding_clip_vitb32 ae, false machine
    from vehicle_images a join roster r on r.id = a.vehicle_id
    cross join lateral (select io.embedding_clip_vitb32 from image_observations io where io.image_id = a.id and io.is_active
                          and io.embedding_clip_vitb32 is not null order by io.observed_at desc limit 1) e
    where a.user_id = p_user and a.merged_from_vehicle_id is null
      and not coalesce(a.is_duplicate,false) and not coalesce(a.is_superseded,false)
      and (a.source in ('user_upload','owner_upload')
           or (a.source = ANY (public.capture_set_photo_sources())
               and not exists (select 1 from capture_set_links l where l.image_id = a.id and l.reverted_at is null)
               and not exists (select 1 from image_observations o where o.image_id = a.id and o.is_active and o.vehicle_id = a.vehicle_id
                                 and o.observed_by not like 'human:%')))
      and not exists (select 1 from image_observations o where o.image_id = a.id and o.observed_by in ('merge_carry_v1','capture_sets_landing_v1'))
    union all   -- identity-filed anchors: a set this scorer filed because it read the car's VIN, plate or badge.
                -- Same-day continuity only (vsim keeps them within 24 h), so a filing never anchors another day.
    select a.id, a.vehicle_id, a.taken_at, e.embedding_clip_vitb32, true
    from capture_set_links l join vehicle_images a on a.id = l.image_id and a.vehicle_id = l.vehicle_id
    join roster r on r.id = a.vehicle_id
    cross join lateral (select io.embedding_clip_vitb32 from image_observations io where io.image_id = a.id and io.is_active
                          and io.embedding_clip_vitb32 is not null order by io.observed_at desc limit 1) e
    where l.reverted_at is null and a.user_id = p_user and a.taken_at between p_from - interval '24 hours' and p_to + interval '24 hours'
      and not coalesce(a.is_duplicate,false) and not coalesce(a.is_superseded,false)
      and greatest(coalesce((l.evidence#>>'{evidence,vin}')::numeric,0), coalesce((l.evidence#>>'{evidence,plate}')::numeric,0),
                   coalesce((l.evidence#>>'{evidence,badge}')::numeric,0)) > 0
  ), vsim as (
    select x.sid, x.id, x.av, avg(x.sim) m from (
      select g.sid, g.id, a.av, 1 - (g.emb <=> a.ae) sim,
             row_number() over (partition by g.id, a.av order by g.emb <=> a.ae) rn
      from g join seg s on s.sid = g.sid join anc a on a.aid <> g.id
      where g.emb is not null and not g.blocked
        and (p_mode <> 'strip' or a.at_ is null or a.at_ < s.st0 - interval '6 hours' or a.at_ > s.st1 + interval '6 hours')
        and not (a.aid = any(coalesce(s.unl,'{}') || coalesce(s.fil,'{}')))
        and (not a.machine or a.at_ between s.st0 - interval '24 hours' and s.st1 + interval '24 hours')) x
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
      and h.taken_at < coalesce(p_to, (select max(st1) from seg))   -- cell/recent still require h.ht < s.st0 - 20 min
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
  ), lines as materialized (   -- OCR lines read from the segment's photos, normalized
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
      case when (select re.cv from recent re where re.sid = s.sid) = r.id then 0.5 else 0 end s_recent,
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
           then 1.0 else 0 end s_badge
    from seg s join cand k on k.sid = s.sid join roster r on r.id = k.cv
  ), tot as (
    select sc.*, s_vin+s_vis+s_plate+s_sess+s_cell+s_recent+s_make+s_model+s_year+s_color+s_badge score,
           row_number() over (partition by sc.sid order by s_vin+s_vis+s_plate+s_sess+s_cell+s_recent+s_make+s_model+s_year+s_color+s_badge desc, sc.cv) rk
    from sc
  ), tm as (
    select t.*, t.score - coalesce(lead(t.score) over (partition by t.sid order by t.rk), 0) mraw from tot t
  )
  select 'ios:' || p_user || ':' || to_char(s.st0 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'), s.st0, s.st1,
         coalesce(s.unl,'{}'), coalesce(s.fil,'{}'), t.cv, t.rk::int,
         jsonb_build_object('score', round(t.score,3), 'margin_raw', round(case when t.rk = 1 then t.mraw else t.score - (select t2.score from tot t2 where t2.sid = t.sid and t2.rk = 1) end,3),
           'vin', t.s_vin, 'visual', round(t.s_vis,3), 'visual_margin', round(t.s_vmargin,4), 'plate', t.s_plate, 'session', round(t.s_sess,3), 'cell', round(t.s_cell,3), 'recent', t.s_recent,
           'make', t.s_make, 'model', t.s_model, 'year', t.s_year, 'color', t.s_color, 'badge', t.s_badge, 'mode', p_mode)
  from seg s join tm t on t.sid = s.sid where t.rk <= 3;
end $function$
