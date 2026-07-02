-- (x,y,z) spatial anchors — the volumetric ground-truth substrate.
--
-- IMPLEMENTS: docs/library/working/working-papers/2026-05-24_substrate_xyz-spatial-anchor-design.md
-- (Option A + the coordinate-frame registry), which sat "awaiting approval, NO DDL APPLIED"
-- since 2026-05-24. Owner approved 2026-07-02 ("i hope you can actually implement them").
--
-- Source axiom (Skylar, 2026-05-24, session 2ebd8b06): "the only ground truth would be an
-- x,y,z volumetric observation and a 0-100 scale condition rating per volumetric measurement...
-- reconstruct events with the images into a dimensional understanding that can then be tracked
-- overtime." Condition is a scalar field over the body envelope, not one number per vehicle.
--
-- This is the layer ABOVE the existing zone system (vehicle_surface_templates /
-- surface_observations 378K rows): zones stay the coarse classifier; (x,y,z) is fine-grained
-- ground truth. Anchors land ONLY from real registration (owner pin-drop / photogrammetry) —
-- never auto-derived from a single 2D photo (that would be fabricated precision).
--
-- Deviations from the design doc, documented:
--  1. The anchor index is PARTIAL (WHERE anchor_frame_id IS NOT NULL) — the doc's plain
--     index would carry all ~7.5M NULL rows for nothing.
--  2. First frame row = the deployed public glTF (nuke.ag/models/k5-blazer.glb, verified
--     serving) rather than a local .blend; origin/scale/orientation are marked UNVERIFIED
--     in mesh_origin_doc per facts-sacred — "even rough is fine" (design §5), but never
--     an asserted origin nobody measured. trust_score 0.5 until inspected.

-- ── The coordinate-frame registry (design §4). A coordinate without a frame is meaningless.
create table if not exists vehicle_coordinate_frames (
  id                    uuid primary key default gen_random_uuid(),

  -- Scope: a specific vehicle (preferred) or an archetype fallback
  vehicle_id            uuid references vehicles(id),
  archetype_make        text,
  archetype_model       text,
  archetype_year_start  smallint,
  archetype_year_end    smallint,
  archetype_body_style  text,

  -- Mesh asset (pointer + metadata; geometry never lives in the DB)
  mesh_url              text not null,
  mesh_format           text not null,
  mesh_version          text,
  mesh_origin_doc       text,
  units                 text not null default 'mm',
  axis_convention       text not null default 'X_forward_Y_left_Z_up',
  bbox_min_mm           real[],
  bbox_max_mm           real[],
  is_default_for_vehicle boolean default false,

  -- Trust / provenance
  source                text,
  trust_score           numeric check (trust_score between 0 and 1),
  created_at            timestamptz not null default now(),
  created_by            text,

  check (vehicle_id is not null or archetype_make is not null)
);

create index if not exists vcf_vehicle on vehicle_coordinate_frames(vehicle_id) where vehicle_id is not null;
create index if not exists vcf_archetype on vehicle_coordinate_frames(archetype_make, archetype_model)
  where archetype_make is not null;

comment on table vehicle_coordinate_frames is
  'Registry of per-vehicle (or per-archetype) 3D coordinate frames: mesh pointer + units + axis convention + origin doc. The frame that makes an (x,y,z) anchor meaningful. Design: docs/library/working/working-papers/2026-05-24_substrate_xyz-spatial-anchor-design.md';

-- ── The anchor columns on the testimony row (design §3, Option A).
-- All nullable: non-spatial observations are unharmed. Instant DDL (no default, no rewrite).
alter table vehicle_observations
  add column if not exists anchor_frame_id        uuid references vehicle_coordinate_frames(id),
  add column if not exists anchor_x_mm            real,
  add column if not exists anchor_y_mm            real,
  add column if not exists anchor_z_mm            real,
  add column if not exists anchor_extent_mm       real,
  add column if not exists condition_rating_0_100 smallint
    check (condition_rating_0_100 between 0 and 100);

-- The canonical query (design §7.1): time-lapse at a coordinate ± ε for one vehicle.
-- Partial: only anchored rows enter the index.
create index if not exists idx_vobs_spatial_anchor
  on vehicle_observations (vehicle_id, anchor_x_mm, anchor_y_mm, anchor_z_mm)
  where anchor_frame_id is not null;

comment on column vehicle_observations.anchor_x_mm is
  'Volumetric ground-truth anchor (design 2026-05-24): coordinate in the anchor_frame_id frame, mm. Landed only from real registration (pin-drop / photogrammetry), never auto-derived from a single photo.';
comment on column vehicle_observations.condition_rating_0_100 is
  '0-100 condition at the anchored volume ("a 92/100 driver door, a 71/100 quarter panel"). Pairs with anchor_* columns; supersede-never-overwrite on re-measurement.';

-- ── First frame row: Skylar's K5 (design §5 bootstrap). Idempotent.
insert into vehicle_coordinate_frames (
  vehicle_id, mesh_url, mesh_format, mesh_version, units, axis_convention,
  mesh_origin_doc, source, trust_score, is_default_for_vehicle, created_by
)
select
  'e08bf694-970f-4cbe-8a74-8715158a0f2e',
  'https://nuke.ag/models/k5-blazer.glb',
  'gltf-binary',
  'frontend-public-2026-06-20',
  'm',
  'gltf_Y_up_Z_forward',
  'glTF spec defaults assumed (meters, +Y up). ORIGIN/SCALE/ORIENTATION UNVERIFIED — inspect the mesh before trusting the first pin; update mesh_origin_doc + trust_score after inspection. Same mesh the wiring visualizer renders.',
  'frontend_wiring_visualizer_glb',
  0.5,
  true,
  'fable5-image-analysis'
where not exists (
  select 1 from vehicle_coordinate_frames
  where vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
    and mesh_url = 'https://nuke.ag/models/k5-blazer.glb'
);
