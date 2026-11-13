-- Profile data-quality scorecard v1 (additive; new objects only).
-- Per vehicle x key field: filled?, evidence count, conflicts, confidence, status; per-vehicle score; fleet rollup views.
-- Nothing here writes to vehicles/field_evidence/vehicle_images. Tables are RLS-on, no anon/authenticated grants.

create table if not exists public.profile_quality_rules (
  rule_key text primary key, num numeric, txt text, note text, updated_at timestamptz default now());
alter table public.profile_quality_rules enable row level security;
revoke all on public.profile_quality_rules from public, anon, authenticated;
insert into public.profile_quality_rules(rule_key,num,note) values
 ('cond_min_photos',10,'condition_rating needs >= N gallery-eligible photos with condition_score'),
 ('cond_min_zones',5,'... spread across >= N distinct vehicle_zone values'),
 ('flaw_min_photos',3,'a known_flaws zone line needs >= N gallery-eligible photos in that zone carrying one of its flags'),
 ('gallery_ok_photos',8,'gallery-visible photos for a full gallery_photos score'),
 ('timeline_ok_events',3,'meaningful timeline events for a full timeline score'),
 ('review_cluster_min',8,'auto-resolve: min decided same-vehicle same-day sibling photos'),
 ('review_cluster_share',0.97,'auto-resolve: min share of decided siblings that are approved')
on conflict (rule_key) do nothing;

create table if not exists public.vehicle_profile_quality_run (
  run_id uuid primary key default gen_random_uuid(),
  label text, kind text not null default 'manual', owner_id uuid,
  started_at timestamptz not null default now(), finished_at timestamptz,
  n_vehicles int, fleet_score numeric, pct_filled numeric, pct_filled_with_evidence numeric,
  conflicts int, junk int, review_needed_photos int, gallery_photos int,
  summary jsonb, keep boolean not null default false);
create table if not exists public.vehicle_profile_quality_vehicle (
  run_id uuid not null references public.vehicle_profile_quality_run(run_id) on delete cascade,
  vehicle_id uuid not null, owner_id uuid, origin_org_id uuid, label text, vehicle_updated_at timestamptz,
  score numeric, fields_total int, fields_filled int, fields_evidenced int, conflicts int, junk int,
  gallery_photos int, review_needed_photos int, review_held_people int, weakest jsonb,
  primary key (run_id, vehicle_id));
create table if not exists public.vehicle_profile_quality_field (
  run_id uuid not null references public.vehicle_profile_quality_run(run_id) on delete cascade,
  vehicle_id uuid not null, field_key text not null, weight numeric, filled boolean, value text,
  status text, evidence_count int, evidence_sources text[], conflict_count int, confidence numeric,
  field_score numeric, issue text,
  primary key (run_id, vehicle_id, field_key));
create index if not exists vpq_field_status_idx on public.vehicle_profile_quality_field(run_id, field_key, status);
create index if not exists vpq_run_started_idx on public.vehicle_profile_quality_run(kind, started_at desc);
alter table public.vehicle_profile_quality_run enable row level security;
alter table public.vehicle_profile_quality_vehicle enable row level security;
alter table public.vehicle_profile_quality_field enable row level security;
revoke all on public.vehicle_profile_quality_run, public.vehicle_profile_quality_vehicle, public.vehicle_profile_quality_field from public, anon, authenticated;

create or replace function public._pq_conflict(p_field text, a text, b text) returns boolean
language plpgsql immutable as $f$
declare na text; nb text; da numeric; db numeric; ca numeric; cb numeric; sa text; sb text;
begin
  sa := a; sb := b;
  IF p_field IN ('color','interior_color') THEN sa := replace(lower(coalesce(a,'')),'gray','grey'); sb := replace(lower(coalesce(b,'')),'gray','grey'); END IF;
  na := public._pf_norm(sa); nb := public._pf_norm(sb);
  IF na = '' OR nb = '' OR na = nb THEN RETURN false; END IF;
  IF p_field IN ('mileage','price') THEN
    sa := regexp_replace(a,'[^0-9.]','','g'); sb := regexp_replace(b,'[^0-9.]','','g');
    IF sa ~ '^[0-9]+(\.[0-9]+)?$' AND sb ~ '^[0-9]+(\.[0-9]+)?$' THEN
      da := sa::numeric; db := sb::numeric;
      RETURN abs(da-db)/greatest(da,db,1) > 0.02;
    END IF;
    RETURN false;
  END IF;
  IF p_field = 'engine' THEN
    ca := public.engine_displacement_ci(a); cb := public.engine_displacement_ci(b);
    IF ca IS NOT NULL AND cb IS NOT NULL AND ca > 0 THEN RETURN abs(ca-cb)/ca > 0.03; END IF;
  END IF;
  IF position(na in nb) > 0 OR position(nb in na) > 0 THEN RETURN false; END IF;
  RETURN true;
end $f$;

create or replace function public._pq_condition_support(p_vehicle uuid)
returns table(scored int, zones int, ok boolean)
language sql stable as $f$
  select s.scored, s.zones,
         (s.scored >= (select num from public.profile_quality_rules where rule_key='cond_min_photos')
          and s.zones >= (select num from public.profile_quality_rules where rule_key='cond_min_zones'))
  from (select count(*)::int scored, count(distinct vi.vehicle_zone)::int zones
        from public.vehicle_images vi
        where vi.vehicle_id = p_vehicle and vi.is_duplicate is not true
          and public.vehicle_image_gallery_eligible(vi) and vi.condition_score is not null) s
$f$;

create or replace function public._pq_flaw_lines(p_vehicle uuid)
returns table(line_no int, line text, zone text, flags text[], support int, boilerplate boolean, synthesized boolean, supported boolean)
language plpgsql stable as $f$
declare kf text; mn int;
begin
  select known_flaws into kf from public.vehicles where id = p_vehicle;
  if kf is null or btrim(kf) = '' then return; end if;
  select num::int into mn from public.profile_quality_rules where rule_key='flaw_min_photos';
  return query
  with l as (select s.ord::int ln, btrim(s.t) line from regexp_split_to_table(kf, E'\n') with ordinality s(t,ord) where btrim(s.t) <> ''),
  p as (select l.ln, l.line,
          case when l.line ~ '^[A-Za-z0-9 ]{2,40}: [A-Za-z0-9 ,''/&-]+$' then regexp_replace(lower(split_part(l.line,': ',1)),' ','_','g') end z,
          case when l.line ~ '^[A-Za-z0-9 ]{2,40}: [A-Za-z0-9 ,''/&-]+$'
               then array(select regexp_replace(lower(btrim(x)),'[^a-z0-9]+','_','g') from unnest(string_to_array(substr(l.line, position(': ' in l.line)+2), ',')) x) end fl
        from l)
  select p.ln, p.line, p.z, p.fl,
    case when p.z is null then null else (select count(distinct vi.id)::int from public.vehicle_images vi
       where vi.vehicle_id = p_vehicle and vi.is_duplicate is not true and public.vehicle_image_gallery_eligible(vi)
         and vi.vehicle_zone = p.z
         and exists (select 1 from unnest(vi.damage_flags) f where regexp_replace(lower(f),'[^a-z0-9]+','_','g') = any(p.fl))) end,
    (p.fl is not null and p.fl <@ array['paint_fade','rust'] and p.fl @> array['paint_fade','rust']),
    (p.z is not null),
    case when p.z is null then null
         else (p.z <> 'other'
               and not (p.fl <@ array['paint_fade','rust'] and p.fl @> array['paint_fade','rust'])
               and (select count(distinct vi.id) from public.vehicle_images vi
                    where vi.vehicle_id = p_vehicle and vi.is_duplicate is not true and public.vehicle_image_gallery_eligible(vi)
                      and vi.vehicle_zone = p.z
                      and exists (select 1 from unnest(vi.damage_flags) f where regexp_replace(lower(f),'[^a-z0-9]+','_','g') = any(p.fl))) >= mn) end
  from p;
end $f$;

create or replace function public.profile_quality_snapshot_v1(
  p_owner uuid default '0b9f107a-d124-49de-9ded-94698f63c1c4',
  p_vehicle uuid default null, p_label text default null, p_kind text default 'manual', p_keep boolean default false)
returns uuid
language plpgsql
set search_path to 'public','pg_temp'
as $f$
declare v_run uuid := gen_random_uuid(); v_n int;
begin
  drop table if exists _pq_v, _pq_img, _pq_ev, _pq_evagg, _pq_evgrp, _pq_base;
  insert into vehicle_profile_quality_run(run_id,label,kind,owner_id,keep) values (v_run,p_label,p_kind,p_owner,p_keep);

  create temp table _pq_v on commit drop as
  select v.*, 
    coalesce(nullif(v.bat_auction_url,''), nullif(v.listing_url,''), nullif(v.discovery_url,''), nullif(v.platform_url,'')) as cite_url
  from vehicles v
  where v.merged_into_vehicle_id is null and v.deleted_at is null
    and (p_vehicle is null or v.id = p_vehicle)
    and (p_owner is null or v.owner_id = p_owner);

  create temp table _pq_img on commit drop as
  select vi.vehicle_id,
    count(*) filter (where vi.is_duplicate is not true and vehicle_image_gallery_eligible(vi))::int gallery,
    count(*) filter (where vi.vision_gate_status = 'review_needed' and vi.is_duplicate is not true and vi.is_superseded is not true)::int rn,
    count(*) filter (where vi.vision_gate_status = 'review_needed' and vi.is_duplicate is not true and vi.is_superseded is not true
                       and vi.vision_gate_agent_reasoning like 'Held for review (apple_vision_people%')::int rn_people
  from vehicle_images vi where vi.vehicle_id in (select id from _pq_v) group by vi.vehicle_id;

  create temp table _pq_ev on commit drop as
  select vehicle_id, key, src, w, val from (
    select fe.vehicle_id,
      case fe.field_name when 'year' then 'year' when 'make' then 'make' when 'model' then 'model'
        when 'trim' then 'trim' when 'series' then 'trim' when 'vin' then 'vin'
        when 'engine_size' then 'engine' when 'engine_type' then 'engine' when 'engine_liters' then 'engine' when 'displacement' then 'engine'
        when 'transmission' then 'transmission' when 'color' then 'color' when 'interior_color' then 'interior_color'
        when 'mileage' then 'mileage' when 'mileage_claim' then 'mileage'
        when 'sale_price' then 'price_status' when 'high_bid' then 'price_status' when 'sale_status' then 'price_status' when 'auction_outcome' then 'price_status'
        when 'mechanical_condition' then 'condition_rating' when 'body_condition' then 'condition_rating' when 'interior_condition' then 'condition_rating' end key,
      'fe:'||coalesce(fe.source_type,'?') src,
      least(0.95, greatest(0.05, coalesce(fe.source_confidence,50)/100.0)) w,
      case when fe.field_name in ('sale_price','high_bid') then null else fe.proposed_value end val
    from field_evidence fe
    where fe.vehicle_id in (select id from _pq_v) and fe.status in ('accepted','pending','conflicted')
    union all
    select pe.vehicle_id,
      case pe.field_name when 'year' then 'year' when 'make' then 'make' when 'model' then 'model'
        when 'trim' then 'trim' when 'series' then 'trim' when 'vin' then 'vin'
        when 'engine_type' then 'engine' when 'displacement' then 'engine'
        when 'transmission' then 'transmission' when 'color' then 'color' when 'interior_color' then 'interior_color'
        when 'mileage' then 'mileage' end,
      'photo', least(0.8, greatest(0.05, coalesce(pe.confidence,0.5)*0.8)), pe.value
    from photo_extracted_fields pe
    where pe.vehicle_id in (select id from _pq_v) and pe.field_name not like 'core.%'
      and pe.value is not null and btrim(pe.value) not in ('','null') and coalesce(pe.confidence,0.5) >= 0.5
    union all
    select vi.vehicle_id, 'vin', 'ident:'||coalesce(vi.source_kind,'?'),
      least(0.95, greatest(0.05, case when coalesce(vi.confidence,0.7) > 1 then vi.confidence/100.0 else coalesce(vi.confidence,0.7) end)), vi.value
    from vehicle_identifiers vi
    where vi.vehicle_id in (select id from _pq_v) and vi.kind = 'vin' and vi.superseded_at is null
    union all
    select v.id, k, 'listing', 0.8, null from _pq_v v, unnest(array['year','make','model']) k where v.cite_url is not null
    union all
    select ve.vehicle_id, 'price_status', 'event:'||coalesce(ve.source_platform,'?'), 0.9, null
    from vehicle_events ve where ve.vehicle_id in (select id from _pq_v) and ve.source_url is not null
    union all
    select v.id, 'mileage', 'col:odometer_url', 0.7, null from _pq_v v where v.odometer_source_url is not null
    union all
    select v.id, k.key, 'col:'||k.src, least(0.9, greatest(0.1, coalesce(k.conf,60)/100.0)), null
    from _pq_v v cross join lateral (values
      ('year', v.year_source, v.year_confidence), ('make', v.make_source, v.make_confidence), ('model', v.model_source, v.model_confidence),
      ('trim', v.trim_source, v.trim_confidence), ('vin', v.vin_source, v.vin_confidence),
      ('mileage', v.mileage_source, null::int), ('engine', v.engine_source, null::int),
      ('transmission', v.transmission_source, null::int), ('color', v.color_source, null::int)) k(key, src, conf)
    where k.src is not null and lower(btrim(k.src)) not in ('','unknown','default','inferred','none','null')
  ) e where key is not null;

  create temp table _pq_evagg on commit drop as
  select vehicle_id, key, sum(c)::int n, array_agg(src order by src) srcs, 1 - exp(sum(ln(1 - wmax))) conf
  from (select vehicle_id, key, src, count(*) c, max(w) wmax from _pq_ev group by 1,2,3) z
  group by vehicle_id, key;

  create temp table _pq_evgrp on commit drop as
  select vehicle_id, key, public._pf_norm(replace(lower(val),'gray','grey')) nv, min(val) val, count(*)::int n, max(w) wmax, bool_or(src <> 'photo') nonphoto
  from _pq_ev where val is not null and btrim(val) <> '' group by 1,2,3;

  create temp table _pq_base on commit drop as
  select v.id vehicle_id, f.key, f.weight, f.val, f.filled, f.junk, f.generic, f.thin, f.conflicts_extra, f.issue, f.extra_n, f.colv
  from _pq_v v
  left join _pq_img im on im.vehicle_id = v.id
  left join lateral (select * from public._pq_condition_support(v.id)) cs on true
  left join lateral (select count(*)::int total, count(*) filter (where synthesized and supported)::int sup,
                            count(*) filter (where synthesized and not supported)::int unsup, count(*) filter (where not synthesized)::int free,
                            count(*) filter (where boilerplate)::int boiler from public._pq_flaw_lines(v.id)) fl on true
  left join lateral (select count(*)::int n from timeline_events te where te.vehicle_id = v.id and coalesce(te.event_type,'') not in ('pending_analysis','profile_merged','profile_merge')) tl on true
  cross join lateral (values
    ('year', 1.0, v.year::text, v.year between 1885 and 2027, false, false, false, 0, null::text, 0, v.year::text),
    ('make', 1.0, v.make, nullif(btrim(v.make),'') is not null, lower(btrim(coalesce(v.make,''))) in ('none','null','unknown','n/a','other','various'), false, false, 0, null, 0, v.make),
    ('model', 1.0, v.model, nullif(btrim(v.model),'') is not null,
        lower(btrim(coalesce(v.model,''))) in ('none','null','unknown','n/a','other','various') or lower(btrim(coalesce(v.model,''))) = lower(btrim(coalesce(v.make,''))), false, false, 0, null, 0, v.model),
    ('trim', 0.5, v.trim, nullif(btrim(v.trim),'') is not null, lower(btrim(coalesce(v.trim,''))) in ('none','null','unknown','n/a','other','base?','tbd'), false, false, 0, null, 0, v.trim),
    ('vin', 1.5, v.vin, nullif(btrim(v.vin),'') is not null,
        case when v.vin is null or btrim(v.vin)='' then false
             when v.year >= 1981 then not (upper(btrim(v.vin)) ~ '^[A-HJ-NPR-Z0-9]{17}$') or upper(v.vin) ~ '(123456|000000|XXXXXX)'
             else not (upper(btrim(v.vin)) ~ '^[A-Z0-9]{5,13}$') end, false, false, 0, null, 0, v.vin),
    ('engine', 1.0, coalesce(v.engine_size, v.engine_type, v.engine_displacement, v.engine_liters::text), coalesce(nullif(btrim(v.engine_size),''), nullif(btrim(v.engine_type),''), nullif(btrim(v.engine_displacement),''), v.engine_liters::text) is not null,
        lower(btrim(coalesce(v.engine_size, v.engine_type, ''))) in ('unknown','none','null','n/a','tbd','other'), false, false, 0, null, 0, coalesce(v.engine_size, v.engine_type, v.engine_displacement, v.engine_liters::text)),
    ('transmission', 1.0, coalesce(v.transmission, v.transmission_type), coalesce(nullif(btrim(v.transmission),''), nullif(btrim(v.transmission_type),'')) is not null,
        lower(btrim(coalesce(v.transmission, v.transmission_type, ''))) in ('unknown','none','null','n/a','tbd','other'), false, false, 0, null, 0, coalesce(v.transmission, v.transmission_type)),
    ('color', 1.0, coalesce(v.color, v.color_primary), coalesce(nullif(btrim(v.color),''), nullif(btrim(v.color_primary),'')) is not null,
        lower(btrim(coalesce(v.color, v.color_primary, ''))) in ('unknown','none','null','n/a','tbd','other','various'), false, false, 0, null, 0, coalesce(v.color, v.color_primary)),
    ('interior_color', 0.5, v.interior_color, nullif(btrim(v.interior_color),'') is not null,
        lower(btrim(coalesce(v.interior_color,''))) in ('unknown','none','null','n/a','tbd','other','various'), false, false, 0, null, 0, v.interior_color),
    ('mileage', 1.5, v.mileage::text, v.mileage is not null, (v.mileage is not null and (v.mileage <= 0 or v.mileage >= 999999)), false, false, 0, null, 0, v.mileage::text),
    ('price_status', 2.0, coalesce(v.sale_status,'')||'|'||coalesce(v.sale_price::text, v.price::text, v.asking_price::text,''),
        (v.sale_status is not null or coalesce(v.sale_price, v.price, v.asking_price, v.sold_price) is not null),
        (coalesce(v.sale_price, v.price, v.asking_price) is not null and coalesce(v.sale_price, v.price, v.asking_price) <= 0), false, false,
        case when v.sale_status = 'sold' and v.sale_price is not null and v.price is not null and v.price <> v.sale_price then 1 else 0 end,
        case when v.sale_status = 'sold' and coalesce(v.sale_price, v.sold_price, v.price) is null then 'sold_without_price' end, 0,
        coalesce(v.sale_price::text, v.price::text, v.asking_price::text)),
    ('condition_rating', 1.0, v.condition_rating::text, v.condition_rating is not null, false, false,
        (v.condition_rating is not null and not coalesce(cs.ok,false)), 0,
        case when v.condition_rating is not null and not coalesce(cs.ok,false) then 'thin: '||coalesce(cs.scored,0)||' scored photos / '||coalesce(cs.zones,0)||' zones' end, coalesce(cs.scored,0), null),
    ('known_flaws', 0.5, left(v.known_flaws, 200), nullif(btrim(v.known_flaws),'') is not null, false,
        (coalesce(fl.total,0) > 0 and coalesce(fl.free,0) = 0 and coalesce(fl.sup,0) = 0), (coalesce(fl.unsup,0) > 0), 0,
        case when coalesce(fl.total,0) > 0 then fl.sup||'/'||fl.total||' lines evidence-supported; '||fl.boiler||' boilerplate; '||fl.unsup||' unsupported' end, coalesce(fl.sup,0)+coalesce(fl.free,0), null),
    ('highlights', 0.5, left(v.highlights, 200), nullif(btrim(v.highlights),'') is not null, false,
        (v.highlights ~ '^[0-9]+ photos across [0-9]+ documented zones'), false, 0,
        case when v.highlights ~ '^[0-9]+ photos across [0-9]+ documented zones' then 'template text' end, case when v.cite_url is not null then 1 else 0 end, null),
    ('image_count', 1.0, v.image_count::text, coalesce(v.image_count,0) > 0, false, false, false,
        case when coalesce(v.image_count,0) <> coalesce(im.gallery,0) then 1 else 0 end,
        case when coalesce(v.image_count,0) <> coalesce(im.gallery,0) then 'column '||coalesce(v.image_count,0)||' vs gallery '||coalesce(im.gallery,0) end, coalesce(im.gallery,0), null),
    ('gallery_photos', 1.5, coalesce(im.gallery,0)::text, coalesce(im.gallery,0) > 0, false, false,
        (coalesce(im.gallery,0) > 0 and coalesce(im.gallery,0) < (select num from profile_quality_rules where rule_key='gallery_ok_photos')), 0,
        case when coalesce(im.rn,0) > 0 then im.rn||' photos stuck in review_needed ('||coalesce(im.rn_people,0)||' people-held)' end, coalesce(im.gallery,0), null),
    ('timeline_events', 1.0, tl.n::text, tl.n > 0, false, false,
        (tl.n > 0 and tl.n < (select num from profile_quality_rules where rule_key='timeline_ok_events')), 0, null, tl.n, null)
  ) f(key, weight, val, filled, junk, generic, thin, conflicts_extra, issue, extra_n, colv)
  ;
  -- NOTE: lateral VALUES column order is key,weight,val,filled,junk,generic,thin,conflicts_extra,issue,extra_n,colv

  insert into vehicle_profile_quality_field(run_id,vehicle_id,field_key,weight,filled,value,status,evidence_count,evidence_sources,conflict_count,confidence,field_score,issue)
  select v_run, b.vehicle_id, b.key, b.weight, coalesce(b.filled,false), left(b.val,200), x.status, x.ev, x.srcs, x.conf_n, round(coalesce(x.conf,0)::numeric,2),
         round((case x.status when 'ok' then 0.7 + 0.3*coalesce(x.conf,0)
                             when 'conflicting' then 0.4 when 'unsupported' then 0.35
                             when 'thin' then case when b.key = 'gallery_photos' then least(1, x.ev::numeric / nullif((select num from profile_quality_rules where rule_key='gallery_ok_photos'),0)) * 0.7
                                                    when b.key = 'timeline_events' then 0.5 else 0.25 end
                             when 'generic' then 0.1 else 0 end)::numeric, 3), b.issue
  from _pq_base b
  left join _pq_evagg ea on ea.vehicle_id = b.vehicle_id and ea.key = b.key
  left join lateral (
    select case when b.colv is not null and btrim(b.colv) <> '' then
             (select count(*)::int from _pq_evgrp g where g.vehicle_id = b.vehicle_id and g.key = b.key
                and (g.nonphoto or g.n >= 2 or g.wmax >= 0.64) and public._pq_conflict(b.key, b.colv, g.val))
           else greatest((select count(*)::int from _pq_evgrp g where g.vehicle_id = b.vehicle_id and g.key = b.key
                and (g.nonphoto or g.n >= 2 or g.wmax >= 0.64)) - 1, 0) end cn
  ) c on true
  cross join lateral (
    select
      case
        when not coalesce(b.filled,false) then 'empty'
        when coalesce(b.junk,false) then 'junk'
        when coalesce(b.generic,false) then 'generic'
        when coalesce(c.cn,0) > 0 or b.conflicts_extra > 0 then 'conflicting'
        when b.thin then 'thin'
        when b.key in ('image_count','gallery_photos','timeline_events','condition_rating','known_flaws','highlights') and coalesce(b.extra_n,0) > 0 then 'ok'
        when coalesce(ea.n,0) = 0 then 'unsupported'
        else 'ok' end as status,
      case when b.key in ('image_count','gallery_photos','timeline_events','condition_rating','known_flaws','highlights') then coalesce(b.extra_n,0) + coalesce(ea.n,0) else coalesce(ea.n,0) end as ev,
      ea.srcs as srcs,
      coalesce(c.cn,0) + coalesce(b.conflicts_extra,0) as conf_n,
      case when b.key in ('image_count','gallery_photos','timeline_events','condition_rating','known_flaws','highlights') then greatest(coalesce(ea.conf,0), least(0.95, 1 - exp(-0.15*coalesce(b.extra_n,0)))) else coalesce(ea.conf,0) end as conf
  ) x;

  select count(*) into v_n from _pq_v;

  insert into vehicle_profile_quality_vehicle(run_id,vehicle_id,owner_id,origin_org_id,label,vehicle_updated_at,score,fields_total,fields_filled,fields_evidenced,conflicts,junk,gallery_photos,review_needed_photos,review_held_people,weakest)
  select v_run, v.id, v.owner_id, v.origin_organization_id, concat_ws(' ', v.year::text, v.make, v.model), v.updated_at,
         round(100 * sum(f.weight*f.field_score)/nullif(sum(f.weight),0), 1),
         count(*)::int, count(*) filter (where f.filled)::int, count(*) filter (where f.filled and f.status in ('ok','conflicting'))::int,
         coalesce(sum(f.conflict_count),0)::int, count(*) filter (where f.status in ('junk','generic'))::int,
         coalesce(im.gallery,0), coalesce(im.rn,0), coalesce(im.rn_people,0),
         (select jsonb_agg(jsonb_build_object('field',w.field_key,'status',w.status,'loss',round(w.weight*(1-w.field_score),2)) )
            from (select * from vehicle_profile_quality_field f2 where f2.run_id=v_run and f2.vehicle_id=v.id and f2.field_score < 1 order by f2.weight*(1-f2.field_score) desc limit 4) w)
  from _pq_v v join vehicle_profile_quality_field f on f.run_id = v_run and f.vehicle_id = v.id
  left join _pq_img im on im.vehicle_id = v.id
  group by v.id, v.owner_id, v.origin_organization_id, v.year, v.make, v.model, v.updated_at, im.gallery, im.rn, im.rn_people;

  update vehicle_profile_quality_run r set finished_at = now(), n_vehicles = s.n, fleet_score = s.sc,
      pct_filled = s.pf, pct_filled_with_evidence = s.pe, conflicts = s.cf, junk = s.jk, review_needed_photos = s.rn, gallery_photos = s.gp,
      summary = jsonb_build_object(
        'by_field', (select jsonb_object_agg(field_key, jsonb_build_object('empty',e,'junk',j,'generic',g,'conflicting',c,'unsupported',u,'thin',t,'ok',o,'avg_score',a))
                     from (select field_key,
                            count(*) filter (where status='empty') e, count(*) filter (where status='junk') j, count(*) filter (where status='generic') g,
                            count(*) filter (where status='conflicting') c, count(*) filter (where status='unsupported') u,
                            count(*) filter (where status='thin') t, count(*) filter (where status='ok') o, round(avg(field_score),2) a
                           from vehicle_profile_quality_field where run_id = v_run group by field_key) q),
        'review_people_held', s.rp)
  from (select count(*) n, round(avg(score),1) sc,
          round(100.0*sum(fields_filled)/nullif(sum(fields_total),0),1) pf, round(100.0*sum(fields_evidenced)/nullif(sum(fields_total),0),1) pe,
          sum(conflicts) cf, sum(junk) jk, sum(review_needed_photos) rn, sum(gallery_photos) gp, sum(review_held_people) rp
        from vehicle_profile_quality_vehicle where run_id = v_run) s
  where r.run_id = v_run;

  if p_kind = 'hourly' then
    delete from vehicle_profile_quality_run where kind = 'hourly' and keep = false and started_at < now() - interval '7 days';
  end if;
  return v_run;
end $f$;

revoke all on function public.profile_quality_snapshot_v1(uuid,uuid,text,text,boolean) from public, anon, authenticated;
revoke all on function public._pq_conflict(text,text,text), public._pq_condition_support(uuid), public._pq_flaw_lines(uuid) from public, anon, authenticated;

create or replace view public.vehicle_profile_quality_latest with (security_invoker = true) as
  select r.* from public.vehicle_profile_quality_run r
  where r.finished_at is not null
    and r.run_id = (select r2.run_id from public.vehicle_profile_quality_run r2 where r2.finished_at is not null and r2.owner_id is not distinct from r.owner_id and r2.n_vehicles > 1 order by r2.started_at desc limit 1);
create or replace view public.vehicle_profile_quality_fleet_rollup with (security_invoker = true) as
  select r.run_id, r.label, r.started_at, r.owner_id, r.n_vehicles, r.fleet_score, r.pct_filled, r.pct_filled_with_evidence, r.conflicts, r.junk, r.review_needed_photos, r.gallery_photos
  from public.vehicle_profile_quality_run r where r.finished_at is not null and r.n_vehicles > 1;
create or replace view public.vehicle_profile_quality_patterns with (security_invoker = true) as
  select f.run_id, f.field_key, f.status, count(*) n_vehicles, round(avg(f.weight),2) weight, round(count(*) * avg(f.weight),1) impact
  from public.vehicle_profile_quality_field f
  where f.run_id in (select run_id from public.vehicle_profile_quality_latest) and f.status <> 'ok'
  group by 1,2,3;
revoke all on public.vehicle_profile_quality_latest, public.vehicle_profile_quality_fleet_rollup, public.vehicle_profile_quality_patterns from public, anon, authenticated;
