-- Supply-side seeding from DEMAND (per .claude/rules/supply-side.md): the K5's most-observed,
-- highest-value parts read $0 because only LMC repro panels are catalogued. These 4 are seeded
-- with WEB-SOURCED conservative-floor prices (provenance in data_source + min/max band) so the
-- documented-investment floor reflects real parts investment. Prices are price-testimony with a
-- short half-life (price_updated_at) — NOT asserted as eternal fact; supersedable by a fresh
-- scrape or an owner receipt. Conservative average_price chosen for a FLOOR (defensible-low).
insert into parts_catalog (part_number, name, brand, category, description,
   compatible_makes, compatible_models, compatible_years, average_price, min_price, max_price,
   price_updated_at, data_source, specifications)
select * from (values
  ('M130','MoTeC M130 ECU','MoTeC','electrical'::parts_category,
   'Standalone M1 engine management ECU. Floor = new base price; firmware (GPR ~$1149) extra and not counted.',
   array['Chevrolet'], array['Blazer','K5'], array[1977], 2395.00, 1800.00, 2645.00, now(),
   'web_research_2026-06_realstreetperformance+johnreedracing', '{"sourced_anchor":"$2395 new base; $1860 GP Lite; $2645 ruggedised"}'::jsonb),
  ('HOLLEYEFI','Holley Terminator X EFI (LS)','Holley','fuel_system'::parts_category,
   'Terminator X standalone EFI/powertrain mgmt for LS. Floor = base kit price.',
   array['Chevrolet'], array['Blazer','K5'], array[1977], 999.00, 999.00, 2200.00, now(),
   'web_research_2026-06_holley.com', '{"sourced_anchor":"$999 base, $1229-2200 X Max configs"}'::jsonb),
  ('GMLS3','Chevrolet Performance LS3 6.2L long-block','Chevrolet Performance','engine'::parts_category,
   'LS3 long-block. Floor = conservative used/crate midpoint; new crate (430hp) anchors near $8000.',
   array['Chevrolet'], array['Blazer','K5'], array[1977], 5000.00, 4000.00, 8000.00, now(),
   'web_research_2026-06_jegs+chevroletperformance', '{"sourced_anchor":"$8000 crate 430hp base; built 525hp $12197"}'::jsonb),
  ('DURASTOP','ACDelco DuraStop brake caliper','ACDelco','brakes'::parts_category,
   'Loaded/friction-ready disc brake caliper, per corner. Floor = mid retail.',
   array['Chevrolet'], array['Blazer','K5'], array[1977], 75.00, 48.00, 114.00, now(),
   'web_research_2026-06_advanceautoparts+walmart', '{"sourced_anchor":"$48-114 ea"}'::jsonb)
) as v(part_number,name,brand,category,description,compatible_makes,compatible_models,compatible_years,average_price,min_price,max_price,price_updated_at,data_source,specifications)
where not exists (select 1 from parts_catalog p where p.part_number = v.part_number);

-- demand-side fitment link (these were observed ON the K5)
insert into parts_fitment (part_id, year_min, year_max, make, model_pattern, engine_pattern, confidence, source)
select p.id, 1973, 1991, 'Chevrolet', 'Blazer|K5', 'LS', 0.7, 'observed_on_k5_photos_2026-06'
from parts_catalog p where p.part_number in ('M130','HOLLEYEFI','GMLS3','DURASTOP')
  and not exists (select 1 from parts_fitment f where f.part_id = p.id);

-- teach the ledger to also match parts_catalog by distinctive-token name containment (cheap: ~105
-- rows). The token lives in parts_catalog.part_number (M130/HOLLEYEFI/GMLS3/DURASTOP) and is matched
-- against the observed component's normalized label OR part_number_guess. price = coalesce(exact
-- catalog_parts SKU match, parts_catalog name match). Still a projection over testimony.
create or replace function get_vehicle_parts_ledger(p_vehicle_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with raw as (
    select c->>'label' label, c->>'part_number_guess' pn,
           upper(regexp_replace(c->>'part_number_guess','[^A-Za-z0-9]','','g')) pn_norm,
           upper(regexp_replace(coalesce(c->>'label','')||' '||(c->>'part_number_guess'),'[^A-Za-z0-9]','','g')) ctx_norm,
           (c->>'confidence')::numeric conf
    from vehicle_observations vo, lateral jsonb_array_elements(vo.structured_data->'components_seen') c
    where vo.vehicle_id = p_vehicle_id and vo.structured_data->>'analysis_kind'='image_deep_byok'
      and vo.is_superseded = false and nullif(c->>'part_number_guess','') is not null
      and (c->>'confidence')::numeric >= 0.8
  ),
  parts as (select pn_norm, max(label) label, min(pn) pn, max(conf) conf, count(*) sightings,
                   max(ctx_norm) ctx_norm from raw where length(pn_norm) >= 3 group by pn_norm),
  matched as (
    select p.*,
           coalesce(cp.name, pc.name) catalog_name,
           coalesce(cp.price_current, pc.average_price) price_current,
           case when cp.name is not null then 'catalog_parts_sku' when pc.name is not null then 'parts_catalog_name' end matched_via
    from parts p
    left join lateral (select name, price_current from catalog_parts cp
                       where upper(regexp_replace(cp.part_number,'[^A-Za-z0-9]','','g')) = p.pn_norm
                         and cp.price_current is not null order by cp.price_current desc limit 1) cp on true
    left join lateral (select name, average_price from parts_catalog pc
                       where pc.average_price is not null and length(pc.part_number) >= 4
                         and p.ctx_norm like '%'||upper(regexp_replace(pc.part_number,'[^A-Za-z0-9]','','g'))||'%'
                       order by pc.average_price desc limit 1) pc on true)
  select jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'observed_parts', (select count(*) from matched),
    'priced_parts', (select count(distinct catalog_name) from matched where price_current is not null),
    'parts_investment_floor_USD', (select coalesce(sum(price),0) from (select distinct catalog_name, price_current price from matched where price_current is not null) d),
    'unpriced_note', 'unmatched parts are OUR catalog-coverage gap, not absent value',
    'parts', (select jsonb_agg(jsonb_build_object('label',label,'part_number',pn,'sightings',sightings,
                 'confidence',conf,'catalog_match',catalog_name,'matched_via',matched_via,'price_USD',price_current) order by price_current desc nulls last, conf desc)
              from matched));
$$;
