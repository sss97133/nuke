create table if not exists public.backup_agg_held_yearflag_v1_20261024 (vehicle_id uuid primary key, old_flags jsonb, old_year integer, run_id text not null, flagged_at timestamptz default now());
alter table public.backup_agg_held_yearflag_v1_20261024 enable row level security;
with f(vid, yr, why) as (values
 ('f1175673-2c06-40ec-88ef-7315b5f463bb'::uuid, 1961, 'house page https://www.goodingco.com/lot/1961-porsche-356-b-super-coupe-3 (on this vehicle) says 1961; vehicle says 1960; held conceptcarz event 79a80b7a-af05-4ed9-8b8f-bd458e17b51c title says 1961'),
 ('d2cd2b44-d116-4d4d-8d31-9ab16ab743fb'::uuid, 2014, 'VIN ZHWUC1ZD4ELA02242 year code E = 2014; vehicle says 2013; held conceptcarz event 1100fb72-81bd-40bb-847b-99e9dd2057db title says 2014')),
b as (insert into public.backup_agg_held_yearflag_v1_20261024 (vehicle_id, old_flags, old_year, run_id)
  select v.id, v.data_quality_flags, v.year, 'agg_held_yearflag_v1_20261024' from public.vehicles v join f on f.vid=v.id on conflict do nothing returning vehicle_id)
update public.vehicles v set data_quality_flags = coalesce(v.data_quality_flags,'{}'::jsonb) || jsonb_build_object('year_suspect', jsonb_build_object(
  'recorded_year', v.year, 'evidence_year', f.yr, 'reason', f.why, 'run_id', 'agg_held_yearflag_v1_20261024', 'flagged_at', now()))
from f join b on b.vehicle_id=f.vid where v.id=f.vid;
