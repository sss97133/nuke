-- Micro-atom lane (mandate Phase 5, "the largest open lane"): scene-context signals captured in
-- byok_deep_analysis JSONB (workshop_signals, presence, scene_type, build_phase) but never queryable
-- as rows. This promotes them into typed evidence rows — the same ARM evidence-table pattern as
-- equipment/consumable/part evidence (NOT a new knowledge island). One row per (image, atom_type).
-- Presence testimony only — never an inferred identity (person_present records THAT a person is in
-- frame, not WHO; resolving to a contact is a separate human-in-loop identity step).
create table if not exists public.scene_micro_atom_evidence (
  id                    uuid primary key default gen_random_uuid(),
  vehicle_id            uuid,
  derived_from_image_id uuid,
  observed_at           timestamptz,
  atom_type             text not null,    -- lighting|fixturing|weld_quality|scene_type|build_phase|place_hint|person_present
  atom_value            text not null,
  confidence            numeric,
  source_method         text,
  created_at            timestamptz default now(),
  unique (vehicle_id, derived_from_image_id, atom_type)
);
create index if not exists idx_micro_atom_vehicle on public.scene_micro_atom_evidence(vehicle_id);
create index if not exists idx_micro_atom_type on public.scene_micro_atom_evidence(atom_type, atom_value);
grant select on public.scene_micro_atom_evidence to anon, authenticated;
comment on table public.scene_micro_atom_evidence is 'Scene micro-atoms (Phase 5 lane): workshop_signals/presence/scene_type/build_phase promoted from byok_deep_analysis JSONB into queryable rows. Presence testimony; person_present is THAT-not-WHO.';

create or replace function cascade_micro_atoms(p_vehicle_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with src as (
    select vi.id img, vi.taken_at obs_at, d,
           (d->>'confidence')::numeric conf
    from vehicle_images vi
    cross join lateral (select vi.ai_scan_metadata->'byok_deep_analysis' d) x
    where vi.vehicle_id = p_vehicle_id and vi.is_external = false and vi.vision_gate_status = 'approved'
      and vi.ai_scan_metadata ? 'byok_deep_analysis' and vi.taken_at is not null
  ),
  flat as (
    select img, obs_at, conf, a.atom_type, a.atom_value
    from src
    cross join lateral (values
      ('lighting',       d->'workshop_signals'->>'lighting'),
      ('fixturing',      d->'workshop_signals'->>'fixturing'),
      ('weld_quality',   nullif(d->'workshop_signals'->>'weld_quality','none_visible')),
      ('scene_type',     d->>'scene_type'),
      ('build_phase',    d->>'build_phase_guess'),
      ('place_hint',     d->'presence'->>'place_hint'),
      ('person_present', case when lower(coalesce(d->'presence'->>'person','false'))
                              not in ('false','none','no','','0','null') then d->'presence'->>'person' end)
    ) a(atom_type, atom_value)
    where a.atom_value is not null and a.atom_value <> ''
  ),
  ins as (
    insert into scene_micro_atom_evidence (vehicle_id, derived_from_image_id, observed_at, atom_type, atom_value, confidence, source_method)
    select p_vehicle_id, img, obs_at, atom_type, atom_value, conf, 'photo_micro_cascade_2026-06-18'
    from flat
    on conflict (vehicle_id, derived_from_image_id, atom_type) do nothing
    returning 1)
  select count(*) into n from ins; return n;
end $$;
grant execute on function cascade_micro_atoms(uuid) to service_role;
