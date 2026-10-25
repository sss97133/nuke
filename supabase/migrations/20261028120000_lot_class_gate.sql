-- lot class: typed, cited lot class per vehicle + like-with-like gate on live comp functions.
-- Additive. Vehicles with no active row are 'car' (default). Revert: conf7/revert_lot_class.sql
do $$ begin
  create type public.lot_class_t as enum ('car','motorcycle','minibike','kart','atv','boat','trailer','tractor','memorabilia','wheels','engine','part');
exception when duplicate_object then null; end $$;

create table if not exists public.vehicle_lot_class (
  vehicle_id uuid not null references public.vehicles(id),
  run_id text not null,
  lot_class public.lot_class_t not null,
  basis text not null check (basis in ('typed_category','title')),
  cited_phrase text not null,
  source_event_id uuid,
  source_field text,
  source_url text,
  set_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (vehicle_id, run_id)
);
create unique index if not exists vehicle_lot_class_active_uq on public.vehicle_lot_class(vehicle_id) where retired_at is null;
alter table public.vehicle_lot_class enable row level security;
comment on table public.vehicle_lot_class is 'Typed lot class with citation. No active row => car. Typed category (vehicle_events.lot_category) beats title rules.';

create or replace function public.lot_class_of(p_vehicle_id uuid) returns public.lot_class_t
language sql stable as $f$
  select coalesce((select lc.lot_class from public.vehicle_lot_class lc where lc.vehicle_id = p_vehicle_id and lc.retired_at is null), 'car'::public.lot_class_t)
$f$;

create or replace function public.lot_class_from_title(t text) returns public.lot_class_t
language sql immutable as $f$
  select (case
      when t ~* '\y(go-?kart|shifter kart|racing kart|kart)\y' then 'kart'
      when t ~* '\y(mini-?bike|minibike)\y' then 'minibike'
      when t ~* '\y(motorcycle|scooter|moped|sidecar)\y' then 'motorcycle'
      when t ~* '\y(atv|utv|quad ?bike|side-by-side)\y' then 'atv'
      when t ~* '\y(boat|speedboat|outboard|pontoon|hydroplane|jet ?ski)\y' then 'boat'
      when t ~* '^(?!.*(w/|\ywith\y| & | and )).*\y(travel trailer|camper trailer|teardrop trailer|utility trailer|car trailer|trailer)$' then 'trailer'
      when t ~* '\y(wall art|pedal car|gas pump|jukebox|neon sign|porcelain sign|dealer sign|sign|poster|artwork|painting|sculpture|brochure|literature|scale model|model car|diorama|toolbox|tool chest|pennant)$' then 'memorabilia'
      when t ~* '^(?!.*\y(coupe|sedan|convertible|roadster|pickup|wagon|truck|van|hatchback|targa|spider|spyder)\y).*\y(wheels|rims|wheel set)\y' then 'wheels'
      when t ~* '^(?!.*\y(coupe|sedan|convertible|roadster|pickup|wagon|truck|van|hatchback|targa|spider|spyder|swap|powered)\y).*\y(engine|crate engine|long block|short block)$' then 'engine'
      when t ~* '^(?!.*\y(coupe|sedan|convertible|roadster|pickup|wagon|truck|van|hatchback|targa|spider|spyder|2-door|4-door|two-door|four-door|project|parts car|sport chassis|freightliner|pair of)\y|.*w/).*\y(removable hardtop|soft top|seats|bumpers?|grille|chassis|rolling chassis|chassis and drivetrain|drivetrain|transmission|transaxle|gearbox|body shell|bodyshell|doors|hood|carburetors?|cylinder heads?|intake manifold|headlights?|steering wheel|parts|spare parts|parts lot)$' then 'part'
      else null end)::public.lot_class_t
$f$;

create or replace function public.lot_class_phrase(t text) returns text
language sql immutable as $f$
  select case
      when t ~* '\y(go-?kart|shifter kart|racing kart|kart)\y' then substring(t from '(?i)'||'\y(go-?kart|shifter kart|racing kart|kart)\y')
      when t ~* '\y(mini-?bike|minibike)\y' then substring(t from '(?i)'||'\y(mini-?bike|minibike)\y')
      when t ~* '\y(motorcycle|scooter|moped|sidecar)\y' then substring(t from '(?i)'||'\y(motorcycle|scooter|moped|sidecar)\y')
      when t ~* '\y(atv|utv|quad ?bike|side-by-side)\y' then substring(t from '(?i)'||'\y(atv|utv|quad ?bike|side-by-side)\y')
      when t ~* '\y(boat|speedboat|outboard|pontoon|hydroplane|jet ?ski)\y' then substring(t from '(?i)'||'\y(boat|speedboat|outboard|pontoon|hydroplane|jet ?ski)\y')
      when t ~* '^(?!.*(w/|\ywith\y| & | and )).*\y(travel trailer|camper trailer|teardrop trailer|utility trailer|car trailer|trailer)$' then substring(t from '(?i)'||'^(?!.*(w/|\ywith\y| & | and )).*\y(travel trailer|camper trailer|teardrop trailer|utility trailer|car trailer|trailer)$')
      when t ~* '\y(wall art|pedal car|gas pump|jukebox|neon sign|porcelain sign|dealer sign|sign|poster|artwork|painting|sculpture|brochure|literature|scale model|model car|diorama|toolbox|tool chest|pennant)$' then substring(t from '(?i)'||'\y(wall art|pedal car|gas pump|jukebox|neon sign|porcelain sign|dealer sign|sign|poster|artwork|painting|sculpture|brochure|literature|scale model|model car|diorama|toolbox|tool chest|pennant)$')
      when t ~* '^(?!.*\y(coupe|sedan|convertible|roadster|pickup|wagon|truck|van|hatchback|targa|spider|spyder)\y).*\y(wheels|rims|wheel set)\y' then substring(t from '(?i)'||'^(?!.*\y(coupe|sedan|convertible|roadster|pickup|wagon|truck|van|hatchback|targa|spider|spyder)\y).*\y(wheels|rims|wheel set)\y')
      when t ~* '^(?!.*\y(coupe|sedan|convertible|roadster|pickup|wagon|truck|van|hatchback|targa|spider|spyder|swap|powered)\y).*\y(engine|crate engine|long block|short block)$' then substring(t from '(?i)'||'^(?!.*\y(coupe|sedan|convertible|roadster|pickup|wagon|truck|van|hatchback|targa|spider|spyder|swap|powered)\y).*\y(engine|crate engine|long block|short block)$')
      when t ~* '^(?!.*\y(coupe|sedan|convertible|roadster|pickup|wagon|truck|van|hatchback|targa|spider|spyder|2-door|4-door|two-door|four-door|project|parts car|sport chassis|freightliner|pair of)\y|.*w/).*\y(removable hardtop|soft top|seats|bumpers?|grille|chassis|rolling chassis|chassis and drivetrain|drivetrain|transmission|transaxle|gearbox|body shell|bodyshell|doors|hood|carburetors?|cylinder heads?|intake manifold|headlights?|steering wheel|parts|spare parts|parts lot)$' then substring(t from '(?i)'||'^(?!.*\y(coupe|sedan|convertible|roadster|pickup|wagon|truck|van|hatchback|targa|spider|spyder|2-door|4-door|two-door|four-door|project|parts car|sport chassis|freightliner|pair of)\y|.*w/).*\y(removable hardtop|soft top|seats|bumpers?|grille|chassis|rolling chassis|chassis and drivetrain|drivetrain|transmission|transaxle|gearbox|body shell|bodyshell|doors|hood|carburetors?|cylinder heads?|intake manifold|headlights?|steering wheel|parts|spare parts|parts lot)$')
      else null end
$f$;

-- stage one uuid range; idempotent per (vehicle_id, run_id); never overwrites an active row from another run
create or replace function public.stage_vehicle_lot_class(p_run_id text, p_lo uuid, p_hi uuid) returns integer
language plpgsql as $f$
declare n int;
begin
  with typed as (
    select distinct on (e.vehicle_id) e.vehicle_id, e.id ev, e.lot_category, e.source_url
    from public.vehicle_events e
    where e.vehicle_id >= p_lo and e.vehicle_id < p_hi and e.lot_category is not null
      and exists (select 1 from public.vehicles vv where vv.id = e.vehicle_id)
    order by e.vehicle_id, e.id
  ), cand as (
    select t.vehicle_id,
      (case t.lot_category when 'motorcycle' then 'motorcycle' when 'parts' then 'part' when 'go_kart' then 'kart'
        when 'wheels' then 'wheels' when 'atv' then 'atv' when 'minibike' then 'minibike' when 'tractor' then 'tractor'
        when 'automobilia' then 'memorabilia' end)::public.lot_class_t lc,
      'typed_category' basis, 'lot_category='||t.lot_category phrase, t.ev, 'vehicle_events.lot_category' fld, t.source_url url
    from typed t
    union all
    select v.id, public.lot_class_from_title(x.t), 'title', public.lot_class_phrase(x.t), null::uuid, x.f, v.listing_url
    from public.vehicles v
    cross join lateral (select case when v.listing_title is not null then v.listing_title when v.bat_listing_title is not null then v.bat_listing_title else v.title end t,
                               case when v.listing_title is not null then 'vehicles.listing_title' when v.bat_listing_title is not null then 'vehicles.bat_listing_title' else 'vehicles.title' end f) x
    where v.id >= p_lo and v.id < p_hi and x.t is not null
      and not exists (select 1 from typed t where t.vehicle_id = v.id)
  )
  insert into public.vehicle_lot_class(vehicle_id, run_id, lot_class, basis, cited_phrase, source_event_id, source_field, source_url)
  select c.vehicle_id, p_run_id, c.lc, c.basis, c.phrase, c.ev, c.fld, c.url
  from cand c
  where c.lc is not null and c.lc <> 'car' and c.phrase is not null
    and not exists (select 1 from public.vehicle_lot_class o where o.vehicle_id = c.vehicle_id and o.retired_at is null)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $f$;

-- gate: comps must share the subject's lot class (subject = p_exclude_vehicle_id, else car)
CREATE OR REPLACE FUNCTION public.find_bat_comps(p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 2, p_limit integer DEFAULT 200, p_skip_wide_fallback boolean DEFAULT false)
 RETURNS TABLE(listing_id uuid, vehicle_id uuid, sale_price integer, bid_count integer, sale_date date, bat_listing_url text, v_year integer, v_make text, v_model text, v_engine_size text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_engine     text;
  v_trans      text;
  v_drive      text;
  v_mileage    integer;
  v_trim       text;
  v_body       text;
  result_count integer;
BEGIN
  -- Try to resolve vehicle attributes from a matching vehicle for better scoring
  -- Pick the first vehicle matching these params to get its attributes
  SELECT v.engine_type, v.transmission, v.drivetrain, v.mileage, v.trim, v.body_style
  INTO v_engine, v_trans, v_drive, v_mileage, v_trim, v_body
  FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(null::uuid) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(null::uuid)))) v
  WHERE lower(v.make) LIKE '%' || lower(p_make) || '%'
    AND (p_model IS NULL OR lower(v.model) LIKE '%' || lower(p_model) || '%')
    AND (p_year IS NULL OR v.year = p_year)
    AND v.engine_type IS NOT NULL
  LIMIT 1;

  -- Use scored comps to get BaT listings ranked by similarity
  RETURN QUERY
  SELECT
    bl.id AS listing_id,
    s.vehicle_id,
    s.sale_price::integer,
    bl.bid_count,
    s.sold_date::date AS sale_date,
    bl.bat_listing_url,
    s.yr AS v_year,
    s.mk AS v_make,
    s.mdl AS v_model,
    v2.engine_size AS v_engine_size
  FROM get_comps_scored(
    p_make         := p_make,
    p_model        := p_model,
    p_year         := p_year,
    p_year_range   := p_year_range,
    p_engine_type  := v_engine,
    p_transmission := v_trans,
    p_drivetrain   := v_drive,
    p_mileage      := v_mileage,
    p_trim         := v_trim,
    p_body_style   := v_body,
    p_limit        := p_limit
  ) s
  JOIN bat_listings bl ON bl.vehicle_id = s.vehicle_id
  JOIN (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(null::uuid) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(null::uuid)))) v2 ON v2.id = s.vehicle_id
  WHERE bl.sale_price > 0;

  GET DIAGNOSTICS result_count = ROW_COUNT;

  -- If we got no results from scored path and not skipping fallback, try wider
  IF result_count = 0 AND NOT p_skip_wide_fallback THEN
    RETURN QUERY
    SELECT bl.id,
           bl.vehicle_id,
           bl.sale_price,
           bl.bid_count,
           bl.sale_date,
           bl.bat_listing_url,
           v2.year,
           v2.make,
           v2.model,
           v2.engine_size
    FROM bat_listings bl
    INNER JOIN (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(null::uuid) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(null::uuid)))) v2 ON v2.id = bl.vehicle_id
    WHERE bl.sale_price > 0
      AND lower(v2.make) LIKE '%' || lower(p_make) || '%'
      AND (p_model IS NULL OR lower(v2.model) LIKE '%' || lower(p_model) || '%')
      AND (p_year IS NULL OR (v2.year BETWEEN p_year - p_year_range * 2 AND p_year + p_year_range * 2))
    ORDER BY bl.sale_date DESC NULLS LAST
    LIMIT p_limit;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_auction_comps(p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '8s'
AS $function$
BEGIN
  RETURN QUERY
  WITH raw AS (
    SELECT v.id, v.year, v.make, v.model, v.trim, v.vin, ae.winning_bid, v.mileage, v.color,
           v.primary_image_url, v.location, ae.source_url, ae.source, ae.auction_end_date,
           ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))) v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (p_year_min IS NULL OR v.year >= p_year_min)
      AND (p_year_max IS NULL OR v.year <= p_year_max)
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ), conv AS (
    SELECT r.*, fx.rate, fx.rate_date, fx.source AS fx_src,
           CASE WHEN r.cur IS NULL THEN r.winning_bid ELSE round(r.winning_bid * fx.rate, 2) END AS price_usd
    FROM raw r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  )
  SELECT c.id, c.year, c.make, c.model, c.trim, c.vin, c.price_usd, c.mileage, c.color,
         c.primary_image_url, c.location, c.source_url, c.source, c.auction_end_date,
         c.winning_bid, c.cur, c.rate, c.rate_date,
         CASE WHEN c.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE c.fx_src END
  FROM conv c
  WHERE (c.cur IS NULL OR c.rate IS NOT NULL)
    AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
    AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ORDER BY c.auction_end_date DESC NULLS LAST
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_auction_comps(p_basis price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '8s'
AS $function$
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  RETURN QUERY
  WITH raw AS (
    SELECT v.id, v.year, v.make, v.model, v.trim, v.vin, (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) AS winning_bid, v.mileage, v.color,
           v.primary_image_url, v.location, ae.source_url, ae.source, ae.auction_end_date,
           ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))) v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (p_year_min IS NULL OR v.year >= p_year_min)
      AND (p_year_max IS NULL OR v.year <= p_year_max)
      AND (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) > 0
      AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ), conv AS (
    SELECT r.*, fx.rate, fx.rate_date, fx.source AS fx_src,
           CASE WHEN r.cur IS NULL THEN r.winning_bid ELSE round(r.winning_bid * fx.rate, 2) END AS price_usd
    FROM raw r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  )
  SELECT c.id, c.year, c.make, c.model, c.trim, c.vin, c.price_usd, c.mileage, c.color,
         c.primary_image_url, c.location, c.source_url, c.source, c.auction_end_date,
         c.winning_bid, c.cur, c.rate, c.rate_date,
         CASE WHEN c.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE c.fx_src END,
         p_basis::text
  FROM conv c
  WHERE (c.cur IS NULL OR c.rate IS NOT NULL)
    AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
    AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ORDER BY c.auction_end_date DESC NULLS LAST
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_comp_tiers(p_year integer, p_make text, p_model_root text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  project_count INT; project_avg REAL; project_min REAL; project_max REAL;
  driver_count INT; driver_avg REAL; driver_min REAL; driver_max REAL;
  restomod_count INT; restomod_avg REAL; restomod_min REAL; restomod_max REAL;
  show_count INT; show_avg REAL; show_min REAL; show_max REAL;
  model_pattern TEXT;
BEGIN
  model_pattern := '%' || LOWER(p_model_root) || '%';

  -- Project tier: $0-$20K
  SELECT COUNT(*), ROUND(AVG((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))::numeric), MIN((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END)), MAX((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))
  INTO project_count, project_avg, project_min, project_max
  FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(null::uuid) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(null::uuid)))) vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND (CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END) > 0 AND (CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END) < 20000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  -- Driver tier: $20K-$50K
  SELECT COUNT(*), ROUND(AVG((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))::numeric), MIN((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END)), MAX((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))
  INTO driver_count, driver_avg, driver_min, driver_max
  FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(null::uuid) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(null::uuid)))) vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND (CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END) BETWEEN 20000 AND 50000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  -- Restomod tier: $50K-$100K
  SELECT COUNT(*), ROUND(AVG((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))::numeric), MIN((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END)), MAX((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))
  INTO restomod_count, restomod_avg, restomod_min, restomod_max
  FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(null::uuid) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(null::uuid)))) vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND (CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END) BETWEEN 50000 AND 100000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  -- Show tier: $100K+
  SELECT COUNT(*), ROUND(AVG((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))::numeric), MIN((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END)), MAX((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))
  INTO show_count, show_avg, show_min, show_max
  FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(null::uuid) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(null::uuid)))) vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND (CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END) > 100000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  RETURN jsonb_build_object(
    'project',  jsonb_build_object('count', COALESCE(project_count, 0),  'avg', project_avg,  'min', project_min,  'max', project_max),
    'driver',   jsonb_build_object('count', COALESCE(driver_count, 0),   'avg', driver_avg,   'min', driver_min,   'max', driver_max),
    'restomod', jsonb_build_object('count', COALESCE(restomod_count, 0), 'avg', restomod_avg, 'min', restomod_min, 'max', restomod_max),
    'show',     jsonb_build_object('count', COALESCE(show_count, 0),     'avg', show_avg,     'min', show_min,     'max', show_max)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_comps_combined(p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_year       integer;
  v_year_range integer;
  v_engine     text;
  v_trans      text;
  v_drive      text;
  v_mileage    integer;
  v_trim       text;
  v_body       text;
BEGIN
  -- Compute year and range from min/max
  IF p_year_min IS NOT NULL AND p_year_max IS NOT NULL THEN
    v_year := (p_year_min + p_year_max) / 2;
    v_year_range := GREATEST((p_year_max - p_year_min) / 2, 1);
  ELSIF p_year_min IS NOT NULL THEN
    v_year := p_year_min + 5;
    v_year_range := 5;
  ELSIF p_year_max IS NOT NULL THEN
    v_year := p_year_max - 5;
    v_year_range := 5;
  END IF;

  -- Try to resolve vehicle attributes if we have an exclude_vehicle_id (i.e. the subject)
  IF p_exclude_vehicle_id IS NOT NULL THEN
    SELECT v.engine_type, v.transmission, v.drivetrain, v.mileage, v.trim, v.body_style
    INTO v_engine, v_trans, v_drive, v_mileage, v_trim, v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))) v WHERE v.id = p_exclude_vehicle_id;
  END IF;

  RETURN QUERY
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    s.sale_price_native, s.currency_code, s.fx_rate, s.fx_rate_date, s.fx_source
  FROM get_comps_scored(
    p_make         := p_make,
    p_model        := p_model,
    p_year         := v_year,
    p_year_range   := COALESCE(v_year_range, 5),
    p_engine_type  := v_engine,
    p_transmission := v_trans,
    p_drivetrain   := v_drive,
    p_mileage      := v_mileage,
    p_trim         := v_trim,
    p_body_style   := v_body,
    p_min_price    := p_min_price,
    p_max_price    := p_max_price,
    p_exclude_vehicle_id := p_exclude_vehicle_id,
    p_limit        := p_limit
  ) s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_comps_combined(p_basis price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_year       integer;
  v_year_range integer;
  v_engine     text;
  v_trans      text;
  v_drive      text;
  v_mileage    integer;
  v_trim       text;
  v_body       text;
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  -- Compute year and range from min/max
  IF p_year_min IS NOT NULL AND p_year_max IS NOT NULL THEN
    v_year := (p_year_min + p_year_max) / 2;
    v_year_range := GREATEST((p_year_max - p_year_min) / 2, 1);
  ELSIF p_year_min IS NOT NULL THEN
    v_year := p_year_min + 5;
    v_year_range := 5;
  ELSIF p_year_max IS NOT NULL THEN
    v_year := p_year_max - 5;
    v_year_range := 5;
  END IF;

  -- Try to resolve vehicle attributes if we have an exclude_vehicle_id (i.e. the subject)
  IF p_exclude_vehicle_id IS NOT NULL THEN
    SELECT v.engine_type, v.transmission, v.drivetrain, v.mileage, v.trim, v.body_style
    INTO v_engine, v_trans, v_drive, v_mileage, v_trim, v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))) v WHERE v.id = p_exclude_vehicle_id;
  END IF;

  RETURN QUERY
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    s.sale_price_native, s.currency_code, s.fx_rate, s.fx_rate_date, s.fx_source, s.price_basis
  FROM get_comps_scored(
    p_basis        := p_basis,
    p_make         := p_make,
    p_model        := p_model,
    p_year         := v_year,
    p_year_range   := COALESCE(v_year_range, 5),
    p_engine_type  := v_engine,
    p_transmission := v_trans,
    p_drivetrain   := v_drive,
    p_mileage      := v_mileage,
    p_trim         := v_trim,
    p_body_style   := v_body,
    p_min_price    := p_min_price,
    p_max_price    := p_max_price,
    p_exclude_vehicle_id := p_exclude_vehicle_id,
    p_limit        := p_limit
  ) s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_comps_scored(p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  w_year        constant numeric := 15;
  w_model       constant numeric := 25;
  w_engine_cyl  constant numeric := 12;
  w_engine_cfg  constant numeric := 5;
  w_trans       constant numeric := 15;
  w_drivetrain  constant numeric := 10;
  w_mileage     constant numeric := 8;
  w_body        constant numeric := 5;
  w_trim_w      constant numeric := 5;

  ref_trans     text;
  ref_cyls      integer;
  ref_eng_cfg   text;
  ref_drive     text;
BEGIN
  ref_trans    := classify_transmission(p_transmission);
  ref_cyls     := extract_cylinder_count(p_engine_type);
  ref_eng_cfg  := extract_engine_config(p_engine_type);
  ref_drive    := classify_drivetrain(p_drivetrain);

  RETURN QUERY
  WITH auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      ae.winning_bid AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ae.source_url,
      ae.source, ae.auction_end_date,
      'auction_event'::text AS src_type,
      ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))) v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      v.sale_price AS price, v.mileage, v.color,
      v.primary_image_url, v.location, v.listing_url AS source_url,
      NULL::text AS source,
      -- the sale's own date (UTC midnight), so a comp from 2010 reads as 2010, not as undated
      (COALESCE(v.sale_date, v.bat_sale_date)::timestamp AT TIME ZONE 'UTC') AS auction_end_date,
      'vehicle_record'::text AS src_type,
      COALESCE(v.sale_price_currency, v.currency_code) AS cur, COALESCE(v.sale_date, v.bat_sale_date) AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id)))) v
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND v.sale_price IS NOT NULL AND v.sale_price > 0
      -- price_verification: one shared rule (vehicle_sale_price_untrusted)
      AND NOT public.vehicle_sale_price_untrusted(v.id, v.sale_price)
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM auction_events ae2
        WHERE ae2.vehicle_id = v.id AND ae2.winning_bid > 0 AND ae2.outcome = 'sold'
      )
  ),
  raw_cands AS (
    SELECT * FROM auction_cands
    UNION ALL
    SELECT * FROM vehicle_cands
  ),
  -- native amount x sale-date USD rate (fx_usd_rate). NULL currency = legacy row, read as reported.
  conv_cands AS (
    SELECT r.*, r.price AS price_native, fx.rate AS fx_rate, fx.rate_date AS fx_rate_date,
      CASE WHEN r.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE fx.source END AS fx_source,
      CASE WHEN r.cur IS NULL THEN r.price::numeric ELSE round(r.price * fx.rate, 2) END AS price_usd
    FROM raw_cands r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  ),
  all_cands AS (
    SELECT * FROM conv_cands c
    WHERE (c.cur IS NULL OR c.fx_rate IS NOT NULL)   -- foreign amount with no rate: excluded, never read as USD
      AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
      AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ),
  scored AS (
    SELECT
      c.id AS vehicle_id,
      c.year AS yr,
      c.make AS mk,
      c.model AS mdl,
      c.trim AS tr,
      c.vin AS vi,
      c.price_usd AS sale_price,
      c.mileage AS miles,
      c.color AS clr,
      c.primary_image_url AS image_url,
      c.location AS loc,
      c.source_url AS listing_url,
      c.source AS platform,
      c.auction_end_date AS sold_date,
      c.src_type AS source_type,
      c.price_native, c.cur, c.fx_rate, c.fx_rate_date, c.fx_source,

      -- Year score
      (CASE WHEN p_year IS NOT NULL AND c.year IS NOT NULL
        THEN w_year * GREATEST(0, 1.0 - ABS(c.year - p_year)::numeric / GREATEST(LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50), 1))
        ELSE w_year * 0.5
      END) AS s_year,

      -- Model score
      (CASE
        WHEN p_model IS NULL THEN w_model * 0.5
        WHEN lower(c.model) = lower(p_model) THEN w_model
        WHEN length(public.model_spelling_key(p_model)) >= 2 AND public.model_spelling_key(c.model) = public.model_spelling_key(p_model) THEN w_model
        WHEN lower(c.model) LIKE '%' || lower(p_model) || '%' THEN w_model * 0.7
        WHEN lower(p_model) LIKE '%' || lower(c.model) || '%' THEN w_model * 0.6
        WHEN lower(c.model) LIKE '%' || lower(split_part(p_model, ' ', 1)) || '%' THEN w_model * 0.4
        ELSE 0
      END) AS s_model,

      -- Engine cylinder score
      (CASE
        WHEN ref_cyls IS NULL OR extract_cylinder_count(c.v_engine) IS NULL THEN w_engine_cyl * 0.3
        WHEN extract_cylinder_count(c.v_engine) = ref_cyls THEN w_engine_cyl
        WHEN ABS(extract_cylinder_count(c.v_engine) - ref_cyls) <= 2 THEN w_engine_cyl * 0.5
        ELSE 0
      END) AS s_engine_cyl,

      -- Engine config score
      (CASE
        WHEN ref_eng_cfg IS NULL OR extract_engine_config(c.v_engine) IS NULL THEN w_engine_cfg * 0.3
        WHEN extract_engine_config(c.v_engine) = ref_eng_cfg THEN w_engine_cfg
        ELSE 0
      END) AS s_engine_cfg,

      -- Transmission score
      (CASE
        WHEN ref_trans IS NULL OR classify_transmission(c.v_trans) IS NULL THEN w_trans * 0.3
        WHEN classify_transmission(c.v_trans) = ref_trans THEN w_trans
        ELSE 0
      END) AS s_trans,

      -- Drivetrain score
      (CASE
        WHEN ref_drive IS NULL OR classify_drivetrain(c.v_drive) IS NULL THEN w_drivetrain * 0.3
        WHEN classify_drivetrain(c.v_drive) = ref_drive THEN w_drivetrain
        WHEN classify_drivetrain(c.v_drive) IN ('4WD','AWD') AND ref_drive IN ('4WD','AWD') THEN w_drivetrain * 0.8
        ELSE 0
      END) AS s_drivetrain,

      -- Mileage score
      (CASE
        WHEN p_mileage IS NULL OR c.mileage IS NULL OR p_mileage = 0 THEN w_mileage * 0.3
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.2 THEN w_mileage
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.5 THEN w_mileage * 0.6
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 1.0 THEN w_mileage * 0.3
        ELSE 0
      END) AS s_mileage,

      -- Body style score
      (CASE
        WHEN p_body_style IS NULL OR c.v_body IS NULL THEN w_body * 0.3
        WHEN lower(c.v_body) = lower(p_body_style) THEN w_body
        WHEN lower(c.v_body) LIKE '%' || lower(p_body_style) || '%' THEN w_body * 0.6
        ELSE 0
      END) AS s_body,

      -- Trim score
      (CASE
        WHEN p_trim IS NULL OR c.trim IS NULL THEN w_trim_w * 0.3
        WHEN lower(c.trim) = lower(p_trim) THEN w_trim_w
        WHEN lower(c.trim) LIKE '%' || lower(p_trim) || '%' THEN w_trim_w * 0.6
        ELSE 0
      END) AS s_trim

    FROM all_cands c
  )
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    ROUND(s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim, 1) AS similarity_score,
    jsonb_build_object(
      'year', ROUND(s.s_year, 1),
      'model', ROUND(s.s_model, 1),
      'engine_cyl', ROUND(s.s_engine_cyl, 1),
      'engine_cfg', ROUND(s.s_engine_cfg, 1),
      'transmission', ROUND(s.s_trans, 1),
      'drivetrain', ROUND(s.s_drivetrain, 1),
      'mileage', ROUND(s.s_mileage, 1),
      'body_style', ROUND(s.s_body, 1),
      'trim', ROUND(s.s_trim, 1)
    ) AS score_breakdown,
    s.price_native::numeric AS sale_price_native, s.cur AS currency_code, s.fx_rate, s.fx_rate_date, s.fx_source
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_comps_scored(p_basis price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  w_year        constant numeric := 15;
  w_model       constant numeric := 25;
  w_engine_cyl  constant numeric := 12;
  w_engine_cfg  constant numeric := 5;
  w_trans       constant numeric := 15;
  w_drivetrain  constant numeric := 10;
  w_mileage     constant numeric := 8;
  w_body        constant numeric := 5;
  w_trim_w      constant numeric := 5;

  ref_trans     text;
  ref_cyls      integer;
  ref_eng_cfg   text;
  ref_drive     text;
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  ref_trans    := classify_transmission(p_transmission);
  ref_cyls     := extract_cylinder_count(p_engine_type);
  ref_eng_cfg  := extract_engine_config(p_engine_type);
  ref_drive    := classify_drivetrain(p_drivetrain);

  RETURN QUERY
  WITH auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ae.source_url,
      ae.source, ae.auction_end_date,
      'auction_event'::text AS src_type,
      ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id))) and id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicles' and q.released_at is null))) v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) > 0
      AND ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ve.source_url,
      COALESCE(public.event_resolved_platform(ve.id, ve.source_suspect), ve.source_platform) AS source,
      COALESCE(ve.sold_at, ve.ended_at) AS auction_end_date,
      'vehicle_event'::text AS src_type,
      NULL::text AS cur, COALESCE(ve.sold_at, ve.ended_at)::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(p_exclude_vehicle_id) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(p_exclude_vehicle_id))) and id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicles' and q.released_at is null))) v
    JOIN vehicle_events ve ON ve.vehicle_id = v.id
      AND NOT coalesce(ve.sale_outcome is not null and ve.sale_outcome <> 'sold', false)
      AND (ve.source_suspect is null OR NOT public.vehicle_event_comp_excluded(ve.id, ve.source_suspect))
      AND NOT public.vehicle_event_low_trust(ve.id)  -- writer_source_trust: low unless corroborated
      AND ve.id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicle_events' and q.released_at is null))
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ve.event_status = 'sold'
      AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted'
      AND (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) > 0
      AND v.deleted_at IS NULL
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM auction_events ae2
        WHERE ae2.vehicle_id = v.id AND ae2.outcome = 'sold' AND (CASE p_basis WHEN 'hammer' THEN ae2.hammer_price WHEN 'gross_incl_premium' THEN ae2.gross_price WHEN 'net_to_owner' THEN ae2.net_to_owner END) > 0
      )
  ),
  raw_cands AS (
    SELECT * FROM auction_cands
    UNION ALL
    SELECT * FROM vehicle_cands
  ),
  -- native amount x sale-date USD rate (fx_usd_rate). NULL currency = legacy row, read as reported.
  conv_cands AS (
    SELECT r.*, r.price AS price_native, fx.rate AS fx_rate, fx.rate_date AS fx_rate_date,
      CASE WHEN r.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE fx.source END AS fx_source,
      CASE WHEN r.cur IS NULL THEN r.price::numeric ELSE round(r.price * fx.rate, 2) END AS price_usd
    FROM raw_cands r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  ),
  all_cands AS (
    SELECT * FROM conv_cands c
    WHERE (c.cur IS NULL OR c.fx_rate IS NOT NULL)   -- foreign amount with no rate: excluded, never read as USD
      AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
      AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ),
  scored AS (
    SELECT
      c.id AS vehicle_id,
      c.year AS yr,
      c.make AS mk,
      c.model AS mdl,
      c.trim AS tr,
      c.vin AS vi,
      c.price_usd AS sale_price,
      c.mileage AS miles,
      c.color AS clr,
      c.primary_image_url AS image_url,
      c.location AS loc,
      c.source_url AS listing_url,
      c.source AS platform,
      c.auction_end_date AS sold_date,
      c.src_type AS source_type,
      c.price_native, c.cur, c.fx_rate, c.fx_rate_date, c.fx_source,

      -- Year score
      (CASE WHEN p_year IS NOT NULL AND c.year IS NOT NULL
        THEN w_year * GREATEST(0, 1.0 - ABS(c.year - p_year)::numeric / GREATEST(LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50), 1))
        ELSE w_year * 0.5
      END) AS s_year,

      -- Model score
      (CASE
        WHEN p_model IS NULL THEN w_model * 0.5
        WHEN lower(c.model) = lower(p_model) THEN w_model
        WHEN length(public.model_spelling_key(p_model)) >= 2 AND public.model_spelling_key(c.model) = public.model_spelling_key(p_model) THEN w_model
        WHEN lower(c.model) LIKE '%' || lower(p_model) || '%' THEN w_model * 0.7
        WHEN lower(p_model) LIKE '%' || lower(c.model) || '%' THEN w_model * 0.6
        WHEN lower(c.model) LIKE '%' || lower(split_part(p_model, ' ', 1)) || '%' THEN w_model * 0.4
        ELSE 0
      END) AS s_model,

      -- Engine cylinder score
      (CASE
        WHEN ref_cyls IS NULL OR extract_cylinder_count(c.v_engine) IS NULL THEN w_engine_cyl * 0.3
        WHEN extract_cylinder_count(c.v_engine) = ref_cyls THEN w_engine_cyl
        WHEN ABS(extract_cylinder_count(c.v_engine) - ref_cyls) <= 2 THEN w_engine_cyl * 0.5
        ELSE 0
      END) AS s_engine_cyl,

      -- Engine config score
      (CASE
        WHEN ref_eng_cfg IS NULL OR extract_engine_config(c.v_engine) IS NULL THEN w_engine_cfg * 0.3
        WHEN extract_engine_config(c.v_engine) = ref_eng_cfg THEN w_engine_cfg
        ELSE 0
      END) AS s_engine_cfg,

      -- Transmission score
      (CASE
        WHEN ref_trans IS NULL OR classify_transmission(c.v_trans) IS NULL THEN w_trans * 0.3
        WHEN classify_transmission(c.v_trans) = ref_trans THEN w_trans
        ELSE 0
      END) AS s_trans,

      -- Drivetrain score
      (CASE
        WHEN ref_drive IS NULL OR classify_drivetrain(c.v_drive) IS NULL THEN w_drivetrain * 0.3
        WHEN classify_drivetrain(c.v_drive) = ref_drive THEN w_drivetrain
        WHEN classify_drivetrain(c.v_drive) IN ('4WD','AWD') AND ref_drive IN ('4WD','AWD') THEN w_drivetrain * 0.8
        ELSE 0
      END) AS s_drivetrain,

      -- Mileage score
      (CASE
        WHEN p_mileage IS NULL OR c.mileage IS NULL OR p_mileage = 0 THEN w_mileage * 0.3
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.2 THEN w_mileage
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.5 THEN w_mileage * 0.6
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 1.0 THEN w_mileage * 0.3
        ELSE 0
      END) AS s_mileage,

      -- Body style score
      (CASE
        WHEN p_body_style IS NULL OR c.v_body IS NULL THEN w_body * 0.3
        WHEN lower(c.v_body) = lower(p_body_style) THEN w_body
        WHEN lower(c.v_body) LIKE '%' || lower(p_body_style) || '%' THEN w_body * 0.6
        ELSE 0
      END) AS s_body,

      -- Trim score
      (CASE
        WHEN p_trim IS NULL OR c.trim IS NULL THEN w_trim_w * 0.3
        WHEN lower(c.trim) = lower(p_trim) THEN w_trim_w
        WHEN lower(c.trim) LIKE '%' || lower(p_trim) || '%' THEN w_trim_w * 0.6
        ELSE 0
      END) AS s_trim

    FROM all_cands c
  )
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    ROUND(s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim, 1) AS similarity_score,
    jsonb_build_object(
      'year', ROUND(s.s_year, 1),
      'model', ROUND(s.s_model, 1),
      'engine_cyl', ROUND(s.s_engine_cyl, 1),
      'engine_cfg', ROUND(s.s_engine_cfg, 1),
      'transmission', ROUND(s.s_trans, 1),
      'drivetrain', ROUND(s.s_drivetrain, 1),
      'mileage', ROUND(s.s_mileage, 1),
      'body_style', ROUND(s.s_body, 1),
      'trim', ROUND(s.s_trim, 1)
    ) AS score_breakdown,
    s.price_native::numeric AS sale_price_native, s.cur AS currency_code, s.fx_rate, s.fx_rate_date, s.fx_source, p_basis::text
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
END;
$function$;
