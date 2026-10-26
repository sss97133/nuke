-- shadow-only: make-pool comp variant over make_canonical. No live function is changed.
create or replace function public.make_texts_for_key(p_make text, p_year integer default null, p_pool boolean default true)
returns text[] language sql stable set search_path to 'public' as $f$
  with k as (select case when p_pool then public.make_comp_pool_key(p_make,p_year) else public.make_canonical_key(p_make,p_year) end key),
  c as (
    select lower(p_make) t
    union select lower(alias_text) from public.make_alias_ref where retired_at is null
    union select lower(canonical_make) from public.make_alias_ref where retired_at is null
    union select lower(canonical_name) from public.canonical_makes
    union select lower(display_name) from public.canonical_makes where display_name is not null
    union select lower(a) from public.canonical_makes, unnest(coalesce(aliases,'{}'::text[])) a)
  select array_agg(distinct t order by t) from c, k
  where t is not null and t<>'' and (case when p_pool then public.make_comp_pool_key(t,p_year) else public.make_canonical_key(t,p_year) end) = k.key
$f$;
comment on function public.make_texts_for_key(text,integer,boolean) is 'make texts sharing make_canonical key (p_pool=false) or comp-pool key incl. successor_brand (p_pool=true). Tuner/replica never included.';

create or replace function public.shadow_get_comps_scored_mc(p_make text, p_model text default null, p_year integer default null, p_year_range integer default 5, p_engine_type text default null, p_transmission text default null, p_drivetrain text default null, p_mileage integer default null, p_trim text default null, p_body_style text default null, p_min_price numeric default null, p_max_price numeric default null, p_exclude_vehicle_id uuid default null, p_limit integer default 20)
returns table(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
language sql stable set search_path to 'public' as $f$
  select g.* from unnest(coalesce(public.make_texts_for_key(p_make,p_year,true), array[lower(p_make)])) t
  cross join lateral public.get_comps_scored(t,p_model,p_year,p_year_range,p_engine_type,p_transmission,p_drivetrain,p_mileage,p_trim,p_body_style,p_min_price,p_max_price,p_exclude_vehicle_id,p_limit) g
  order by g.similarity_score desc, g.sold_date desc nulls last
  limit least(greatest(coalesce(p_limit,20),1),200)
$f$;
comment on function public.shadow_get_comps_scored_mc(text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer) is 'SHADOW ONLY (RULE43): get_comps_scored pooled over make_canonical comp-pool make texts. Not called by any live path.';
