-- Component Lifecycle Tracking
-- 
-- For complex restorations where work spans months/years.
-- Simple before/after pairs don't capture:
--   - Front clip removed Jan 15 (6 hrs)
--   - ... 2 months pass ...
--   - Front clip prepped Mar 20 (4 hrs)
--   - ... 3 months pass ...
--   - Front clip painted Jun 10 (8 hrs)
--   - ... 6 months pass ...
--   - Front clip installed Dec 15 (8 hrs)
--   TOTAL: 26 hrs over 11 months
--
-- The AI tracks COMPONENT STATE over TIME, not just image pairs.

CREATE TABLE IF NOT EXISTS component_lifecycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Component identification
  component_name TEXT NOT NULL,  -- 'front_clip', 'driver_door', 'engine'
  component_category TEXT,       -- 'body', 'interior', 'mechanical', 'electrical'
  
  -- Current state in restoration lifecycle
  current_state TEXT NOT NULL DEFAULT 'original',
  -- Possible states:
  --   original         - Factory/as-found condition
  --   removed          - Taken off vehicle
  --   disassembled     - Broken down into sub-components
  --   stored           - Waiting for work
  --   in_prep          - Being prepped (sanding, rust removal)
  --   in_fabrication   - Metal work, welding, panel replacement
  --   in_primer        - Primed, waiting for paint
  --   in_paint         - Being painted
  --   in_finishing     - Clear coat, wet sanding, buffing
  --   ready_to_install - Complete, waiting for installation
  --   installed        - Back on vehicle
  --   complete         - Fully done, verified
  
  -- State history (array of state changes with timestamps, images, labor)
  state_history JSONB DEFAULT '[]',
  -- Each entry: { fromState, toState, timestamp, imageIds, laborHours, materials, notes, confidence }
  
  -- Cumulative totals across ALL sessions for this component
  total_labor_hours REAL DEFAULT 0,
  total_materials_cost DECIMAL(10,2) DEFAULT 0,
  total_sessions INT DEFAULT 0,
  
  -- Timeline span (can be months/years apart)
  first_activity TIMESTAMPTZ,
  last_activity TIMESTAMPTZ,
  
  -- Completion tracking
  percent_complete INT DEFAULT 0,
  estimated_remaining_hours REAL,
  
  -- Links to timeline events for this component
  linked_timeline_event_ids UUID[] DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- One lifecycle per component per vehicle
  UNIQUE(vehicle_id, component_name)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_component_lifecycles_vehicle ON component_lifecycles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_component_lifecycles_state ON component_lifecycles(current_state);
CREATE INDEX IF NOT EXISTS idx_component_lifecycles_category ON component_lifecycles(component_category);

-- Index for finding incomplete work (loose ends)
CREATE INDEX IF NOT EXISTS idx_component_lifecycles_incomplete ON component_lifecycles(vehicle_id) 
  WHERE current_state NOT IN ('original', 'complete');

-- View for finding "loose ends" - components with work started but not finished
-- AI can use this to tie up loose ends when it sees related images
CREATE OR REPLACE VIEW component_loose_ends AS
SELECT 
  cl.*,
  v.year, v.make, v.model,
  DATE_PART('day', NOW() - cl.last_activity) as days_since_activity,
  CASE 
    WHEN DATE_PART('day', NOW() - cl.last_activity) > 180 THEN 'stale'
    WHEN DATE_PART('day', NOW() - cl.last_activity) > 30 THEN 'idle'
    ELSE 'active'
  END as activity_status
FROM component_lifecycles cl
JOIN vehicles v ON v.id = cl.vehicle_id
WHERE cl.current_state NOT IN ('original', 'complete')
ORDER BY cl.last_activity ASC;  -- Oldest/most stale first

COMMENT ON TABLE component_lifecycles IS 'Tracks component state through restoration lifecycle (months/years)';
COMMENT ON COLUMN component_lifecycles.state_history IS 'Array of state changes with labor/materials per session';
COMMENT ON VIEW component_loose_ends IS 'Components with work started but not completed - AI can help tie up';

