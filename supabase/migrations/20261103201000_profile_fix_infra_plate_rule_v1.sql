BEGIN;
-- 1/5 profile data-fix infrastructure + plate-code rule.
-- Fix log + revert, plate-code classifier, vehicle_identifiers plate kinds, photo_land_classification (writer rule)
-- routes data-plate codes to identifiers instead of vehicle attributes, and a per-vehicle evidence sweep.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.profile_fix_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  rule text NOT NULL,
  vehicle_id uuid,
  target_table text NOT NULL,
  target_pk uuid,
  column_name text,
  op text NOT NULL CHECK (op IN ('update','insert')),
  before jsonb,
  after jsonb,
  evidence jsonb,
  at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
CREATE INDEX IF NOT EXISTS profile_fix_log_run_idx ON public.profile_fix_log(run_id, id);
ALTER TABLE public.profile_fix_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_fix_log FROM PUBLIC, anon, authenticated;

-- Apply (or, when p_dry, only describe) one column change on one row, with a before/after log row.
CREATE OR REPLACE FUNCTION public._pf_update(p_run uuid, p_rule text, p_table text, p_pk uuid, p_col text,
                                             p_new jsonb, p_vehicle uuid, p_evidence jsonb, p_dry boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE old jsonb;
BEGIN
  IF p_table NOT IN ('vehicles','field_evidence','vehicle_events','vehicle_images') THEN RAISE EXCEPTION '_pf_update: table % not allowed', p_table; END IF;
  EXECUTE format('SELECT to_jsonb(t)->%L FROM public.%I t WHERE id = $1', p_col, p_table) INTO old USING p_pk;
  IF old IS NOT DISTINCT FROM p_new OR (old IS NULL AND p_new = 'null'::jsonb) THEN RETURN NULL; END IF;
  IF NOT p_dry THEN
    INSERT INTO public.profile_fix_log(run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
    VALUES (p_run, p_rule, p_vehicle, p_table, p_pk, p_col, 'update', coalesce(old,'null'::jsonb), p_new, p_evidence);
    EXECUTE format('UPDATE public.%I SET %I = (jsonb_populate_record(null::public.%I, jsonb_build_object(%L, $1))).%I WHERE id = $2',
                   p_table, p_col, p_table, p_col, p_col) USING p_new, p_pk;
  END IF;
  RETURN jsonb_build_object('table', p_table, 'pk', p_pk, 'column', p_col, 'before', old, 'after', p_new, 'rule', p_rule);
END $$;

-- Undo a run: restore every logged update (newest first) and delete every row the run inserted.
CREATE OR REPLACE FUNCTION public.profile_fix_revert(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r record; n_u int := 0; n_d int := 0;
BEGIN
  FOR r IN SELECT * FROM public.profile_fix_log WHERE run_id = p_run AND reverted_at IS NULL ORDER BY id DESC LOOP
    IF r.op = 'update' THEN
      EXECUTE format('UPDATE public.%I SET %I = (jsonb_populate_record(null::public.%I, jsonb_build_object(%L, $1))).%I WHERE id = $2',
                     r.target_table, r.column_name, r.target_table, r.column_name, r.column_name) USING r.before, r.target_pk;
      n_u := n_u + 1;
    ELSE
      EXECUTE format('DELETE FROM public.%I WHERE id = $1', r.target_table) USING r.target_pk;
      n_d := n_d + 1;
    END IF;
    UPDATE public.profile_fix_log SET reverted_at = now() WHERE id = r.id;
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'restored', n_u, 'deleted', n_d);
END $$;

-- Data-plate code recognizer: "Plate text '67' under TRIM" -> (identifier kind, code, vehicles column the code was mistaken for).
CREATE OR REPLACE FUNCTION public.photo_plate_code_kind(p_text text)
RETURNS TABLE(kind text, code text, col text) LANGUAGE sql IMMUTABLE AS $$
  WITH m AS (SELECT regexp_match(p_text, 'plate\s+(?:text\s+)?''([^'']{1,16})''\s+(?:under|for|in|on)\s+(body|colou?r|paint|trim|trans(?:mission)?|axle|date|dsc|dso|dst|district)\M', 'i') AS g)
  SELECT CASE lower(g[2]) WHEN 'body' THEN 'plate_body_code' WHEN 'color' THEN 'plate_paint_code' WHEN 'colour' THEN 'plate_paint_code'
                          WHEN 'paint' THEN 'plate_paint_code' WHEN 'trim' THEN 'plate_trim_code'
                          WHEN 'trans' THEN 'plate_transmission_code' WHEN 'transmission' THEN 'plate_transmission_code'
                          WHEN 'axle' THEN 'plate_axle_code' WHEN 'date' THEN 'plate_date_code' ELSE 'plate_district_code' END,
         g[1],
         CASE lower(g[2]) WHEN 'body' THEN 'body_style' WHEN 'color' THEN 'color' WHEN 'colour' THEN 'color' WHEN 'paint' THEN 'color'
                          WHEN 'trim' THEN 'trim' WHEN 'trans' THEN 'transmission' WHEN 'transmission' THEN 'transmission' END
  FROM m WHERE g IS NOT NULL;
$$;

-- Subject test for photo evidence: is this attribute about something other than the vehicle's own body?
--  * colour read from engine/interior/wheel parts is not the paint colour
--  * a value that appears only in a "reflection / background / another car" sentence of the description describes another vehicle
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

-- vehicle_identifiers: plate code kinds (closed list stays closed).
ALTER TABLE public.vehicle_identifiers DROP CONSTRAINT IF EXISTS vehicle_identifiers_kind_check;
ALTER TABLE public.vehicle_identifiers ADD CONSTRAINT vehicle_identifiers_kind_check CHECK (kind = ANY (ARRAY[
  'vin','chassis','engine','body_number','transmission','assigned_vin','coachbuilder_plate','kardex','coa',
  'plate_body_code','plate_paint_code','plate_trim_code','plate_transmission_code','plate_axle_code','plate_date_code','plate_district_code'])) NOT VALID;
ALTER TABLE public.vehicle_identifiers VALIDATE CONSTRAINT vehicle_identifiers_kind_check;

-- Writer rule: photo_land_classification no longer lands plate codes / other-subject readings as vehicle attributes.
-- (definition below is the backed-up one plus the two guards; raw photo_extracted_fields keep the faithful reading)

CREATE OR REPLACE FUNCTION public.photo_land_classification(p_image_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  vi record; cls jsonb; x jsonb; pv text; conf numeric; descr text; vid uuid;
  n_desc int := 0; n_f int := 0; n_t int := 0; n_fe int := 0; n_ang int := 0; n_cam int := 0; rc int;
  ang_key text; ang_id uuid; pose jsonb; byok jsonb; dist numeric; az numeric; el numeric; res jsonb; dq text; pl jsonb;
begin
  select v.id, v.user_id, v.vehicle_id, v.vision_gate_status::text as gate, v.ai_scan_metadata as md
    into vi from public.vehicle_images v where v.id = p_image_id and v.ai_processing_status = 'completed';
  if not found then return jsonb_build_object('skipped', 'not_completed'); end if;
  vid := case when vi.vehicle_id is not null and coalesce(vi.gate, '') not like 'rejected%' then vi.vehicle_id end;
  cls := vi.md->'classification';
  if cls is not null and jsonb_typeof(cls) = 'object' and cls->>'image_type' is not null then
    x := case when jsonb_typeof(cls->'v2') = 'object' then cls->'v2' else '{}'::jsonb end;
    pv := coalesce(x->>'prompt_version', cls#>>'{classifier_receipt,prompt_version}', 'legacy');
    conf := least(greatest(coalesce(nullif(cls->>'confidence','')::numeric, 0), 0), 1);
    descr := nullif(btrim(coalesce(cls->>'description', '')), '');

    if descr is not null and not exists (select 1 from public.image_descriptions d where d.image_id = p_image_id and d.description_type = 'classifier_v2') then
      insert into public.image_descriptions(image_id, vehicle_id, description, description_type, source, source_version, confidence, evidence)
      values (p_image_id, vid, descr, 'classifier_v2', 'photo-pipeline-classifier', pv, conf,
              jsonb_build_object('photo_id', p_image_id, 'image_type', cls->>'image_type', 'is_automotive', cls->'is_automotive', 'model', cls#>>'{classifier_receipt,model}'));
      n_desc := 1;
    end if;

    insert into public.photo_extracted_fields(image_id, user_id, vehicle_id, field_name, value, quote, confidence, source, prompt_version, meta)
    select distinct on (s.fn) p_image_id, vi.user_id, vid, s.fn, s.val, s.qt, s.cf, 'classifier_v2', pv, s.meta
    from (
      select e->>'field_name' fn, nullif(btrim(e->>'value'), '') val, nullif(e->>'evidence','') qt,
             least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf, jsonb_build_object('photo_id', p_image_id) meta
        from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e
      union all
      select 'vin', nullif(btrim(x#>>'{vin,value}'), ''), nullif(x#>>'{vin,evidence}',''),
             least(greatest(nullif(x#>>'{vin,confidence}','')::numeric, 0), 1),
             jsonb_build_object('photo_id', p_image_id, 'checksum_ok', x#>'{vin,checksum_ok}')
        where jsonb_typeof(x->'vin') = 'object'
    ) s where s.fn is not null and s.val is not null
    order by s.fn, s.cf desc nulls last
    on conflict do nothing;
    get diagnostics rc = row_count; n_f := n_f + rc;

    insert into public.photo_extracted_fields(image_id, user_id, vehicle_id, field_name, value, quote, confidence, source, prompt_version, meta)
    select p_image_id, vi.user_id, vid, c.fn, c.val, c.qt, c.cf, 'classifier_v2', pv, jsonb_build_object('photo_id', p_image_id)
    from (values
      ('core.image_type', cls->>'image_type', left(descr, 300), conf),
      ('core.is_automotive', cls->>'is_automotive', left(descr, 300), conf),
      ('core.classifier_confidence', cls->>'confidence', null, conf),
      ('core.description', descr, descr, conf),
      ('doc.type', nullif(x->>'document_type', ''), left(descr, 300), conf),
      ('doc.kind', nullif(x->>'document_kind', ''), left(descr, 300), conf)
    ) c(fn, val, qt, cf) where c.val is not null
    on conflict do nothing;
    get diagnostics rc = row_count; n_f := n_f + rc;

    insert into public.photo_text_lines(image_id, user_id, vehicle_id, line_idx, text, region, confidence, source, prompt_version)
    select p_image_id, vi.user_id, vid, (t.ord - 1)::int, btrim(t.e->>'text'),
           case when t.e ? 'region' then t.e->'region' end,
           least(greatest(nullif(t.e->>'confidence','')::numeric, 0), 1), 'classifier_v2', pv
    from jsonb_array_elements(case when jsonb_typeof(x->'text_lines') = 'array' then x->'text_lines' else '[]'::jsonb end) with ordinality t(e, ord)
    where nullif(btrim(coalesce(t.e->>'text', '')), '') is not null
    on conflict do nothing;
    get diagnostics rc = row_count; n_t := rc;

    if vid is not null then
      insert into public.field_evidence(vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, raw_extraction_data)
      select vid, s.fn, s.val, 'ai_visual', round(s.cf * 100)::int, left('photo-pipeline landing v1: ' || s.qt, 400),
             jsonb_build_object('photo_id', p_image_id, 'image_id', p_image_id, 'quote', s.qt, 'confidence', s.cf, 'extractor', 'photo_land_classification', 'prompt_version', pv)
      from (
        select distinct on (fn, val) e->>'field_name' fn, btrim(e->>'value') val, e->>'evidence' qt, least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf
          from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e
         order by fn, val
      ) s
      where s.cf >= 0.6 and nullif(s.qt, '') is not null and nullif(s.val, '') is not null and s.fn is not null
        -- plate stamping codes are identifiers, not attributes; other-vehicle / non-body readings are not evidence about this car
        and not exists (select 1 from public.photo_plate_code_kind(s.qt))
        and public.photo_field_not_about_vehicle(s.fn, s.val, s.qt, descr) is null
      on conflict (vehicle_id, field_name, source_type, proposed_value) do nothing;
      get diagnostics rc = row_count; n_fe := rc;

      begin
        select jsonb_agg(jsonb_build_object('kind', k.kind, 'value', k.code, 'quote', left(k.qt, 400), 'confidence', k.cf)) into pl
        from (select distinct on (pk.kind, pk.code) pk.kind, pk.code, s2.qt, s2.cf
                from (select e->>'evidence' qt, least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf
                        from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e) s2
                cross join lateral public.photo_plate_code_kind(s2.qt) pk
               where s2.cf >= 0.6
               order by pk.kind, pk.code) k;
        if pl is not null then
          perform public.land_identifier_claims(vid, jsonb_build_object('identifiers', pl), null, 'photo_land_classification', 'photo', p_image_id, null);
          update public.vehicle_identifiers set evidence_class = 'plate_stamping'
           where vehicle_id = vid and source_image_id = p_image_id and kind like 'plate\_%' and evidence_class is null;
        end if;
      exception when others then null;
      end;

      ang_key := case x#>>'{angle,value}'
        when 'exterior_front' then 'exterior.front.center'
        when 'exterior_rear' then 'exterior.rear.center'
        when 'interior_dashboard' then 'interior.dash.full'
        when 'engine_bay' then 'engine.bay'
        when 'undercarriage' then 'undercarriage.general'
        when 'detail_shot' then 'detail.general'
        else null end;
      if ang_key is not null and not exists (select 1 from public.image_angle_observations o where o.image_id = p_image_id and o.source = 'classifier_v2') then
        select a.angle_id into ang_id from public.angle_taxonomy a where a.canonical_key = ang_key and a.deprecated_at is null limit 1;
        if ang_id is not null then
          insert into public.image_angle_observations(image_id, vehicle_id, angle_id, confidence, source, source_version, evidence)
          values (p_image_id, vid, ang_id, least(greatest(coalesce(nullif(x#>>'{angle,confidence}','')::numeric, conf), 0), 1), 'classifier_v2', pv,
                  jsonb_build_object('photo_id', p_image_id, 'classifier_angle', x#>>'{angle,value}', 'quote', left(descr, 300)));
          n_ang := 1;
        end if;
      end if;
    end if;
  end if;

  byok := vi.md->'byok_deep_analysis';
  if byok is not null and jsonb_typeof(byok->'camera_pose') = 'object' then
    pose := byok->'camera_pose';
    az := case when (pose->>'azimuth_deg') ~ '^-?[0-9.]+$' then (pose->>'azimuth_deg')::numeric end;
    el := case when (pose->>'elevation_deg') ~ '^-?[0-9.]+$' then (pose->>'elevation_deg')::numeric end;
    dq := pose->>'distance_est';
    dist := case when dq ~* '^[~ ]*[0-9.]+ ?m$' then round((regexp_replace(dq, '[^0-9.]', '', 'g'))::numeric * 1000) end;
    if (az is not null or el is not null) then
      insert into public.image_camera_position(image_id, vehicle_id, subject_key, azimuth_deg, elevation_deg, distance_mm, confidence, source, source_version, evidence)
      values (p_image_id, vid, 'vehicle', az, el, dist,
              least(greatest(coalesce(nullif(byok->>'confidence','')::numeric, 0.5), 0), 1), 'byok_deep_analysis', coalesce(byok->>'prompt_version', 'unknown'),
              jsonb_build_object('photo_id', p_image_id, 'camera_pose', pose, 'run_id', byok->>'run_id'))
      on conflict (image_id, subject_key, source, source_version) do nothing;
      get diagnostics rc = row_count; n_cam := rc;
    end if;
  end if;

  res := jsonb_build_object('descriptions', n_desc, 'fields', n_f, 'text_lines', n_t, 'field_evidence', n_fe, 'angles', n_ang, 'camera', n_cam);
  insert into public.photo_land_progress(image_id, result) values (p_image_id, res)
    on conflict (image_id) do update set landed_at = now(), result = excluded.result;
  return res;
exception when others then
  return jsonb_build_object('error', sqlerrm, 'state', sqlstate);
end;
$function$
;

COMMIT;
