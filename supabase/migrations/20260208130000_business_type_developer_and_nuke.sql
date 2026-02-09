-- Add business_type 'developer' and set Nuke Ltd to developer.

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'public.businesses'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%business_type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.businesses DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- Normalize any existing values not in the new list to 'other' before adding constraint
UPDATE public.businesses
SET business_type = 'other'
WHERE business_type IS NOT NULL
  AND business_type NOT IN (
    'sole_proprietorship', 'partnership', 'llc', 'corporation',
    'garage', 'dealership', 'restoration_shop', 'performance_shop',
    'body_shop', 'detailing', 'mobile_service', 'specialty_shop',
    'parts_supplier', 'fabrication', 'racing_team',
    'auction_house', 'marketplace', 'concours', 'automotive_expo',
    'motorsport_event', 'rally_event', 'builder',
    'collection', 'dealer', 'forum', 'club', 'media', 'registry',
    'developer', 'other'
  );

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_business_type_check
  CHECK (business_type IN (
    'sole_proprietorship', 'partnership', 'llc', 'corporation',
    'garage', 'dealership', 'restoration_shop', 'performance_shop',
    'body_shop', 'detailing', 'mobile_service', 'specialty_shop',
    'parts_supplier', 'fabrication', 'racing_team',
    'auction_house', 'marketplace', 'concours', 'automotive_expo',
    'motorsport_event', 'rally_event', 'builder',
    'collection', 'dealer', 'forum', 'club', 'media', 'registry',
    'developer',
    'other'
  ));

UPDATE public.businesses
SET business_type = 'developer'
WHERE LOWER(TRIM(business_name)) = 'nuke ltd'
   OR LOWER(TRIM(COALESCE(legal_name, ''))) = 'nuke ltd'
   OR slug = 'nuke-ltd';
