-- Enhanced Tag Context and Tool Tracking System
-- =============================================

-- 1. Create user_tools table for inventory tracking
CREATE TABLE IF NOT EXISTS user_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  category TEXT CHECK (category IN ('hand_tool', 'power_tool', 'specialty_tool', 'lifting_equipment', 'safety_equipment')),
  purchase_date DATE,
  cost DECIMAL(10,2),
  condition TEXT CHECK (condition IN ('new', 'good', 'fair', 'poor')) DEFAULT 'good',
  location TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create tool_usage_log table for tracking usage
CREATE TABLE IF NOT EXISTS tool_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  brand TEXT,
  usage_date TIMESTAMPTZ DEFAULT NOW(),
  usage_context TEXT,
  estimated_duration_hours DECIMAL(4,2),
  source TEXT CHECK (source IN ('ai_detected', 'manual', 'imported')) DEFAULT 'ai_detected',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create tool_analytics view for usage insights
CREATE OR REPLACE VIEW tool_usage_analytics AS
SELECT 
  ut.user_id,
  ut.description as tool_name,
  ut.brand,
  ut.category,
  ut.total_spent as cost,
  COUNT(tul.id) as usage_count,
  SUM(tul.estimated_duration_hours) as total_hours_used,
  ROUND(
    CASE 
      WHEN ut.total_spent > 0 THEN (SUM(tul.estimated_duration_hours) * 50) / ut.total_spent * 100 
      ELSE 0 
    END, 2
  ) as roi_percentage,
  MAX(tul.usage_date) as last_used,
  COUNT(DISTINCT tul.vehicle_id) as vehicles_worked_on
FROM user_tools ut
LEFT JOIN tool_usage_log tul ON ut.user_id = tul.user_id AND ut.description = tul.tool_name
WHERE ut.condition IS NOT NULL  -- Use condition as active indicator
GROUP BY ut.user_id, ut.description, ut.brand, ut.category, ut.total_spent;

-- 4. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_tools_user_id ON user_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tools_category ON user_tools(category);
CREATE INDEX IF NOT EXISTS idx_tool_usage_user_vehicle ON tool_usage_log(user_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_tool_usage_date ON tool_usage_log(usage_date);
CREATE INDEX IF NOT EXISTS idx_tool_usage_tool_name ON tool_usage_log(tool_name);

-- 5. Add RLS policies
ALTER TABLE user_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_usage_log ENABLE ROW LEVEL SECURITY;

-- Users can only see their own tools
CREATE POLICY "Users can view own tools" ON user_tools
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tools" ON user_tools
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tools" ON user_tools
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can only see their own tool usage
CREATE POLICY "Users can view own tool usage" ON tool_usage_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tool usage" ON tool_usage_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 6. Create function to add context to existing tags
CREATE OR REPLACE FUNCTION add_context_to_existing_tags()
RETURNS void AS $$
DECLARE
  tag_record RECORD;
  timeline_event RECORD;
  work_session_name TEXT;
BEGIN
  -- Update tags with timeline event context
  FOR tag_record IN 
    SELECT it.id, it.timeline_event_id, it.vehicle_id
    FROM image_tags it
    WHERE it.timeline_event_id IS NOT NULL
      AND (it.metadata->>'work_session' IS NULL OR it.metadata->>'work_session' = '')
  LOOP
    -- Get timeline event info
    SELECT te.title, te.event_date, te.event_type
    INTO timeline_event
    FROM timeline_events te
    WHERE te.id = tag_record.timeline_event_id;
    
    IF timeline_event IS NOT NULL THEN
      work_session_name := timeline_event.title || ' - ' || timeline_event.event_date;
      
      -- Update tag metadata with context
      UPDATE image_tags
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'work_session', work_session_name,
        'event_type', timeline_event.event_type,
        'context_updated_at', NOW()
      )
      WHERE id = tag_record.id;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Updated % tags with context', (
    SELECT COUNT(*) FROM image_tags WHERE metadata->>'context_updated_at' IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql;

-- 7. Create function to connect tags to receipts
CREATE OR REPLACE FUNCTION connect_tags_to_receipts(p_vehicle_id UUID)
RETURNS void AS $$
DECLARE
  tag_record RECORD;
  receipt_record RECORD;
  match_score INTEGER;
BEGIN
  -- For each AI-detected part tag
  FOR tag_record IN 
    SELECT it.id, it.tag_name, it.metadata->>'part_number' as part_number, it.metadata->>'brand' as brand
    FROM image_tags it
    WHERE it.vehicle_id = p_vehicle_id
      AND it.source_type = 'ai'
      AND it.metadata->>'ai_supervised' = 'true'
      AND it.metadata->>'part_number' IS NOT NULL
  LOOP
    -- Look for matching receipts
    FOR receipt_record IN 
      SELECT r.id, r.vendor_name, r.total_amount, r.raw_extraction
      FROM receipts r
      WHERE r.scope_type = 'vehicle'
        AND r.scope_id::uuid = p_vehicle_id
        AND r.is_active = true
    LOOP
      -- Simple matching logic (can be enhanced)
      match_score := 0;
      
      -- Check if receipt contains part number
      IF receipt_record.raw_extraction::text ILIKE '%' || tag_record.part_number || '%' THEN
        match_score := match_score + 50;
      END IF;
      
      -- Check if receipt contains brand
      IF tag_record.brand IS NOT NULL AND receipt_record.raw_extraction::text ILIKE '%' || tag_record.brand || '%' THEN
        match_score := match_score + 30;
      END IF;
      
      -- Check if receipt contains part name
      IF receipt_record.raw_extraction::text ILIKE '%' || tag_record.tag_name || '%' THEN
        match_score := match_score + 20;
      END IF;
      
      -- If good match, update tag
      IF match_score >= 50 THEN
        UPDATE image_tags
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'connected_receipt_id', receipt_record.id,
          'receipt_vendor', receipt_record.vendor_name,
          'receipt_amount', receipt_record.total_amount,
          'match_score', match_score,
          'receipt_connected_at', NOW()
        )
        WHERE id = tag_record.id;
        
        RAISE NOTICE 'Connected tag % to receipt % (score: %)', 
          tag_record.tag_name, receipt_record.vendor_name, match_score;
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 8. Create enhanced tag context view
CREATE OR REPLACE VIEW enhanced_tag_context AS
SELECT 
  it.id,
  it.tag_name,
  it.tag_type,
  it.confidence,
  it.source_type,
  it.verified,
  it.metadata,
  te.title as timeline_event_title,
  te.event_date,
  te.event_type,
  te.labor_hours,
  vi.image_url,
  vi.taken_at,
  r.vendor_name as receipt_vendor,
  r.total_amount as receipt_amount,
  CASE 
    WHEN it.metadata->>'ai_supervised' = 'true' THEN 'AI-Supervised'
    WHEN it.source_type = 'ai' THEN 'AI-Generated'
    ELSE 'Manual'
  END as tag_source,
  it.metadata->>'work_session' as work_session,
  it.metadata->>'user_notes' as user_notes,
  it.metadata->>'part_number' as part_number,
  it.metadata->>'brand' as brand,
  it.metadata->>'category' as category,
  it.metadata->>'connected_receipt_id' as connected_receipt_id
FROM image_tags it
LEFT JOIN timeline_events te ON it.timeline_event_id = te.id
LEFT JOIN vehicle_images vi ON it.image_id = vi.id
LEFT JOIN receipts r ON (it.metadata->>'connected_receipt_id')::uuid = r.id;

-- 9. Run initial context update for existing tags
SELECT add_context_to_existing_tags();

-- 10. Connect existing tags to receipts for test vehicle
SELECT connect_tags_to_receipts('e08bf694-970f-4cbe-8a74-8715158a0f2e');

-- 11. Create sample user tools for testing
INSERT INTO user_tools (user_id, description, brand, category, total_spent, condition) VALUES
('00000000-0000-0000-0000-000000000000', 'Cordless Drill', 'Milwaukee', 'power_tool', 199.99, 'good'),
('00000000-0000-0000-0000-000000000000', 'Socket Set', 'Craftsman', 'hand_tool', 89.99, 'good'),
('00000000-0000-0000-0000-000000000000', 'Torque Wrench', 'Snap-on', 'specialty_tool', 249.99, 'new'),
('00000000-0000-0000-0000-000000000000', 'Floor Jack', 'Harbor Freight', 'lifting_equipment', 149.99, 'good'),
('00000000-0000-0000-0000-000000000000', 'Safety Glasses', '3M', 'safety_equipment', 12.99, 'good')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE user_tools IS 'User tool inventory for tracking owned tools and their usage';
COMMENT ON TABLE tool_usage_log IS 'Log of tool usage across vehicles for analytics';
COMMENT ON VIEW tool_usage_analytics IS 'Analytics on tool ROI and usage patterns';
COMMENT ON VIEW enhanced_tag_context IS 'Enhanced view of tags with full context including timeline events and receipts';
