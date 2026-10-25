-- body/engine coverage round 2: vPIC decodes of previously undecoded VINs + cited pre-1981 model reference table.
-- Additive. New basis 'reference'. New run rows carry forward every existing cited value; a disagreeing new value is
-- logged to vehicle_body_engine_conflict and never replaces the existing one.
alter table public.vehicle_body_engine drop constraint if exists vehicle_body_engine_body_basis_check;
alter table public.vehicle_body_engine add constraint vehicle_body_engine_body_basis_check check (body_basis in ('vin_decode','listing_field','title','reference'));
alter table public.vehicle_body_engine drop constraint if exists vehicle_body_engine_engine_basis_check;
alter table public.vehicle_body_engine add constraint vehicle_body_engine_engine_basis_check check (engine_basis in ('vin_decode','listing_field','title','reference','mixed'));
alter table public.vehicle_body_engine add column if not exists retired_by_run text;

create table if not exists public.model_body_engine_ref (
  id serial primary key, make text not null, family text not null, year_from int not null, year_to int not null,
  body_style public.body_style_t, engine_cyl smallint check (engine_cyl between 1 and 16), engine_config public.engine_config_t,
  engine_liters numeric(4,1), source_url text not null check (source_url ~ '^https?://'), verified_phrase text not null,
  created_run text not null, created_at timestamptz not null default now(), retired_at timestamptz,
  check (year_from <= year_to and year_to <= 1983));
alter table public.model_body_engine_ref enable row level security;

create table if not exists public.vin_vpic_decode (
  vin text primary key, run_id text not null, model_year int, make text, model text, body_class text, engine_cylinders text,
  displacement_l text, engine_configuration text, electrification text, error_code text, confidence int,
  source text not null default 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/', fetched_at timestamptz not null default now());
alter table public.vin_vpic_decode enable row level security;

create table if not exists public.vehicle_body_engine_stage (
  run_id text not null, vehicle_id uuid not null, body_style public.body_style_t, engine_cyl smallint, engine_config public.engine_config_t,
  engine_liters numeric(4,1), basis text not null, body_cited text, engine_cited text, source_ref text not null, primary key (run_id, vehicle_id, basis));
alter table public.vehicle_body_engine_stage enable row level security;

create table if not exists public.vehicle_body_engine_conflict (
  run_id text not null, vehicle_id uuid not null, field text not null, kept text, kept_basis text, offered text, offered_basis text,
  offered_cited text, flagged_at timestamptz not null default now(), primary key (run_id, vehicle_id, field, offered_basis));
alter table public.vehicle_body_engine_conflict enable row level security;

-- merge staged values for one id range. Precedence for filling a null field: vin_decode > reference. Existing cited values always kept.
create or replace function public.merge_vehicle_body_engine(p_run text, p_lo uuid, p_hi uuid) returns int language plpgsql as $f$
declare n int;
begin
  create temp table _m on commit drop as
  with s as (
    select vehicle_id,
      (array_agg(body_style order by basis='reference') filter (where body_style is not null))[1] sb,
      (array_agg(basis order by basis='reference') filter (where body_style is not null))[1] sbb,
      (array_agg(body_cited order by basis='reference') filter (where body_style is not null))[1] sbc,
      (array_agg(engine_cyl order by basis='reference') filter (where engine_cyl is not null or engine_config is not null or engine_liters is not null))[1] sc,
      (array_agg(engine_config order by basis='reference') filter (where engine_cyl is not null or engine_config is not null or engine_liters is not null))[1] scf,
      (array_agg(engine_liters order by basis='reference') filter (where engine_cyl is not null or engine_config is not null or engine_liters is not null))[1] sl,
      (array_agg(basis order by basis='reference') filter (where engine_cyl is not null or engine_config is not null or engine_liters is not null))[1] seb,
      (array_agg(engine_cited order by basis='reference') filter (where engine_cyl is not null or engine_config is not null or engine_liters is not null))[1] sec,
      string_agg(distinct source_ref, ' ') src
    from public.vehicle_body_engine_stage where run_id = p_run and vehicle_id >= p_lo and vehicle_id < p_hi group by vehicle_id)
  select s.*, o.vehicle_id ov, o.run_id orun, o.body_style ob, o.body_basis obb, o.body_cited obc, o.engine_cyl oc, o.engine_config ocf, o.engine_liters ol,
         o.engine_basis oeb, o.engine_cited oec, o.source_ref osrc
  from s left join public.vehicle_body_engine o on o.vehicle_id = s.vehicle_id and o.retired_at is null;

  insert into public.vehicle_body_engine_conflict(run_id, vehicle_id, field, kept, kept_basis, offered, offered_basis, offered_cited)
  select p_run, vehicle_id, 'body_style', ob::text, obb, sb::text, sbb, sbc from _m where ob is not null and sb is not null and ob <> sb
  union all select p_run, vehicle_id, 'engine_cyl', oc::text, oeb, sc::text, seb, sec from _m where oc is not null and sc is not null and oc <> sc
  on conflict do nothing;

  -- only rows that gain something
  delete from _m where not ((ob is null and sb is not null) or (oeb is null and seb is not null)
    or (oeb is not null and seb is not null and ((oc is null and sc is not null and (ocf is null or scf is null or ocf = scf)) or (ol is null and sl is not null and (oc is null or sc is null or oc = sc)))));

  update public.vehicle_body_engine o set retired_at = now(), retired_by_run = p_run from _m where o.vehicle_id = _m.ov and o.run_id = _m.orun and o.retired_at is null;

  insert into public.vehicle_body_engine(vehicle_id, run_id, body_style, body_basis, body_cited, engine_cyl, engine_config, engine_liters, engine_basis, engine_cited, source_ref)
  select vehicle_id, p_run,
    coalesce(ob, sb), case when ob is not null then obb else sbb end, case when ob is not null then obc else sbc end,
    coalesce(oc, case when ocf is null or scf is null or ocf = scf then sc end), coalesce(ocf, case when oc is null or sc is null or oc = sc then scf end),
    coalesce(ol, case when oc is null or sc is null or oc = sc then sl end),
    case when oeb is null then seb when seb is null then oeb when (oc is null and sc is not null) or (ol is null and sl is not null) then 'mixed' else oeb end,
    case when oeb is null then sec when seb is null then oec when (oc is null and sc is not null) or (ol is null and sl is not null) then oec || ' + ' || sec else oec end,
    concat_ws(' ', osrc, src)
  from _m;
  get diagnostics n = row_count; return n;
end $f$;

-- cited reference rows (each verified: phrase found on the fetched source page)
insert into public.model_body_engine_ref(make,family,year_from,year_to,body_style,engine_cyl,engine_config,engine_liters,source_url,verified_phrase,created_run) values
('chevrolet','corvette',1956,1962,null,8,'v',null,'https://en.wikipedia.org/wiki/Chevrolet_Corvette_(C1)','V8','body_engine_v2_20261025'),
('chevrolet','corvette',1963,1967,null,8,'v',null,'https://en.wikipedia.org/wiki/Chevrolet_Corvette_(C2)','V8','body_engine_v2_20261025'),
('chevrolet','corvette',1968,1981,null,8,'v',null,'https://en.wikipedia.org/wiki/Chevrolet_Corvette_(C3)','V8','body_engine_v2_20261025'),
('ford','thunderbird',1955,1979,null,8,'v',null,'https://en.wikipedia.org/wiki/Ford_Thunderbird','V8','body_engine_v2_20261025'),
('pontiac','gto',1964,1974,null,8,'v',null,'https://en.wikipedia.org/wiki/Pontiac_GTO','V8','body_engine_v2_20261025'),
('pontiac','trans',1969,1981,null,8,'v',null,'https://en.wikipedia.org/wiki/Pontiac_Firebird','Trans Am','body_engine_v2_20261025'),
('oldsmobile','442',1964,1980,null,8,'v',null,'https://en.wikipedia.org/wiki/Oldsmobile_442','V8','body_engine_v2_20261025'),
('plymouth','road',1968,1975,null,8,'v',null,'https://en.wikipedia.org/wiki/Plymouth_Road_Runner','V8','body_engine_v2_20261025'),
('buick','riviera',1963,1978,null,8,'v',null,'https://en.wikipedia.org/wiki/Buick_Riviera','V8','body_engine_v2_20261025'),
('cadillac','eldorado',1953,1980,null,8,'v',null,'https://en.wikipedia.org/wiki/Cadillac_Eldorado','V8','body_engine_v2_20261025'),
('lincoln','continental',1956,1980,null,8,'v',null,'https://en.wikipedia.org/wiki/Lincoln_Continental','V8','body_engine_v2_20261025'),
('volkswagen','beetle',1938,1980,null,4,'flat',null,'https://en.wikipedia.org/wiki/Volkswagen_Beetle','flat-four|boxer','body_engine_v2_20261025'),
('volkswagen','super',1971,1980,null,4,'flat',null,'https://en.wikipedia.org/wiki/Volkswagen_Beetle','Super Beetle','body_engine_v2_20261025'),
('volkswagen','karmann',1955,1974,null,4,'flat',null,'https://en.wikipedia.org/wiki/Volkswagen_Karmann_Ghia','flat-four|boxer','body_engine_v2_20261025'),
('volkswagen','type',1950,1979,null,4,'flat',null,'https://en.wikipedia.org/wiki/Volkswagen_Type_2','flat-four|boxer','body_engine_v2_20261025'),
('chevrolet','corvair',1960,1969,null,6,'flat',null,'https://en.wikipedia.org/wiki/Chevrolet_Corvair','flat-six|flat six','body_engine_v2_20261025'),
('porsche','912',1965,1969,null,4,'flat',1.6,'https://en.wikipedia.org/wiki/Porsche_912','flat-four|1.6','body_engine_v2_20261025'),
('porsche','911',1964,1980,null,6,'flat',null,'https://en.wikipedia.org/wiki/Porsche_911','flat-six','body_engine_v2_20261025'),
('porsche','911t',1968,1973,null,6,'flat',null,'https://en.wikipedia.org/wiki/Porsche_911','911T','body_engine_v2_20261025'),
('porsche','911s',1967,1977,null,6,'flat',null,'https://en.wikipedia.org/wiki/Porsche_911','911S','body_engine_v2_20261025'),
('porsche','911sc',1978,1983,null,6,'flat',3.0,'https://en.wikipedia.org/wiki/Porsche_911','911SC|911 SC','body_engine_v2_20261025'),
('porsche','914',1969,1976,'targa',null,'flat',null,'https://en.wikipedia.org/wiki/Porsche_914','targa','body_engine_v2_20261025'),
('jaguar','xke',1971,1975,null,12,'v',5.3,'https://en.wikipedia.org/wiki/Jaguar_E-Type','V12','body_engine_v2_20261025'),
('mg','mgb',1962,1980,null,4,'inline',1.8,'https://en.wikipedia.org/wiki/MGB','1798|1.8','body_engine_v2_20261025'),
('mg','td',1950,1953,'roadster',4,'inline',1.3,'https://en.wikipedia.org/wiki/MG_T-type','1250','body_engine_v2_20261025'),
('triumph','tr6',1968,1976,'roadster',6,'inline',2.5,'https://en.wikipedia.org/wiki/Triumph_TR6','2.5|2498','body_engine_v2_20261025'),
('bmw','2002',1968,1976,null,4,'inline',2.0,'https://en.wikipedia.org/wiki/BMW_02_Series','M10','body_engine_v2_20261025'),
('nissan','240z',1969,1973,'coupe',6,'inline',2.4,'https://en.wikipedia.org/wiki/Nissan_S30','L24','body_engine_v2_20261025'),
('mercedes-benz','280sl',1968,1971,'roadster',6,'inline',2.8,'https://en.wikipedia.org/wiki/Mercedes-Benz_W113','280 SL','body_engine_v2_20261025'),
('mercedes-benz','450sl',1972,1980,'roadster',8,'v',4.5,'https://en.wikipedia.org/wiki/Mercedes-Benz_R107_and_C107','450 SL','body_engine_v2_20261025'),
('ford','bronco',1978,1979,'suv',8,'v',null,'https://en.wikipedia.org/wiki/Ford_Bronco','1978','body_engine_v2_20261025'),
('chevrolet','el',1959,1980,'pickup',null,null,null,'https://en.wikipedia.org/wiki/Chevrolet_El_Camino','pickup|coupé utility','body_engine_v2_20261025'),
('chevrolet','c10',1960,1980,'pickup',null,null,null,'https://en.wikipedia.org/wiki/Chevrolet_C/K','pickup','body_engine_v2_20261025'),
('chevrolet','3100',1947,1955,'pickup',null,null,null,'https://en.wikipedia.org/wiki/Chevrolet_Advance_Design','3100','body_engine_v2_20261025'),
('chevrolet','k5',1969,1980,'suv',null,null,null,'https://en.wikipedia.org/wiki/Chevrolet_K5_Blazer','SUV|sport utility','body_engine_v2_20261025'),
('ford','f100',1953,1980,'pickup',null,null,null,'https://en.wikipedia.org/wiki/Ford_F-Series','F-100','body_engine_v2_20261025'),
('triumph','bonneville',1959,1980,'motorcycle',2,null,null,'https://en.wikipedia.org/wiki/Triumph_Bonneville','parallel.twin','body_engine_v2_20261025')
on conflict do nothing;
