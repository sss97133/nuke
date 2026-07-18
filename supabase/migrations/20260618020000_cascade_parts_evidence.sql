-- ARM6 — parts as queryable PRESENCE testimony, not dead-ending in JSONB (mandate Phase 5 / W4).
-- Sibling of cascade_consumable_evidence / cascade_equipment_evidence. A component seen in a frame
-- (byok_deep_analysis.components_seen[].part_number_guess) becomes one part_observation_evidence row
-- per (vehicle, image, guess): "part X was visible in photo Y." It resolves to a parts_catalog SKU
-- when possible (carrying the catalog price as supersedable price-testimony with observed_at), and
-- when it can't, the row still lands with matched=false so the catalog-coverage GAP is queryable —
-- never silently dropped. Presence is testimony; the VALUE floor stays the conservative computed
-- projection (get_vehicle_documented_investment). Human signs value.
create table if not exists public.part_observation_evidence (
  id                    uuid primary key default gen_random_uuid(),
  catalog_part_id       uuid references parts_catalog(id),
  catalog_match_kind    text,        -- 'catalog_parts_sku' | 'parts_catalog_name' | null
  observed_label        text,
  part_number_guess     text,
  derived_from_image_id uuid,
  vehicle_id            uuid,
  observed_at           timestamptz not null,
  bbox                  jsonb,
  confidence            numeric,
  matched               boolean default false,
  unit_price_usd        numeric,     -- catalog price at observation time; price-testimony, supersedable
  source_method         text,
  created_at            timestamptz default now(),
  unique (vehicle_id, derived_from_image_id, part_number_guess)
);
create index if not exists idx_part_obs_vehicle on public.part_observation_evidence(vehicle_id);
create index if not exists idx_part_obs_catalog on public.part_observation_evidence(catalog_part_id);
create index if not exists idx_part_obs_image on public.part_observation_evidence(derived_from_image_id);
grant select on public.part_observation_evidence to anon, authenticated;
comment on table public.part_observation_evidence is 'Per-photo part-visible atoms (ARM6 testimony). Resolves observed components to parts_catalog SKUs (price = supersedable price-testimony) or lands matched=false to surface the catalog gap. Presence, never a fabricated purchase. Owner signs value.';

-- cascade_parts_evidence(vehicle_id) — emits ARM6 rows from the deep verdicts. Matching mirrors
-- get_vehicle_parts_ledger: catalog_parts by exact normalized part_number, else parts_catalog by
-- distinctive-token name containment against the observed label+guess. Idempotent on the unique key.
create or replace function cascade_parts_evidence(p_vehicle_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with comps as (
    select vi.id img, vi.taken_at obs_at,
           c->>'label' label, c->>'part_number_guess' pn, c->'bbox' bbox,
           (c->>'confidence')::numeric conf,
           upper(regexp_replace(c->>'part_number_guess','[^A-Za-z0-9]','','g')) pn_norm,
           upper(regexp_replace(coalesce(c->>'label','')||' '||(c->>'part_number_guess'),'[^A-Za-z0-9]','','g')) ctx_norm
    from vehicle_images vi, lateral jsonb_array_elements(vi.ai_scan_metadata->'byok_deep_analysis'->'components_seen') c
    where vi.vehicle_id = p_vehicle_id and vi.is_external = false and vi.vision_gate_status = 'approved'
      and vi.ai_scan_metadata->'byok_deep_analysis' ? 'components_seen'
      and vi.taken_at is not null
      and nullif(c->>'part_number_guess','') is not null and (c->>'confidence')::numeric >= 0.8
  ),
  resolved as (
    select comps.*, cp.cid cp_id, cp.nm cp_name, cp.price cp_price,
           pc.cid pc_id, pc.nm pc_name, pc.price pc_price
    from comps
    left join lateral (select id cid, name nm, price_current price from catalog_parts x
        where x.price_current is not null
          and upper(regexp_replace(x.part_number,'[^A-Za-z0-9]','','g')) = comps.pn_norm
        order by x.price_current desc limit 1) cp on true
    left join lateral (select id cid, name nm, average_price price from parts_catalog y
        where y.average_price is not null and length(y.part_number) >= 4
          and comps.ctx_norm like '%'||upper(regexp_replace(y.part_number,'[^A-Za-z0-9]','','g'))||'%'
        order by y.average_price desc limit 1) pc on true
  ),
  ins as (
    insert into part_observation_evidence
      (catalog_part_id, catalog_match_kind, observed_label, part_number_guess, derived_from_image_id,
       vehicle_id, observed_at, bbox, confidence, matched, unit_price_usd, source_method)
    select coalesce(cp_id, pc_id),
           case when cp_id is not null then 'catalog_parts_sku' when pc_id is not null then 'parts_catalog_name' end,
           label, pn, img, p_vehicle_id, obs_at, bbox, conf,
           (cp_id is not null or pc_id is not null), coalesce(cp_price, pc_price),
           'photo_testimony_cascade_2026-06-18'
    from resolved
    where not exists (select 1 from part_observation_evidence x
                      where x.vehicle_id = p_vehicle_id and x.derived_from_image_id = resolved.img
                        and x.part_number_guess = resolved.pn)
    returning 1)
  select count(*) into n from ins; return n;
end $$;
grant execute on function cascade_parts_evidence(uuid) to service_role;
