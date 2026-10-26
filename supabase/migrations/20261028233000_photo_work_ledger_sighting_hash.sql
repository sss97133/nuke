-- Photo work ledger writer fix: production asset_observations requires content_hash and observed_at (NOT NULL), which
-- the 20261028203000 contract fixture did not model, so the first live call failed and rolled back (nothing written).
--   * content_hash = md5(asset_id | image_id | pass:tier), the same identity as the sighting's unique key.
--   * Photos without taken_at keep their reading but fold no sighting (a sighting needs the photo's clock).
-- Contract: supabase/sql/test_photo_work_ledger.sql (fixture now carries both NOT NULLs).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.record_photo_work_readings(p_person uuid, p_readings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  r jsonb; o jsonb; img record; prior record;
  pass text; tier integer; rec_id uuid; aid uuid; k text; brand text; fold text; conf numeric; com jsonb;
  n_in integer := 0; n_new integer := 0; n_same integer := 0; n_refused integer := 0; n_assets integer := 0; n_sightings integer := 0;
  refused jsonb := '[]'::jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'record_photo_work_readings is service-only' USING ERRCODE = '42501';
  END IF;
  IF p_person IS NULL OR jsonb_typeof(p_readings) IS DISTINCT FROM 'array' OR jsonb_array_length(p_readings) > 500 THEN
    RAISE EXCEPTION 'p_readings must be a JSON array of at most 500 readings for one person' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(p_readings) x LOOP
    n_in := n_in + 1;
    pass := coalesce(nullif(r->>'pass', ''), 'photo_work_v1');
    tier := CASE WHEN r->>'tier' IN ('1', '2') THEN (r->>'tier')::integer ELSE 1 END;
    img := NULL;
    IF r->>'image_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
      SELECT i.id, i.user_id, i.vehicle_id, i.taken_at, i.latitude, i.longitude, i.vision_gate_status::text AS gate, i.is_sensitive
        INTO img FROM public.vehicle_images i WHERE i.id = (r->>'image_id')::uuid;
    END IF;
    IF img.id IS NULL OR img.user_id IS DISTINCT FROM p_person OR img.gate = 'rejected_personal' OR coalesce(img.is_sensitive, false)
       OR jsonb_typeof(r#>'{reading,objects}') IS DISTINCT FROM 'array' OR jsonb_typeof(r#>'{reading,work}') IS DISTINCT FROM 'object'
       OR jsonb_typeof(r#>'{reading,commerce}') IS DISTINCT FROM 'object' OR nullif(r->>'model', '') IS NULL THEN
      n_refused := n_refused + 1;
      refused := refused || jsonb_build_array(left(coalesce(r->>'image_id', '?'), 36));
      CONTINUE;
    END IF;
    SELECT a.id, a.analysis_tier INTO prior FROM public.image_analysis_records a
      WHERE a.image_id = img.id AND a.inferred_findings->>'photo_work_pass' = pass AND a.superseded_by IS NULL
      ORDER BY a.analysis_tier DESC LIMIT 1;
    IF prior.id IS NOT NULL AND prior.analysis_tier >= tier THEN n_same := n_same + 1; CONTINUE; END IF;

    SELECT avg(CASE WHEN x->>'confidence' ~ '^[0-9.]+$' THEN least((x->>'confidence')::numeric, 1) END) INTO conf
      FROM jsonb_array_elements(r#>'{reading,objects}') x;
    INSERT INTO public.image_analysis_records (image_id, vehicle_id, analysis_tier, analyzed_at, analyzed_by_model,
      confirmed_findings, inferred_findings, unknown_items, overall_confidence, citation_count, inference_count, unknown_count,
      supersedes, handoff_notes)
    VALUES (img.id, NULL, tier, CASE WHEN r->>'analyzed_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN (r->>'analyzed_at')::timestamptz ELSE now() END,
      r->>'model',
      jsonb_build_object('text_read', (SELECT coalesce(jsonb_agg(x->>'text_read'), '[]'::jsonb) FROM jsonb_array_elements(r#>'{reading,objects}') x
        WHERE nullif(btrim(x->>'text_read'), '') IS NOT NULL)),
      (r->'reading') || jsonb_build_object('photo_work_pass', pass, 'usage', r->'usage'),
      '[]'::jsonb, round(conf, 3),
      (SELECT count(*) FROM jsonb_array_elements(r#>'{reading,objects}') x WHERE nullif(btrim(x->>'text_read'), '') IS NOT NULL),
      jsonb_array_length(r#>'{reading,objects}'), 0, prior.id,
      'photo work reading; vehicle_id left NULL to keep it owner-private, vehicle context via image_id')
    RETURNING id INTO rec_id;
    IF prior.id IS NOT NULL THEN
      UPDATE public.image_analysis_records SET superseded_by = rec_id, superseded_at = now(),
        superseded_reason = 'higher-tier photo work reading' WHERE id = prior.id;
    END IF;
    n_new := n_new + 1;
    com := CASE WHEN coalesce(r#>>'{reading,commerce,context}', 'none') <> 'none' THEN r#>'{reading,commerce}' END;

    -- A sighting needs the photo's clock (asset_observations.observed_at is NOT NULL); the reading stays recorded.
    FOR o IN SELECT x FROM jsonb_array_elements(r#>'{reading,objects}') x WHERE img.taken_at IS NOT NULL LOOP
      CONTINUE WHEN NOT (o->>'kind' IN ('equipment', 'tool', 'goods')
        OR (o->>'kind' IN ('part', 'material') AND o->>'role' IN ('loose', 'for_sale', 'being_moved')));
      CONTINUE WHEN NOT (o->>'confidence' ~ '^[0-9.]+$' AND (o->>'confidence')::numeric >= 0.5);
      k := nullif(regexp_replace(lower(coalesce(o->>'key', '')), '[^a-z0-9._]', '', 'g'), '');
      CONTINUE WHEN k IS NULL;
      brand := nullif(regexp_replace(lower(coalesce(o->>'brand', '')), '[^a-z0-9]', '', 'g'), '');
      IF brand IN ('unknown', 'null', 'none', 'generic', 'na', 'unbranded') THEN brand := NULL; END IF;
      fold := k || '|' || coalesce(brand, '-');
      aid := NULL;
      SELECT a.id INTO aid FROM public.assets a WHERE a.creator_id = p_person AND a.attributes->>'fold_key' = fold;
      IF aid IS NULL THEN
        INSERT INTO public.assets (asset_type, title, creator_id, owner_id, status, visibility, attributes)
        VALUES (o->>'kind', left(coalesce(nullif(btrim(o->>'label'), ''), k), 200), p_person, NULL, 'pending', 'private',
          jsonb_build_object('fold_key', fold, 'key', k, 'brand', nullif(btrim(o->>'brand'), ''), 'method', pass,
            'first_reading', rec_id, 'instance_resolved', false,
            'basis', 'photo sightings folded by item type and printed brand; ownership not established'))
        ON CONFLICT (creator_id, (attributes->>'fold_key')) WHERE attributes ? 'fold_key' DO NOTHING
        RETURNING id INTO aid;
        IF aid IS NULL THEN
          SELECT a.id INTO aid FROM public.assets a WHERE a.creator_id = p_person AND a.attributes->>'fold_key' = fold;
        ELSE
          n_assets := n_assets + 1;
        END IF;
      END IF;
      INSERT INTO public.asset_observations (asset_id, kind, observed_at, content_text, structured_data, confidence,
        source_identifier, extraction_method, agent_model, content_hash)
      VALUES (aid, 'photo_sighting', img.taken_at, left(o->>'label', 300),
        jsonb_strip_nulls(jsonb_build_object('image_id', img.id, 'reading_id', rec_id, 'role', o->>'role', 'model', nullif(btrim(o->>'model'), ''),
          'text_read', nullif(btrim(o->>'text_read'), ''), 'count', o->'count', 'vehicle_id', img.vehicle_id,
          'cell', CASE WHEN img.latitude IS NOT NULL AND img.longitude IS NOT NULL
            THEN round(img.latitude::numeric, 3)::text || ',' || round(img.longitude::numeric, 3)::text END,
          'commerce', com, 'activity', nullif(r#>>'{reading,work,activity}', 'none'))),
        least((o->>'confidence')::numeric, 1), img.id::text, pass || ':t' || tier, r->>'model',
        md5(aid::text || '|' || img.id::text || '|' || pass || ':t' || tier))
      ON CONFLICT (asset_id, source_identifier, extraction_method) WHERE kind = 'photo_sighting' DO NOTHING;
      IF FOUND THEN n_sightings := n_sightings + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('received', n_in, 'recorded', n_new, 'already_recorded', n_same, 'refused', n_refused,
    'refused_ids', refused, 'assets_created', n_assets, 'sightings_recorded', n_sightings);
END $$;
REVOKE ALL ON FUNCTION public.record_photo_work_readings(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_photo_work_readings(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
