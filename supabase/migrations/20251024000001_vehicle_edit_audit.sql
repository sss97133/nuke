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
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_edit_audit_vehicle ON vehicle_edit_audit(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_edit_audit_editor ON vehicle_edit_audit(editor_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_edit_audit_created ON vehicle_edit_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_edit_audit_field ON vehicle_edit_audit(field_name);

-- RLS Policies for audit log
DO $$
BEGIN
  IF to_regclass('public.vehicle_edit_audit') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.vehicle_edit_audit ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vehicle_edit_audit' AND policyname = 'Anyone can view edit history'
    ) THEN
      EXECUTE 'DROP POLICY "Anyone can view edit history" ON public.vehicle_edit_audit';
    END IF;
    EXECUTE 'CREATE POLICY "Anyone can view edit history" ON public.vehicle_edit_audit FOR SELECT USING (true)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vehicle_edit_audit' AND policyname = 'System can insert audit records'
    ) THEN
      EXECUTE 'DROP POLICY "System can insert audit records" ON public.vehicle_edit_audit';
    END IF;
    EXECUTE 'CREATE POLICY "System can insert audit records" ON public.vehicle_edit_audit FOR INSERT WITH CHECK (true)';
  ELSE
    RAISE NOTICE 'Skipping RLS setup: vehicle_edit_audit table does not exist.';
  END IF;
END
$$;

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
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE NOTICE 'Skipping audit trigger: public.vehicles table does not exist.';
    RETURN;
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS vehicle_edit_audit_trigger ON public.vehicles';
  EXECUTE '
    CREATE TRIGGER vehicle_edit_audit_trigger
      AFTER UPDATE ON public.vehicles
      FOR EACH ROW
      EXECUTE FUNCTION public.log_vehicle_edit()
  ';
END
$$;

-- Create view for easy audit history reading
DO $$
BEGIN
  IF to_regclass('public.vehicle_edit_audit') IS NULL THEN
    RAISE NOTICE 'Skipping audit view creation: vehicle_edit_audit table does not exist.';
    RETURN;
  END IF;

  IF to_regclass('public.vehicle_edit_history') IS NOT NULL THEN
    PERFORM 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'vehicle_edit_history'
      AND c.relkind = 'v';

    IF FOUND THEN
      EXECUTE 'DROP VIEW public.vehicle_edit_history';
    ELSE
      EXECUTE 'DROP TABLE IF EXISTS public.vehicle_edit_history CASCADE';
    END IF;
  END IF;

  EXECUTE '
    CREATE VIEW public.vehicle_edit_history AS
    SELECT 
      vea.id,
      vea.vehicle_id,
      v.year || '' '' || v.make || '' '' || v.model AS vehicle_name,
      vea.editor_id,
      p.username AS editor_username,
      p.full_name AS editor_name,
      vea.field_name,
      vea.old_value,
      vea.new_value,
      vea.change_type,
      vea.edit_reason,
      vea.created_at
    FROM public.vehicle_edit_audit vea
    LEFT JOIN public.vehicles v ON v.id = vea.vehicle_id
    LEFT JOIN public.profiles p ON p.id = vea.editor_id
    ORDER BY vea.created_at DESC
  ';

  EXECUTE 'GRANT SELECT ON public.vehicle_edit_history TO authenticated';
  EXECUTE 'GRANT SELECT ON public.vehicle_edit_history TO anon';
END
$$;

