-- Cited allowance: 7 and 9 cylinders (5 is already valid) only when the engine is cited as a radial.
create table if not exists public.engine_cyl_allowance (
  cyl smallint primary key, requires_pattern text not null, source_url text not null check (source_url ~ '^https?://'),
  verified_phrase text not null, created_run text not null, created_at timestamptz not null default now(), retired_at timestamptz);
alter table public.engine_cyl_allowance enable row level security;
alter table public.vehicle_body_engine_flag add column if not exists retired_by_run text;

create or replace function public.valid_engine_cyl(n int, cited text) returns boolean language sql immutable as
$$ select n is null or n in (1,2,3,4,5,6,8,10,12,16) or (n in (7,9) and coalesce(cited,'') ~* '\yradial\y') $$;
alter table public.vehicle_body_engine drop constraint if exists vehicle_body_engine_engine_cyl_valid;
alter table public.vehicle_body_engine add constraint vehicle_body_engine_engine_cyl_valid check (public.valid_engine_cyl(engine_cyl, engine_cited)) not valid;

-- parser: strict as before; a 7 or 9 is returned only when the same text says radial
create or replace function public.engine_cyl_from_text(t text, p_strict boolean) returns smallint language sql immutable as $function$
  select x::smallint from (select coalesce(
    nullif(substring(t from '(?i)\yv-?(1[026]|[2-68])\y'),''),
    case when not p_strict then nullif(substring(t from '(?i)\y[iwh]-?(1[026]|[1-68])\y'),'') end,
    nullif(substring(t from '(?i)\y(?:inline|straight|flat|boxer)[- ]?(1[026]|[1-68])\y'),''),
    nullif(substring(t from '(?i)\y(1[026]|[1-68])[- ]?cyl'),''),
    case when t ~* '\yradial\y' then nullif(substring(t from '(?i)\y([579])[- ]?cyl'),'') end,
    case lower(substring(t from '(?i)\y(?:inline|straight|flat|v|w|opposed)[- ](one|single|two|twin|three|four|five|six|eight|ten|twelve|sixteen)\y'))
      when 'one' then '1' when 'single' then '1' when 'two' then '2' when 'twin' then '2' when 'three' then '3' when 'four' then '4' when 'five' then '5'
      when 'six' then '6' when 'eight' then '8' when 'ten' then '10' when 'twelve' then '12' when 'sixteen' then '16' end) x) s
  where public.valid_engine_cyl(x::int, t)
$function$;
