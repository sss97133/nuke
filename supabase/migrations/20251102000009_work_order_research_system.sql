-- Work Order Research System
-- Bookmarks, parts database, labor breakdown, and image annotations

-- ============================================================================
-- USER BOOKMARKS - Save work orders, parts, shops for later
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  bookmark_type TEXT NOT NULL CHECK (bookmark_type IN ('work_order', 'part', 'shop', 'technique', 'image')),
  reference_id UUID NOT NULL,
  title TEXT,
  thumbnail_url TEXT,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, bookmark_type, reference_id)
);

CREATE INDEX idx_user_bookmarks_user ON user_bookmarks(user_id);
CREATE INDEX idx_user_bookmarks_type ON user_bookmarks(bookmark_type);
CREATE INDEX idx_user_bookmarks_reference ON user_bookmarks(reference_id);

-- RLS
ALTER TABLE user_bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own bookmarks" ON user_bookmarks;
CREATE POLICY "Users can view own bookmarks" ON user_bookmarks
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own bookmarks" ON user_bookmarks;
CREATE POLICY "Users can insert own bookmarks" ON user_bookmarks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own bookmarks" ON user_bookmarks;
CREATE POLICY "Users can update own bookmarks" ON user_bookmarks
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own bookmarks" ON user_bookmarks;
CREATE POLICY "Users can delete own bookmarks" ON user_bookmarks
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- WORK ORDER PARTS - Parts used in each work order
-- ============================================================================

CREATE TABLE IF NOT EXISTS work_order_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timeline_event_id UUID REFERENCES business_timeline_events(id) ON DELETE CASCADE,
  part_name TEXT NOT NULL,
  part_number TEXT,
  brand TEXT,
  category TEXT, -- 'material', 'fastener', 'consumable', 'component'
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2),
  total_price DECIMAL(10,2),
  supplier TEXT,
  buy_url TEXT,
  image_url TEXT,
  notes TEXT,
  ai_extracted BOOLEAN DEFAULT false,
  user_verified BOOLEAN DEFAULT false,
  added_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_work_order_parts_event ON work_order_parts(timeline_event_id);
CREATE INDEX idx_work_order_parts_brand ON work_order_parts(brand);

-- RLS
ALTER TABLE work_order_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view work order parts" ON work_order_parts;
CREATE POLICY "Public can view work order parts" ON work_order_parts
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert work order parts" ON work_order_parts;
CREATE POLICY "Authenticated users can insert work order parts" ON work_order_parts
  FOR INSERT WITH CHECK (auth.uid() = added_by);

DROP POLICY IF EXISTS "Users can update own parts" ON work_order_parts;
CREATE POLICY "Users can update own parts" ON work_order_parts
  FOR UPDATE USING (auth.uid() = added_by);

-- ============================================================================
-- WORK ORDER LABOR - Labor breakdown for each work order
-- ============================================================================

CREATE TABLE IF NOT EXISTS work_order_labor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timeline_event_id UUID REFERENCES business_timeline_events(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  task_category TEXT, -- 'removal', 'fabrication', 'installation', 'finishing', 'diagnosis'
  hours DECIMAL(5,2) NOT NULL,
  hourly_rate DECIMAL(10,2),
  total_cost DECIMAL(10,2),
  difficulty_rating INTEGER CHECK (difficulty_rating >= 1 AND difficulty_rating <= 10),
  notes TEXT,
  industry_standard_hours DECIMAL(5,2), -- Mitchell1/Chilton reference
  ai_estimated BOOLEAN DEFAULT false,
  added_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_work_order_labor_event ON work_order_labor(timeline_event_id);
CREATE INDEX idx_work_order_labor_category ON work_order_labor(task_category);

-- RLS
ALTER TABLE work_order_labor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view work order labor" ON work_order_labor;
CREATE POLICY "Public can view work order labor" ON work_order_labor
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert work order labor" ON work_order_labor;
CREATE POLICY "Authenticated users can insert work order labor" ON work_order_labor
  FOR INSERT WITH CHECK (auth.uid() = added_by);

DROP POLICY IF EXISTS "Users can update own labor entries" ON work_order_labor;
CREATE POLICY "Users can update own labor entries" ON work_order_labor
  FOR UPDATE USING (auth.uid() = added_by);

-- ============================================================================
-- IMAGE ANNOTATIONS - Clickable hotspots on work order photos
-- ============================================================================

CREATE TABLE IF NOT EXISTS image_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID REFERENCES organization_images(id) ON DELETE CASCADE,
  x_percent DECIMAL(5,2) NOT NULL CHECK (x_percent >= 0 AND x_percent <= 100),
  y_percent DECIMAL(5,2) NOT NULL CHECK (y_percent >= 0 AND y_percent <= 100),
  annotation_type TEXT NOT NULL CHECK (annotation_type IN ('part', 'quality_issue', 'technique', 'tool', 'measurement')),
  title TEXT NOT NULL,
  description TEXT,
  related_part_id UUID REFERENCES work_order_parts(id) ON DELETE SET NULL,
  severity TEXT CHECK (severity IN ('info', 'minor', 'major', 'critical')),
  created_by UUID REFERENCES auth.users(id),
  ai_generated BOOLEAN DEFAULT false,
  confidence DECIMAL(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_image_annotations_image ON image_annotations(image_id);
CREATE INDEX idx_image_annotations_type ON image_annotations(annotation_type);

-- RLS
ALTER TABLE image_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view image annotations" ON image_annotations;
CREATE POLICY "Public can view image annotations" ON image_annotations
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert annotations" ON image_annotations;
CREATE POLICY "Authenticated users can insert annotations" ON image_annotations
  FOR INSERT WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update own annotations" ON image_annotations;
CREATE POLICY "Users can update own annotations" ON image_annotations
  FOR UPDATE USING (auth.uid() = created_by);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get bookmark count for a work order
CREATE OR REPLACE FUNCTION get_work_order_bookmark_count(event_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM user_bookmarks
    WHERE bookmark_type = 'work_order'
      AND reference_id = event_id
  );
END;
$$;

-- Check if user has bookmarked something
CREATE OR REPLACE FUNCTION user_has_bookmarked(
  p_user_id UUID,
  p_bookmark_type TEXT,
  p_reference_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1
    FROM user_bookmarks
    WHERE user_id = p_user_id
      AND bookmark_type = p_bookmark_type
      AND reference_id = p_reference_id
  );
END;
$$;

-- Get total parts cost for a work order
CREATE OR REPLACE FUNCTION get_work_order_parts_total(event_id UUID)
RETURNS DECIMAL(10,2)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(total_price)
     FROM work_order_parts
     WHERE timeline_event_id = event_id),
    0
  );
END;
$$;

-- Get total labor cost for a work order
CREATE OR REPLACE FUNCTION get_work_order_labor_total(event_id UUID)
RETURNS DECIMAL(10,2)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(total_cost)
     FROM work_order_labor
     WHERE timeline_event_id = event_id),
    0
  );
END;
$$;

COMMENT ON TABLE user_bookmarks IS 'User-saved work orders, parts, shops, and techniques for research';
COMMENT ON TABLE work_order_parts IS 'Parts and materials used in each work order with shopping links';
COMMENT ON TABLE work_order_labor IS 'Labor breakdown for work orders with industry comparisons';
COMMENT ON TABLE image_annotations IS 'Clickable hotspots and annotations on work order photos';

