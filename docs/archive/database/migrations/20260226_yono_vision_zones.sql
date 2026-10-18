-- YONO Vision Zone System — Phase 1 coordinate infrastructure
-- Adds spatial coordinate columns to vehicle_images and creates new tables:
--   vehicle_reconstructions (COLMAP camera poses)
--   vehicle_coverage_map    (per-vehicle zone coverage flags)
--   vehicle_condition_reports (aggregated condition reports)
--
-- This implements L0 (zone) through the foundation for L2 (surface coords).
-- See VISION_ARCHITECTURE.md and VISION_ROADMAP.md for full design.

-- ─────────────────────────────────────────────────────────────
-- 1. Add zone/coordinate columns to vehicle_images
-- ─────────────────────────────────────────────────────────────

-- L0: Zone classification (single image, no COLMAP needed)
ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS vehicle_zone          text,
  ADD COLUMN IF NOT EXISTS zone_confidence       numeric(4,3);

-- L2+: Surface coordinates (populated after COLMAP Phase 1)
ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS surface_coord_u       numeric(8,2),
  ADD COLUMN IF NOT EXISTS surface_coord_v       numeric(8,2);

-- Camera pose from COLMAP reconstruction (4x4 world-to-camera matrix as JSON)
ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS camera_pose           jsonb;

-- Zone column comments
COMMENT ON COLUMN vehicle_images.vehicle_zone IS
  'L0 zone classification from yono-analyze. One of 41 zones defined in VISION_ARCHITECTURE.md. Written by zone classifier (yono_zone_classifier).';

COMMENT ON COLUMN vehicle_images.zone_confidence IS
  '0.0-1.0 confidence in vehicle_zone prediction. Low confidence = zone is ambiguous.';

COMMENT ON COLUMN vehicle_images.surface_coord_u IS
  'L2 surface coordinate U (inches from front-center-ground origin). Null until COLMAP Phase 1 completes.';

COMMENT ON COLUMN vehicle_images.surface_coord_v IS
  'L2 surface coordinate V (inches from front-center-ground origin). Null until COLMAP Phase 1 completes.';

COMMENT ON COLUMN vehicle_images.camera_pose IS
  'COLMAP camera pose: {R: [[3x3 rotation]], t: [tx, ty, tz]} world-to-camera transform. Written by bat_reconstruct.py.';

-- Indexes for zone-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_images_vehicle_zone
  ON vehicle_images (vehicle_zone)
  WHERE vehicle_zone IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_images_pending_zone
  ON vehicle_images (id)
  WHERE vehicle_zone IS NULL AND vision_analyzed_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. vehicle_reconstructions — COLMAP output storage
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vehicle_reconstructions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  point_cloud_url        text,
  -- camera_poses: {image_filename: {R: [[3x3]], t: [3]}} for all registered images
  camera_poses           jsonb NOT NULL DEFAULT '{}',
  reconstruction_quality text NOT NULL DEFAULT 'pending'
    CHECK (reconstruction_quality IN ('pending', 'good', 'poor', 'failed', 'skipped')),
  image_count            int NOT NULL DEFAULT 0,
  reconstructed_at       timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_reconstructions_vehicle_id_unique UNIQUE (vehicle_id)
);

COMMENT ON TABLE vehicle_reconstructions IS
  'COLMAP Structure-from-Motion results per vehicle. Written by yono/scripts/bat_reconstruct.py. '
  'camera_poses maps image filenames to 4x4 world-to-camera transforms.';

COMMENT ON COLUMN vehicle_reconstructions.camera_poses IS
  'Dict of {image_filename: {R: [[3x3 rotation matrix]], t: [tx, ty, tz]}} from COLMAP sparse reconstruction.';

COMMENT ON COLUMN vehicle_reconstructions.reconstruction_quality IS
  'good = 10+ images registered; poor = 3-9 images; failed = COLMAP failed; skipped = not yet run.';

CREATE INDEX IF NOT EXISTS idx_vehicle_reconstructions_vehicle_id
  ON vehicle_reconstructions (vehicle_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_reconstructions_quality
  ON vehicle_reconstructions (reconstruction_quality);

-- ─────────────────────────────────────────────────────────────
-- 3. vehicle_coverage_map — per-vehicle zone coverage flags
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vehicle_coverage_map (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id            uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Exterior whole-vehicle
  has_ext_front              bool NOT NULL DEFAULT false,
  has_ext_front_driver       bool NOT NULL DEFAULT false,
  has_ext_front_passenger    bool NOT NULL DEFAULT false,
  has_ext_driver_side        bool NOT NULL DEFAULT false,
  has_ext_passenger_side     bool NOT NULL DEFAULT false,
  has_ext_rear               bool NOT NULL DEFAULT false,
  has_ext_rear_driver        bool NOT NULL DEFAULT false,
  has_ext_rear_passenger     bool NOT NULL DEFAULT false,
  has_ext_roof               bool NOT NULL DEFAULT false,
  has_ext_undercarriage      bool NOT NULL DEFAULT false,

  -- Panels
  has_panel_hood             bool NOT NULL DEFAULT false,
  has_panel_trunk            bool NOT NULL DEFAULT false,
  has_panel_door_fl          bool NOT NULL DEFAULT false,
  has_panel_door_fr          bool NOT NULL DEFAULT false,
  has_panel_door_rl          bool NOT NULL DEFAULT false,
  has_panel_door_rr          bool NOT NULL DEFAULT false,
  has_panel_fender_fl        bool NOT NULL DEFAULT false,
  has_panel_fender_fr        bool NOT NULL DEFAULT false,
  has_panel_fender_rl        bool NOT NULL DEFAULT false,
  has_panel_fender_rr        bool NOT NULL DEFAULT false,

  -- Wheels
  has_wheel_fl               bool NOT NULL DEFAULT false,
  has_wheel_fr               bool NOT NULL DEFAULT false,
  has_wheel_rl               bool NOT NULL DEFAULT false,
  has_wheel_rr               bool NOT NULL DEFAULT false,

  -- Interior
  has_int_dashboard          bool NOT NULL DEFAULT false,
  has_int_front_seats        bool NOT NULL DEFAULT false,
  has_int_rear_seats         bool NOT NULL DEFAULT false,
  has_int_cargo              bool NOT NULL DEFAULT false,
  has_int_headliner          bool NOT NULL DEFAULT false,
  has_int_door_panel_fl      bool NOT NULL DEFAULT false,
  has_int_door_panel_fr      bool NOT NULL DEFAULT false,
  has_int_door_panel_rl      bool NOT NULL DEFAULT false,
  has_int_door_panel_rr      bool NOT NULL DEFAULT false,

  -- Mechanical
  has_mech_engine_bay        bool NOT NULL DEFAULT false,
  has_mech_transmission      bool NOT NULL DEFAULT false,
  has_mech_suspension        bool NOT NULL DEFAULT false,

  -- Detail
  has_detail_vin             bool NOT NULL DEFAULT false,
  has_detail_badge           bool NOT NULL DEFAULT false,
  has_detail_damage          bool NOT NULL DEFAULT false,
  has_detail_odometer        bool NOT NULL DEFAULT false,

  -- Aggregate stats
  total_zones_covered        smallint NOT NULL DEFAULT 0,
  -- 0.0-1.0: covered zones / total meaningful zones (excludes 'other')
  coverage_score             numeric(4,3) NOT NULL DEFAULT 0.0,

  image_count                int NOT NULL DEFAULT 0,
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vehicle_coverage_map_vehicle_id_unique UNIQUE (vehicle_id)
);

COMMENT ON TABLE vehicle_coverage_map IS
  'Per-vehicle zone coverage summary. Updated by generate_condition_report.py after vision analysis. '
  'coverage_score = covered_zones / 40 (excludes other zone). Used for "missing coverage" alerts.';

CREATE INDEX IF NOT EXISTS idx_vehicle_coverage_map_vehicle_id
  ON vehicle_coverage_map (vehicle_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_coverage_map_coverage_score
  ON vehicle_coverage_map (coverage_score DESC)
  WHERE coverage_score > 0;

-- ─────────────────────────────────────────────────────────────
-- 4. vehicle_condition_reports — aggregated condition reports
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vehicle_condition_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Coverage
  surface_coverage numeric(4,3) NOT NULL DEFAULT 0.0,  -- 0.0-1.0
  uncovered_zones  text[] NOT NULL DEFAULT '{}',

  -- Condition
  overall_score    numeric(3,1),  -- 1.0-5.0, weighted avg across zones
  image_count      int NOT NULL DEFAULT 0,

  -- Findings: array of {zone, finding, severity, confidence, source_images, coord_u, coord_v}
  findings         jsonb NOT NULL DEFAULT '[]',

  -- Summary stats
  damage_zone_count     int NOT NULL DEFAULT 0,   -- zones with damage detected
  modification_count    int NOT NULL DEFAULT 0,   -- total unique mods detected

  -- Metadata
  model_version    text,
  generated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vehicle_condition_reports_vehicle_id_unique UNIQUE (vehicle_id)
);

COMMENT ON TABLE vehicle_condition_reports IS
  'Aggregated per-vehicle condition report from all analyzed images. '
  'findings is an array: [{zone, finding, severity, confidence, source_images, coord_u, coord_v}]. '
  'Written by yono/scripts/generate_condition_report.py. '
  'Surface via API: GET /vehicles/{id}/condition-report';

COMMENT ON COLUMN vehicle_condition_reports.findings IS
  'Array of condition findings. Each: {zone: str, finding: str, severity: 1-5, confidence: 0-1, '
  'source_image_ids: [uuid], coord_u: float|null, coord_v: float|null}';

CREATE INDEX IF NOT EXISTS idx_vehicle_condition_reports_vehicle_id
  ON vehicle_condition_reports (vehicle_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_condition_reports_overall_score
  ON vehicle_condition_reports (overall_score)
  WHERE overall_score IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 5. Register new columns in pipeline_registry
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pipeline_registry') THEN
    INSERT INTO pipeline_registry (table_name, column_name, owned_by, do_not_write_directly, write_via, description)
    VALUES
      ('vehicle_images', 'vehicle_zone', 'yono-analyze', true, 'yono-analyze edge function / zone classifier', 'L0 zone from 41-zone taxonomy in VISION_ARCHITECTURE.md'),
      ('vehicle_images', 'zone_confidence', 'yono-analyze', true, 'yono-analyze edge function', 'Confidence in vehicle_zone prediction'),
      ('vehicle_images', 'surface_coord_u', 'bat-reconstruct', true, 'bat_reconstruct.py COLMAP pipeline', 'L2 surface U coordinate (inches). Null until Phase 1 COLMAP.'),
      ('vehicle_images', 'surface_coord_v', 'bat-reconstruct', true, 'bat_reconstruct.py COLMAP pipeline', 'L2 surface V coordinate (inches). Null until Phase 1 COLMAP.'),
      ('vehicle_images', 'camera_pose', 'bat-reconstruct', true, 'bat_reconstruct.py COLMAP pipeline', 'COLMAP camera pose {R: 3x3, t: [3]} for pixel-to-surface projection')
    ON CONFLICT (table_name, column_name) DO UPDATE
      SET owned_by = EXCLUDED.owned_by, description = EXCLUDED.description;
  END IF;
END $$;
