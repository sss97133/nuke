-- ECR Make/Model Catalog (Exclusive Car Registry)
-- Stores a lightweight taxonomy (makes + models) with counts and URLs.
-- Intentionally separate from canonical_makes/canonical_models (factory-correct nomenclature).
--
-- Primary seed pages:
-- - https://exclusivecarregistry.com/make
-- - https://exclusivecarregistry.com/make/<make_slug>
-- - (derived) https://exclusivecarregistry.com/model/<make_slug>/<model_slug>

-- 1) Makes
CREATE TABLE IF NOT EXISTS public.ecr_makes (
  ecr_make_slug TEXT PRIMARY KEY,
  make_name TEXT NOT NULL,
  make_url TEXT NOT NULL,
  logo_url TEXT,
  model_count INTEGER,
  car_count INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ecr_makes_name ON public.ecr_makes(make_name);
CREATE INDEX IF NOT EXISTS idx_ecr_makes_last_seen ON public.ecr_makes(last_seen_at DESC);

-- 2) Models (scoped to make)
CREATE TABLE IF NOT EXISTS public.ecr_models (
  ecr_make_slug TEXT NOT NULL REFERENCES public.ecr_makes(ecr_make_slug) ON DELETE CASCADE,
  ecr_model_slug TEXT NOT NULL,
  model_name TEXT NOT NULL,
  summary TEXT,
  variants_count INTEGER,
  image_url TEXT,
  model_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (ecr_make_slug, ecr_model_slug)
);

CREATE INDEX IF NOT EXISTS idx_ecr_models_make ON public.ecr_models(ecr_make_slug);
CREATE INDEX IF NOT EXISTS idx_ecr_models_name ON public.ecr_models(model_name);
CREATE INDEX IF NOT EXISTS idx_ecr_models_last_seen ON public.ecr_models(last_seen_at DESC);

-- 3) RLS (public read; service role writes)
ALTER TABLE public.ecr_makes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecr_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read ecr makes" ON public.ecr_makes;
CREATE POLICY "Public read ecr makes"
  ON public.ecr_makes
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Public read ecr models" ON public.ecr_models;
CREATE POLICY "Public read ecr models"
  ON public.ecr_models
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Service role write ecr makes" ON public.ecr_makes;
CREATE POLICY "Service role write ecr makes"
  ON public.ecr_makes
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role write ecr models" ON public.ecr_models;
CREATE POLICY "Service role write ecr models"
  ON public.ecr_models
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

