-- get_vehicle_documented_investment(vehicle_id) — PROJECTION (applied-ontology §III: computed
-- from the observation stack, never stored; nothing asserted) of a built vehicle's DEFENSIBLE
-- VALUE FLOOR = documented labor + documented parts.
--
-- Doctrine (feedback_valuation_block_when_not_defensible): "comps don't price builds; the
-- documented investment ledger is the defensible floor." This composes the two already-built
-- stacks into that one floor — ADDITIVELY. It does NOT modify vehicle_full_picture,
-- compute_inferred_value, or get_vehicle_parts_ledger; it READS them.
--
--   labor_value_USD  = conservative burst-clustered active labor (intent-gated: active minutes
--                      are the bursts of real work the photo stream proves, not photo-span
--                      inflation), valued at the shop rate. This is exactly vehicle_full_picture's
--                      v3_burst_active_USD primitive — computed here the same way so the two
--                      functions never disagree. v1 (duration_minutes) is too sparsely populated
--                      to be a floor; v2 (photo-count) is the optimistic ceiling, not a floor.
--   parts_floor_USD  = get_vehicle_parts_ledger floor — catalog-priced parts the deep-verdict
--                      photo testimony demonstrably shows on the vehicle.
--   documented_floor = labor + parts.
--
-- Every number carries source DNA (amount, source, method, observed_at, trust) per
-- feedback_numbers_carry_source_dna. Catalog prices are SUPPLY-side claims, not asserted facts;
-- unpriced observed parts are OUR catalog-coverage gap, never a market verdict of "no value."
-- PER-VEHICLE only (the 38.9M vehicle_images table makes corpus aggregates time out).
create or replace function get_vehicle_documented_investment(p_vehicle_id uuid)
returns jsonb language plpgsql stable as $$
declare
  v_vehicle        record;
  v_shop_rate      numeric := 160;    -- same constant vehicle_full_picture uses for v1/v2/v3
  v_quality_factor numeric := 0.92;   -- same quality factor vehicle_full_picture uses
  v_burst_min      bigint;
  v_indep_sessions int;
  v_labor_value    numeric;
  v_parts          jsonb;
  v_parts_floor    numeric;
  v_observed_parts int;
  v_priced_parts   int;
  v_unpriced       int;
  v_documented     numeric;
  v_last_photo     date;
  v_labor_conf     text;
  v_parts_conf     text;
begin
  select id, year, make, model, vin into v_vehicle from vehicles where id = p_vehicle_id;
  if not found then
    return jsonb_build_object('error','vehicle not found','vehicle_id',p_vehicle_id);
  end if;

  -- LABOR: burst-clustered active minutes (the conservative, intent-gated method) × rate × quality.
  -- Identical formula to vehicle_full_picture's v3_burst_active_USD.
  v_burst_min  := compute_active_minutes_burst_total(p_vehicle_id, 30);
  v_labor_value := (v_burst_min::numeric / 60) * v_shop_rate * v_quality_factor;

  select count(*) into v_indep_sessions
    from work_sessions
   where vehicle_id = p_vehicle_id and session_type is distinct from 'baseline_backfill';

  -- PARTS: read the already-built parts ledger (catalog-priced photo testimony).
  v_parts          := get_vehicle_parts_ledger(p_vehicle_id);
  v_parts_floor    := coalesce((v_parts->>'parts_investment_floor_USD')::numeric, 0);
  v_observed_parts := coalesce((v_parts->>'observed_parts')::int, 0);
  v_priced_parts   := coalesce((v_parts->>'priced_parts')::int, 0);
  v_unpriced       := v_observed_parts - v_priced_parts;

  v_documented := v_labor_value + v_parts_floor;

  select max(taken_at)::date into v_last_photo
    from vehicle_images where vehicle_id = p_vehicle_id;

  -- Confidence is about the FLOOR's defensibility, not a market verdict.
  v_labor_conf := case
    when v_burst_min = 0 then 'no_labor_evidence'
    when v_burst_min < 600 then 'thin'      -- under 10 active hours documented
    when v_burst_min < 6000 then 'moderate' -- under ~100 active hours
    else 'deep'
  end;
  v_parts_conf := case
    when v_observed_parts = 0 then 'no_parts_evidence'
    when v_priced_parts = 0 then 'observed_unpriced'  -- parts seen, catalog hasn't priced them yet
    when v_priced_parts < v_observed_parts * 0.25 then 'sparse_catalog_coverage'
    else 'moderate_catalog_coverage'
  end;

  return jsonb_build_object(
    'vehicle', jsonb_build_object('id',v_vehicle.id,'year',v_vehicle.year,'make',v_vehicle.make,'model',v_vehicle.model,'vin',v_vehicle.vin),
    'labor_value_USD',       round(v_labor_value, 2),
    'parts_floor_USD',       round(v_parts_floor, 2),
    'parts_unpriced_count',  v_unpriced,
    'documented_floor_USD',  round(v_documented, 2),
    'confidence', jsonb_build_object(
      'labor', v_labor_conf,
      'parts', v_parts_conf,
      'overall', case
        when v_burst_min = 0 and v_observed_parts = 0 then 'no_documented_investment'
        when v_burst_min = 0 or v_observed_parts = 0 then 'partial'
        else 'composed'
      end
    ),
    -- source DNA: every component number is (amount, source, method, observed_at, trust)
    'source_dna', jsonb_build_object(
      'labor', jsonb_build_object(
        'amount_USD',  round(v_labor_value, 2),
        'source',      'work_sessions + vehicle_images burst clustering',
        'method',      format('compute_active_minutes_burst_total(gap=30min)=%s min × $%s/hr × %s quality (v3 conservative, intent-gated)', v_burst_min, v_shop_rate, v_quality_factor),
        'observed_at', v_last_photo,
        'trust',       v_labor_conf,
        'independent_sessions', v_indep_sessions,
        'burst_active_minutes', v_burst_min
      ),
      'parts', jsonb_build_object(
        'amount_USD',  round(v_parts_floor, 2),
        'source',      'vehicle_observations.components_seen (deep_byok, conf>=0.8) joined to catalog_parts supply prices',
        'method',      'get_vehicle_parts_ledger: dedup by normalized part-number, max catalog price_current',
        'observed_at', v_last_photo,
        'trust',       v_parts_conf,
        'observed_parts', v_observed_parts,
        'priced_parts',   v_priced_parts,
        'unpriced_note',  'unpriced observed parts are OUR catalog-coverage gap, not absent value'
      )
    ),
    'doctrine_note', 'Defensible value FLOOR = documented labor + documented parts (comps do not price builds). PROJECTION only — computed from the observation stacks, nothing stored, nothing asserted. Catalog prices are supply-side claims the owner supersedes; this is a floor, never a market verdict.'
  );
end;
$$;
grant execute on function get_vehicle_documented_investment(uuid) to anon, authenticated, service_role;
