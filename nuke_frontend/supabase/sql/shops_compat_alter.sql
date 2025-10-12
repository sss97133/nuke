BEGIN;

-- Ensure shops table has is_public column used by policies and public viewing
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT true;

-- Backfill NULLs to true to allow public viewing by default
UPDATE public.shops SET is_public = COALESCE(is_public, true) WHERE is_public IS NULL;

-- Ensure shops table has verification_status for UI
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'unverified';

-- Backfill NULL verification_status to 'unverified'
UPDATE public.shops
SET verification_status = COALESCE(verification_status, 'unverified')
WHERE verification_status IS NULL;

COMMIT;
