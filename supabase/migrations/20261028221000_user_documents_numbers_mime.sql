-- The financial evidence intake accepts Apple Numbers originals (.numbers, see ingest-observation
-- financialEvidence.ts), but the private user-documents bucket refused their MIME types, so a Numbers
-- workbook could not be stored as its own original. Allow the two types Apple and browsers send.
-- The bucket stays private; its size limit and policies are unchanged.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT array_agg(DISTINCT t ORDER BY t)
  FROM unnest(allowed_mime_types || ARRAY['application/x-iwork-numbers-sffnumbers', 'application/vnd.apple.numbers']) t)
WHERE id = 'user-documents'
  AND allowed_mime_types IS NOT NULL
  AND NOT (allowed_mime_types @> ARRAY['application/x-iwork-numbers-sffnumbers', 'application/vnd.apple.numbers']);
COMMIT;
