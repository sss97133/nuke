-- Fix Timeline Event Comments to include thumbnails
-- This makes comments show which image/work order they're about

BEGIN;

-- 1. Ensure timeline_event_comments table exists
CREATE TABLE IF NOT EXISTS timeline_event_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES vehicle_timeline_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  
  -- NEW: Link to specific image or work order being commented on
  image_id UUID REFERENCES vehicle_images(id) ON DELETE SET NULL,
  work_order_id UUID REFERENCES work_sessions(id) ON DELETE SET NULL,
  
  -- NEW: Store thumbnail URL for quick display
  thumbnail_url TEXT,
  context_type TEXT CHECK (context_type IN ('image', 'work_order', 'receipt', 'general')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_timeline_comments_event ON timeline_event_comments(event_id);
CREATE INDEX IF NOT EXISTS idx_timeline_comments_user ON timeline_event_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_timeline_comments_image ON timeline_event_comments(image_id);
CREATE INDEX IF NOT EXISTS idx_timeline_comments_work_order ON timeline_event_comments(work_order_id);

-- RLS Policies
ALTER TABLE timeline_event_comments ENABLE ROW LEVEL SECURITY;

-- Everyone can read comments
DROP POLICY IF EXISTS "Anyone can view timeline comments" ON timeline_event_comments;
CREATE POLICY "Anyone can view timeline comments"
  ON timeline_event_comments
  FOR SELECT
  USING (true);

-- Authenticated users can add comments
DROP POLICY IF EXISTS "Authenticated users can add comments" ON timeline_event_comments;
CREATE POLICY "Authenticated users can add comments"
  ON timeline_event_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own comments
DROP POLICY IF EXISTS "Users can update own comments" ON timeline_event_comments;
CREATE POLICY "Users can update own comments"
  ON timeline_event_comments
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can delete their own comments
DROP POLICY IF EXISTS "Users can delete own comments" ON timeline_event_comments;
CREATE POLICY "Users can delete own comments"
  ON timeline_event_comments
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 2. Create view for comments with thumbnails and context
CREATE OR REPLACE VIEW timeline_comments_with_context AS
SELECT 
  c.id,
  c.event_id,
  c.user_id,
  c.comment_text,
  c.image_id,
  c.work_order_id,
  c.thumbnail_url,
  c.context_type,
  c.created_at,
  c.updated_at,
  
  -- Event context
  e.event_type,
  e.event_date,
  e.vehicle_id,
  
  -- User info
  u.email as user_email,
  u.raw_user_meta_data->>'username' as username,
  u.raw_user_meta_data->>'avatar_url' as user_avatar,
  
  -- Image context (if applicable)
  CASE 
    WHEN c.image_id IS NOT NULL THEN 
      jsonb_build_object(
        'url', vi.image_url,
        'thumbnail', COALESCE(c.thumbnail_url, vi.image_url),
        'category', vi.category,
        'taken_at', vi.taken_at
      )
    ELSE NULL
  END as image_context,
  
  -- Work order context (if applicable)
  CASE
    WHEN c.work_order_id IS NOT NULL THEN
      jsonb_build_object(
        'title', ws.work_title,
        'status', ws.status,
        'created_at', ws.created_at
      )
    ELSE NULL
  END as work_order_context

FROM timeline_event_comments c
JOIN vehicle_timeline_events e ON e.id = c.event_id
LEFT JOIN auth.users u ON u.id = c.user_id
LEFT JOIN vehicle_images vi ON vi.id = c.image_id
LEFT JOIN work_sessions ws ON ws.id = c.work_order_id;

COMMENT ON VIEW timeline_comments_with_context IS 'Comments with full context including thumbnails';

-- 3. Function to automatically set thumbnail when commenting on images
CREATE OR REPLACE FUNCTION auto_set_comment_thumbnail()
RETURNS TRIGGER AS $$
BEGIN
  -- If commenting on an image, auto-set thumbnail
  IF NEW.image_id IS NOT NULL AND NEW.thumbnail_url IS NULL THEN
    SELECT image_url INTO NEW.thumbnail_url
    FROM vehicle_images
    WHERE id = NEW.image_id;
    
    NEW.context_type := 'image';
  END IF;
  
  -- If commenting on work order, set context
  IF NEW.work_order_id IS NOT NULL AND NEW.context_type IS NULL THEN
    NEW.context_type := 'work_order';
  END IF;
  
  -- Default to general if nothing specific
  IF NEW.context_type IS NULL THEN
    NEW.context_type := 'general';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_auto_set_comment_thumbnail ON timeline_event_comments;
CREATE TRIGGER tr_auto_set_comment_thumbnail
  BEFORE INSERT ON timeline_event_comments
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_comment_thumbnail();

COMMIT;

