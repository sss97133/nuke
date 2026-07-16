-- Equipment derived from photo TESTIMONY, per the applied-ontology canon (papers/
-- applied-ontology-vehicle-domain.md §III/§VI, from-protege-to-production.md): an equipment
-- entity's EXISTENCE is inferred from the observation stack (a tool seen N× in photos =
-- evidence the shop has it), its cost is a CLAIM with provenance (low-trust agentic estimate,
-- superseded by an owner claim — never a stored fact), and its current value is COMPUTED
-- (current_value_computed is GENERATED). Matches the convention of the existing 5 rows
-- (source='photo_evidence_inferred', status='in_service', a notes line citing the evidence).
-- Cost figures here are market-typical agentic estimates (low confidence) — the OWNER's number
-- supersedes via an UPDATE with source='owner'. They are NOT asserted as truth.

insert into equipment (name, category, purchase_cost, est_useful_life_hours, hours_used_observed, source, status, notes)
select * from (values
  ('Engine hoist',              'lift',                250.00,   2000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 99x across analyzed shop photos. Cost = market-typical agentic estimate; supersede with owner cost.'),
  ('Floor jack',                'lift',                150.00,   3000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 115x. Market-typical estimate; owner supersedes.'),
  ('Forklift',                  'lift',              18000.00,  12000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 18x. Big-ticket asset — market-typical estimate, owner cost supersedes.'),
  ('MIG welder',                'power_tool',          850.00,   2000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 19x in fabrication frames. Market-typical estimate; owner supersedes.'),
  ('Angle grinder',             'power_tool',          130.00,   1500.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 26x. Estimate; owner supersedes.'),
  ('Impact wrench',             'power_tool',          220.00,   2000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 18x. Estimate; owner supersedes.'),
  ('Cordless drill',            'power_tool',          180.00,   2000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 12x. Estimate; owner supersedes.'),
  ('Engine stand',              'support',             160.00,   3000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 25x. Estimate; owner supersedes.'),
  ('Jack stand',                'support',              80.00,   8000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 35x (jack stand/stands). Estimate; owner supersedes.'),
  ('Rolling tool chest',        'storage',             600.00,  15000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 52x (chest/cart/cabinet). Estimate; owner supersedes.'),
  ('Workbench',                 'shop_infrastructure', 350.00,  25000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 45x (workbench/work bench). Estimate; owner supersedes.'),
  ('Step ladder',               'access',               90.00,   5000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 56x (step ladder/stool). Estimate; owner supersedes.'),
  ('Snap-on compression gauge', 'measuring',           220.00,   3000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 14x. Estimate; owner supersedes.'),
  ('Digital caliper',           'measuring',            45.00,   4000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 14x. Estimate; owner supersedes.'),
  ('Tape measure',              'measuring',            25.00,   5000.0, 0.0, 'photo_evidence_inferred', 'in_service', 'Observed 140x. Estimate; owner supersedes.')
) as e(name, category, purchase_cost, est_useful_life_hours, hours_used_observed, source, status, notes)
where not exists (select 1 from equipment x where lower(x.name) = lower(e.name));

-- resolve_equipment(tool_string) — maps a free-text observed tool to an equipment entity by
-- name containment (most-specific match wins). Returns null for unmatched/consumable strings
-- (masking tape, shop rag) so they are surfaced, not silently dropped.
create or replace function resolve_equipment(p_tool text)
returns uuid language sql stable as $$
  select e.id from equipment e
  where lower(p_tool) = lower(regexp_replace(e.name, '\s*\(.*\)', ''))
     or lower(e.name) like '%' || lower(p_tool) || '%'
     or lower(p_tool) like '%' || lower(regexp_replace(e.name, '\s*\(.*\)', '')) || '%'
  order by length(e.name) desc
  limit 1;
$$;

-- cascade_equipment_evidence(vehicle_id) — the ACTOR-EVENT testimony: equipment used on a
-- vehicle, on a labor day, documented by a photo. One row per (equipment, labor-day) with the
-- day's clustered labor minutes as the use-window. Idempotent (UNIQUE equipment_id+image).
-- UNCONFIRMED — the human signs value; this is observed evidence, not a billed fact.
create or replace function cascade_equipment_evidence(p_vehicle_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with frames as (
    select vi.id img, vi.taken_at::date d,
           resolve_equipment(lower(jsonb_array_elements_text(vi.ai_scan_metadata->'byok_deep_analysis'->'workshop_signals'->'tools_visible'))) eq_id
    from vehicle_images vi
    where vi.vehicle_id = p_vehicle_id and vi.is_external = false and vi.vision_gate_status = 'approved'
      and vi.ai_scan_metadata->'byok_deep_analysis'->>'intent' = 'labor'
      and (vi.ai_scan_metadata->'byok_deep_analysis'->>'intent_confidence')::numeric >= 0.6
      and vi.ai_scan_metadata->'byok_deep_analysis'->'workshop_signals' ? 'tools_visible'
      and vi.taken_at is not null
  ),
  per_day as (  -- one (equipment, day): a representative image + the day's labor minutes
    select eq_id, d, (array_agg(img))[1] rep_img,
           coalesce((select ws.duration_minutes from work_sessions ws
                     where ws.vehicle_id = p_vehicle_id and ws.session_date = frames.d limit 1), 30) mins
    from frames where eq_id is not null group by eq_id, d
  ),
  ins as (
    insert into equipment_usage_evidence
      (equipment_id, derived_from_image_id, vehicle_id, observed_at, use_context, estimated_use_minutes, visible_state, source_method, confidence)
    select pd.eq_id, pd.rep_img, p_vehicle_id, pd.d, 'observed_in_labor_frame', pd.mins, 'in_use',
           'photo_testimony_cascade_2026-06-17', 0.7
    from per_day pd
    where not exists (select 1 from equipment_usage_evidence x
                      where x.equipment_id = pd.eq_id and x.derived_from_image_id = pd.rep_img)
    returning 1)
  select count(*) into n from ins; return n;
end $$;

-- aggregate observed usage into equipment.hours_used_observed (COMPUTED from the evidence
-- stack — current_value_computed then auto-recomputes via its GENERATED expression).
create or replace function refresh_equipment_hours()
returns void language sql security definer set search_path = public as $$
  update equipment e set
    hours_used_observed = coalesce((select sum(estimated_use_minutes)/60.0 from equipment_usage_evidence ue where ue.equipment_id = e.id), e.hours_used_observed),
    hours_used_last_computed_at = now()
  where exists (select 1 from equipment_usage_evidence ue where ue.equipment_id = e.id);
$$;

grant execute on function resolve_equipment(text), cascade_equipment_evidence(uuid), refresh_equipment_hours() to service_role;
