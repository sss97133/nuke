-- Extend the existing automatic photo-field semantic gate. Retained source
-- text, image fields, identifiers and existing testimony are not rewritten.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF pg_get_functiondef('public.photo_field_not_about_vehicle(text,text,text,text)'::regprocedure)
 IS DISTINCT FROM $expected$CREATE OR REPLACE FUNCTION public.photo_field_not_about_vehicle(p_field text, p_val text, p_quote text, p_descr text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
END $function$
$expected$ THEN
  RAISE EXCEPTION 'photo field semantic owner drifted; review current function';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.photo_field_not_about_vehicle(p_field text, p_val text, p_quote text, p_descr text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
 s text; in_flag boolean := false; in_plain boolean := false;
 v text := lower(btrim(coalesce(p_val,''))); q text := lower(coalesce(p_quote,''));
BEGIN
  -- Preserve raw photo fields/text in their existing stores. These are reasons
  -- a reading cannot become the named vehicle attribute, not review-queue jobs.
  IF p_field='vin' THEN RETURN 'dedicated_identifier_admission_required'; END IF;
  IF p_field IN ('make','model','series','trim','year','body_style','engine_type','engine_size','engine_configuration',
      'engine_displacement_l','displacement','color','interior_color','transmission','drivetrain')
    AND (q ~ '\m(body|cowl|trim|fisher|data)[ -]*(tag|plate)\M|\mbody by fisher\M'
      OR coalesce(p_descr,'') ~* '^(an? )?(close[ -]up|macro).*\m(body|cowl|trim)[ -]*(tag|plate)\M') THEN
    RETURN 'body_tag_code_requires_decode';
  END IF;
  IF p_field IN ('make','model','series','trim','year','engine_type','engine_size','engine_configuration','engine_displacement_l','displacement','horsepower')
    AND (q ~ '\m(badge|emblem|decal|lettering|sticker|graphic|script)\M'
      OR (q ~ '\m(text|label|labelled|labeled|inscription|reading|reads|marked|printed|embossed|stenciled)\M'
        AND q ~ '\m(hood|scoop|shaker|fender|dashboard|dash|air cleaner|cover|trunk|grille|side of the car|side above)\M')) THEN
    RETURN 'appearance_text_not_vehicle_specification';
  END IF;
  IF p_field IN ('engine_type','engine_size','engine_configuration','engine_displacement_l','displacement','horsepower','transmission','drivetrain')
    AND q ~ '\m(casting|casting number|cast code|cast[ -]in (number[0-9]*|code|text|mark)|engine code|block code|stamped code|stamp number)\M' THEN
    RETURN 'component_identifier_requires_decode';
  END IF;
  IF p_field='body_style'
    AND (v ~ '\m(interior|transmission|gear|shifter|dashboard|cabin|seat)\M'
      OR (q ~ '\m(interior|gear shift|shifter|shift knob|shift pattern|dashboard)\M'
        AND q !~ '\m(coupe|sedan|convertible|roadster|hatchback|wagon|pickup|truck|van|fastback|hardtop|body style|body shape)\M')) THEN
    RETURN 'cabin_detail_not_body_style';
  END IF;
  IF p_field='color'
    AND (v ~ '\m(pinstripe|pinstripes|stripe|stripes|graphic|graphics|decal|decals|lettering|emblem)\M'
      OR (q ~ '\m(pinstripe|pinstripes|stripe|stripes|graphic|graphics|decal|decals|lettering|emblem)\M'
        AND q !~ '\m(base|body|panel|exterior)\M')) THEN
    RETURN 'graphic_not_body_paint';
  END IF;
  IF p_field = 'color' AND p_quote ~* '\m(engine|air cleaner|block|valve cover|carburet|manifold|seat|upholstery|dash|steering|wheel|rim|brake|caliper|radiator|interior)\M' THEN
    RETURN 'not_body_paint';
  END IF;
  IF p_field IN ('make','model','series','trim','year','body_style','color','interior_color') AND v <> '' AND p_descr IS NOT NULL THEN
    FOR s IN SELECT regexp_split_to_table(p_descr, '(?<=[.!?])\s+') LOOP
      IF lower(s) ~ ('\m' || regexp_replace(v, '([^a-z0-9 ])', '\\\1', 'g') || '\M') THEN
        IF s ~* '\m(reflect\w*|in the background|another|behind|nearby)\M' THEN in_flag := true; ELSE in_plain := true; END IF;
      END IF;
    END LOOP;
    IF in_flag AND NOT in_plain THEN RETURN 'other_vehicle_in_frame'; END IF;
  END IF;
  RETURN NULL;
END $function$;
-- Same semantic owner for the edge writer: one bounded read, no duplicate
-- client vocabulary. The dedicated VIN admission is deliberately separate.
CREATE OR REPLACE FUNCTION public.photo_field_not_about_vehicle(p_fields jsonb, p_descr text)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $function$
DECLARE decisions jsonb;
BEGIN
 IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields)>100 THEN
  RETURN jsonb_build_object('status','invalid_field_collection');
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('index',ord-1,'reason',
   CASE WHEN e->>'field_name'='vin' THEN 'dedicated_identifier_admission_required'
        WHEN EXISTS(SELECT 1 FROM public.photo_plate_code_kind(e->>'evidence')) THEN 'plate_identifier_not_vehicle_attribute'
        ELSE public.photo_field_not_about_vehicle(e->>'field_name',e->>'value',e->>'evidence',p_descr) END)
   ORDER BY ord),'[]'::jsonb) INTO decisions
 FROM jsonb_array_elements(p_fields) WITH ORDINALITY f(e,ord);
 RETURN jsonb_build_object('status','ok','decisions',decisions);
END $function$;
REVOKE ALL ON FUNCTION public.photo_field_not_about_vehicle(jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.photo_field_not_about_vehicle(jsonb,text) TO service_role;
COMMIT;
