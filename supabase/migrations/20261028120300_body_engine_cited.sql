-- body style + engine: typed, cited. Priority per field: VIN decode (17-char VIN, NHTSA, decode year = vehicle year, confidence >= 70)
-- > listing structured field with a recorded source (engine_type/engine_size + engine_source; body_style_quote) > cited title phrase.
-- No citation => null. Additive. Revert: conf8/revert_body_engine.sql (retire by run id).
do $$ begin
  create type public.body_style_t as enum ('coupe','convertible','roadster','targa','fastback','sedan','wagon','hatchback','pickup','suv','van','motorcycle');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.engine_config_t as enum ('inline','v','flat','w','rotary','electric');
exception when duplicate_object then null; end $$;

create table if not exists public.vehicle_body_engine (
  vehicle_id uuid not null references public.vehicles(id),
  run_id text not null,
  body_style public.body_style_t,
  body_basis text check (body_basis in ('vin_decode','listing_field','title')),
  body_cited text,
  engine_cyl smallint check (engine_cyl between 1 and 16),
  engine_config public.engine_config_t,
  engine_liters numeric(4,1) check (engine_liters > 0 and engine_liters < 15),
  engine_basis text check (engine_basis in ('vin_decode','listing_field','title')),
  engine_cited text,
  source_ref text,
  set_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (vehicle_id, run_id),
  check ((body_style is null) = (body_cited is null) and (body_style is null) = (body_basis is null)),
  check ((coalesce(engine_cyl::text, engine_config::text, engine_liters::text) is null) = (engine_cited is null) and (engine_cited is null) = (engine_basis is null))
);
create unique index if not exists vehicle_body_engine_active_uq on public.vehicle_body_engine(vehicle_id) where retired_at is null;
alter table public.vehicle_body_engine enable row level security;
comment on table public.vehicle_body_engine is 'Cited body style / engine. Each non-null value carries basis + cited text; null = no citation.';

create or replace function public.body_style_from_text(t text) returns public.body_style_t language sql immutable as $f$
  select (case
    when t ~* '\ymotorcycle' then 'motorcycle'
    when t ~* '\ytarga\y' then 'targa'
    when t ~* '\y(roadster|spyder|spider|speedster|barchetta)\y' then 'roadster'
    when t ~* '\y(convertible|cabriolet|cabrio|drophead|volante)\y' then 'convertible'
    when t ~* '\yfastback\y' then 'fastback'
    when t ~* '\y(coupe|coupé|berlinetta)\y' then 'coupe'
    when t ~* '\y(sedan|saloon|berlina)\y' then 'sedan'
    when t ~* '\y(wagon|estate|shooting brake|avant)\y' then 'wagon'
    when t ~* '\y(hatchback|liftback)\y' then 'hatchback'
    when t ~* '\y(pickup|pick-up|crew cab|regular cab|extended cab|chassis cab)\y' then 'pickup'
    when t ~* '\y(suv|sport utility)' then 'suv'
    when t ~* '\y(van|microbus|minivan)\y' then 'van'
  end)::public.body_style_t
$f$;
create or replace function public.body_style_phrase(t text) returns text language sql immutable as $f$
  select substring(t from '(?i)(\ymotorcycle[a-z -]*|\ytarga\y|\y(?:roadster|spyder|spider|speedster|barchetta)\y|\y(?:convertible|cabriolet|cabrio|drophead|volante)\y|\yfastback\y|\y(?:coupe|coupé|berlinetta)\y|\y(?:sedan|saloon|berlina)\y|\y(?:wagon|estate|shooting brake|avant)\y|\y(?:hatchback|liftback)\y|\y(?:pickup|pick-up|crew cab|regular cab|extended cab|chassis cab)\y|\y(?:suv|sport utility)[a-z ()/]*|\y(?:van|microbus|minivan)\y)')
$f$;
-- engine text -> cylinders / config / liters. p_strict (titles): only V<n>, "<n>-cylinder", and spelled inline/flat/V forms.
create or replace function public.engine_cyl_from_text(t text, p_strict boolean) returns smallint language sql immutable as $f$
  select x::smallint from (select coalesce(
    nullif(substring(t from '(?i)\yv-?(\d{1,2})\y'),''),
    case when not p_strict then nullif(substring(t from '(?i)\y[iwh]-?(\d{1,2})\y'),'') end,
    nullif(substring(t from '(?i)\y(?:inline|straight|flat|boxer)[- ]?(\d{1,2})\y'),''),
    nullif(substring(t from '(?i)\y(\d{1,2})[- ]?cyl'),''),
    case lower(substring(t from '(?i)\y(?:inline|straight|flat|v|w|opposed)[- ](one|single|two|twin|three|four|five|six|eight|ten|twelve|sixteen)\y'))
      when 'one' then '1' when 'single' then '1' when 'two' then '2' when 'twin' then '2' when 'three' then '3' when 'four' then '4' when 'five' then '5'
      when 'six' then '6' when 'eight' then '8' when 'ten' then '10' when 'twelve' then '12' when 'sixteen' then '16' end) x) s
  where x::int between 1 and 16
$f$;
create or replace function public.engine_config_from_text(t text, p_strict boolean) returns public.engine_config_t language sql immutable as $f$
  select (case
    when t ~* '\y(rotary|wankel)\y' then 'rotary'
    when t ~* '\y(electric motor|dual-motor|tri-motor|electric)\y' then 'electric'
    when t ~* '\y(flat|boxer|opposed)[- ]?(\d|one|two|twin|four|six|eight|twelve)' or (not p_strict and t ~* '\yh-?\d\y') then 'flat'
    when t ~* '\yv-?(\d{1,2}|twin|six|eight|ten|twelve)\y' and coalesce(substring(t from '(?i)\yv-?(\d{1,2})\y'),'8')::int <= 16 then 'v'
    when t ~* '\yw-?(8|12|16)\y' and not p_strict then 'w'
    when t ~* '\y(inline|straight)[- ]?(\d|one|two|three|four|five|six|eight)' or (not p_strict and t ~* '\yi-?\d\y') then 'inline'
  end)::public.engine_config_t
$f$;
create or replace function public.engine_liters_from_text(t text) returns numeric language sql immutable as $f$
  select l from (select coalesce(
    substring(replace(t, ',', '') from '(?i)\y(\d{1,2}\.\d)\s*-?\s*(?:l\y|liter|litre)')::numeric,
    round(substring(replace(t, ',', '') from '(?i)\y(\d{3,4})\s*cc\y')::numeric/1000,1)) l) s where l > 0 and l < 15
$f$;

create or replace function public.stage_vehicle_body_engine(p_run_id text, p_lo uuid, p_hi uuid) returns integer
language plpgsql as $f$
declare n int;
begin
  insert into public.vehicle_body_engine(vehicle_id, run_id, body_style, body_basis, body_cited, engine_cyl, engine_config, engine_liters, engine_basis, engine_cited, source_ref)
  select id, p_run_id, b_val, b_basis, b_cited, e_cyl, e_cfg, e_lit, e_basis, e_cited, src
  from (
    select v.id,
      -- body
      case when bv.vb is not null then bv.vb when lb.lb is not null then lb.lb else tb.tb end b_val,
      case when bv.vb is not null then 'vin_decode' when lb.lb is not null then 'listing_field' when tb.tb is not null then 'title' end b_basis,
      case when bv.vb is not null then 'nhtsa body_type='||d.body_type when lb.lb is not null then 'body_style_quote: '||left(v.body_style_quote,200)
           when tb.tb is not null then public.body_style_phrase(tt.t) end b_cited,
      -- engine: vin decode needs cylinders or displacement
      case when ve.ok then ve.cyl when le.ok then le.cyl when te.ok then te.cyl end e_cyl,
      case when ve.ok then null when le.ok then le.cfg when te.ok then te.cfg end e_cfg,
      case when ve.ok then ve.lit when le.ok then le.lit when te.ok then null end e_lit,
      case when ve.ok then 'vin_decode' when le.ok then 'listing_field' when te.ok then 'title' end e_basis,
      case when ve.ok then 'nhtsa cylinders='||coalesce(d.engine_cylinders::text,'?')||' displacement_l='||coalesce(d.engine_displacement_liters::text,'?')
           when le.ok then left(le.txt,200)||' ['||v.engine_source||']' when te.ok then te.ph end e_cited,
      concat_ws(' ', case when (bv.vb is not null or ve.ok) then 'vin_decoded_data:'||v.vin end,
                     case when (lb.lb is not null or le.ok or tb.tb is not null or te.ok) then coalesce(v.listing_url, v.discovery_url) end) src
    from public.vehicles v
    cross join lateral (select coalesce(v.listing_title, v.bat_listing_title, v.title) t) tt
    left join public.vin_decoded_data d on length(v.vin) = 17 and d.vin = v.vin and d.confidence >= 70 and v.year >= 1981
      and d.year is not null and abs(d.year - v.year) <= 1
    cross join lateral (select case when d.vin is not null then public.body_style_from_text(d.body_type) end vb) bv
    cross join lateral (select case when d.vin is not null and (d.engine_cylinders::text ~ '^\d{1,2}$' or d.engine_displacement_liters::text ~ '^\d{1,2}(\.\d+)?$') then true else false end ok,
      case when d.engine_cylinders::text ~ '^\d{1,2}$' and d.engine_cylinders::text::int between 1 and 16 then d.engine_cylinders::text::smallint end cyl,
      case when d.engine_displacement_liters::text ~ '^\d{1,2}(\.\d+)?$' and d.engine_displacement_liters::text::numeric between 0.05 and 14.9 then round(d.engine_displacement_liters::text::numeric,1) end lit) ve0
    cross join lateral (select (ve0.cyl is not null or ve0.lit is not null) ok, ve0.cyl, ve0.lit) ve
    cross join lateral (select case when v.body_style_quote is not null then public.body_style_from_text(v.body_style_quote) end lb) lb
    cross join lateral (select public.body_style_from_text(tt.t) tb) tb
    cross join lateral (select x.txt, public.engine_cyl_from_text(x.txt,false) cyl, public.engine_config_from_text(x.txt,false) cfg, public.engine_liters_from_text(x.txt) lit,
        (v.engine_source is not null and x.txt is not null and coalesce(public.engine_cyl_from_text(x.txt,false)::text, public.engine_config_from_text(x.txt,false)::text, public.engine_liters_from_text(x.txt)::text) is not null) ok
      from (select coalesce(v.engine_type, v.engine_size) txt) x) le
    cross join lateral (select public.engine_cyl_from_text(tt.t,true) cyl, public.engine_config_from_text(tt.t,true) cfg,
        substring(tt.t from '(?i)(\yv-?\d{1,2}\y|\y\d{1,2}[- ]?cyl[a-z]*|\y(?:inline|straight|flat|boxer|v|w|opposed)[- ]?(?:\d{1,2}|one|single|two|twin|three|four|five|six|eight|ten|twelve|sixteen)\y|\y(?:rotary|wankel)\y)') ph,
        (public.engine_cyl_from_text(tt.t,true) is not null or public.engine_config_from_text(tt.t,true) in ('rotary','v','flat','inline')) ok0) te0
    cross join lateral (select te0.cyl, te0.cfg, te0.ph, (te0.ok0 and te0.ph is not null) ok) te
    where v.id >= p_lo and v.id < p_hi
      and not exists (select 1 from public.vehicle_body_engine o where o.vehicle_id = v.id and o.retired_at is null)
  ) z
  where b_val is not null or e_basis is not null
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $f$;
