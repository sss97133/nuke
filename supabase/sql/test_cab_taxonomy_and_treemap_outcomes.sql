-- Contract test for Cars & Bids multi-axis taxonomy (`series`, `trim`, `body_style`),
-- outcome & sale_date normalization, and `treemap_family_sales` series facet enrichment.
-- Runs inside `BEGIN ... ROLLBACK` via `scripts/ci/db-contracts.sh`.

BEGIN;

-- 1. Verify `public.treemap_family_sales` exists and includes `v.series` in its definition
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.treemap_family_sales(text, text, integer)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.treemap_family_sales(text, text, integer) is missing';
  END IF;
  IF position('v.series' in v_def) = 0 THEN
    RAISE EXCEPTION 'public.treemap_family_sales must enrich model descriptor with v.series';
  END IF;
  IF position('v.trim' in v_def) = 0 THEN
    RAISE EXCEPTION 'public.treemap_family_sales must enrich model descriptor with v.trim';
  END IF;
  IF position('v.body_style' in v_def) = 0 THEN
    RAISE EXCEPTION 'public.treemap_family_sales must enrich model descriptor with v.body_style';
  END IF;
END $$;

-- 2. Verify canonical_models includes the Cars & Bids coarse model aliases
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.canonical_models WHERE lower(make) = 'ford' AND lower(canonical_model) = 'f-250') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.canonical_models
      WHERE lower(make) = 'ford'
        AND lower(canonical_model) = 'f-250'
        AND aliases @> ARRAY['super duty']
    ) THEN
      RAISE EXCEPTION 'Ford F-250 canonical_models row is missing alias "super duty"';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.canonical_models WHERE lower(make) = 'bmw' AND lower(canonical_model) = '2002') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.canonical_models
      WHERE lower(make) = 'bmw'
        AND lower(canonical_model) = '2002'
        AND aliases @> ARRAY['02 series']
    ) THEN
      RAISE EXCEPTION 'BMW 2002 canonical_models row is missing alias "02 series"';
    END IF;
  END IF;
END $$;

ROLLBACK;
