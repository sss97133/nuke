-- Quick fix to ensure content_approval_status type exists
-- This should have been created by 20251119000003_public_content_visibility.sql
-- but may be missing in some environments

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_approval_status') THEN
    CREATE TYPE content_approval_status AS ENUM ('pending','auto_approved','approved','rejected');
    RAISE NOTICE 'Created content_approval_status enum type';
  ELSE
    RAISE NOTICE 'content_approval_status enum type already exists';
  END IF;
END $$;

-- Ensure the column exists on vehicle_images
ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS approval_status content_approval_status NOT NULL DEFAULT 'pending';

