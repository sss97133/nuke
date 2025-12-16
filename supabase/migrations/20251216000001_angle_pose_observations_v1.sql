-- Decades-proof angle + pose observation schema (v1)
-- Key principle: never “replace” facts; record observations over time with provenance.

-- 1) Canonical, versioned angle taxonomy (stable IDs)
create table if not exists public.angle_taxonomy (
  angle_id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,             -- e.g. exterior.front_quarter.driver
  domain text not null,                           -- exterior|interior|engine|undercarriage|document|detail
  display_label text not null,
  side_applicability text,                        -- driver|passenger|both|none|null
  created_at timestamptz not null default now(),
  deprecated_at timestamptz,
  replaced_by_angle_id uuid references public.angle_taxonomy(angle_id)
);

create index if not exists angle_taxonomy_domain_idx on public.angle_taxonomy(domain);

create table if not exists public.angle_taxonomy_versions (
  taxonomy_version text primary key,              -- e.g. v1_2025_12
  created_at timestamptz not null default now(),
  notes text
);

create table if not exists public.angle_aliases (
  alias_key text primary key,                     -- model output tokens, legacy keys, etc.
  angle_id uuid not null references public.angle_taxonomy(angle_id),
  taxonomy_version text references public.angle_taxonomy_versions(taxonomy_version),
  created_at timestamptz not null default now()
);

-- 2) Angle observations (time-series) per image
create table if not exists public.image_angle_observations (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references public.vehicle_images(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  angle_id uuid not null references public.angle_taxonomy(angle_id),

  -- Confidence normalized 0..1; keep raw in evidence/raw if needed.
  confidence numeric,
  source text not null,                           -- ai|human|import|derived
  source_version text,                            -- model/version hash or rule version
  evidence jsonb,                                 -- full_vehicle_in_frame, occlusion, etc.
  observed_at timestamptz not null default now()
);

create index if not exists image_angle_obs_image_idx on public.image_angle_observations(image_id, observed_at desc);
create index if not exists image_angle_obs_vehicle_idx on public.image_angle_observations(vehicle_id, observed_at desc);
create index if not exists image_angle_obs_angle_idx on public.image_angle_observations(angle_id, observed_at desc);

-- 3) Pose observations (camera extrinsics + intrinsics) per image
create table if not exists public.image_pose_observations (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references public.vehicle_images(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,

  -- Reference frame contract (publish this once; never change semantics without bumping version)
  reference_frame text not null default 'vehicle_frame_v1', -- +X forward, +Y driver side, +Z up, origin at vehicle center

  -- Camera position in meters relative to vehicle frame (may be null if unknown)
  cam_x_m numeric,
  cam_y_m numeric,
  cam_z_m numeric,

  -- Camera orientation as quaternion (may be null if unknown)
  q_w numeric,
  q_x numeric,
  q_y numeric,
  q_z numeric,

  -- Derived coarse pose angles in vehicle frame (optional)
  yaw_deg numeric,
  pitch_deg numeric,
  roll_deg numeric,
  pose_confidence numeric,                        -- 0..1

  -- Camera intrinsics (optional; often from EXIF + camera DB lookup)
  focal_length_mm numeric,
  sensor_width_mm numeric,
  sensor_height_mm numeric,
  fov_x_deg numeric,
  fov_y_deg numeric,

  -- What this pose is “about”
  target_anchor text,                             -- e.g. anchor.engine.bay.center, anchor.interior.dashboard.center
  target_bbox jsonb,                              -- normalized bbox if a target is detected

  source text not null,                           -- ai|human|import|derived
  source_version text,
  raw jsonb,
  observed_at timestamptz not null default now()
);

create index if not exists image_pose_obs_image_idx on public.image_pose_observations(image_id, observed_at desc);
create index if not exists image_pose_obs_vehicle_idx on public.image_pose_observations(vehicle_id, observed_at desc);

-- 4) Seed v1 taxonomy version (no angles yet; we’ll insert canonical keys gradually)
insert into public.angle_taxonomy_versions (taxonomy_version, notes)
values ('v1_2025_12', 'Initial angle taxonomy/pose observation scaffolding.')
on conflict (taxonomy_version) do nothing;


