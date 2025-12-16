-- BaT DOM Map Health Tracking (HTML snapshots + per-field extraction health)
-- Purpose:
-- 1) Persist HTML evidence so we can re-run deterministic extractors without re-scraping
-- 2) Persist per-field health metrics so Admin can see coverage/failures/backfill readiness
--
-- Notes:
-- - Uses IF NOT EXISTS + safe constraints so db reset/apply is repeatable.
-- - Generalized to "listing_*" so other platforms can reuse it (BaT is the first client).

-- ============================================================
-- 1) HTML SNAPSHOTS (Evidence)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.listing_page_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  platform TEXT NOT NULL, -- 'bat', 'craigslist', etc.
  listing_url TEXT NOT NULL,

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_method TEXT,      -- 'firecrawl' | 'direct' | 'other'
  http_status INTEGER,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,

  -- Evidence
  html TEXT,
  html_sha256 TEXT,
  content_length INTEGER,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_page_snapshots_platform_url_time
  ON public.listing_page_snapshots(platform, listing_url, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_page_snapshots_platform_time
  ON public.listing_page_snapshots(platform, fetched_at DESC);

-- Idempotent dedupe: same HTML for same listing should not be inserted repeatedly.
-- (Partial indexes are not supported by IF NOT EXISTS in all versions; use DO block + exception-safe create)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_listing_page_snapshots_platform_url_sha'
  ) THEN
    CREATE UNIQUE INDEX uq_listing_page_snapshots_platform_url_sha
      ON public.listing_page_snapshots(platform, listing_url, html_sha256)
      WHERE html_sha256 IS NOT NULL;
  END IF;
END
$$;

-- ============================================================
-- 2) EXTRACTION HEALTH (per listing + per run)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.listing_extraction_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  platform TEXT NOT NULL,
  listing_url TEXT NOT NULL,
  snapshot_id UUID REFERENCES public.listing_page_snapshots(id) ON DELETE SET NULL,

  extractor_name TEXT NOT NULL,    -- 'bat_dom_map'
  extractor_version TEXT NOT NULL, -- 'v1'

  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Health payload is intentionally JSON so we can evolve fields without migrations:
  -- {
  --   "overall_score": 0-100,
  --   "fields": { "location": { "ok": true, "value": "...", "method": "selector:..." }, ... },
  --   "counts": { "images": 123, "comments": 456, "bids": 78 },
  --   "warnings": ["..."],
  --   "errors": ["..."]
  -- }
  health JSONB NOT NULL DEFAULT '{}'::jsonb,
  overall_score INTEGER,
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_extraction_health_platform_time
  ON public.listing_extraction_health(platform, extracted_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_extraction_health_platform_url_time
  ON public.listing_extraction_health(platform, listing_url, extracted_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_listing_extraction_health_snapshot_extractor'
  ) THEN
    CREATE UNIQUE INDEX uq_listing_extraction_health_snapshot_extractor
      ON public.listing_extraction_health(snapshot_id, extractor_name, extractor_version)
      WHERE snapshot_id IS NOT NULL;
  END IF;
END
$$;

-- ============================================================
-- 3) Views / RPC for admin dashboards
-- ============================================================

-- Latest health row per platform+listing_url
CREATE OR REPLACE VIEW public.listing_extraction_health_latest AS
SELECT DISTINCT ON (platform, listing_url)
  platform,
  listing_url,
  snapshot_id,
  extractor_name,
  extractor_version,
  extracted_at,
  overall_score,
  ok,
  error_message,
  health
FROM public.listing_extraction_health
ORDER BY platform, listing_url, extracted_at DESC;

-- BaT summary helper (coverage + missing fields)
CREATE OR REPLACE FUNCTION public.get_bat_dom_health_summary(p_hours INTEGER DEFAULT 168)
RETURNS TABLE (
  listings INTEGER,
  ok_listings INTEGER,
  fail_listings INTEGER,
  avg_score NUMERIC,
  p50_score NUMERIC,
  images_missing INTEGER,
  location_missing INTEGER,
  description_missing INTEGER,
  comments_missing INTEGER,
  bids_missing INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH h AS (
    SELECT *
    FROM public.listing_extraction_health_latest
    WHERE platform = 'bat'
      AND extracted_at > NOW() - (p_hours || ' hours')::INTERVAL
  ),
  scores AS (
    SELECT
      COUNT(*)::INTEGER AS listings,
      COUNT(*) FILTER (WHERE ok)::INTEGER AS ok_listings,
      COUNT(*) FILTER (WHERE NOT ok)::INTEGER AS fail_listings,
      AVG(COALESCE(overall_score, 0))::NUMERIC AS avg_score,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(overall_score, 0))::NUMERIC AS p50_score,
      COUNT(*) FILTER (WHERE COALESCE((health->'counts'->>'images')::INT, 0) = 0)::INTEGER AS images_missing,
      COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'location'->>'ok')::BOOLEAN, FALSE) = FALSE)::INTEGER AS location_missing,
      COUNT(*) FILTER (WHERE COALESCE((health->'fields'->'description'->>'ok')::BOOLEAN, FALSE) = FALSE)::INTEGER AS description_missing,
      COUNT(*) FILTER (WHERE COALESCE((health->'counts'->>'comments')::INT, 0) = 0)::INTEGER AS comments_missing,
      COUNT(*) FILTER (WHERE COALESCE((health->'counts'->>'bids')::INT, 0) = 0)::INTEGER AS bids_missing
    FROM h
  )
  SELECT * FROM scores;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4) RLS
-- ============================================================
-- Helper: admin/moderator gate (do NOT rely on deprecated profiles.is_admin)
CREATE OR REPLACE FUNCTION public.is_admin_or_moderator()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        -- Some environments use user_type enum for privilege
        (p.user_type::text IN ('admin', 'moderator'))
        -- Others use a freeform role string
        OR (p.role IN ('admin', 'moderator', 'superadmin'))
      )
  );
$$;

ALTER TABLE public.listing_page_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_extraction_health ENABLE ROW LEVEL SECURITY;

-- Service role write access
DROP POLICY IF EXISTS "Service role can manage listing_page_snapshots" ON public.listing_page_snapshots;
CREATE POLICY "Service role can manage listing_page_snapshots"
  ON public.listing_page_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can manage listing_extraction_health" ON public.listing_extraction_health;
CREATE POLICY "Service role can manage listing_extraction_health"
  ON public.listing_extraction_health
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Admin read access (re-uses profiles.is_admin convention used elsewhere)
DROP POLICY IF EXISTS "Admins can read listing_page_snapshots" ON public.listing_page_snapshots;
CREATE POLICY "Admins can read listing_page_snapshots"
  ON public.listing_page_snapshots
  FOR SELECT
  USING (
    public.is_admin_or_moderator()
  );

DROP POLICY IF EXISTS "Admins can read listing_extraction_health" ON public.listing_extraction_health;
CREATE POLICY "Admins can read listing_extraction_health"
  ON public.listing_extraction_health
  FOR SELECT
  USING (
    public.is_admin_or_moderator()
  );


