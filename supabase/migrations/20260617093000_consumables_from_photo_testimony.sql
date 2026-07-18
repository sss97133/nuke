-- Consumables derived from photo TESTIMONY — the ARM5 sibling of the equipment migration
-- (20260617090000_equipment_from_photo_testimony.sql), per the applied-ontology canon
-- (papers/applied-ontology-vehicle-domain.md §III/§VI, from-protege-to-production.md).
--
-- A consumable's EXISTENCE is inferred from the observation stack: masking tape seen 13×,
-- masking paper 7×, shop rag 8×, body filler, primer/paint, abrasives across analyzed K5
-- photos = evidence the shop stocks and uses these. Its cost_per_unit is a CLAIM with
-- provenance (low-trust agentic market-typical estimate, SUPERSEDED by an owner claim —
-- never asserted as truth). current_stock_estimate is intentionally LEFT NULL: a photo
-- can observe a consumable's PRESENCE/USE but cannot measure how much remains on the shelf
-- or how much was consumed. We record presence as testimony (consumable_usage_evidence),
-- NOT a fabricated decrement.
--
-- The consumables table has no `source` column (it predates the source convention), so the
-- inference provenance lives in `notes` — matching how the equipment rows cite their evidence.

-- ── 1. SEED the recurring observed consumables ────────────────────────────────────────────
-- Counts in notes are real observation tallies from vehicle_images byok_deep_analysis
-- tools_visible on the 1977 K5 Blazer (vehicle e08bf694-970f-4cbe-8a74-8715158a0f2e).
-- cost_per_unit = market-typical agentic estimate (low confidence); owner number supersedes.
-- current_stock_estimate stays NULL — never fabricate a shelf count from a photo.
insert into consumables (name, category, unit_of_measure, reorder_level, current_stock_estimate, cost_per_unit, notes)
select * from (values
  ('Masking tape',    'masking',   'roll',  4,  null::int,  6.50, 'photo_evidence_inferred: observed 13x in K5 shop frames (masking tape). cost_per_unit = market-typical agentic estimate, owner supersedes. Stock NULL — a photo cannot count rolls on the shelf.'),
  ('Masking paper',   'masking',   'roll',  2,  null::int, 14.00, 'photo_evidence_inferred: observed 7x (masking paper) on paint-prep days. Estimate; owner supersedes. Stock unmeasurable from photo.'),
  ('Body filler',     'filler',    'tube',  2,  null::int, 22.00, 'photo_evidence_inferred: body filler + spreader observed on 2021-05-16 prep day. Estimate; owner supersedes. Consumed-amount not asserted.'),
  ('Sandpaper / abrasive disc', 'abrasive', 'each', 10, null::int, 1.80, 'photo_evidence_inferred: mirka abrasives, sanding disc marks, abrasive tool observed. Estimate; owner supersedes.'),
  ('Primer',          'paint',     'quart', 1,  null::int, 38.00, 'photo_evidence_inferred: primer/paint surfaces observed in state_observations + paint frames. Estimate; owner supersedes. Quantity used not asserted.'),
  ('Paint',           'paint',     'quart', 1,  null::int, 65.00, 'photo_evidence_inferred: aerosol paint / spray paint can / paint mixing table observed. Estimate; owner supersedes. Coverage/usage not asserted.'),
  ('Shop rags',       'cleaning',  'each',  20, null::int,  0.60, 'photo_evidence_inferred: shop rag/shop towel observed 8x+. Estimate; owner supersedes.'),
  ('Nitrile gloves',  'ppe',       'pair',  50, null::int,  0.35, 'photo_evidence_inferred: nitrile/work/leather gloves observed across labor frames. Estimate; owner supersedes.'),
  ('Adhesive remover','cleaning',  'can',   2,  null::int, 11.00, 'photo_evidence_inferred: 3M adhesive remover observed 3x. Estimate; owner supersedes.')
) as c(name, category, unit_of_measure, reorder_level, current_stock_estimate, cost_per_unit, notes)
where not exists (select 1 from consumables x where lower(x.name) = lower(c.name));

-- ── 2. consumable_usage_evidence — per-photo PRESENCE testimony ───────────────────────────
-- Mirrors equipment_usage_evidence exactly. One row per (consumable, photo): "consumable X
-- was visible in photo Y on a labor day." UNCONFIRMED observed evidence, never a billed fact
-- and never a measured consumption quantity. The human signs value; this is testimony.
create table if not exists public.consumable_usage_evidence (
  id                    uuid primary key default gen_random_uuid(),
  consumable_id         uuid references consumables(id),
  derived_from_image_id uuid,
  vehicle_id            uuid,
  technician_id         uuid,
  observed_at           timestamptz not null,
  use_context           text,     -- 'observed_in_labor_frame'
  visible_state         text,     -- 'present_in_frame' (NOT 'consumed N units' — unmeasurable)
  source_method         text,
  confidence            numeric,
  notes                 text,
  created_at            timestamptz default now(),
  unique (consumable_id, derived_from_image_id)
);
create index if not exists idx_cu_evidence_consumable on public.consumable_usage_evidence(consumable_id);
create index if not exists idx_cu_evidence_observed on public.consumable_usage_evidence(observed_at desc);
grant select on public.consumable_usage_evidence to anon, authenticated;

comment on table public.consumable_usage_evidence is 'Per-photo consumable-visible atoms (ARM5 testimony). "Consumable X is visible in photo Y on a labor day → +1 presence-evidence." We record PRESENCE, never a fabricated consumed quantity — a photo cannot measure how much paint/tape was used. Owner signs value.';

-- ── 3. resolve_consumable(observed_string) — maps a free-text observed material to a row ──
-- Same shape as resolve_equipment: most-specific match wins; returns null for non-consumable
-- strings (engine hoist, tape measure) so they stay surfaced for equipment, not mis-bound.
-- The synonym CTE folds the observed vocabulary (shop towel→Shop rags, bondo→Body filler,
-- aerosol/spray paint→Paint, sanding disc/mirka→Sandpaper, etc.) onto the seeded names.
create or replace function resolve_consumable(p_str text)
returns uuid language sql stable as $$
  with norm as (
    select case
      when lower(p_str) ~ 'masking tape'                         then 'masking tape'
      when lower(p_str) ~ 'masking paper|paint paper'            then 'masking paper'
      when lower(p_str) ~ 'body filler|bondo|filler spreader'    then 'body filler'
      when lower(p_str) ~ 'sandpaper|sanding disc|abrasive|mirka|sanding pad|sand paper'
                                                                  then 'sandpaper / abrasive disc'
      when lower(p_str) ~ 'primer'                               then 'primer'
      when lower(p_str) ~ 'aerosol paint|spray paint|paint can|paint mixing|paint marker|^paint$|wet paint|base coat|clear coat'
                                                                  then 'paint'
      when lower(p_str) ~ 'shop rag|shop towel|microfiber|rag'   then 'shop rags'
      when lower(p_str) ~ 'glove'                                then 'nitrile gloves'
      when lower(p_str) ~ 'adhesive remover|3m adhesive'         then 'adhesive remover'
      else null
    end nm
  )
  select c.id from consumables c, norm
  where norm.nm is not null and lower(c.name) = norm.nm
  limit 1;
$$;

-- ── 4. cascade_consumable_evidence(vehicle_id) — the ARM5 cascade ──────────────────────────
-- Reads consumable strings out of tools_visible (where vision co-mingles materials with
-- tools — resolve_equipment correctly returns null for them, leaving them for us). Emits one
-- presence-evidence row per (consumable, labor-day, representative photo). Idempotent on
-- (consumable_id, derived_from_image_id). visible_state = 'present_in_frame' — NEVER a count.
create or replace function cascade_consumable_evidence(p_vehicle_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with frames as (
    select vi.id img, vi.taken_at::date d,
           resolve_consumable(lower(jsonb_array_elements_text(vi.ai_scan_metadata->'byok_deep_analysis'->'workshop_signals'->'tools_visible'))) c_id
    from vehicle_images vi
    where vi.vehicle_id = p_vehicle_id and vi.is_external = false and vi.vision_gate_status = 'approved'
      and vi.ai_scan_metadata->'byok_deep_analysis'->>'intent' = 'labor'
      and (vi.ai_scan_metadata->'byok_deep_analysis'->>'intent_confidence')::numeric >= 0.6
      and vi.ai_scan_metadata->'byok_deep_analysis'->'workshop_signals' ? 'tools_visible'
      and vi.taken_at is not null
  ),
  per_day as (  -- one (consumable, day): a representative image
    select c_id, d, (array_agg(img))[1] rep_img
    from frames where c_id is not null group by c_id, d
  ),
  ins as (
    insert into consumable_usage_evidence
      (consumable_id, derived_from_image_id, vehicle_id, observed_at, use_context, visible_state, source_method, confidence)
    select pd.c_id, pd.rep_img, p_vehicle_id, pd.d, 'observed_in_labor_frame', 'present_in_frame',
           'photo_testimony_cascade_2026-06-17', 0.65
    from per_day pd
    where not exists (select 1 from consumable_usage_evidence x
                      where x.consumable_id = pd.c_id and x.derived_from_image_id = pd.rep_img)
    returning 1)
  select count(*) into n from ins; return n;
end $$;

grant execute on function resolve_consumable(text), cascade_consumable_evidence(uuid) to service_role;
