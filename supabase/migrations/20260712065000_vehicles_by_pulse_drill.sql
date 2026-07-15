-- vehicles_by_pulse — the drill behind every Explore "Pulse" cell (iOS).
--
-- A pulse cell (make / model / year / metro / day-of-week) → the actual photographed
-- cars behind that group, price-ranked (hero cars lead). Reuses the VehicleHeaderRow
-- shape so the drill flows into the same VehicleDetailView as search. Applied to prod
-- 2026-07-12; recorded for drift. ("trim" is quoted — it's a reserved word.)

CREATE OR REPLACE FUNCTION vehicles_by_pulse(p_dimension text, p_value text, p_limit int DEFAULT 60)
RETURNS TABLE(id uuid, year int, make text, model text, "trim" text,
              primary_image_url text, city text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.id, v.year, v.make, v.model, v.trim, v.primary_image_url, v.city, v.state
  FROM vehicles v
  WHERE v.is_public AND v.primary_image_url IS NOT NULL AND v.primary_image_url <> ''
    AND CASE p_dimension
      WHEN 'make'  THEN v.make = p_value
      WHEN 'model' THEN btrim(coalesce(v.make,'') || ' ' || coalesce(v.model,'')) = p_value
      WHEN 'year'  THEN v.year::text = p_value
      WHEN 'metro' THEN (v.city || ', ' || v.state) = p_value
      WHEN 'dow'   THEN to_char(v.sale_date, 'Dy') = p_value
    END
  ORDER BY (v.sale_price IS NULL), v.sale_price DESC NULLS LAST
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION vehicles_by_pulse(text, text, int) TO anon, authenticated;
