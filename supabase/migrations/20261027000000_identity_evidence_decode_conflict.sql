-- Evidence vs stored vPIC decode conflicts: view public.vehicle_evidence_decode_conflict (future overlap surfaces automatically),
-- public.flag_evidence_decode_conflicts(run_id) flags (conflict=true + citation appended), prior values kept in identity_decode_conflict_flag_log.
-- First run identity_decode_conflict_flag_v1_20261025 flagged 35 rows on 2026-10-25. Revert: supabase/sql/revert_identity_decode_conflict_flag_v1.sql
-- Evidence-vs-VIN-decode conflicts: surface (view) and flag (log-backed, reversible). Additive only.
-- uses existing public.vin_check_digit_ok(p text)
create or replace function public.vin_body_class_category(b text) returns text language sql immutable as $f$
 select case
  when b is null then null
  when b ~* 'three wheeled|autocycle' then null  -- autocycles failed held-out check as motorcycle (96/108)
  when b ~* '^motorcycle -' or b ~* '^off-road vehicle - (dirt bike|motocross|enduro)' then 'motorcycle'
  when b ~* '^off-road vehicle - (all.terrain|multipurpose)|low speed vehicle' then 'cart_utility'
  when b = 'Trailer' then 'trailer_rv'
  when b in ('Coupe','Convertible/Cabriolet','Sedan/Saloon','Hatchback/Liftback/Notchback','Roadster','Wagon','Limousine') then 'car'
  when b in ('Pickup','Sport Utility Vehicle [SUV]/Multipurpose Vehicle [MPV]','Crossover Utility Vehicle [CUV]','Sport Utility Truck [SUT]','Van','Cargo Van','Minivan','Truck','Truck-Tractor','Step Van/Walk-in Van')
    or b ~ '^Incomplete - (Chassis Cab|Cutaway|Commercial Chassis)' then 'truck_utility'
  else null end $f$;

create or replace function public.vin_make_norm(m text) returns text language sql immutable as $f$
 select case x when 'chevy' then 'chevrolet' when 'vw' then 'volkswagen' when 'mercedes' then 'mercedesbenz'
   when 'harley' then 'harleydavidson' when 'alfa' then 'alfaromeo' else x end
 from (select regexp_replace(lower(coalesce(m,'')),'[^a-z]','','g') x) s $f$;

create or replace view public.vehicle_evidence_decode_conflict as
with d as materialized (
  select d.*, public.vin_body_class_category(d.body_class) cat from public.vin_vpic_decode d
  where public.vin_body_class_category(d.body_class) is not null and public.vin_check_digit_ok(d.vin)),
dv as materialized (
  select d.*, v.id vid, v.year vyear, v.make vmake, v.model vmodel from d join public.vehicles v on v.vin=d.vin
  where left(public.vin_make_norm(d.make),5)<>'' and left(public.vin_make_norm(d.make),5)=left(public.vin_make_norm(v.make),5)
    and (d.model_year is null or v.year is null or abs(d.model_year-v.year)<=1))
select e.id evidence_id, e.vehicle_id, e.run_id evidence_run_id, e.category evidence_category,
       dv.cat decode_category, dv.body_class, dv.vin, dv.run_id decode_run_id, dv.source||dv.vin decode_url,
       dv.model_year, dv.make decode_make, dv.model decode_model, dv.vyear vehicle_year, dv.vmake vehicle_make, dv.vmodel vehicle_model,
       'vin_vpic_decode:'||dv.run_id||':'||dv.vin||' body_class='||dv.body_class||' -> '||dv.cat decode_citation
from dv join public.vehicle_identity_evidence e on e.vehicle_id=dv.vid
where e.retired_at is null and e.category<>dv.cat;
comment on view public.vehicle_evidence_decode_conflict is 'Active identity evidence whose category the stored vPIC VIN decode contradicts (valid check digit, make and year guard). Read-only; covers future overlap automatically.';

create table if not exists public.identity_decode_conflict_flag_log(
  evidence_id bigint not null, run_id text not null, prev_conflict boolean, prev_conflict_with text, citation text not null,
  flagged_at timestamptz not null default now(), primary key (evidence_id, run_id));

create or replace function public.flag_evidence_decode_conflicts(p_run_id text) returns integer language plpgsql as $f$
declare n int;
begin
  with c as (select distinct on (evidence_id) * from public.vehicle_evidence_decode_conflict
             where evidence_id not in (select evidence_id from public.identity_decode_conflict_flag_log)),
  lg as (insert into public.identity_decode_conflict_flag_log(evidence_id,run_id,prev_conflict,prev_conflict_with,citation)
         select c.evidence_id,p_run_id,e.conflict,e.conflict_with,c.decode_citation from c join public.vehicle_identity_evidence e on e.id=c.evidence_id
         returning evidence_id,citation)
  update public.vehicle_identity_evidence e set conflict=true,
    conflict_with=concat_ws('; ', nullif(e.conflict_with,''), lg.citation)
  from lg where e.id=lg.evidence_id;
  get diagnostics n = row_count; return n;
end $f$;
