-- =====================================================
-- VEHICLE EDIT AUDIT LOG
-- =====================================================
-- Track all changes to vehicles for transparency
-- Date: October 24, 2025
-- =====================================================

-- Create audit log table
CREATE TABLE IF NOT EXISTS vehicle_edit_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  editor_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- What changed
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
  
  -- Context
  edit_reason TEXT,
  ip_address INET,
  user_agent TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'
);

-- Indexes for performance
CREATE INDEX idx_vehicle_edit_audit_vehicle ON vehicle_edit_audit(vehicle_id);
CREATE INDEX idx_vehicle_edit_audit_editor ON vehicle_edit_audit(editor_id);
CREATE INDEX idx_vehicle_edit_audit_created ON vehicle_edit_audit(created_at DESC);
CREATE INDEX idx_vehicle_edit_audit_field ON vehicle_edit_audit(field_name);

-- RLS Policies for audit log
ALTER TABLE vehicle_edit_audit ENABLE ROW LEVEL SECURITY;

-- Anyone can view audit history
CREATE POLICY "Anyone can view edit history"
  ON vehicle_edit_audit
  FOR SELECT
  USING (true);

-- System can insert audit records
CREATE POLICY "System can insert audit records"
  ON vehicle_edit_audit
  FOR INSERT
  WITH CHECK (true);

-- Create function to automatically log vehicle changes
CREATE OR REPLACE FUNCTION log_vehicle_edit()
RETURNS TRIGGER AS $$
DECLARE
  col TEXT;
  old_val TEXT;
  new_val TEXT;
BEGIN
  -- Only log on UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- Loop through changed columns
    FOR col IN 
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'vehicles' 
      AND column_name NOT IN ('updated_at', 'id', 'created_at')
    LOOP
      EXECUTE format('SELECT ($1).%I::TEXT, ($2).%I::TEXT', col, col)
        INTO old_val, new_val
        USING OLD, NEW;
      
      -- Only log if value actually changed
      IF old_val IS DISTINCT FROM new_val THEN
        INSERT INTO vehicle_edit_audit (
          vehicle_id,
          editor_id,
          field_name,
          old_value,
          new_value,
          change_type
        ) VALUES (
          NEW.id,
          auth.uid(),
          col,
          old_val,
          new_val,
          'update'
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to vehicles table
DROP TRIGGER IF EXISTS vehicle_edit_audit_trigger ON vehicles;
CREATE TRIGGER vehicle_edit_audit_trigger
  AFTER UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION log_vehicle_edit();

-- Create view for easy audit history reading
CREATE OR REPLACE VIEW vehicle_edit_history AS
SELECT 
  vea.id,
  vea.vehicle_id,
  v.year || ' ' || v.make || ' ' || v.model AS vehicle_name,
  vea.editor_id,
  p.username AS editor_username,
  p.full_name AS editor_name,
  vea.field_name,
  vea.old_value,
  vea.new_value,
  vea.change_type,
  vea.edit_reason,
  vea.created_at
FROM vehicle_edit_audit vea
LEFT JOIN vehicles v ON v.id = vea.vehicle_id
LEFT JOIN profiles p ON p.id = vea.editor_id
ORDER BY vea.created_at DESC;

-- Grant access to view
GRANT SELECT ON vehicle_edit_history TO authenticated;
GRANT SELECT ON vehicle_edit_history TO anon;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Vehicle edit audit system created! All changes will be tracked transparently.';
END$$;

