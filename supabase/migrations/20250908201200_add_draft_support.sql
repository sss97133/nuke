-- Add draft support to vehicles table
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT false;

-- Add index for efficient draft queries
CREATE INDEX IF NOT EXISTS idx_vehicles_is_draft ON public.vehicles(is_draft);

-- Update RLS policies to handle drafts
DROP POLICY IF EXISTS "Users can view their own vehicles" ON public.vehicles;
CREATE POLICY "Users can view their own vehicles" ON public.vehicles
    FOR SELECT USING (
        auth.uid() = user_id OR 
        (is_public = true AND is_draft = false)
    );

-- Allow users to update their own drafts
DROP POLICY IF EXISTS "Users can update their own vehicles" ON public.vehicles;
CREATE POLICY "Users can update their own vehicles" ON public.vehicles
    FOR UPDATE USING (auth.uid() = user_id);

-- Allow users to delete their own drafts
DROP POLICY IF EXISTS "Users can delete their own vehicles" ON public.vehicles;
CREATE POLICY "Users can delete their own vehicles" ON public.vehicles
    FOR DELETE USING (auth.uid() = user_id AND is_draft = true);

-- Comment on the new column
COMMENT ON COLUMN public.vehicles.is_draft IS 'Indicates if this vehicle record is a draft (not published)';
