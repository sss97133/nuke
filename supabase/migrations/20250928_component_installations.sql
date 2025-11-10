-- Create component_installations table
CREATE TABLE IF NOT EXISTS public.component_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    
    component_category TEXT NOT NULL,
    component_type TEXT NOT NULL,
    component_location TEXT,
    
    brand TEXT NOT NULL,
    part_number TEXT,
    serial_number TEXT,
    country_of_origin TEXT,
    
    is_oem BOOLEAN DEFAULT false,
    is_genuine BOOLEAN DEFAULT true,
    quality_tier TEXT DEFAULT 'aftermarket',
    
    installed_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    installed_by UUID REFERENCES auth.users(id),
    installation_shop UUID,
    labor_hours NUMERIC(5,2),
    
    receipt_url TEXT,
    invoice_number TEXT,
    purchase_price NUMERIC(10,2),
    installation_cost NUMERIC(10,2),
    
    verified_by_mechanic BOOLEAN DEFAULT false,
    verification_photos TEXT[],
    torque_specs_followed BOOLEAN,
    torque_values JSONB,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_component_vehicle ON public.component_installations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_component_category ON public.component_installations(component_category);
CREATE INDEX IF NOT EXISTS idx_component_brand ON public.component_installations(brand);
CREATE INDEX IF NOT EXISTS idx_component_quality ON public.component_installations(quality_tier);
CREATE INDEX IF NOT EXISTS idx_component_installed_date ON public.component_installations(installed_date DESC);
CREATE INDEX IF NOT EXISTS idx_component_installed_by ON public.component_installations(installed_by);
CREATE INDEX IF NOT EXISTS idx_component_created_by ON public.component_installations(created_by);

ALTER TABLE public.component_installations ENABLE ROW LEVEL SECURITY;

-- RLS policies (separate per operation; specify roles)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.component_installations TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'component_installations' AND policyname = 'Public vehicle read'
  ) THEN
    EXECUTE 'CREATE POLICY "Public vehicle read" ON public.component_installations
    FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = component_installations.vehicle_id AND v.is_public = true)
        OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = component_installations.vehicle_id AND v.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = component_installations.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true AND vup.role IN (''owner'',''co_owner'',''mechanic'',''appraiser'',''moderator''))
      )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'component_installations' AND policyname = 'Owner insert'
  ) THEN
    EXECUTE 'CREATE POLICY "Owner insert" ON public.component_installations
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = component_installations.vehicle_id AND v.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = component_installations.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true AND vup.role IN (''owner'',''co_owner'',''mechanic'',''appraiser'',''moderator''))
      )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'component_installations' AND policyname = 'Owner update'
  ) THEN
    EXECUTE 'CREATE POLICY "Owner update" ON public.component_installations
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = component_installations.vehicle_id AND v.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = component_installations.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true AND vup.role IN (''owner'',''co_owner'',''mechanic'',''appraiser'',''moderator''))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = component_installations.vehicle_id AND v.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = component_installations.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true AND vup.role IN (''owner'',''co_owner'',''mechanic'',''appraiser'',''moderator''))
      )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'component_installations' AND policyname = 'Owner delete'
  ) THEN
    EXECUTE 'CREATE POLICY "Owner delete" ON public.component_installations
    FOR DELETE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = component_installations.vehicle_id AND v.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = component_installations.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true AND vup.role IN (''owner'',''co_owner'',''moderator''))
      )';
  END IF;
END;
$$;

-- Create atomic_events table
CREATE TABLE IF NOT EXISTS public.atomic_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    
    event_type TEXT NOT NULL,
    object_class TEXT NOT NULL,
    object_identifier TEXT NOT NULL,
    
    actor_id UUID REFERENCES auth.users(id),
    location_id UUID,
    parent_event_id UUID REFERENCES public.atomic_events(id),
    
    evidence_urls TEXT[],
    evidence_type TEXT[],
    
    metadata JSONB,
    confidence_score NUMERIC(3,2),
    
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_atomic_vehicle ON public.atomic_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_atomic_event_type ON public.atomic_events(event_type);
CREATE INDEX IF NOT EXISTS idx_atomic_object_class ON public.atomic_events(object_class);
CREATE INDEX IF NOT EXISTS idx_atomic_object_id ON public.atomic_events(object_identifier);
CREATE INDEX IF NOT EXISTS idx_atomic_timestamp ON public.atomic_events(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_atomic_actor ON public.atomic_events(actor_id);

ALTER TABLE public.atomic_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.atomic_events TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'atomic_events' AND policyname = 'Public vehicle events read'
  ) THEN
    EXECUTE 'CREATE POLICY "Public vehicle events read" ON public.atomic_events
    FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = atomic_events.vehicle_id AND v.is_public = true)
        OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = atomic_events.vehicle_id AND v.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = atomic_events.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true AND vup.role IN (''owner'',''co_owner'',''mechanic'',''appraiser'',''moderator''))
      )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'atomic_events' AND policyname = 'Owner events insert'
  ) THEN
    EXECUTE 'CREATE POLICY "Owner events insert" ON public.atomic_events
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = atomic_events.vehicle_id AND v.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = atomic_events.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true AND vup.role IN (''owner'',''co_owner'',''mechanic'',''appraiser'',''moderator''))
      )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'atomic_events' AND policyname = 'Owner events update'
  ) THEN
    EXECUTE 'CREATE POLICY "Owner events update" ON public.atomic_events
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = atomic_events.vehicle_id AND v.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = atomic_events.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true AND vup.role IN (''owner'',''co_owner'',''mechanic'',''appraiser'',''moderator''))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = atomic_events.vehicle_id AND v.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = atomic_events.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true AND vup.role IN (''owner'',''co_owner'',''mechanic'',''appraiser'',''moderator''))
      )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'atomic_events' AND policyname = 'Owner events delete'
  ) THEN
    EXECUTE 'CREATE POLICY "Owner events delete" ON public.atomic_events
    FOR DELETE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = atomic_events.vehicle_id AND v.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = atomic_events.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true AND vup.role IN (''owner'',''co_owner'',''moderator''))
      )';
  END IF;
END;
$$;

-- Trigger function: recalc component_value; safe for INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION public.update_vehicle_component_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    target_vehicle UUID := COALESCE(
        (CASE WHEN TG_OP = 'DELETE' THEN OLD.vehicle_id ELSE NEW.vehicle_id END),
        NULL
    );
BEGIN
    IF target_vehicle IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    UPDATE public.vehicles v
    SET metadata = jsonb_set(
        COALESCE(v.metadata, '{}'::jsonb),
        '{component_value}',
        (
            SELECT COALESCE(SUM(ci.purchase_price), 0)::text::jsonb
            FROM public.component_installations ci
            WHERE ci.vehicle_id = target_vehicle
        )
    )
    WHERE v.id = target_vehicle;
    
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS update_vehicle_on_component_change ON public.component_installations;
CREATE TRIGGER update_vehicle_on_component_change
    AFTER INSERT OR UPDATE OR DELETE ON public.component_installations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_vehicle_component_value();

-- Removed mock seed data. No inserts are executed here.
