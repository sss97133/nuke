BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.photo_field_not_about_vehicle(p_field text, p_val text, p_quote text, p_descr text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; in_flag boolean := false; in_plain boolean := false; v text := lower(btrim(coalesce(p_val,'')));
BEGIN
  IF p_field = 'color' AND p_quote ~* '\m(engine|air cleaner|block|valve cover|carburet|manifold|seat|upholstery|dash|steering|wheel|rim|brake|caliper|radiator|interior)\M' THEN
    RETURN 'not_body_paint';
  END IF;
  IF p_field IN ('make','model','trim','year','body_style','color','interior_color') AND v <> '' AND p_descr IS NOT NULL THEN
    FOR s IN SELECT regexp_split_to_table(p_descr, '(?<=[.!?])\s+') LOOP
      IF lower(s) ~ ('\m' || regexp_replace(v, '([^a-z0-9 ])', '\\\1', 'g') || '\M') THEN
        IF s ~* '\m(reflect\w*|in the background|another|behind|nearby)\M' THEN in_flag := true; ELSE in_plain := true; END IF;
      END IF;
    END LOOP;
    IF in_flag AND NOT in_plain THEN RETURN 'other_vehicle_in_frame'; END IF;
  END IF;
  RETURN NULL;
END $$;

COMMIT;
