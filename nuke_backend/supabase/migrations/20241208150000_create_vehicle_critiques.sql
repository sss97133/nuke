-- Create table for storing vehicle critiques and business feedback
CREATE TABLE IF NOT EXISTS vehicle_critiques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL,

  -- Critique categorization
  category TEXT NOT NULL CHECK (category IN ('categorization', 'business_impact', 'data_correction', 'operational_note')),
  subcategory TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

  -- Content
  description TEXT NOT NULL,
  suggested_actions TEXT[],

  -- Business impact metrics (JSON for flexibility)
  business_impact JSONB DEFAULT '{}',

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'implemented', 'rejected')),
  resolution_notes TEXT,
  resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure user has provided meaningful content
  CONSTRAINT meaningful_description CHECK (length(trim(description)) >= 10)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_vehicle_critiques_vehicle_id ON vehicle_critiques(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_critiques_user_id ON vehicle_critiques(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_critiques_organization_id ON vehicle_critiques(organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_critiques_status ON vehicle_critiques(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_critiques_category ON vehicle_critiques(category);
CREATE INDEX IF NOT EXISTS idx_vehicle_critiques_priority ON vehicle_critiques(priority);
CREATE INDEX IF NOT EXISTS idx_vehicle_critiques_created_at ON vehicle_critiques(created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE vehicle_critiques ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view critiques for vehicles they have access to
CREATE POLICY "Users can view critiques for accessible vehicles" ON vehicle_critiques
  FOR SELECT USING (
    -- User can see their own critiques
    user_id = auth.uid() OR
    -- User can see critiques for vehicles they own/contribute to
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_critiques.vehicle_id
      AND (
        v.uploaded_by = auth.uid() OR
        v.is_public = true OR
        EXISTS (
          SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v.id
          AND vc.user_id = auth.uid()
          AND vc.status = 'active'
        )
      )
    ) OR
    -- Organization members can see critiques from their org
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.organization_id = vehicle_critiques.organization_id
    )
  );

-- Users can create critiques for vehicles they have access to
CREATE POLICY "Users can create critiques for accessible vehicles" ON vehicle_critiques
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_critiques.vehicle_id
      AND (
        v.uploaded_by = auth.uid() OR
        v.is_public = true OR
        EXISTS (
          SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v.id
          AND vc.user_id = auth.uid()
          AND vc.status = 'active'
        )
      )
    )
  );

-- Users can update their own critiques
CREATE POLICY "Users can update their own critiques" ON vehicle_critiques
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Only the creator can delete their critique (before it's reviewed)
CREATE POLICY "Users can delete their own unreviewed critiques" ON vehicle_critiques
  FOR DELETE USING (
    user_id = auth.uid() AND
    status = 'pending'
  );

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION update_vehicle_critiques_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to auto-update timestamps
CREATE TRIGGER update_vehicle_critiques_updated_at
  BEFORE UPDATE ON vehicle_critiques
  FOR EACH ROW
  EXECUTE PROCEDURE update_vehicle_critiques_updated_at();

-- Create a view for business intelligence reporting
CREATE OR REPLACE VIEW vehicle_critique_analytics AS
SELECT
  c.id,
  c.vehicle_id,
  v.year,
  v.make,
  v.model,
  v.status as vehicle_status,
  c.category,
  c.subcategory,
  c.priority,
  c.status,
  c.business_impact,
  c.created_at,
  c.resolved_at,
  p.full_name as critique_author,
  p.role as author_role,
  b.business_name as organization,
  EXTRACT(EPOCH FROM (COALESCE(c.resolved_at, NOW()) - c.created_at)) / 86400 AS resolution_days
FROM vehicle_critiques c
JOIN vehicles v ON c.vehicle_id = v.id
JOIN profiles p ON c.user_id = p.id
LEFT JOIN businesses b ON c.organization_id = b.id;

-- Grant access to the analytics view
GRANT SELECT ON vehicle_critique_analytics TO authenticated;