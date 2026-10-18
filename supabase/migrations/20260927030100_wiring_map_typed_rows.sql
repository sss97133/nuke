-- Wiring map: typed rows for every wire end, plug and open call.
--
-- WHY: owner, 2026-09-27: "it belongs as rows and columns not raw text". The vehicle's wiring map lets the owner
-- and agents work one target (a plug, a wire end, an open call) at a time, with group context
-- (section -> truck) above. That needs wires that link to their plugs and cavities, plugs that link to
-- their device, and open calls with alternatives and dependencies. Design: docs/wiring/WIRING_SUBSTRATE_V2_SPEC.md
-- (owner-approved 2026-06-10); plan approved 2026-09-27.
--
-- SCHEMA_LAW pre-mint checklist (lofficiel-concierge/supabase/SCHEMA_LAW.md):
--  §1 search: harness_endpoints (per-design endpoint instances with canvas coords, typed endpoint_type) is REUSED as
--     the map node / plug-on-this-vehicle. vehicle_custom_circuits (wires), wire_termination_specs (wire ends) and
--     wiring_decisions (calls) are EXTENDED. Nothing holds a call's alternatives or the calls' dependencies (the
--     design structure matrix) -> 2 new tables, plain CREATE TABLE so a collision fails loudly.
--  §2 facts stay observations first: 754 K5 wiring observations (2026-09-26) are the evidence; these rows are the
--     queryable current state the map needs (joins by cavity, dependency walks, ranking of placement spots).
--  §3 DNA columns use the canonical names; trust speaks T1/T2/T3.
--  §4 corrections are supersession (is_superseded / superseded_by); nothing here UPDATEs a fact column.
--  §5 invariants are CHECKs and FKs below; attack-tested in a rolled-back transaction before merge.
--  §6 writers: the wiring loader (service role) now; the map's own write path later. Browser writes stay limited to
--     vehicle_custom_circuits.build_state (existing column grant).
--  §7 RLS: public read where the vehicle is public (mirrors vehicle_custom_circuits / vehicle_observations); writes
--     service role (plus the existing owner policies on harness_endpoints).

-- ---------------------------------------------------------------- shared vocabularies (as CHECKs, listed here)
-- trust:          T1 owner/operator-confirmed · T2 attributed/relayed · T3 scraped/inferred
-- design_status:  concept (on the list, not decided) · decided
-- work_status:    open · in_progress · needs_owner · done · blocked
-- harness_section: engine · power_spine · comms · dash_cabin · body_convenience · lighting_front · lighting_rear ·
--                  powertrain_chassis
-- family:         terminal/contact family at a plug: ssc · d38999_20 · gt150 · mp150 · ev1 · kit_terminal ·
--                 te_amp_plug · ring_small · lug · miniseal · solder_sleeve · xlr_solder · unknown

-- ---------------------------------------------------------------- harness_endpoints = map nodes / plugs on this vehicle
alter table public.harness_endpoints
  add column code text,
  add column manifest_device_id uuid references public.vehicle_build_manifest(id) on delete set null,
  add column family text check (family in ('ssc','d38999_20','gt150','mp150','ev1','kit_terminal','te_amp_plug',
                                            'ring_small','lug','miniseal','solder_sleeve','xlr_solder','unknown')),
  add column harness_section text check (harness_section in ('engine','power_spine','comms','dash_cabin','body_convenience',
                                                             'lighting_front','lighting_rear','powertrain_chassis')),
  add column design_status text not null default 'concept' check (design_status in ('concept','decided')),
  add column work_status text not null default 'open' check (work_status in ('open','in_progress','needs_owner','done','blocked')),
  add column assignee text check (assignee ~ '^(owner|dave|agent:[a-z0-9_.-]+)$'),
  add column pos_x_m numeric,
  add column pos_y_m numeric,
  add column pos_z_m numeric,
  add column pos_source text,
  add column source text,
  add column method text,
  add column observed_at timestamptz,
  add column trust text check (trust in ('T1','T2','T3')),
  add column confidence_score numeric check (confidence_score between 0 and 1),
  add column is_superseded boolean not null default false,
  add column superseded_by uuid references public.harness_endpoints(id);

create unique index harness_endpoints_design_code_live
  on public.harness_endpoints (design_id, code) where code is not null and is_superseded = false;

-- ---------------------------------------------------------------- vehicle_custom_circuits = wires, ends linked
alter table public.vehicle_custom_circuits
  add column from_endpoint_id uuid references public.harness_endpoints(id) on delete set null,
  add column to_endpoint_id uuid references public.harness_endpoints(id) on delete set null,
  add column from_cavity text,
  add column to_cavity text,
  add column design_status text not null default 'concept' check (design_status in ('concept','decided')),
  add column harness_section text check (harness_section in ('engine','power_spine','comms','dash_cabin','body_convenience',
                                                             'lighting_front','lighting_rear','powertrain_chassis')),
  add column source text,
  add column method text,
  add column observed_at timestamptz,
  add column trust text check (trust in ('T1','T2','T3')),
  add column confidence_score numeric check (confidence_score between 0 and 1),
  add column is_superseded boolean not null default false,
  add column superseded_by uuid references public.vehicle_custom_circuits(id);

create index vehicle_custom_circuits_live_by_overlay
  on public.vehicle_custom_circuits (overlay_id, circuit_code) where is_superseded = false;

-- ---------------------------------------------------------------- wire_termination_specs = wire ends, keyed by circuit + cavity
alter table public.wire_termination_specs
  add column circuit_id uuid references public.vehicle_custom_circuits(id) on delete set null,
  add column endpoint_id uuid references public.harness_endpoints(id) on delete set null,
  add column wire_code text,
  add column cavity text,
  add column source text,
  add column method text,
  add column observed_at timestamptz,
  add column trust text check (trust in ('T1','T2','T3')),
  add column confidence_score numeric check (confidence_score between 0 and 1),
  add column is_superseded boolean not null default false,
  add column superseded_by uuid references public.wire_termination_specs(id);

create unique index wire_termination_specs_end_live
  on public.wire_termination_specs (circuit_id, endpoint_id) where circuit_id is not null and is_superseded = false;

-- ---------------------------------------------------------------- wiring_decisions = the open calls
alter table public.wiring_decisions
  add column decision_kind text check (decision_kind in ('placement','part_choice','architecture','routing','policy')),
  add column work_status text not null default 'open' check (work_status in ('open','in_progress','needs_owner','decided')),
  add column assignee text check (assignee ~ '^(owner|dave|agent:[a-z0-9_.-]+)$'),
  add column method text,
  add column observed_at timestamptz,
  add column trust text check (trust in ('T1','T2','T3')),
  add column confidence_score numeric check (confidence_score between 0 and 1),
  add column is_superseded boolean not null default false,
  add column superseded_by uuid references public.wiring_decisions(id);

-- ---------------------------------------------------------------- alternatives for each call (placement spots carry position + cost)
create table public.wiring_decision_alternatives (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.wiring_decisions(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+$'),
  label text not null,
  zone text,
  pos_x_m numeric,
  pos_y_m numeric,
  pos_z_m numeric,
  total_length_ft numeric check (total_length_ft >= 0),
  wires_through_61pin integer check (wires_through_61pin >= 0),
  cavities_61pin integer check (cavities_61pin between 0 and 61),
  crossings integer check (crossings >= 0),
  heat_ok boolean,
  splash_ok boolean,
  score numeric,
  rank integer check (rank >= 1),
  computed_by text,
  computed_at timestamptz,
  derivation_version text,
  notes text,
  source text,
  method text,
  observed_at timestamptz,
  trust text check (trust in ('T1','T2','T3')),
  confidence_score numeric check (confidence_score between 0 and 1),
  is_superseded boolean not null default false,
  superseded_by uuid references public.wiring_decision_alternatives(id),
  created_at timestamptz not null default now()
);
comment on table public.wiring_decision_alternatives is
  'One row per option of a wiring call (wiring_decisions). Placement calls carry a spot (zone, x/y/z in the digital-twin '
  'frame) and its cost against the current wire list (length, 61-pin use, crossings, heat/splash), recomputed as wire '
  'ends settle -- the M130 funnel. Supersede, never overwrite.';
create unique index wiring_decision_alternatives_key_live
  on public.wiring_decision_alternatives (decision_id, key) where is_superseded = false;

alter table public.wiring_decisions
  add column recommended_alternative_id uuid references public.wiring_decision_alternatives(id),
  add column chosen_alternative_id uuid references public.wiring_decision_alternatives(id);

-- ---------------------------------------------------------------- the design structure matrix: which call depends on what
create table public.wiring_decision_links (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.wiring_decisions(id) on delete cascade,
  relation text not null check (relation in ('depends_on','blocks','coupled_with')),
  other_decision_id uuid references public.wiring_decisions(id) on delete cascade,
  endpoint_id uuid references public.harness_endpoints(id) on delete cascade,
  note text,
  source text,
  trust text check (trust in ('T1','T2','T3')),
  created_at timestamptz not null default now(),
  check (num_nonnulls(other_decision_id, endpoint_id) = 1),
  check (other_decision_id is distinct from decision_id)
);
comment on table public.wiring_decision_links is
  'Design structure matrix for wiring calls: a call depends on / blocks / is coupled with another call or a map node '
  '(harness_endpoints). The map walks it to show what a call is waiting on and what settling it would unblock.';
create unique index wiring_decision_links_uniq
  on public.wiring_decision_links (decision_id, relation, coalesce(other_decision_id, endpoint_id));

-- ---------------------------------------------------------------- read access: public for public vehicles, like circuits
-- (a policy's lookup into another table is itself filtered by that table's RLS, so the design row must be
--  readable too, or the endpoint policy below can never pass for a visitor)
create policy "Public read for public vehicles" on public.harness_designs for select using (
  exists (select 1 from public.vehicles v where v.id = harness_designs.vehicle_id
            and (v.is_public = true or v.user_id = auth.uid() or v.owner_id = auth.uid())));

create policy "Public read for public vehicles" on public.harness_endpoints for select using (
  exists (select 1 from public.harness_designs d join public.vehicles v on v.id = d.vehicle_id
          where d.id = harness_endpoints.design_id
            and (v.is_public = true or v.user_id = auth.uid() or v.owner_id = auth.uid())));

create policy "Public read for public vehicles" on public.wiring_decisions for select using (
  exists (select 1 from public.vehicles v where v.id = wiring_decisions.vehicle_id
            and (v.is_public = true or v.user_id = auth.uid() or v.owner_id = auth.uid())));
create policy "Service role full access" on public.wiring_decisions for all using (auth.role() = 'service_role');

alter table public.wiring_decision_alternatives enable row level security;
create policy "Public read for public vehicles" on public.wiring_decision_alternatives for select using (
  exists (select 1 from public.wiring_decisions w join public.vehicles v on v.id = w.vehicle_id
          where w.id = wiring_decision_alternatives.decision_id
            and (v.is_public = true or v.user_id = auth.uid() or v.owner_id = auth.uid())));
create policy "Service role full access" on public.wiring_decision_alternatives for all using (auth.role() = 'service_role');

alter table public.wiring_decision_links enable row level security;
create policy "Public read for public vehicles" on public.wiring_decision_links for select using (
  exists (select 1 from public.wiring_decisions w join public.vehicles v on v.id = w.vehicle_id
          where w.id = wiring_decision_links.decision_id
            and (v.is_public = true or v.user_id = auth.uid() or v.owner_id = auth.uid())));
create policy "Service role full access" on public.wiring_decision_links for all using (auth.role() = 'service_role');
