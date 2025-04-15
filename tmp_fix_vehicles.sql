ALTER TABLE IF EXISTS public.vehicles ADD COLUMN IF NOT EXISTS owner_id UUID DEFAULT auth.uid();
DROP POLICY IF EXISTS "Users can view their own vehicles" ON public.vehicles;
CREATE POLICY "Users can view their own vehicles" ON public.vehicles FOR SELECT USING (owner_id = auth.uid());
