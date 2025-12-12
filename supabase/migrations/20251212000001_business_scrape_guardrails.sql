-- Guardrails: prevent obviously invalid scraped business profiles from corrupting public.businesses
-- Approach:
-- - Add CHECK constraints as NOT VALID to avoid failing on existing bad data.
-- - After cleanup, you can VALIDATE CONSTRAINT to enforce for all rows.
--
-- IMPORTANT:
-- - Constraints are intentionally mild (format sanity) to avoid blocking legitimate entries.
-- - These are focused on columns that scrapers frequently mis-map.

-- Website should be a URL when present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_website_url_format_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_website_url_format_check
      CHECK (website IS NULL OR website ~* '^https?://')
      NOT VALID;
  END IF;
END $$;

-- source_url should be a URL when present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_source_url_format_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_source_url_format_check
      CHECK (source_url IS NULL OR source_url ~* '^https?://')
      NOT VALID;
  END IF;
END $$;

-- Email should be roughly email-shaped when present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_email_format_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_email_format_check
      CHECK (email IS NULL OR email ~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$')
      NOT VALID;
  END IF;
END $$;

-- State should be 2-letter uppercase when present (US assumption)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_state_format_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_state_format_check
      CHECK (state IS NULL OR state ~ '^[A-Z]{2}$')
      NOT VALID;
  END IF;
END $$;

-- Zip should be 5 digits or 5-4 when present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_zip_format_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_zip_format_check
      CHECK (zip_code IS NULL OR zip_code ~ '^\\d{5}(-\\d{4})?$')
      NOT VALID;
  END IF;
END $$;


