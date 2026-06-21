-- iOS ignition site sync: server-side home for the capture app's confirmed
-- sites. Today the app's GPS shop-gate sites are device-local only
-- (Config.shopLocations is hardcoded; ignition-cluster confirmations live in
-- UserDefaults) — they must sync to the server so the gate survives
-- reinstalls and works across devices. Owner-scoped RLS: a user manages only
-- their own sites.

CREATE TABLE IF NOT EXISTS public.user_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  radius_m integer NOT NULL DEFAULT 150,
  source text NOT NULL DEFAULT 'ignition_cluster',
  confirmed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_sites_owner_all ON public.user_sites;
CREATE POLICY user_sites_owner_all
ON public.user_sites
FOR ALL
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE INDEX IF NOT EXISTS idx_user_sites_user_id ON public.user_sites (user_id);
