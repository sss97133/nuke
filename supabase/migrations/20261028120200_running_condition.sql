-- running condition: typed, cited from title or (non-generated) listing description. No citation => no row => unknown.
-- Additive. Revert: conf7/revert_running_condition.sql
do $$ begin
  create type public.running_condition_t as enum ('running','project','non_running','parts_car','unknown');
exception when duplicate_object then null; end $$;

create table if not exists public.vehicle_running_condition (
  vehicle_id uuid not null references public.vehicles(id),
  run_id text not null,
  running_condition public.running_condition_t not null check (running_condition <> 'unknown'),
  cited_phrase text not null,
  source_field text not null,
  source_url text,
  set_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (vehicle_id, run_id)
);
create unique index if not exists vehicle_running_condition_active_uq on public.vehicle_running_condition(vehicle_id) where retired_at is null;
alter table public.vehicle_running_condition enable row level security;
comment on table public.vehicle_running_condition is 'Cited running condition. Absent row = unknown; never inferred without a cited phrase.';

create or replace function public.running_condition_of(p_vehicle_id uuid) returns public.running_condition_t
language sql stable as $f$
  select coalesce((select rc.running_condition from public.vehicle_running_condition rc where rc.vehicle_id = p_vehicle_id and rc.retired_at is null), 'unknown'::public.running_condition_t)
$f$;

create or replace function public.running_condition_match(t text, p_title boolean) returns text[]
language sql immutable as $f$
  select case when p_title then (case
      when t ~* '\y(parts car|parts vehicle|for parts|parts only|parts or restoration|parts/restoration)\y' then 'parts_car'
      when t ~* '\y(non-?running|not running|not currently running|non-?runner|non-?operational|inoperable|(does not|doesn''t|won''t|will not|did not|does not currently) (run|start|turn over)|engine (is )?seized|seized engine|no-?start)\y' then 'non_running'
      when t ~* '\yproject\y' then 'project'
      when t ~* '\y(project car|project vehicle|sold as a project|offered as a project|as a project|barn find|basket case|unfinished (restoration|project)|needs (a )?(full |complete )?restoration|restoration candidate|disassembled)\y' then 'project'
      when t ~* '\y(runs and drives|running and driving|runs & drives|starts and runs|starts, runs,? and drives|runs well|drives well|runs great|drives great|currently running and driving)\y' then 'running'
      end) else (case
      when t ~* '\y(sold for parts|for parts only|parts only|as a parts car|offered as a parts|parts vehicle)\y' then 'parts_car'
      when t ~* '\y(non-?running|not running|not currently running|non-?runner|non-?operational|(vehicle|car|truck|it) is inoperable|sold as inoperable|(does not|doesn''t|won''t|will not|did not|does not currently) (run|start|turn over)|engine (is )?seized|seized engine)\y' then 'non_running'
      when t ~* '\y(project car|project vehicle|sold as a project|offered as a project|as a project|barn find|basket case|unfinished (restoration|project)|needs (a )?(full |complete )?restoration|restoration candidate|(partially|currently|remains) disassembled)\y' then 'project'
      when t ~* '\y(runs and drives|running and driving|runs & drives|starts and runs|starts, runs,? and drives|runs well|drives well|runs great|drives great|currently running and driving)\y' then 'running'
      end) end
  || array[case when p_title then (case
      when t ~* '\y(parts car|parts vehicle|for parts|parts only|parts or restoration|parts/restoration)\y' then substring(t from '(?i)('||'\y(parts car|parts vehicle|for parts|parts only|parts or restoration|parts/restoration)\y'||')')
      when t ~* '\y(non-?running|not running|not currently running|non-?runner|non-?operational|inoperable|(does not|doesn''t|won''t|will not|did not|does not currently) (run|start|turn over)|engine (is )?seized|seized engine|no-?start)\y' then substring(t from '(?i)('||'\y(non-?running|not running|not currently running|non-?runner|non-?operational|inoperable|(does not|doesn''t|won''t|will not|did not|does not currently) (run|start|turn over)|engine (is )?seized|seized engine|no-?start)\y'||')')
      when t ~* '\yproject\y' then substring(t from '(?i)('||'\yproject\y'||')')
      when t ~* '\y(project car|project vehicle|sold as a project|offered as a project|as a project|barn find|basket case|unfinished (restoration|project)|needs (a )?(full |complete )?restoration|restoration candidate|disassembled)\y' then substring(t from '(?i)('||'\y(project car|project vehicle|sold as a project|offered as a project|as a project|barn find|basket case|unfinished (restoration|project)|needs (a )?(full |complete )?restoration|restoration candidate|disassembled)\y'||')')
      when t ~* '\y(runs and drives|running and driving|runs & drives|starts and runs|starts, runs,? and drives|runs well|drives well|runs great|drives great|currently running and driving)\y' then substring(t from '(?i)('||'\y(runs and drives|running and driving|runs & drives|starts and runs|starts, runs,? and drives|runs well|drives well|runs great|drives great|currently running and driving)\y'||')')
      end) else (case
      when t ~* '\y(sold for parts|for parts only|parts only|as a parts car|offered as a parts|parts vehicle)\y' then substring(t from '(?i)('||'\y(sold for parts|for parts only|parts only|as a parts car|offered as a parts|parts vehicle)\y'||')')
      when t ~* '\y(non-?running|not running|not currently running|non-?runner|non-?operational|(vehicle|car|truck|it) is inoperable|sold as inoperable|(does not|doesn''t|won''t|will not|did not|does not currently) (run|start|turn over)|engine (is )?seized|seized engine)\y' then substring(t from '(?i)('||'\y(non-?running|not running|not currently running|non-?runner|non-?operational|(vehicle|car|truck|it) is inoperable|sold as inoperable|(does not|doesn''t|won''t|will not|did not|does not currently) (run|start|turn over)|engine (is )?seized|seized engine)\y'||')')
      when t ~* '\y(project car|project vehicle|sold as a project|offered as a project|as a project|barn find|basket case|unfinished (restoration|project)|needs (a )?(full |complete )?restoration|restoration candidate|(partially|currently|remains) disassembled)\y' then substring(t from '(?i)('||'\y(project car|project vehicle|sold as a project|offered as a project|as a project|barn find|basket case|unfinished (restoration|project)|needs (a )?(full |complete )?restoration|restoration candidate|(partially|currently|remains) disassembled)\y'||')')
      when t ~* '\y(runs and drives|running and driving|runs & drives|starts and runs|starts, runs,? and drives|runs well|drives well|runs great|drives great|currently running and driving)\y' then substring(t from '(?i)('||'\y(runs and drives|running and driving|runs & drives|starts and runs|starts, runs,? and drives|runs well|drives well|runs great|drives great|currently running and driving)\y'||')')
      end) end]
$f$;

create or replace function public.stage_vehicle_running_condition(p_run_id text, p_lo uuid, p_hi uuid) returns integer
language plpgsql as $f$
declare n int;
begin
  insert into public.vehicle_running_condition(vehicle_id, run_id, running_condition, cited_phrase, source_field, source_url)
  select v.id, p_run_id, m.c::public.running_condition_t, m.ph, m.f, v.listing_url
  from public.vehicles v
  cross join lateral (
    select x[1] c, x[2] ph, f from (
      select public.running_condition_match(coalesce(v.listing_title, v.bat_listing_title, v.title), true) x,
             case when v.listing_title is not null then 'vehicles.listing_title' when v.bat_listing_title is not null then 'vehicles.bat_listing_title' else 'vehicles.title' end f, 1 o
      union all
      select public.running_condition_match(left(v.description, 20000), false), 'vehicles.description', 2
      where v.description_generated_at is null
    ) z where x[1] is not null and x[2] is not null
    order by o limit 1
  ) m
  where v.id >= p_lo and v.id < p_hi
    and not exists (select 1 from public.vehicle_running_condition o where o.vehicle_id = v.id and o.retired_at is null)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $f$;
