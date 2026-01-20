-- Body style consistency backfill
--
-- Goal:
-- - Ensure `vehicles.canonical_body_style` is populated wherever possible (VIN-decoded first).
-- - Fill/standardize `vehicles.body_style` only when it's missing/placeholder/obvious alias,
--   using the canonical display name (avoids clobbering detailed human-entered values).
-- - Create a lightweight audit view for "needs review" rows.

DO $$
DECLARE
  has_listing_kind boolean;
BEGIN
  -- Guardrails: skip cleanly if required schema isn't present (keeps db reset resilient).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'body_style'
  ) THEN
    RAISE NOTICE 'Skip body_style backfill: public.vehicles.body_style not present';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'canonical_body_style'
  ) THEN
    RAISE NOTICE 'Skip body_style backfill: public.vehicles.canonical_body_style not present';
    RETURN;
  END IF;

  IF to_regprocedure('public.normalize_body_style(text)') IS NULL THEN
    RAISE NOTICE 'Skip body_style backfill: public.normalize_body_style(text) not present';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'canonical_body_styles'
  ) THEN
    RAISE NOTICE 'Skip body_style backfill: public.canonical_body_styles not present';
    RETURN;
  END IF;

  -- `listing_kind` is a newer column. This migration must remain resilient even when
  -- it runs before the listing-kind migration in some environments.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'listing_kind'
  ) INTO has_listing_kind;

  -- ==========================================================================
  -- 1) Backfill canonical_body_style using VIN-decoded data when available
  -- ==========================================================================
  -- Only populate when missing (don't overwrite existing canonical assignments).
  UPDATE public.vehicles v
  SET canonical_body_style = public.normalize_body_style(COALESCE(v.body_style, vd.body_type, vd.vehicle_type))
  FROM public.vin_decoded_data vd
  WHERE v.vin IS NOT NULL
    AND UPPER(v.vin) = vd.vin
    AND v.canonical_body_style IS NULL;

  -- Non-VIN: derive from body_style only (missing canonical only).
  UPDATE public.vehicles v
  SET canonical_body_style = public.normalize_body_style(v.body_style)
  WHERE v.canonical_body_style IS NULL
    AND v.body_style IS NOT NULL
    AND btrim(v.body_style) <> '';

  -- ==========================================================================
  -- 2) Fill/standardize vehicles.body_style from canonical display_name
  -- ==========================================================================
  -- We keep this conservative:
  -- - Fill when null/blank/placeholder.
  -- - Standardize when the current value is an obvious alias (including canonical key itself).
  -- This avoids clobbering detailed/curated body_style strings that aren't simple aliases.
  IF has_listing_kind THEN
    UPDATE public.vehicles v
    SET body_style = cbs.display_name
    FROM public.canonical_body_styles cbs
    WHERE v.canonical_body_style = cbs.canonical_name
      AND COALESCE(v.listing_kind, 'vehicle') = 'vehicle'
      AND (
        v.body_style IS NULL
        OR btrim(v.body_style) = ''
        OR lower(btrim(v.body_style)) IN ('n/a', 'na', 'unknown', 'other', 'unclassified')
        OR lower(btrim(v.body_style)) = lower(cbs.canonical_name)
        OR lower(btrim(v.body_style)) = ANY(
          ARRAY(
            SELECT lower(a) FROM unnest(cbs.aliases) a
          )
        )
      );
  ELSE
    UPDATE public.vehicles v
    SET body_style = cbs.display_name
    FROM public.canonical_body_styles cbs
    WHERE v.canonical_body_style = cbs.canonical_name
      AND (
        v.body_style IS NULL
        OR btrim(v.body_style) = ''
        OR lower(btrim(v.body_style)) IN ('n/a', 'na', 'unknown', 'other', 'unclassified')
        OR lower(btrim(v.body_style)) = lower(cbs.canonical_name)
        OR lower(btrim(v.body_style)) = ANY(
          ARRAY(
            SELECT lower(a) FROM unnest(cbs.aliases) a
          )
        )
      );
  END IF;

  -- ==========================================================================
  -- 3) Audit view: rows likely needing review (nulls + un-normalizable)
  -- ==========================================================================
  DROP VIEW IF EXISTS public.body_style_audit;
  IF has_listing_kind THEN
    CREATE VIEW public.body_style_audit AS
    SELECT
      v.id,
      v.listing_kind,
      v.listing_source,
      v.listing_url,
      v.year,
      v.make,
      v.model,
      v.vin,
      v.body_style,
      v.canonical_body_style,
      vd.body_type AS vin_decoded_body_type,
      vd.vehicle_type AS vin_decoded_vehicle_type,
      CASE
        WHEN COALESCE(v.listing_kind, 'vehicle') <> 'vehicle' THEN 'non_vehicle_item'
        WHEN v.body_style IS NULL OR btrim(v.body_style) = '' THEN 'missing_body_style'
        WHEN v.canonical_body_style IS NULL THEN 'missing_canonical_body_style'
        WHEN public.normalize_body_style(v.body_style) IS NULL THEN 'unrecognized_body_style_value'
        ELSE 'ok'
      END AS audit_status
    FROM public.vehicles v
    LEFT JOIN public.vin_decoded_data vd
      ON v.vin IS NOT NULL AND UPPER(v.vin) = vd.vin;
  ELSE
    CREATE VIEW public.body_style_audit AS
    SELECT
      v.id,
      NULL::text AS listing_kind,
      v.listing_source,
      v.listing_url,
      v.year,
      v.make,
      v.model,
      v.vin,
      v.body_style,
      v.canonical_body_style,
      vd.body_type AS vin_decoded_body_type,
      vd.vehicle_type AS vin_decoded_vehicle_type,
      CASE
        WHEN v.body_style IS NULL OR btrim(v.body_style) = '' THEN 'missing_body_style'
        WHEN v.canonical_body_style IS NULL THEN 'missing_canonical_body_style'
        WHEN public.normalize_body_style(v.body_style) IS NULL THEN 'unrecognized_body_style_value'
        ELSE 'ok'
      END AS audit_status
    FROM public.vehicles v
    LEFT JOIN public.vin_decoded_data vd
      ON v.vin IS NOT NULL AND UPPER(v.vin) = vd.vin;
  END IF;
END;
$$;

