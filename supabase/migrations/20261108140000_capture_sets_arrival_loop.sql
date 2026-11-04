-- Capture sets file themselves as photos arrive: the arrival loop for the scorer.
--
-- Why (owner, 2026-11-03): the 1973 Firebird (20d21fb0) was missing its 10-28 shoot. 403 frames sat unfiled; the scorer
-- put the morning set on the 1967 GTO. Things like this "should merge naturally because the data indicates it".
-- The data did indicate it. The OCR read TRANS AM and SD-455 lettering and PONTIAC on the shoot's frames, and the classifier read
-- "trans am" with 0.9 confidence. Five defects stopped the merge:
--   1. capture_sets_score and capture_sets_landing_run were applied by hand and are not in the repo. This file records the
--      live bodies with the changes below.
--   2. Model matching used substring only: classifier "trans am" vs roster "Firebird" scored -0.8.
--      vehicle_model_aliases already holds the data (transam, formula, esprit -> pontiac_firebird).
--   3. OCR lines counted only for VIN and plate. A family name lettered on the car did not count.
--   4. Nothing ran the scorer. capture_set_rescore_queue (20261023231000) existed with no drainer, and photo arrival
--      enqueued nothing.
--   5. A filing never informed the rest of the day. History stopped at the window start, and the scorer's own
--      identity-backed filings were never visual anchors.
--
-- Changes:
--   * vehicle_model_family(make, model) reads vehicle_model_aliases. The scorer's model leg scores a family-equal
--     reading as a match (+1.0, the same as a substring match).
--   * badge leg (+1.0): a family alias of length >= 5 read at OCR confidence >= 0.7 on a photo in the set. It counts
--     only when the make is corroborated by the make read on the car or the classifier's make consensus, so a lift
--     brand (RANGER) cannot name a Ford Ranger by itself. The weight is judgment, equal to the model leg; it is not
--     calibrated yet.
--   * Identity-filed anchors: photos this scorer filed with vin, plate or badge > 0 become visual anchors within 24 h
--     only. A filing never anchors another day.
--   * History reaches the window's end, so cell/recent see the sets filed earlier the same day (still >= 20 min before).
--   * After a run files photos, the window's days and the day before are re-enqueued. The loop terminates: a pass that
--     files nothing enqueues nothing.
--   * Arrival: the drainer polls new unfiled relay photos since its cursor (capture_sets_arm_cursor; per relay user
--     through idx_vehicle_images_unorganized, because vehicle_images is too busy to take a trigger lock).
--     A statement trigger on image_text_reads arms the day when OCR lands. capture_sets_drain runs one due day every
--     5 minutes, 10 minutes after the last arrival or OCR read, so a shoot in progress is scored once it settles.
--   * Unchanged: the filing bar (score >= 2.5, margin >= 1), review rows below it, the Viva exclusions and
--     capture_sets_revert(run).
--   * Security: capture_sets_score and capture_sets_landing_run were EXECUTE for PUBLIC (SECURITY DEFINER). Both are
--     now service_role only.
--   * Backfill: arm the user-days of the last 30 days that hold unfiled relay photos (656 frames on 16 days at writing).
-- Revert: supabase/sql/revert_20261108140000_capture_sets_arrival_loop.sql
SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- 1. Model family from data.
CREATE OR REPLACE FUNCTION public.vehicle_model_family(p_make text, p_model text)
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE SET search_path TO 'public', 'pg_temp' AS $f$
  WITH m AS (
    SELECT CASE WHEN lower(btrim(coalesce(p_make,''))) IN ('chevrolet','chevy','gmc','gm') THEN 'gm'
                WHEN lower(btrim(coalesce(p_make,''))) IN ('dodge','ram') THEN 'dodge_ram'
                WHEN lower(btrim(coalesce(p_make,''))) LIKE 'olds%' THEN 'oldsmobile'
                ELSE regexp_replace(lower(coalesce(p_make,'')),'[^a-z0-9]','','g') END grp,
           regexp_replace(lower(coalesce(p_model,'')),'[^a-z0-9]','','g') full_,
           regexp_replace(lower(split_part(btrim(coalesce(p_model,'')),' ',1)),'[^a-z0-9]','','g') first_)
  SELECT a.family FROM m JOIN vehicle_model_aliases a
    ON a.alias_norm IN (m.full_, m.first_) AND (m.grp = '' OR a.make_grp = m.grp)
  ORDER BY (a.alias_norm = m.full_) DESC, length(a.alias_norm) DESC LIMIT 1
$f$;

-- 2. Arm a user-day for rescoring (debounced by requested_at; the drainer waits 10 minutes after the last arm).
CREATE OR REPLACE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
  INSERT INTO capture_set_rescore_queue AS q (user_id, day, requested_at, not_before, reasons)
  VALUES (p_user, p_day, now(), current_date, jsonb_build_array(p_reason))
  ON CONFLICT (user_id, day) DO UPDATE
    SET requested_at = now(), not_before = least(q.not_before, current_date), done_at = NULL, done_run_id = NULL,
        reasons = (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT x FROM jsonb_array_elements(q.reasons || jsonb_build_array(p_reason)) x
                   OFFSET greatest(0, jsonb_array_length(q.reasons) + 1 - 20)) t)
$f$;

-- 3. Arrival: a cursor for the photo poll, and a trigger for OCR reads.
CREATE TABLE IF NOT EXISTS public.capture_sets_arm_cursor (
  id        boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_scan timestamptz NOT NULL
);
ALTER TABLE public.capture_sets_arm_cursor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capture_sets_arm_cursor FROM PUBLIC, anon, authenticated;
INSERT INTO public.capture_sets_arm_cursor (id, last_scan) VALUES (true, now()) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.capture_sets_arm_new_photos()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v_from timestamptz; v_to timestamptz := now(); n integer := 0; r record;
BEGIN
  SELECT last_scan INTO v_from FROM capture_sets_arm_cursor WHERE id FOR UPDATE;
  FOR r IN SELECT u.user_id, (vi.taken_at AT TIME ZONE 'America/Los_Angeles')::date d, count(*) c
           FROM (SELECT DISTINCT user_id FROM capture_upload_status WHERE user_id IS NOT NULL) u
           JOIN LATERAL (SELECT taken_at FROM vehicle_images v
                         WHERE v.user_id = u.user_id AND v.vehicle_id IS NULL AND v.created_at > v_from AND v.created_at <= v_to
                           AND v.source = 'capture_relay_ios' AND v.taken_at IS NOT NULL) vi ON true
           GROUP BY 1, 2 LOOP
    PERFORM capture_sets_enqueue(r.user_id, r.d, jsonb_build_object('arrival', r.c));
    n := n + 1;
  END LOOP;
  UPDATE capture_sets_arm_cursor SET last_scan = v_to WHERE id;
  RETURN n;
END $f$;

CREATE OR REPLACE FUNCTION public.capture_sets_arm_on_text_read()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  PERFORM capture_sets_enqueue(n.user_id, n.d, jsonb_build_object('text_read', n.c))
  FROM (SELECT vi.user_id, (vi.taken_at AT TIME ZONE 'America/Los_Angeles')::date d, count(*) c
        FROM new_rows r JOIN vehicle_images vi ON vi.id = r.image_id
        WHERE vi.source = 'capture_relay_ios' AND vi.vehicle_id IS NULL AND vi.taken_at IS NOT NULL AND vi.user_id IS NOT NULL
        GROUP BY 1, 2) n;
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS capture_sets_arm_on_text_read ON public.image_text_reads;
CREATE TRIGGER capture_sets_arm_on_text_read AFTER INSERT ON public.image_text_reads
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.capture_sets_arm_on_text_read();

-- 4. The scorer (live body of 2026-11-04 plus the changes in the header).
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
           or (a.source = 'capture_relay_ios'
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
end $function$;

-- 5. The landing run (live body of 2026-11-04 plus the re-enqueue after a filing).
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
    -- A filing is new evidence for the sets around it: rescore the window's days and their neighbours. Terminates:
    -- each pass files only photos that were unfiled, so a pass that files nothing enqueues nothing.
    if coalesce((res->>'photos_filed')::int, 0) > 0 then
      perform capture_sets_enqueue(p_user, d::date, jsonb_build_object('after_run', p_run))
      from generate_series(((p_from at time zone 'America/Los_Angeles')::date - 1)::timestamp,
                           ((p_to at time zone 'America/Los_Angeles')::date)::timestamp, interval '1 day') d;
    end if;
  end if;
  return jsonb_build_object('run_id', p_run, 'dry', p_dry, 'sets_scored', (select count(distinct set_key) from _cs),
    'would_file_photos', would_file, 'clear_sets', jsonb_array_length(items), 'review_sets', nrev, 'held_photos', held,
    'claims_vin_0_97', nclaim_vin, 'claims_plate_0_97', nclaim_plate, 'claims_suggestion_le_0_84', nclaim_sugg, 'candidates', rc, 'apply', res, 'items', items);
end $function$;

-- 6. Drainer: one due user-day per call, oldest arm first, settled 10 minutes. A day re-armed during its own run
--    (a filing, a new photo) stays due and runs again: that is the fixed point.
CREATE OR REPLACE FUNCTION public.capture_sets_drain(p_max integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE q record; v_run uuid; v_res jsonb; v_out jsonb := '[]'; v_armed integer;
BEGIN
  v_armed := capture_sets_arm_new_photos();
  FOR q IN SELECT * FROM capture_set_rescore_queue
           WHERE done_at IS NULL AND not_before <= current_date AND requested_at < now() - interval '10 minutes'
           ORDER BY requested_at LIMIT greatest(1, least(p_max, 5)) FOR UPDATE SKIP LOCKED LOOP
    v_run := gen_random_uuid();
    BEGIN
      v_res := capture_sets_landing_run(q.user_id, (q.day::timestamp AT TIME ZONE 'America/Los_Angeles'),
                                        ((q.day + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'), v_run, false);
      UPDATE capture_set_rescore_queue SET done_run_id = v_run, done_at = now()
       WHERE user_id = q.user_id AND day = q.day AND requested_at = q.requested_at;
      v_out := v_out || jsonb_build_object('day', q.day, 'run_id', v_run, 'sets', v_res->'sets_scored',
                 'filed', v_res#>'{apply,photos_filed}', 'review_sets', v_res->'review_sets');
    EXCEPTION WHEN OTHERS THEN
      UPDATE capture_set_rescore_queue SET not_before = current_date + 1,
             reasons = reasons || jsonb_build_array(jsonb_build_object('error', left(SQLERRM, 200), 'at', now()))
       WHERE user_id = q.user_id AND day = q.day;
      v_out := v_out || jsonb_build_object('day', q.day, 'error', left(SQLERRM, 200));
    END;
  END LOOP;
  RETURN jsonb_build_object('armed_days', v_armed, 'runs', v_out);
END $f$;

-- 7. Grants: writers and the scorer are service-side only.
REVOKE ALL ON FUNCTION public.capture_sets_score(uuid, timestamptz, timestamptz, text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_sets_landing_run(uuid, timestamptz, timestamptz, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_sets_enqueue(uuid, date, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_sets_drain(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_sets_arm_new_photos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_sets_arm_on_text_read() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_sets_score(uuid, timestamptz, timestamptz, text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_sets_landing_run(uuid, timestamptz, timestamptz, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_sets_enqueue(uuid, date, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_sets_drain(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_model_family(text, text) TO service_role, authenticated, anon;

-- 8. Schedule (every 5 minutes, one day per call; a full shoot day scores in about 66 s).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'capture-sets-drain';
SELECT cron.schedule('capture-sets-drain', '*/5 * * * *',
  $c$SET statement_timeout = '290s'; SELECT public.capture_sets_drain(1);$c$);

-- 9. Backfill: arm the last 30 days that hold unfiled relay photos.
SELECT public.capture_sets_enqueue(user_id, d, jsonb_build_object('backfill', '20261108140000'))
FROM (SELECT DISTINCT user_id, (taken_at AT TIME ZONE 'America/Los_Angeles')::date d FROM vehicle_images
      WHERE source = 'capture_relay_ios' AND vehicle_id IS NULL AND user_id IS NOT NULL
        AND taken_at > now() - interval '30 days') x;
UPDATE capture_set_rescore_queue SET requested_at = now() - interval '11 minutes'
 WHERE done_at IS NULL AND reasons @> '[{"backfill": "20261108140000"}]';
