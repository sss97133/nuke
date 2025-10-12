-- Create missing tables for the remote database

-- Create discovered_vehicles table (for vehicles user is interested in)
CREATE TABLE IF NOT EXISTS public.discovered_vehicles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
    -- Vehicle data (if not yet in main vehicles table)
    make TEXT,
    model TEXT,
    year INTEGER,
    color TEXT,
    vin TEXT,
    -- Discovery metadata
    discovery_context TEXT,
    discovery_source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create vehicle_user_permissions table (for contributor relationships)
CREATE TABLE IF NOT EXISTS public.vehicle_user_permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'contributor', 'viewer', 'moderator')),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    granted_by UUID REFERENCES auth.users(id),
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMPTZ,
    UNIQUE(vehicle_id, user_id, role)
);

-- Add RLS policies for discovered_vehicles
ALTER TABLE public.discovered_vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own discovered vehicles" ON public.discovered_vehicles
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own discovered vehicles" ON public.discovered_vehicles
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own discovered vehicles" ON public.discovered_vehicles
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own discovered vehicles" ON public.discovered_vehicles
    FOR DELETE
    USING (auth.uid() = user_id);

-- Add RLS policies for vehicle_user_permissions
ALTER TABLE public.vehicle_user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view permissions for vehicles they're associated with" ON public.vehicle_user_permissions
    FOR SELECT
    USING (auth.uid() = user_id OR EXISTS (
        SELECT 1 FROM public.vehicles v 
        WHERE v.id = vehicle_id AND v.user_id = auth.uid()
    ));

CREATE POLICY "Vehicle owners can grant permissions" ON public.vehicle_user_permissions
    FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.vehicles v 
        WHERE v.id = vehicle_id AND v.user_id = auth.uid()
    ));

CREATE POLICY "Vehicle owners can update permissions" ON public.vehicle_user_permissions
    FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.vehicles v 
        WHERE v.id = vehicle_id AND v.user_id = auth.uid()
    ));

CREATE POLICY "Vehicle owners can revoke permissions" ON public.vehicle_user_permissions
    FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM public.vehicles v 
        WHERE v.id = vehicle_id AND v.user_id = auth.uid()
    ));
