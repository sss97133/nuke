-- Build Management System Privacy Schema Migration
-- Adds privacy controls to existing build tables

-- Add privacy columns to vehicle_builds
ALTER TABLE vehicle_builds
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS visibility_level TEXT DEFAULT 'private' CHECK (visibility_level IN ('private', 'friends', 'public')),
ADD COLUMN IF NOT EXISTS show_costs BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS allow_comments BOOLEAN DEFAULT FALSE;

-- Add privacy columns to build_line_items
ALTER TABLE build_line_items
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS hide_cost BOOLEAN DEFAULT FALSE;

-- Add privacy columns to build_documents
ALTER TABLE build_documents
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;

-- Add privacy columns to build_images
ALTER TABLE build_images
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;

-- Add privacy columns to build_benchmarks
ALTER TABLE build_benchmarks
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;

-- Add privacy columns to build_phases
ALTER TABLE build_phases
ADD COLUMN IF NOT EXISTS is_cost_visible BOOLEAN DEFAULT NULL; -- NULL = inherit from build

-- Create build_permissions table if not exists
CREATE TABLE IF NOT EXISTS build_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  build_id UUID REFERENCES vehicle_builds(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  permission_level TEXT DEFAULT 'view' CHECK (permission_level IN ('view', 'comment', 'edit')),
  granted_by UUID REFERENCES profiles(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(build_id, user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_builds_visibility ON vehicle_builds(visibility_level, is_public);
CREATE INDEX IF NOT EXISTS idx_items_public ON build_line_items(is_public);
CREATE INDEX IF NOT EXISTS idx_permissions_build_user ON build_permissions(build_id, user_id);

-- Update existing RLS policies to include privacy checks
DROP POLICY IF EXISTS builds_policy ON vehicle_builds;
CREATE POLICY builds_policy ON vehicle_builds
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_id
      AND v.uploaded_by = auth.uid()
    )
    OR
    (
      -- Public builds are visible to all authenticated users
      visibility_level = 'public'
      AND EXISTS (
        SELECT 1 FROM vehicles v
        WHERE v.id = vehicle_id
        AND v.is_public = TRUE
      )
    )
    OR
    (
      -- Shared builds via permissions
      visibility_level = 'friends'
      AND EXISTS (
        SELECT 1 FROM build_permissions bp
        WHERE bp.build_id = id
        AND bp.user_id = auth.uid()
        AND (bp.expires_at IS NULL OR bp.expires_at > NOW())
      )
    )
  );

-- Update line items policy
DROP POLICY IF EXISTS items_policy ON build_line_items;
CREATE POLICY items_policy ON build_line_items
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      WHERE vb.id = build_id
      AND (
        EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vb.vehicle_id
          AND v.uploaded_by = auth.uid()
        )
        OR
        (
          vb.visibility_level = 'public'
          AND is_public = TRUE
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vb.vehicle_id
            AND v.is_public = TRUE
          )
        )
      )
    )
  );

-- Update documents policy
DROP POLICY IF EXISTS documents_policy ON build_documents;
CREATE POLICY documents_policy ON build_documents
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      WHERE vb.id = build_id
      AND (
        EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vb.vehicle_id
          AND v.uploaded_by = auth.uid()
        )
        OR
        (
          is_public = TRUE
          AND vb.visibility_level = 'public'
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vb.vehicle_id
            AND v.is_public = TRUE
          )
        )
      )
    )
  );

-- Update images policy
DROP POLICY IF EXISTS images_policy ON build_images;
CREATE POLICY images_policy ON build_images
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      WHERE vb.id = build_id
      AND (
        EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vb.vehicle_id
          AND v.uploaded_by = auth.uid()
        )
        OR
        (
          is_public = TRUE
          AND vb.visibility_level = 'public'
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vb.vehicle_id
            AND v.is_public = TRUE
          )
        )
      )
    )
  );

-- Enable RLS on new table
ALTER TABLE build_permissions ENABLE ROW LEVEL SECURITY;

-- Permissions policy
CREATE POLICY permissions_policy ON build_permissions
  USING (
    user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      JOIN vehicles v ON v.id = vb.vehicle_id
      WHERE vb.id = build_id
      AND v.uploaded_by = auth.uid()
    )
  );

-- Create public view for anonymous access
CREATE OR REPLACE VIEW public_builds AS
SELECT
  vb.id,
  vb.vehicle_id,
  vb.name,
  vb.description,
  vb.status,
  vb.start_date,
  vb.target_completion_date,
  vb.actual_completion_date,
  CASE
    WHEN vb.show_costs = TRUE THEN vb.total_budget
    ELSE NULL
  END as total_budget,
  CASE
    WHEN vb.show_costs = TRUE THEN vb.total_spent
    ELSE NULL
  END as total_spent,
  vb.total_hours_estimated,
  vb.total_hours_actual,
  vb.created_at,
  v.year,
  v.make,
  v.model
FROM vehicle_builds vb
JOIN vehicles v ON v.id = vb.vehicle_id
WHERE vb.visibility_level = 'public'
  AND v.is_public = TRUE;