-- Backfill slugs for all businesses that don't have one
-- and add a trigger to auto-generate slugs on INSERT

-- Function to generate a URL-safe slug from a name
CREATE OR REPLACE FUNCTION generate_business_slug(name TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INT := 2;
BEGIN
  -- Lowercase, replace non-alphanumeric with hyphens, trim hyphens, collapse multiple hyphens
  base_slug := lower(name);
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
  base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
  base_slug := regexp_replace(base_slug, '-{2,}', '-', 'g');

  -- Truncate to 60 chars
  base_slug := left(base_slug, 60);
  base_slug := regexp_replace(base_slug, '-+$', '', 'g');

  -- If empty after cleaning, use a fallback
  IF base_slug = '' OR base_slug IS NULL THEN
    base_slug := 'org';
  END IF;

  -- Check uniqueness, append counter if needed
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM businesses WHERE slug = final_slug) LOOP
    final_slug := base_slug || '-' || counter;
    counter := counter + 1;
  END LOOP;

  RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

-- Backfill all businesses without slugs
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, business_name FROM businesses WHERE slug IS NULL ORDER BY created_at LOOP
    UPDATE businesses SET slug = generate_business_slug(r.business_name) WHERE id = r.id;
  END LOOP;
END $$;

-- Trigger to auto-generate slug on INSERT if not provided
CREATE OR REPLACE FUNCTION trigger_generate_business_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL AND NEW.business_name IS NOT NULL THEN
    NEW.slug := generate_business_slug(NEW.business_name);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_slug_businesses ON businesses;
CREATE TRIGGER trg_auto_slug_businesses
  BEFORE INSERT ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_generate_business_slug();
