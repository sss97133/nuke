-- Remove user association from automated bulk imports
-- These vehicles were created by automation, not user uploads
-- They should be linked to organizations, not individual users

UPDATE vehicles
SET 
  uploaded_by = NULL,
  origin_metadata = origin_metadata || jsonb_build_object(
    'automated_import', true,
    'no_user_uploader', true,
    'backfilled_uploaded_by', false
  )
WHERE profile_origin = 'dropbox_import'
  AND created_at >= '2025-11-03T06:49:00'::timestamptz
  AND created_at <= '2025-11-03T06:55:00'::timestamptz
  AND origin_organization_id IS NOT NULL;

-- Verify the update
SELECT 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE uploaded_by IS NULL) as no_user,
  COUNT(*) FILTER (WHERE origin_organization_id IS NOT NULL) as has_org,
  COUNT(*) FILTER (WHERE origin_metadata->>'automated_import' = 'true') as marked_automated
FROM vehicles
WHERE profile_origin = 'dropbox_import'
  AND created_at >= '2025-11-03T06:49:00'::timestamptz
  AND created_at <= '2025-11-03T06:55:00'::timestamptz;

