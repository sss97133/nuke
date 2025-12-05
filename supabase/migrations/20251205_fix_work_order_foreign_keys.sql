-- Fix work_order_parts and work_order_labor to reference timeline_events instead of business_timeline_events
-- This aligns with the comprehensive receipt view

-- Drop old foreign key constraints
ALTER TABLE work_order_parts 
  DROP CONSTRAINT IF EXISTS work_order_parts_timeline_event_id_fkey;

ALTER TABLE work_order_labor 
  DROP CONSTRAINT IF EXISTS work_order_labor_timeline_event_id_fkey;

-- Add new foreign key constraints pointing to timeline_events
ALTER TABLE work_order_parts
  ADD CONSTRAINT work_order_parts_timeline_event_id_fkey 
  FOREIGN KEY (timeline_event_id) 
  REFERENCES timeline_events(id) 
  ON DELETE CASCADE;

ALTER TABLE work_order_labor
  ADD CONSTRAINT work_order_labor_timeline_event_id_fkey 
  FOREIGN KEY (timeline_event_id) 
  REFERENCES timeline_events(id) 
  ON DELETE CASCADE;

COMMENT ON COLUMN work_order_parts.timeline_event_id IS 'References timeline_events (vehicle timeline) not business_timeline_events';
COMMENT ON COLUMN work_order_labor.timeline_event_id IS 'References timeline_events (vehicle timeline) not business_timeline_events';

