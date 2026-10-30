-- Reissue after deploy41007078888 rolled back atomically: one reference make is CHEVROLET.
-- Match make case-insensitively, retaining exact row IDs, model codes and K10 alias ownership.
-- Narrow correction of a cross-model alias, not a replacement of the GM Truck browse family.
-- Retained source labels identify K10 Custom; K10 already owns that exact alias.
-- Retained identity labels stay unchanged. Refresh derived identity only through its cited writer.
-- Rebuild dependent market folds through their existing owner.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Reusing the identity writer must not also replace generation/series from a broad
-- catalog row. This opt-in scope refreshes only the derived model and its match score.
-- Existing callers, signature, ownership and grants retain their behavior.
DO $writer$
DECLARE definition text; anchor text := '  INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)';
BEGIN
  definition := pg_get_functiondef('public.correct_vehicle_identity(uuid,jsonb,jsonb,jsonb,text)'::regprocedure);
  IF position('normalized_model_only' IN definition)=0 THEN
    IF encode(sha256(convert_to(definition,'UTF8')),'base64') <> 'cM4qvHF+7oLWoaGBtXV5H41AO3kOeMAXnVrZIadtI3Q='
      OR (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 THEN
      RAISE EXCEPTION 'Identity correction writer changed; review before extending its derived-model scope';
    END IF;
    definition := replace(definition,anchor,$branch$
  IF p_source->>'scope'='normalized_model_only' THEN
    IF v_new_year IS NOT NULL OR v_new_make IS NOT NULL OR v_new_model IS DISTINCT FROM v_model
      OR p_value - 'model' <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Derived model refresh must retain the exact recorded identity';
    END IF;
    DECLARE matched record; previous_model text;
    BEGIN
      SELECT * INTO matched FROM public.normalize_vehicle_model(v_make,v_model,v_year);
      IF matched.canonical_model IS NULL THEN
        RETURN jsonb_build_object('status','unresolved','vehicle_id',p_vehicle_id);
      END IF;
      SELECT normalized_model INTO previous_model FROM public.vehicles WHERE id=p_vehicle_id;
      IF previous_model IS NOT DISTINCT FROM matched.canonical_model THEN
        RETURN jsonb_build_object('status','unchanged','vehicle_id',p_vehicle_id);
      END IF;
      INSERT INTO public.superseded_rows(source_table,row_id,row_data,asserted_by,source,reason)
      VALUES ('vehicles',p_vehicle_id,jsonb_build_object('field','normalized_model','value',previous_model,
        'replacement',matched.canonical_model,'method','normalize_vehicle_model'),v_asserted,p_source,p_reason);
      PERFORM set_config('app.writer',c_writer,true);
      UPDATE public.vehicles SET normalized_model=matched.canonical_model,model_confidence=matched.confidence
        WHERE id=p_vehicle_id;
      RETURN jsonb_build_object('status','corrected','vehicle_id',p_vehicle_id,
        'normalized_model',matched.canonical_model);
    END;
  END IF;
$branch$ || anchor);
    EXECUTE definition;
  END IF;
END $writer$;

DO $guard$
BEGIN
  IF (SELECT count(*) FROM public.canonical_models
      WHERE id IN ('022cef91-1b4b-406d-9f39-d08072175cbd', '5d4192f0-9d02-497f-b4a9-c890c42414fa')
        AND lower(make) = 'chevrolet' AND canonical_model = 'C10') <> 2
     OR NOT EXISTS (SELECT FROM public.canonical_models
       WHERE id = '87fb1e59-3e43-4b01-83ff-d6f679192ccd'
         AND lower(make) = 'chevrolet' AND canonical_model = 'K10'
         AND 'k10 custom' = ANY(aliases)) THEN
    RAISE EXCEPTION 'Chevrolet C10/K10 alias ownership changed; review before applying';
  END IF;
END $guard$;

UPDATE public.canonical_models
SET notes = concat_ws(E'\n', nullif(notes, ''),
      '[K10 Custom alias separation] Superseded aliases: ' || to_jsonb(aliases)::text),
    aliases = array_remove(aliases, 'k10 custom')
WHERE id IN ('022cef91-1b4b-406d-9f39-d08072175cbd', '5d4192f0-9d02-497f-b4a9-c890c42414fa')
  AND 'k10 custom' = ANY(aliases);

-- Existing profiles otherwise keep the old normalized_model even after lookup is fixed.
-- Re-submit the unchanged label only when an unsuperseded index observation supports
-- the same year/make/model. Uncited records remain unresolved, never guessed.
DO $refresh_identity$
DECLARE r record; receipt jsonb;
BEGIN
  FOR r IN
    SELECT v.id, v.year, v.make, v.model, v.normalized_model, p.id AS source_id,
      p.source_url, p.structured_data
    FROM public.vehicles v
    CROSS JOIN LATERAL (
      SELECT o.id,o.source_url,o.structured_data FROM public.vehicle_observations o
      WHERE o.vehicle_id=v.id AND o.extraction_method='public_lot_index'
        AND o.kind IN ('listing','sale_result') AND o.is_superseded IS FALSE
        AND o.property_id IS NULL
        AND lower(o.structured_data->>'model')=lower(v.model)
        AND o.structured_data->>'year'=v.year::text AND o.structured_data->>'make'=v.make
        AND o.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$'
      ORDER BY o.ingested_at DESC, o.id LIMIT 1
    ) p
    WHERE lower(v.make)='chevrolet' AND lower(v.model)='k10 custom'
      AND v.normalized_model='C10' AND v.is_public IS TRUE AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    ORDER BY v.id LIMIT 1000
  LOOP
    receipt := public.correct_vehicle_identity(r.id,
      jsonb_build_object('year',r.year,'make',r.make,'model',r.model),
      jsonb_build_object('model',r.model),
      jsonb_build_object('type','vehicle_observations','ref',r.source_id::text,
        'scope','normalized_model_only',
        'url',r.source_url,'title',concat_ws(' ',r.structured_data->>'year',r.structured_data->>'make',r.structured_data->>'model'),
        'previous_normalized_model',r.normalized_model),
      'Refresh derived model after K10 Custom alias correction; retain the original source identity label');
    IF receipt->>'status' <> 'corrected' OR NOT EXISTS (
      SELECT FROM public.vehicles WHERE id=r.id AND normalized_model='K10' AND model=r.model
    ) THEN RAISE EXCEPTION 'Cited K10 normalized identity did not refresh: %',r.id; END IF;
  END LOOP;
END $refresh_identity$;

-- Both models' old fits used the superseded membership. Withhold through the existing writer.
DO $invalidate$
DECLARE r record;
BEGIN
  FOR r IN SELECT brand, family_key FROM public.family_price_change
    WHERE brand = 'Chevrolet'
      AND family_key IN ('022cef91-1b4b-406d-9f39-d08072175cbd', '023c138f-2f9e-4023-a3c3-bbdc2e1c0b43')
      AND method IS DISTINCT FROM 'identity_membership_changed_v1'
  LOOP
    PERFORM public.record_family_price_index(jsonb_build_object(
      'brand', r.brand, 'family_key', r.family_key, 'fitted_at', now(),
      'period_kind', NULL, 'series', '[]'::jsonb,
      'change', jsonb_build_object('change_12m', NULL, 'lo', NULL, 'hi', NULL,
        'n_last12', 0, 'n_prior12', 0, 'verdict', 'too few to tell',
        'method', 'identity_membership_changed_v1',
        'ref_car', jsonb_build_object('basis', 'K10 Custom membership corrected; awaiting a new fit'),
        'pairs', NULL, 'rs_change', NULL, 'rs_lo', NULL, 'rs_hi', NULL, 'chips', '[]'::jsonb)));
  END LOOP;
END $invalidate$;
DO $locks$
BEGIN
 IF EXISTS (SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock') THEN
  RAISE EXCEPTION 'Lock wait detected after identity correction; rollback and investigate';
 END IF;
END $locks$;
COMMIT;
