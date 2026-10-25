-- BaT-prose running_condition patterns (hand-reviewed: 64/64 true on all hits, see PR). New cited tags only, run id running_condition_v3_batprose_20261025.
-- Revert: supabase/rollbacks/20261028121300_running_condition_bat_prose_rollback.sql
create or replace function public.running_condition_match_bat_prose(t text) returns text[]
language sql immutable parallel safe as $f$
  select case
    when t ~* '\y(said to|reportedly|reported to) (run|runs|start|starts) and (drive|drives|run|runs)\y' then array['running', substring(t from '(?i)('||'\y(said to|reportedly|reported to) (run|runs|start|starts) and (drive|drives|run|runs)\y'||')')]
    when t ~* '\y(said to|reportedly|reported to) (run|runs|drive|drives) (well|nicely|smoothly|properly)\y' then array['running', substring(t from '(?i)('||'\y(said to|reportedly|reported to) (run|runs|drive|drives) (well|nicely|smoothly|properly)\y'||')')]
    when t ~* '\y(engine|car|truck|vehicle) (runs|starts) and (drives|idles)\y' then array['running', substring(t from '(?i)('||'\y(engine|car|truck|vehicle) (runs|starts) and (drives|idles)\y'||')')]
    when t ~* '\ynot in running condition\y' then array['non_running', substring(t from '(?i)('||'\ynot in running condition\y'||')')]
  end
$f$;

create or replace function public.stage_running_condition_bat_prose(p_run_id text, p_lo uuid, p_hi uuid)
returns integer language plpgsql as $f$
declare n int;
begin
  insert into public.vehicle_running_condition(vehicle_id, run_id, running_condition, cited_phrase, source_field, source_url)
  select d.vehicle_id, p_run_id, m.x[1]::public.running_condition_t, m.x[2], 'vehicle_listing_description.description', d.source_url
  from public.vehicle_listing_description d
  cross join lateral (select public.running_condition_match_bat_prose(left(d.description, 20000)) x) m
  where d.retired_at is null and d.vehicle_id >= p_lo and d.vehicle_id < p_hi
    and m.x[1] is not null and m.x[2] is not null
    and not exists (select 1 from public.vehicle_running_condition o where o.vehicle_id = d.vehicle_id and o.retired_at is null)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $f$;
