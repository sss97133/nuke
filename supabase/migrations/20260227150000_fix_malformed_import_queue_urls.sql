-- Fix malformed listing_url values in import_queue
-- 1. Remove explicit :80 port from http/https URLs (bringatrailer.com:80)
-- 2. Fix BaT URLs with case-mismatch /N/A suffix (normalize to /n/a)
-- 3. Fix BaT URLs with junk path suffixes (/carfax, /title, etc.)
-- These malformed URLs cause "Invalid BaT listing URL" failures after 5 attempts

-- Fix 1: Remove :80 port from BaT URLs
UPDATE import_queue
SET
  listing_url = replace(listing_url, 'bringatrailer.com:80/', 'bringatrailer.com/'),
  status = 'pending',
  attempts = 0,
  error_message = NULL,
  failure_category = NULL,
  next_attempt_at = NULL,
  locked_at = NULL,
  locked_by = NULL
WHERE
  listing_url ILIKE '%bringatrailer.com:80%'
  AND status IN ('failed', 'pending');

-- Fix 2: Normalize BaT /N/A suffix (case sensitivity)
UPDATE import_queue
SET
  listing_url = regexp_replace(listing_url, '/N/A(/?)$', '/n/a\1', 'g'),
  status = 'pending',
  attempts = 0,
  error_message = NULL,
  failure_category = NULL,
  next_attempt_at = NULL,
  locked_at = NULL,
  locked_by = NULL
WHERE
  listing_url ~ 'bringatrailer\.com/listing/.+/N/A'
  AND status IN ('failed', 'pending');

-- Fix 3: Remove known junk suffixes from BaT URLs (/carfax, /title, /n/a)
-- Only strip if it looks like an appended suffix on an otherwise valid URL
UPDATE import_queue
SET
  listing_url = regexp_replace(listing_url, '/(carfax|title|n\/a)$', '', 'g'),
  status = 'pending',
  attempts = 0,
  error_message = NULL,
  failure_category = NULL,
  next_attempt_at = NULL,
  locked_at = NULL,
  locked_by = NULL
WHERE
  listing_url ~ 'bringatrailer\.com/listing/.+/(carfax|title)$'
  AND status IN ('failed', 'pending');
