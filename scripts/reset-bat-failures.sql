-- Reset all BaT failures to pending so they can be reprocessed
UPDATE import_queue
SET
  status = 'pending',
  attempts = 0,
  error_message = NULL,
  locked_by = NULL,
  locked_at = NULL,
  next_attempt_at = NULL,
  last_attempt_at = NULL
WHERE
  status = 'failed'
  AND listing_url LIKE '%bringatrailer%';

-- Show results
SELECT
  status,
  COUNT(*) as count
FROM import_queue
WHERE listing_url LIKE '%bringatrailer%'
GROUP BY status
ORDER BY count DESC;
