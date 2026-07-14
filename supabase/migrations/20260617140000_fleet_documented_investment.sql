-- Make the documented-investment floor durable + queryable instead of a one-off loop. Store the
-- per-vehicle floor on the existing coverage counter (refreshed per-vehicle by the cascade, so it
-- stays current as analysis deepens), and a fleet rollup that sums the stored column instantly.
-- Still a PROJECTION composed from testimony (v3 labor + photo-parts ledger) — no stored facts,
-- recomputed from the observation stack each refresh.
alter table image_coverage_by_vehicle add column if not exists documented_floor_usd numeric;
alter table image_coverage_by_vehicle add column if not exists floor_labor_usd numeric;
alter table image_coverage_by_vehicle add column if not exists floor_parts_usd numeric;
alter table image_coverage_by_vehicle add column if not exists floor_computed_at timestamptz;

create or replace function refresh_vehicle_documented_floor(p_vehicle_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare j jsonb; f numeric;
begin
  j := get_vehicle_documented_investment(p_vehicle_id);
  f := (j->>'documented_floor_USD')::numeric;
  update image_coverage_by_vehicle set
    documented_floor_usd = f,
    floor_labor_usd = (j->'source_dna'->'labor'->>'amount_USD')::numeric,
    floor_parts_usd = (j->>'parts_floor_USD')::numeric,
    floor_computed_at = now()
  where vehicle_id = p_vehicle_id;
  return f;
end $$;

create or replace function get_fleet_documented_investment()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fleet_documented_floor_USD', coalesce(sum(documented_floor_usd),0),
    'fleet_labor_floor_USD', coalesce(sum(floor_labor_usd),0),
    'fleet_parts_floor_USD', coalesce(sum(floor_parts_usd),0),
    'vehicles_priced', count(*) filter (where documented_floor_usd > 0),
    'note', 'labor-dominant floor; parts mostly uncatalogued (OUR gap). Conservative floor, not appraisal.',
    'by_vehicle', (select jsonb_agg(jsonb_build_object(
        'vehicle', coalesce(v.year::text||' '||v.make||' '||v.model,'?'),
        'floor_USD', c.documented_floor_usd, 'labor_USD', c.floor_labor_usd, 'parts_USD', c.floor_parts_usd) order by c.documented_floor_usd desc)
      from image_coverage_by_vehicle c left join vehicles v on v.id=c.vehicle_id where c.documented_floor_usd > 0))
  from image_coverage_by_vehicle;
$$;
grant execute on function refresh_vehicle_documented_floor(uuid), get_fleet_documented_investment() to service_role;
