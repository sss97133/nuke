-- Fix placeholder URLs by marking them as broken
-- These will need to be re-uploaded by users

UPDATE vehicle_documents
SET
  file_url = 'BROKEN: ' || file_url,
  description = COALESCE(description, '') || ' [NEEDS RE-UPLOAD: File was using broken placeholder URL]'
WHERE file_url LIKE '%placeholder-storage.com%';

UPDATE ownership_verifications
SET
  title_document_url = CASE
    WHEN title_document_url LIKE '%placeholder-storage.com%' THEN 'BROKEN: ' || title_document_url
    ELSE title_document_url
  END,
  drivers_license_url = CASE
    WHEN drivers_license_url LIKE '%placeholder-storage.com%' THEN 'BROKEN: ' || drivers_license_url
    ELSE drivers_license_url
  END,
  face_scan_url = CASE
    WHEN face_scan_url LIKE '%placeholder-storage.com%' THEN 'BROKEN: ' || face_scan_url
    ELSE face_scan_url
  END,
  insurance_document_url = CASE
    WHEN insurance_document_url LIKE '%placeholder-storage.com%' THEN 'BROKEN: ' || insurance_document_url
    ELSE insurance_document_url
  END,
  status = CASE
    WHEN title_document_url LIKE '%placeholder-storage.com%'
      OR drivers_license_url LIKE '%placeholder-storage.com%'
      OR face_scan_url LIKE '%placeholder-storage.com%'
      OR insurance_document_url LIKE '%placeholder-storage.com%'
    THEN 'needs_reupload'
    ELSE status
  END
WHERE title_document_url LIKE '%placeholder-storage.com%'
   OR drivers_license_url LIKE '%placeholder-storage.com%'
   OR face_scan_url LIKE '%placeholder-storage.com%'
   OR insurance_document_url LIKE '%placeholder-storage.com%';

SELECT 'Fixed placeholder URLs - users will need to re-upload affected files' as result;