-- Verification test for 20261018150000_dedup_treemap_family_sales_images_and_mecum.sql
DO $$
DECLARE
  v_rows jsonb;
  v_c_1965_203500 int;
  v_c_1965_150700 int;
  v_c_1967_286000 int;
  v_has_polluted_ccz int;
BEGIN
  v_rows := public.treemap_family_sales('Chevrolet', 'aebc65e7-9760-4936-b6c3-b5233d079df4')->'rows';

  -- Two distinct Mecum Kissimmee 2026 lots (1162540 on Jan 16 and 1163056 on Jan 17) both sold for $203,500
  -- and both carry their own photos, so both should remain in the result set.
  SELECT count(*) INTO v_c_1965_203500
  FROM jsonb_array_elements(v_rows) r
  WHERE (r->>4)::int = 1965 AND (r->>2)::int = 203500;

  -- Barrett-Jackson $150,700 1965 Chevelle Malibu (30b54679) vs corrupted conceptcarz row (62840c86)
  -- collapses to 1 canonical row.
  SELECT count(*) INTO v_c_1965_150700
  FROM jsonb_array_elements(v_rows) r
  WHERE (r->>4)::int = 1965 AND (r->>2)::int = 150700;

  -- Barrett-Jackson $286,000 1967 Chevelle Custom (real date vs Jan-1 placeholder) collapses to 1 row.
  SELECT count(*) INTO v_c_1967_286000
  FROM jsonb_array_elements(v_rows) r
  WHERE (r->>4)::int = 1967 AND (r->>2)::int = 286000;

  SELECT count(*) INTO v_has_polluted_ccz
  FROM jsonb_array_elements(v_rows) r
  WHERE r->>0 = '62840c86-ed40-4749-81cd-d072d96aff3c';

  IF v_c_1965_203500 <> 2 THEN
    RAISE EXCEPTION 'Expected 2 distinct Mecum lots for 1965 Chevelle $203,500, got %', v_c_1965_203500;
  END IF;

  IF v_c_1965_150700 <> 1 THEN
    RAISE EXCEPTION 'Expected 1 row for 1965 Chevelle $150,700, got %', v_c_1965_150700;
  END IF;

  IF v_c_1967_286000 <> 1 THEN
    RAISE EXCEPTION 'Expected 1 row for 1967 Chevelle $286,000, got %', v_c_1967_286000;
  END IF;

  IF v_has_polluted_ccz <> 0 THEN
    RAISE EXCEPTION 'Expected polluted conceptcarz row 62840c86 to be excluded, got %', v_has_polluted_ccz;
  END IF;
END $$;
