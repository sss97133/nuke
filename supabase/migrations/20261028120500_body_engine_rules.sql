-- body/engine schema rules: cited body-style compatibility, valid cylinder counts, cited flags. Additive; nothing overwritten or deleted.
create table if not exists public.body_style_compat (
  a public.body_style_t not null, b public.body_style_t not null, relation text not null check (relation in ('compatible')),
  source_url text not null check (source_url ~ '^https?://'), verified_phrase text not null, created_run text not null,
  created_at timestamptz not null default now(), retired_at timestamptz, primary key (a, b), check (a < b));
alter table public.body_style_compat enable row level security;

create table if not exists public.vehicle_body_engine_flag (
  run_id text not null, vehicle_id uuid not null, field text not null check (field in ('body_style','engine_cyl')),
  flag text not null check (flag in ('compatible_not_conflict','invalid_value','possible_engine_swap')),
  value text, conflict_run_id text, offered_basis text, cited text not null, source_ref text not null,
  created_at timestamptz not null default now(), retired_at timestamptz,
  primary key (run_id, vehicle_id, field, flag));
alter table public.vehicle_body_engine_flag enable row level security;

create or replace function public.valid_engine_cyl(n int) returns boolean language sql immutable as
$$ select n is null or n in (1,2,3,4,5,6,8,10,12,16) $$;
-- enforced on every new row; NOT VALID so existing rows are flagged, not rewritten
alter table public.vehicle_body_engine drop constraint if exists vehicle_body_engine_engine_cyl_valid;
alter table public.vehicle_body_engine add constraint vehicle_body_engine_engine_cyl_valid check (public.valid_engine_cyl(engine_cyl)) not valid;

-- title parser fix: model names such as Moto Guzzi V7/V11, "V-14", "V15" were read as cylinder counts. Only real counts are returned now.
create or replace function public.engine_cyl_from_text(t text, p_strict boolean) returns smallint language sql immutable as $function$
  select x::smallint from (select coalesce(
    nullif(substring(t from '(?i)\yv-?(1[026]|[2-68])\y'),''),
    case when not p_strict then nullif(substring(t from '(?i)\y[iwh]-?(1[026]|[1-68])\y'),'') end,
    nullif(substring(t from '(?i)\y(?:inline|straight|flat|boxer)[- ]?(1[026]|[1-68])\y'),''),
    nullif(substring(t from '(?i)\y(1[026]|[1-68])[- ]?cyl'),''),
    case lower(substring(t from '(?i)\y(?:inline|straight|flat|v|w|opposed)[- ](one|single|two|twin|three|four|five|six|eight|ten|twelve|sixteen)\y'))
      when 'one' then '1' when 'single' then '1' when 'two' then '2' when 'twin' then '2' when 'three' then '3' when 'four' then '4' when 'five' then '5'
      when 'six' then '6' when 'eight' then '8' when 'ten' then '10' when 'twelve' then '12' when 'sixteen' then '16' end) x) s
  where public.valid_engine_cyl(x::int)
$function$;
