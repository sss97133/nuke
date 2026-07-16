-- get_vehicle_parts_ledger(vehicle_id) — PROJECTION (per applied-ontology §III: computed from
-- the observation stack, never stored) of the parts a vehicle demonstrably carries, derived
-- from deep-verdict components_seen.part_number_guess (testimony, conf>=0.8), joined to the
-- existing catalog_parts (supply side) for price. This is the documented investment ledger —
-- the defensible value FLOOR for built vehicles (feedback_valuation_block_when_not_defensible:
-- comps don't price builds; the investment ledger does). No new table, no asserted fact —
-- catalog prices are supply-side claims; unmatched parts surface as OUR intake gap, not a verdict.
create or replace function get_vehicle_parts_ledger(p_vehicle_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with raw as (
    select c->>'label' label, c->>'part_number_guess' pn,
           upper(regexp_replace(c->>'part_number_guess','[^A-Za-z0-9]','','g')) pn_norm,
           (c->>'confidence')::numeric conf
    from vehicle_observations vo, lateral jsonb_array_elements(vo.structured_data->'components_seen') c
    where vo.vehicle_id = p_vehicle_id and vo.structured_data->>'analysis_kind'='image_deep_byok'
      and vo.is_superseded = false and nullif(c->>'part_number_guess','') is not null
      and (c->>'confidence')::numeric >= 0.8
  ),
  parts as (  -- dedup by normalized part-number guess
    select pn_norm, max(label) label, min(pn) pn, max(conf) conf, count(*) sightings
    from raw where length(pn_norm) >= 3 group by pn_norm
  ),
  matched as (
    select p.*, cp.name catalog_name, cp.price_current
    from parts p
    left join lateral (select name, price_current from catalog_parts cp
                       where upper(regexp_replace(cp.part_number,'[^A-Za-z0-9]','','g')) = p.pn_norm
                         and cp.price_current is not null order by cp.price_current desc limit 1) cp on true
  )
  select jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'observed_parts', (select count(*) from matched),
    'priced_parts', (select count(*) from matched where price_current is not null),
    'parts_investment_floor_USD', (select coalesce(sum(price_current),0) from matched),
    'unpriced_note', 'unmatched parts are OUR catalog-coverage gap, not absent value',
    'parts', (select jsonb_agg(jsonb_build_object('label',label,'part_number',pn,'sightings',sightings,
                 'confidence',conf,'catalog_match',catalog_name,'price_USD',price_current) order by price_current desc nulls last, conf desc)
              from matched)
  );
$$;
grant execute on function get_vehicle_parts_ledger(uuid) to anon, authenticated, service_role;
