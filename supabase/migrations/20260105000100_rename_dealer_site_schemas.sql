-- Rename dealer_site_schemas -> source_site_schemas (and related indexes)

DO $$
BEGIN
  IF to_regclass('public.dealer_site_schemas') IS NOT NULL
     AND to_regclass('public.source_site_schemas') IS NULL THEN
    EXECUTE 'ALTER TABLE dealer_site_schemas RENAME TO source_site_schemas';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.idx_dealer_site_schemas_domain') IS NOT NULL
     AND to_regclass('public.idx_source_site_schemas_domain') IS NULL THEN
    EXECUTE 'ALTER INDEX idx_dealer_site_schemas_domain RENAME TO idx_source_site_schemas_domain';
  END IF;

  IF to_regclass('public.idx_dealer_site_schemas_type') IS NOT NULL
     AND to_regclass('public.idx_source_site_schemas_type') IS NULL THEN
    EXECUTE 'ALTER INDEX idx_dealer_site_schemas_type RENAME TO idx_source_site_schemas_type';
  END IF;

  IF to_regclass('public.idx_dealer_site_schemas_valid') IS NOT NULL
     AND to_regclass('public.idx_source_site_schemas_valid') IS NULL THEN
    EXECUTE 'ALTER INDEX idx_dealer_site_schemas_valid RENAME TO idx_source_site_schemas_valid';
  END IF;
END $$;

-- Ensure indexes exist regardless of rename order
CREATE INDEX IF NOT EXISTS idx_source_site_schemas_domain ON source_site_schemas(domain);
CREATE INDEX IF NOT EXISTS idx_source_site_schemas_type ON source_site_schemas(site_type);
CREATE INDEX IF NOT EXISTS idx_source_site_schemas_valid ON source_site_schemas(is_valid) WHERE is_valid = true;
-- Rename dealer_site_schemas -> source_site_schemas and expand metadata

DO $$
BEGIN
  IF to_regclass('public.dealer_site_schemas') IS NOT NULL
     AND to_regclass('public.source_site_schemas') IS NULL THEN
    EXECUTE 'ALTER TABLE dealer_site_schemas RENAME TO source_site_schemas';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.idx_dealer_site_schemas_domain') IS NOT NULL
     AND to_regclass('public.idx_source_site_schemas_domain') IS NULL THEN
    EXECUTE 'ALTER INDEX idx_dealer_site_schemas_domain RENAME TO idx_source_site_schemas_domain';
  END IF;

  IF to_regclass('public.idx_dealer_site_schemas_type') IS NOT NULL
     AND to_regclass('public.idx_source_site_schemas_type') IS NULL THEN
    EXECUTE 'ALTER INDEX idx_dealer_site_schemas_type RENAME TO idx_source_site_schemas_type';
  END IF;

  IF to_regclass('public.idx_dealer_site_schemas_valid') IS NOT NULL
     AND to_regclass('public.idx_source_site_schemas_valid') IS NULL THEN
    EXECUTE 'ALTER INDEX idx_dealer_site_schemas_valid RENAME TO idx_source_site_schemas_valid';
  END IF;
END $$;

-- Ensure indexes exist even if rename already happened earlier
CREATE INDEX IF NOT EXISTS idx_source_site_schemas_domain ON source_site_schemas(domain);
CREATE INDEX IF NOT EXISTS idx_source_site_schemas_type ON source_site_schemas(site_type);
CREATE INDEX IF NOT EXISTS idx_source_site_schemas_valid ON source_site_schemas(is_valid) WHERE is_valid = true;

-- Refresh check constraint with expanded site types
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dealer_site_schemas_site_type_check'
  ) THEN
    EXECUTE 'ALTER TABLE source_site_schemas DROP CONSTRAINT dealer_site_schemas_site_type_check';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'source_site_schemas_site_type_check'
  ) THEN
    EXECUTE 'ALTER TABLE source_site_schemas DROP CONSTRAINT source_site_schemas_site_type_check';
  END IF;
END $$;

ALTER TABLE source_site_schemas
  ADD CONSTRAINT source_site_schemas_site_type_check CHECK (
    site_type IN (
      'directory',
      'dealer_website',
      'auction_house',
      'marketplace',
      'builder',
      'manufacturer',
      'broker',
      'service_shop',
      'supplier',
      'fabricator',
      'oem',
      'platform'
    )
  );

COMMENT ON TABLE source_site_schemas IS 'Catalog of site structures for structure-first extraction';
COMMENT ON COLUMN source_site_schemas.schema_data IS 'JSONB structure mapping field locations and extraction patterns';

