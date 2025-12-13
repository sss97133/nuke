-- Link catalog_sources -> data_source_registry with high-confidence matching only
-- Goal: unify catalog provider identity without introducing a provider org profile system.
--
-- Confidence rules (intentionally strict):
-- - Exact (case-insensitive) provider name == source_name
-- - OR exact domain match between catalog_sources.base_url and data_source_registry.source_url

DO $$
BEGIN
  IF to_regclass('public.catalog_sources') IS NULL OR to_regclass('public.data_source_registry') IS NULL THEN
    RETURN;
  END IF;

  -- Add FK column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'catalog_sources'
      AND column_name = 'source_registry_id'
  ) THEN
    ALTER TABLE public.catalog_sources
      ADD COLUMN source_registry_id UUID REFERENCES public.data_source_registry(id) ON DELETE SET NULL;
  END IF;

  -- Helpful index
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'catalog_sources'
      AND indexname = 'idx_catalog_sources_source_registry_id'
  ) THEN
    CREATE INDEX idx_catalog_sources_source_registry_id ON public.catalog_sources(source_registry_id)
      WHERE source_registry_id IS NOT NULL;
  END IF;

  -- Backfill by exact provider name match (case-insensitive)
  UPDATE public.catalog_sources cs
  SET source_registry_id = dsr.id
  FROM public.data_source_registry dsr
  WHERE cs.source_registry_id IS NULL
    AND cs.provider IS NOT NULL
    AND btrim(cs.provider) <> ''
    AND dsr.source_name IS NOT NULL
    AND lower(btrim(dsr.source_name)) = lower(btrim(cs.provider));

  -- Backfill by domain match (strip scheme, path, and www.)
  UPDATE public.catalog_sources cs
  SET source_registry_id = dsr.id
  FROM public.data_source_registry dsr
  WHERE cs.source_registry_id IS NULL
    AND cs.base_url IS NOT NULL
    AND dsr.source_url IS NOT NULL
    AND regexp_replace(
          split_part(regexp_replace(lower(cs.base_url), '^https?://', ''), '/', 1),
          '^www\\.', ''
        ) = regexp_replace(
          split_part(regexp_replace(lower(dsr.source_url), '^https?://', ''), '/', 1),
          '^www\\.', ''
        );
END $$;

COMMENT ON COLUMN public.catalog_sources.source_registry_id IS 'Optional link to data_source_registry(id) when provider identity matches with high confidence.';


