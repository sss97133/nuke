-- Backfill vehicles.canonical_body_style + vehicles.canonical_vehicle_type
-- Depends on: 20260114000000_canonical_vehicle_types_and_body_styles.sql
-- Safe guards:
-- - No-ops if canonical columns/functions are missing (prevents db reset surprises).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicles'
      AND column_name = 'canonical_body_style'
  ) THEN
    RAISE NOTICE 'Skip backfill: public.vehicles.canonical_body_style not present';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicles'
      AND column_name = 'canonical_vehicle_type'
  ) THEN
    RAISE NOTICE 'Skip backfill: public.vehicles.canonical_vehicle_type not present';
    RETURN;
  END IF;

  IF to_regprocedure('public.normalize_body_style(text)') IS NULL THEN
    RAISE NOTICE 'Skip backfill: public.normalize_body_style(text) not present';
    RETURN;
  END IF;

  IF to_regprocedure('public.normalize_vehicle_type(text)') IS NULL THEN
    RAISE NOTICE 'Skip backfill: public.normalize_vehicle_type(text) not present';
    RETURN;
  END IF;

  -- 1) VIN-backed: use vin_decoded_data when present
  UPDATE public.vehicles v
  SET
    canonical_body_style = public.normalize_body_style(COALESCE(v.body_style, n.body_type, n.vehicle_type)),
    canonical_vehicle_type = public.normalize_vehicle_type(COALESCE(n.vehicle_type, v.body_style, n.body_type))
  FROM public.vin_decoded_data n
  WHERE v.vin IS NOT NULL
    AND UPPER(v.vin) = n.vin
    AND (v.canonical_body_style IS NULL OR v.canonical_vehicle_type IS NULL);

  -- 2) Non-VIN: fall back to vehicles.body_style only
  UPDATE public.vehicles v
  SET
    canonical_body_style = COALESCE(v.canonical_body_style, public.normalize_body_style(v.body_style)),
    canonical_vehicle_type = COALESCE(
      v.canonical_vehicle_type,
      (SELECT vehicle_type FROM public.canonical_body_styles WHERE canonical_name = public.normalize_body_style(v.body_style) LIMIT 1),
      public.normalize_vehicle_type(v.body_style)
    )
  WHERE (v.canonical_body_style IS NULL OR v.canonical_vehicle_type IS NULL);
END;
$$;

