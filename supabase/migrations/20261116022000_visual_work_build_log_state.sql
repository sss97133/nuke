-- visual_work_build_log took 7-13 s per profile load on the one vehicle with visual work
-- (31 records; EXPLAIN ANALYZE 7,321 ms, auto_explain 10.5-13.3 s on 2026-11-12). Measured split:
-- ~5 s was pg_timezone_names (56 ms per call, once per cited image), 1.2 s the cost fold, 0.44 s
-- catalog product cards. Two changes, output unchanged except master_ledger.as_of (compute time):
-- 1. The card reader and the cost fold list the time-zone catalog once per call.
-- 2. The reader's output is stored per vehicle and amount visibility and served while a digest of
--    every vehicle-scoped input matches and no clock-dependent field has turned; otherwise the
--    reader computes live. A cron job keeps public vehicles' rows current.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
DO $guard$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.visual_work_build_log(uuid)'::regprocedure)
    IS DISTINCT FROM '13ac8bf78de5d493ff1df40c10d09ae7'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)'::regprocedure)
    IS DISTINCT FROM 'b48e464547fd4d2497ec178d61afc0e3' THEN
  RAISE EXCEPTION 'Visual work reader or cost fold drifted; inspect current owner';
 END IF;
END $guard$;

CREATE TABLE public.visual_work_build_log_state(
 vehicle_id uuid NOT NULL,
 amounts_visible boolean NOT NULL,
 inputs_digest text NOT NULL CHECK(inputs_digest ~ '^[0-9a-f]{32}$'),
 output jsonb NOT NULL CHECK(jsonb_typeof(output)='object'),
 computed_at timestamptz NOT NULL,
 valid_until timestamptz NOT NULL,
 compute_ms integer CHECK(compute_ms>=0),
 PRIMARY KEY(vehicle_id,amounts_visible));
ALTER TABLE public.visual_work_build_log_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.visual_work_build_log_state FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE public.visual_work_build_log_state IS
'Stored output of visual_work_build_log per vehicle and amount visibility (grain: one vehicle x amounts_visible, overwritten). Writer: SQL visual_work_build_log_refresh (cron visual-work-build-log-refresh). Clock: computed_at (derived). Served by visual_work_build_log only while inputs_digest equals visual_work_build_log_inputs_digest(vehicle) and valid_until has not passed; otherwise the reader computes live. Public, undeleted vehicles only. No RLS policy: read only through the reader.';
COMMENT ON COLUMN public.visual_work_build_log_state.amounts_visible IS 'The compute''s tied flag: true is the owner/service variant with receipt amounts; anon and unrelated users get false.';
COMMENT ON COLUMN public.visual_work_build_log_state.valid_until IS 'Earliest of computed_at + 1 hour (catalog quotes, labor rates, reference hours), the first catalog price_stale flip (captured_at + 7 days) and the first future service-fee retrieval time.';

CREATE OR REPLACE FUNCTION public.visual_work_master_cost_fold(p_vehicle_id uuid, p_cards jsonb, p_tied boolean, p_limited boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 zones text[]; card jsonb; doc jsonb; basis jsonb; line jsonb; kind text; scenario text; physical_key text;
 qty jsonb; qty_value numeric; rate_input jsonb; rate_info jsonb; rate_value numeric; currency text;
 ref jsonb; resolved jsonb; fixed_service boolean; fee_valid boolean; hours jsonb; unit_hours jsonb; cost jsonb; pricing jsonb; product jsonb; price_range jsonb;
 reasons jsonb; sources jsonb; source_images jsonb; basis_images jsonb; basis_source_id text; source_ok boolean; reference_ok boolean;
 h_min numeric; h_typ numeric; h_max numeric; year_value integer; source_row record;
 candidates jsonb:='[]'; folded jsonb; selected_rows jsonb; scenarios jsonb:='[]'; rows_for_scope jsonb;
 systems jsonb; totals jsonb; coverage jsonb; scenario_rows jsonb; system_key text;
 missing_cards integer:=0; line_count integer:=0; input_limited boolean:=false; stage_id uuid; card_incomplete boolean;
 uuid_pattern constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
 key_pattern constant text:='^[a-z0-9][a-z0-9._:-]{0,159}$';
 number_pattern constant text:='^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$';
BEGIN
 -- This private helper receives only cards qualified by visual_work_build_log.
 -- Repeat the parent gate so a future internal caller cannot widen visibility.
 IF jsonb_typeof(p_cards) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cards)>100 THEN RETURN '{}'::jsonb; END IF;
 SELECT v.year INTO year_value FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.deleted_at IS NULL
 AND (v.is_public IS TRUE OR auth.role()='service_role' OR (auth.uid() IS NOT NULL AND
 (v.user_id=auth.uid() OR v.owner_id=auth.uid() OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid()))));
 IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
 FOR card IN SELECT value FROM jsonb_array_elements(p_cards) LOOP
  SELECT o.structured_data INTO doc FROM public.vehicle_observations o
   WHERE o.id=(card->>'observation_id')::uuid AND o.vehicle_id=p_vehicle_id AND o.is_superseded IS FALSE;
  basis:=doc->'estimate_basis'; scenario:=basis->>'scenario';
  IF basis->>'version' IS DISTINCT FROM '1' OR scenario NOT IN ('reconstruct_observed','finish_scenario')
   OR scenario IS NULL OR nullif(btrim(basis->>'method'),'') IS NULL OR nullif(btrim(basis->>'derivation'),'') IS NULL THEN
   missing_cards:=missing_cards+1; CONTINUE;
  END IF;
  card_incomplete:=false;
  FOREACH kind IN ARRAY ARRAY['labor','material'] LOOP
   IF jsonb_typeof(doc->CASE WHEN kind='labor' THEN 'operations' ELSE 'materials' END) IS DISTINCT FROM 'array' THEN
    card_incomplete:=true; CONTINUE;
   END IF;
   FOR line IN SELECT value FROM jsonb_array_elements(doc->CASE WHEN kind='labor' THEN 'operations' ELSE 'materials' END) LOOP
    line_count:=line_count+1; IF line_count>500 THEN input_limited:=true; EXIT; END IF;
    reasons:='[]'; hours:=NULL; unit_hours:=NULL; cost:=NULL; resolved:=NULL; pricing:=NULL; product:=NULL; currency:=NULL;
    rate_info:=NULL; rate_value:=NULL; price_range:=NULL; qty_value:=NULL; reference_ok:=true; fixed_service:=false;
    physical_key:=line->>CASE WHEN kind='labor' THEN 'physical_operation_key' ELSE 'physical_material_key' END;
    IF physical_key IS NULL OR physical_key !~ key_pattern OR coalesce(line->>'system_key','') !~ key_pattern
      OR nullif(btrim(line->>'label'),'') IS NULL THEN reasons:=reasons||'"invalid_line_key"'::jsonb; END IF;
    IF line ? 'selected' AND jsonb_typeof(line->'selected') NOT IN ('boolean','null') THEN
     reasons:=reasons||'"invalid_selection"'::jsonb;
    END IF;
    IF line->>'overlap_group' IS NOT NULL AND line->>'overlap_group' !~ key_pattern THEN
     reasons:=reasons||'"invalid_overlap_group"'::jsonb;
    END IF;
    IF line->>'shared_access'='true' AND line->>'overlap_group' IS NOT NULL THEN
     reasons:=reasons||'"shared_access_must_be_separate_additive_line"'::jsonb;
    END IF;
    -- Every basis must retain a same-car canonical witness/current source. A
    -- qualified visual work card already validated its complete multi-photo set.
    sources:=line->'source_observation_ids'; source_ok:=true; source_images:='[]';
    IF jsonb_typeof(sources) IS DISTINCT FROM 'array' THEN sources:='[]'; source_ok:=false; END IF;
    IF jsonb_array_length(sources) NOT BETWEEN 1 AND 20 THEN source_ok:=false; END IF;
    FOR basis_source_id IN SELECT value#>>'{}' FROM jsonb_array_elements(sources) LOOP
     IF basis_source_id IS NULL OR basis_source_id !~ uuid_pattern THEN source_ok:=false; CONTINUE; END IF;
     SELECT o.id,o.source_url INTO source_row FROM public.vehicle_observations o WHERE o.id=basis_source_id::uuid
      AND o.vehicle_id=p_vehicle_id AND o.is_superseded IS FALSE;
     IF NOT FOUND THEN source_ok:=false; CONTINUE; END IF;
     -- A cited, already-qualified work card can carry several physical/context
     -- sources. Otherwise return the actual canonical witness, even when it is
     -- absent from this line's containing card. Never substitute that card's photo.
     SELECT coalesce(jsonb_agg(ci||jsonb_build_object('source_observation_id',source_row.id,
       'date_role','source_capture_not_work_date') ORDER BY ci->>'image_id'),'[]') INTO basis_images
      FROM jsonb_array_elements(p_cards) c CROSS JOIN LATERAL jsonb_array_elements(c->'images') ci
      WHERE (c->>'observation_id')::uuid=source_row.id;
     IF basis_images='[]'::jsonb THEN
      -- pg_timezone_names reads every zone file (~56 ms); list it once per call, not once per image.
      IF zones IS NULL THEN SELECT coalesce(array_agg(z.name),'{}') INTO zones FROM pg_catalog.pg_timezone_names z; END IF;
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('image_id',i.id,'image_url',i.image_url,
        'source_observation_id',source_row.id,'role',coalesce(ci->>'role','source'),
        'caption',coalesce(nullif(left(public.text_redact_contact(ci->>'caption'),300),''),'Cited source photograph'),
        'taken_at',CASE WHEN isfinite(i.taken_at) THEN i.taken_at END,
        'capture_time_zone',CASE WHEN ci IS NOT NULL THEN ci->>'capture_time_zone'
         WHEN nullif(i.exif_data->>'capture_time_zone','') IS NOT NULL THEN
          CASE WHEN i.exif_data->>'capture_time_zone'=ANY(zones) THEN i.exif_data->>'capture_time_zone' END END,
        'capture_time_basis',nullif(left(public.text_redact_contact(i.exif_data->>'capture_time_basis'),300),''),
        'date_role','source_capture_not_work_date')),'[]') INTO basis_images
       FROM public.observation_witnesses w JOIN public.vehicle_images i ON i.id=w.image_id
       LEFT JOIN LATERAL (SELECT cimg FROM jsonb_array_elements(card->'images') cimg
         WHERE cimg->>'image_id'=i.id::text AND cimg->>'image_url'=i.image_url LIMIT 1) cited ON true
       CROSS JOIN LATERAL (SELECT cited.cimg AS ci) caption
       WHERE w.observation_id=source_row.id AND i.vehicle_id=p_vehicle_id AND i.image_url=source_row.source_url
        AND (public.receipt_work_frame_eligible(i) OR (ci->>'role'='context'
         AND ci->>'source_observation_id'=source_row.id::text AND w.witness_role='derived'))
        AND coalesce(i.image_vehicle_match_status,'') NOT IN ('mismatch','unrelated');
     END IF;
     IF basis_images='[]'::jsonb THEN source_ok:=false;
     ELSE source_images:=source_images||basis_images; END IF;
    END LOOP;
    IF NOT source_ok THEN reasons:=reasons||'"source_unavailable"'::jsonb; END IF;
    qty:=line->'quantity';
    IF qty->>'value' ~ number_pattern AND (qty->>'value')::numeric>0 AND (qty->>'value')::numeric<=10000
     AND nullif(btrim(qty->>'unit'),'') IS NOT NULL AND qty->>'basis' IN ('source','explicit_assumption')
     AND nullif(btrim(qty->>'derivation'),'') IS NOT NULL THEN qty_value:=(qty->>'value')::numeric;
    ELSE reasons:=reasons||'"quantity_unresolved"'::jsonb; END IF;
    IF kind='labor' THEN
     IF (scenario='reconstruct_observed' AND coalesce(line->>'evidence_role','') NOT IN ('conditional_reconstruction','observed_transition'))
      OR (scenario='finish_scenario' AND line->>'evidence_role' IS DISTINCT FROM 'conditional_finish') THEN
      reasons:=reasons||'"scenario_role_mismatch"'::jsonb;
     END IF;
     IF line->>'evidence_role'='observed_transition' AND
      (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(card->'images') i WHERE i->>'role'='before')
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(card->'images') i WHERE i->>'role'='after')) THEN
      reasons:=reasons||'"observed_transition_needs_before_and_after"'::jsonb;
     END IF;
     ref:=line->'reference';
     fixed_service:=ref->>'type'='fixed_service_fee';
     IF fixed_service THEN
      -- Public menu data is attributed by the current work observation. A URL
      -- and capture digest are citations, not a confirmed vehicle-specific quote.
      IF line->>'evidence_role' NOT IN ('conditional_reconstruction','conditional_finish') THEN
       reasons:=reasons||'"fixed_service_scope_unqualified"'::jsonb;
      END IF;
      IF line->>'selected' IS NULL THEN reasons:=reasons||'"fixed_service_selection_required"'::jsonb; END IF;
      fee_valid:=coalesce(ref->>'price_basis','') IN ('published_starting_price','published_menu_price')
       AND nullif(btrim(ref->>'derivation'),'') IS NOT NULL
       AND nullif(btrim(ref->>'unit'),'') IS NOT NULL AND btrim(ref->>'unit')=btrim(qty->>'unit')
       AND length(coalesce(ref->>'source_url','')) BETWEEN 9 AND 2000
       AND coalesce(ref->>'source_url','') ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]<>"\\]*)?$'
       AND coalesce(ref->>'source_sha256','') ~ '^[a-f0-9]{64}$'
       AND coalesce(ref->>'source_retrieved_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
       AND pg_input_is_valid(coalesce(ref->>'source_retrieved_at',''),'timestamp with time zone');
      IF fee_valid IS TRUE THEN
       fee_valid:=isfinite((ref->>'source_retrieved_at')::timestamptz)
        AND (ref->>'source_retrieved_at')::timestamptz<=statement_timestamp();
      END IF;
      IF fee_valid IS DISTINCT FROM true THEN reasons:=reasons||'"service_fee_source_or_scope_unresolved"'::jsonb;
      ELSE
       currency:=ref->>'currency'; price_range:=ref->'unit_fee';
       IF coalesce(currency,'') !~ '^[A-Z]{3}$' OR coalesce(price_range->>'min','') !~ number_pattern
        OR coalesce(price_range->>'typical','') !~ number_pattern OR coalesce(price_range->>'max','') !~ number_pattern THEN
        fee_valid:=false;
       ELSIF (price_range->>'min')::numeric>(price_range->>'typical')::numeric
        OR (price_range->>'typical')::numeric>(price_range->>'max')::numeric
        OR (price_range->>'max')::numeric>1000000 THEN fee_valid:=false;
       END IF;
       IF NOT fee_valid THEN
        reasons:=reasons||'"service_fee_range_or_currency_invalid"'::jsonb; price_range:=NULL; currency:=NULL;
       END IF;
       resolved:=jsonb_build_object('type','fixed_service_fee','unit_fee',price_range,'currency',currency,
        'unit',left(public.text_redact_contact(ref->>'unit'),80),'price_basis',ref->>'price_basis',
        'source_url',ref->>'source_url','source_retrieved_at',(ref->>'source_retrieved_at')::timestamptz,
        'source_sha256',ref->>'source_sha256','source_role','attributed_public_menu_capture',
        'derivation',left(public.text_redact_contact(ref->>'derivation'),1200));
       IF price_range IS NOT NULL AND qty_value IS NOT NULL THEN
        cost:=jsonb_build_object('min',round((price_range->>'min')::numeric*qty_value,2),
         'typical',round((price_range->>'typical')::numeric*qty_value,2),'max',round((price_range->>'max')::numeric*qty_value,2));
       END IF;
      END IF;
      -- No rate lookup, inverse price/rate calculation or imputed hours.
     ELSE
     IF ref->>'type'='labor_operation' THEN
      resolved:=public.listing_plan_resolve_target(ref,year_value);
      IF resolved->>'state' IS DISTINCT FROM 'resolved' OR resolved->>'year_applicability'='out_of_range' THEN reference_ok:=false; END IF;
      -- A single reference hour is a point, not an invented calibrated range.
      h_typ:=(resolved#>>'{hours,typical}')::numeric;
      hours:=jsonb_build_object('min',h_typ,'typical',h_typ,'max',h_typ);
     ELSIF ref->>'type'='stage_row' THEN
      IF coalesce(ref->>'stage_map_id','') !~ uuid_pattern THEN reference_ok:=false;
      ELSE
       SELECT m.id INTO stage_id FROM public.stage_transition_labor_map m WHERE m.id=(ref->>'stage_map_id')::uuid
        AND m.category=ref->>'category' AND m.from_stage=ref->>'from_stage' AND m.to_stage=ref->>'to_stage'
        AND m.zone_pattern=ref->>'zone_pattern';
       IF NOT FOUND THEN reference_ok:=false;
       ELSE resolved:=public.listing_plan_resolve_target(ref,year_value);
        IF resolved->>'stage_map_id' IS DISTINCT FROM stage_id::text THEN reference_ok:=false; END IF;
        hours:=resolved->'hours';
       END IF;
      END IF;
     ELSIF ref->>'type'='analyst_range' AND nullif(btrim(ref->>'derivation'),'') IS NOT NULL
       AND line->>'evidence_role' IN ('conditional_reconstruction','conditional_finish') THEN
      hours:=ref->'hours'; resolved:=jsonb_build_object('type','analyst_range','hours',hours,'label','attributed_scenario_uncalibrated',
       'derivation',left(public.text_redact_contact(ref->>'derivation'),1200),'method',basis->>'method');
     ELSE reference_ok:=false; END IF;
     IF NOT reference_ok OR coalesce(hours->>'min','') !~ number_pattern OR coalesce(hours->>'typical','') !~ number_pattern
      OR coalesce(hours->>'max','') !~ number_pattern THEN reasons:=reasons||'"hours_reference_unresolved"'::jsonb; hours:=NULL;
     ELSIF (hours->>'min')::numeric>(hours->>'typical')::numeric OR (hours->>'typical')::numeric>(hours->>'max')::numeric
      OR (hours->>'max')::numeric>10000 THEN reasons:=reasons||'"hours_range_invalid"'::jsonb; hours:=NULL;
     END IF;
     unit_hours:=hours;
     IF resolved IS NOT NULL THEN resolved:=resolved||jsonb_build_object('hours_per_unit',unit_hours); END IF;
     rate_input:=doc->'rate_basis';
     IF rate_input->>'kind'='resolved_default' THEN
      rate_info:=public.resolve_labor_rate();
      -- The existing rate owner does not supply currency. An explicit currency
      -- assumption must travel with the scenario; never infer it from '$'.
      currency:=CASE WHEN rate_input->>'currency' ~ '^[A-Z]{3}$' AND nullif(btrim(rate_input->>'derivation'),'') IS NOT NULL
       THEN rate_input->>'currency' END;
      rate_info:=rate_info||jsonb_build_object('kind','resolved_default','currency',currency,
       'currency_basis',CASE WHEN currency IS NOT NULL THEN 'explicit_assumption' ELSE 'unrecorded' END,
       'derivation',left(public.text_redact_contact(rate_input->>'derivation'),1200));
      rate_value:=(rate_info->>'rate')::numeric;
     ELSIF rate_input->>'kind'='explicit_assumption' AND rate_input->>'rate' ~ number_pattern
      AND nullif(btrim(rate_input->>'derivation'),'') IS NOT NULL THEN
      rate_value:=(rate_input->>'rate')::numeric; currency:=rate_input->>'currency';
      rate_info:=jsonb_build_object('kind','explicit_assumption','rate',rate_value,'currency',currency,
       'derivation',left(public.text_redact_contact(rate_input->>'derivation'),1200),'label','attributed_scenario_uncalibrated');
     ELSIF rate_input->>'kind'='reported' THEN
      -- Reported private rates are not converted to anonymous scenario amounts.
      -- Binding a report to its numeric source is deliberately not inferred.
      reasons:=reasons||to_jsonb(CASE WHEN p_tied THEN 'reported_rate_needs_numeric_source_binding' ELSE 'private_rate_withheld' END);
      rate_info:=jsonb_build_object('kind','reported','status','unresolved');
     ELSE reasons:=reasons||'"rate_unresolved"'::jsonb;
     END IF;
     IF rate_value IS NULL OR rate_value<=0 OR rate_value>100000 OR coalesce(currency,'') !~ '^[A-Z]{3}$' THEN
      reasons:=reasons||'"rate_or_currency_unresolved"'::jsonb; rate_value:=NULL; currency:=NULL;
     END IF;
     IF hours IS NOT NULL AND qty_value IS NOT NULL THEN
      hours:=jsonb_build_object('min',(hours->>'min')::numeric*qty_value,'typical',(hours->>'typical')::numeric*qty_value,
       'max',(hours->>'max')::numeric*qty_value);
      IF rate_value IS NOT NULL THEN cost:=jsonb_build_object('min',round((hours->>'min')::numeric*rate_value,2),
       'typical',round((hours->>'typical')::numeric*rate_value,2),'max',round((hours->>'max')::numeric*rate_value,2)); END IF;
     END IF;
     END IF;
    ELSE
     pricing:=line->'pricing';
     IF pricing->>'kind'='catalog' AND coalesce(pricing->>'receipt_item_id','') ~ uuid_pattern THEN
      SELECT r->'product' INTO product FROM jsonb_array_elements(card->'receipts') r
       WHERE (r->>'item_id')::uuid=(pricing->>'receipt_item_id')::uuid;
      IF product IS NOT NULL AND jsonb_typeof(product)='object' AND product->>'price_stale'='false'
       AND (pricing->>'catalog_part_id' IS NULL OR lower(pricing->>'catalog_part_id')=product->>'catalog_part_id')
       AND product->>'quote_price' ~ number_pattern THEN
       price_range:=jsonb_build_object('min',product->'quote_price','typical',product->'quote_price','max',product->'quote_price');
       currency:=product->>'currency'; pricing:=jsonb_build_object('kind','catalog','receipt_item_id',pricing->'receipt_item_id','product',product);
      ELSE reasons:=reasons||'"current_catalog_quote_unavailable"'::jsonb; pricing:=jsonb_build_object('kind','catalog','receipt_item_id',pricing->'receipt_item_id'); END IF;
     ELSIF pricing->>'kind'='analyst_range' AND nullif(btrim(pricing->>'derivation'),'') IS NOT NULL THEN
      price_range:=pricing->'unit_price'; currency:=pricing->>'currency';
      pricing:=jsonb_build_object('kind','analyst_range','unit_price',price_range,'currency',currency,
       'derivation',left(public.text_redact_contact(pricing->>'derivation'),1200),'label','attributed_scenario_uncalibrated');
     ELSE reasons:=reasons||'"material_price_unresolved"'::jsonb; pricing:=jsonb_build_object('kind','unpriced'); END IF;
     IF price_range IS NOT NULL THEN
      IF coalesce(price_range->>'min','') !~ number_pattern OR coalesce(price_range->>'typical','') !~ number_pattern
       OR coalesce(price_range->>'max','') !~ number_pattern OR coalesce(currency,'') !~ '^[A-Z]{3}$' THEN
       reasons:=reasons||'"material_price_range_invalid"'::jsonb; price_range:=NULL;
      ELSIF (price_range->>'min')::numeric>(price_range->>'typical')::numeric
       OR (price_range->>'typical')::numeric>(price_range->>'max')::numeric THEN
       reasons:=reasons||'"material_price_range_invalid"'::jsonb; price_range:=NULL;
      END IF;
     END IF;
     IF price_range IS NOT NULL AND qty_value IS NOT NULL THEN
      cost:=jsonb_build_object('min',round((price_range->>'min')::numeric*qty_value,2),
       'typical',round((price_range->>'typical')::numeric*qty_value,2),'max',round((price_range->>'max')::numeric*qty_value,2));
     END IF;
    END IF;
    -- Bad source/scope/quantity is not rescued by otherwise computable numbers.
    IF reasons ?| ARRAY['source_unavailable','invalid_line_key','quantity_unresolved','scenario_role_mismatch',
      'observed_transition_needs_before_and_after','invalid_selection','invalid_overlap_group','shared_access_must_be_separate_additive_line',
      'fixed_service_scope_unqualified','fixed_service_selection_required']
     THEN hours:=NULL; cost:=NULL; END IF;
    candidates:=candidates||jsonb_build_array(jsonb_build_object('scenario',scenario,'kind',kind,
     'physical_key',coalesce(physical_key,'unresolved:'||(card->>'observation_id')||':'||line_count),
     'system_key',coalesce(line->>'system_key','unresolved'),'label',left(public.text_redact_contact(line->>'label'),300),
     'status',CASE WHEN jsonb_array_length(reasons)=0 AND cost IS NOT NULL THEN 'resolved' WHEN hours IS NOT NULL THEN 'partial' ELSE 'unresolved' END,
     'reasons',reasons,'work_observation_ids',jsonb_build_array(card->>'observation_id'),'source_images',source_images,
     'source_observation_ids',(SELECT coalesce(jsonb_agg(DISTINCT lower(s#>>'{}') ORDER BY lower(s#>>'{}')),'[]')
       FROM jsonb_array_elements(sources) s WHERE s#>>'{}' ~ uuid_pattern),
     'quantity',jsonb_build_object('value',qty_value,'unit',qty->>'unit','basis',qty->>'basis','derivation',left(public.text_redact_contact(qty->>'derivation'),1200)),
     'reference',resolved,'pricing',pricing,'rate_basis',rate_info,'evidence_role',CASE WHEN kind='labor' THEN line->>'evidence_role'
       WHEN scenario='finish_scenario' THEN 'conditional_finish' ELSE 'conditional_reconstruction' END,
     'estimate_basis',jsonb_build_object('method',left(public.text_redact_contact(basis->>'method'),300),'derivation',left(public.text_redact_contact(basis->>'derivation'),1200)),
     'hours',hours,'cost',cost,'currency',currency,'overlap_group',line->>'overlap_group','selected',line->'selected',
     'shared_access',coalesce(line->>'shared_access','false')='true',
     'formula',CASE WHEN kind='labor' AND fixed_service THEN format('%s %s × (%s / %s / %s) %s per %s; person-hours unknown',
       coalesce(qty_value::text,'unknown'),left(public.text_redact_contact(qty->>'unit'),80),
       coalesce(price_range->>'min','unknown'),coalesce(price_range->>'typical','unknown'),coalesce(price_range->>'max','unknown'),
       coalesce(currency,'currency unknown'),left(public.text_redact_contact(qty->>'unit'),80))
      WHEN kind='labor' THEN format('%s %s × (%s / %s / %s) person-hours per %s × %s %s/person-hour',
       coalesce(qty_value::text,'unknown'),left(public.text_redact_contact(qty->>'unit'),80),
       coalesce(unit_hours->>'min','unknown'),coalesce(unit_hours->>'typical','unknown'),coalesce(unit_hours->>'max','unknown'),
       left(public.text_redact_contact(qty->>'unit'),80),coalesce(rate_value::text,'unknown'),coalesce(currency,'currency unknown'))
      ELSE format('%s %s × (%s / %s / %s) %s per %s',coalesce(qty_value::text,'unknown'),left(public.text_redact_contact(qty->>'unit'),80),
       coalesce(price_range->>'min','unknown'),coalesce(price_range->>'typical','unknown'),coalesce(price_range->>'max','unknown'),
       coalesce(currency,'currency unknown'),left(public.text_redact_contact(qty->>'unit'),80)) END));
   END LOOP;
  END LOOP;
  IF card_incomplete THEN missing_cards:=missing_cards+1; END IF;
 END LOOP;
 IF candidates='[]'::jsonb THEN RETURN '{}'::jsonb; END IF;
 -- Fold repeated physical operation/material keys once across the whole car.
 -- The fingerprint is the actual normalized input, not the citing photo count.
 WITH x AS (SELECT r,md5((r-ARRAY['source_observation_ids','source_images','work_observation_ids','label','estimate_basis','reasons'])::text) sig
   FROM jsonb_array_elements(candidates) r), g AS (
  SELECT r->>'scenario' s,r->>'kind' k,r->>'physical_key' p,count(*) n,count(DISTINCT sig) variants,
   (jsonb_agg(r ORDER BY r#>>'{work_observation_ids,0}'))->0 first,
   jsonb_agg(r) claims,min(sig) sig FROM x GROUP BY 1,2,3)
 SELECT jsonb_agg(first||jsonb_build_object('claim_count',n,'input_fingerprint',sig,
   'work_observation_ids',(SELECT jsonb_agg(DISTINCT id ORDER BY id) FROM jsonb_array_elements(claims) c CROSS JOIN LATERAL jsonb_array_elements(c->'work_observation_ids') id),
   'source_observation_ids',(SELECT coalesce(jsonb_agg(DISTINCT id ORDER BY id),'[]') FROM jsonb_array_elements(claims) c CROSS JOIN LATERAL jsonb_array_elements(c->'source_observation_ids') id),
   'source_images',(SELECT coalesce(jsonb_agg(merged ORDER BY merged->>'image_id'),'[]') FROM (
     SELECT ((jsonb_agg(im ORDER BY im->>'source_observation_id'))->0)-'source_observation_id'
       ||jsonb_build_object('source_observation_ids',jsonb_agg(DISTINCT im->'source_observation_id' ORDER BY im->'source_observation_id'),
         'role',CASE WHEN count(DISTINCT im->>'role')=1 THEN min(im->>'role') ELSE 'source' END,
         'caption',CASE WHEN count(DISTINCT im->>'caption')=1 THEN min(im->>'caption') ELSE 'Cited source photograph' END) AS merged
     FROM jsonb_array_elements(claims) c CROSS JOIN LATERAL jsonb_array_elements(c->'source_images') im
     GROUP BY im->>'image_id',im->>'image_url') source_union))
   ||CASE WHEN variants>1 THEN jsonb_build_object('status','unresolved','hours',NULL,'cost',NULL,'reasons',jsonb_build_array('conflicting_physical_key')) ELSE '{}'::jsonb END
   ORDER BY s,k,p) INTO folded FROM g;
 WITH x AS (SELECT r,count(*) OVER(PARTITION BY r->>'scenario',r->>'kind',r->>'overlap_group') n,
   count(*) FILTER(WHERE r->>'selected'='true') OVER(PARTITION BY r->>'scenario',r->>'kind',r->>'overlap_group') yes,
   count(*) FILTER(WHERE r->>'selected' IN ('true','false')) OVER(PARTITION BY r->>'scenario',r->>'kind',r->>'overlap_group') specified
   FROM jsonb_array_elements(folded) r)
 SELECT jsonb_agg(r||CASE
   WHEN r->>'overlap_group' IS NOT NULL AND (yes<>1 OR specified<>n)
    THEN jsonb_build_object('status','unresolved','hours',NULL,'cost',NULL,'reasons',(r->'reasons')||'"overlap_selection_unresolved"'::jsonb)
   WHEN r->>'selected'='false' THEN jsonb_build_object('status','excluded','hours',NULL,'cost',NULL,'reasons',(r->'reasons')||'"unselected_alternative"'::jsonb)
   ELSE '{}'::jsonb END ORDER BY r->>'scenario',r->>'system_key',r->>'kind',r->>'physical_key') INTO selected_rows FROM x;
 FOREACH scenario IN ARRAY ARRAY['reconstruct_observed','finish_scenario'] LOOP
  SELECT coalesce(jsonb_agg(r),'[]') INTO scenario_rows FROM jsonb_array_elements(selected_rows) r WHERE r->>'scenario'=scenario;
  IF scenario_rows='[]'::jsonb THEN CONTINUE; END IF;
  systems:='[]';
  -- NULL is the whole-scenario fold; every system uses the identical arithmetic.
  FOR system_key IN SELECT k FROM (SELECT NULL::text AS k UNION ALL SELECT DISTINCT r->>'system_key' FROM jsonb_array_elements(scenario_rows) r) scopes
   ORDER BY k NULLS FIRST LOOP
   SELECT coalesce(jsonb_agg(r),'[]') INTO rows_for_scope FROM jsonb_array_elements(scenario_rows) r
    WHERE system_key IS NULL OR r->>'system_key'=system_key;
   SELECT jsonb_build_object('hours',CASE WHEN count(*) FILTER(WHERE r->>'kind'='labor'
      AND r->>'status' IN ('resolved','partial') AND jsonb_typeof(r->'hours')='object')>0
     THEN jsonb_build_object('min',sum((r#>>'{hours,min}')::numeric),'typical',sum((r#>>'{hours,typical}')::numeric),'max',sum((r#>>'{hours,max}')::numeric)) END,
     'hours_coverage',jsonb_build_object(
      'labor_lines',count(*) FILTER(WHERE r->>'kind'='labor' AND r->>'status'<>'excluded'),
      'estimated_lines',count(*) FILTER(WHERE r->>'kind'='labor' AND r->>'status' IN ('resolved','partial') AND jsonb_typeof(r->'hours')='object'),
      'unknown_lines',count(*) FILTER(WHERE r->>'kind'='labor' AND r->>'status'<>'excluded' AND coalesce(jsonb_typeof(r->'hours'),'null')<>'object'),
      'status',CASE
       WHEN count(*) FILTER(WHERE r->>'kind'='labor' AND r->>'status'<>'excluded')=0 THEN 'not_applicable'
       WHEN count(*) FILTER(WHERE r->>'kind'='labor' AND r->>'status' IN ('resolved','partial') AND jsonb_typeof(r->'hours')='object')=0 THEN 'unestimated'
       WHEN count(*) FILTER(WHERE r->>'kind'='labor' AND r->>'status'<>'excluded' AND coalesce(jsonb_typeof(r->'hours'),'null')<>'object')>0
        OR p_limited OR input_limited THEN 'partial' ELSE 'complete_for_supplied_lines' END),
     'currencies',(SELECT coalesce(jsonb_agg(jsonb_build_object('currency',c,'cost',jsonb_build_object('min',lo,'typical',mid,'max',hi),'covered_lines',n) ORDER BY c),'[]')
      FROM (SELECT q->>'currency' c,sum((q#>>'{cost,min}')::numeric) lo,sum((q#>>'{cost,typical}')::numeric) mid,sum((q#>>'{cost,max}')::numeric) hi,count(*) n
       FROM jsonb_array_elements(rows_for_scope) q WHERE q->>'status'='resolved' AND q->'cost' IS DISTINCT FROM 'null'::jsonb GROUP BY 1) sums),
     'labor_currencies',(SELECT coalesce(jsonb_agg(jsonb_build_object('currency',c,'cost',jsonb_build_object('min',lo,'typical',mid,'max',hi),'covered_lines',n) ORDER BY c),'[]')
      FROM (SELECT q->>'currency' c,sum((q#>>'{cost,min}')::numeric) lo,sum((q#>>'{cost,typical}')::numeric) mid,sum((q#>>'{cost,max}')::numeric) hi,count(*) n
       FROM jsonb_array_elements(rows_for_scope) q WHERE q->>'kind'='labor' AND q->>'status'='resolved' AND q->'cost' IS DISTINCT FROM 'null'::jsonb GROUP BY 1) sums),
     'material_currencies',(SELECT coalesce(jsonb_agg(jsonb_build_object('currency',c,'cost',jsonb_build_object('min',lo,'typical',mid,'max',hi),'covered_lines',n) ORDER BY c),'[]')
      FROM (SELECT q->>'currency' c,sum((q#>>'{cost,min}')::numeric) lo,sum((q#>>'{cost,typical}')::numeric) mid,sum((q#>>'{cost,max}')::numeric) hi,count(*) n
       FROM jsonb_array_elements(rows_for_scope) q WHERE q->>'kind'='material' AND q->>'status'='resolved' AND q->'cost' IS DISTINCT FROM 'null'::jsonb GROUP BY 1) sums)) INTO totals
    FROM jsonb_array_elements(rows_for_scope) r;
   SELECT jsonb_build_object('lines',count(*),'resolved_lines',count(*) FILTER(WHERE r->>'status'='resolved'),
    'partial_lines',count(*) FILTER(WHERE r->>'status'='partial'),'unresolved_lines',count(*) FILTER(WHERE r->>'status'='unresolved'),
    'excluded_lines',count(*) FILTER(WHERE r->>'status'='excluded'),'duplicate_claims_folded',sum((r->>'claim_count')::integer-1),
    'status',CASE WHEN bool_and(r->>'status' IN ('resolved','excluded')) AND NOT p_limited AND NOT input_limited
      THEN 'complete_for_supplied_lines' ELSE 'partial' END) INTO coverage FROM jsonb_array_elements(rows_for_scope) r;
   IF system_key IS NULL THEN
    scenarios:=scenarios||jsonb_build_array(jsonb_build_object('scenario',scenario,'rows',scenario_rows,'totals',totals,'coverage',coverage));
   ELSE systems:=systems||jsonb_build_array(jsonb_build_object('system_key',system_key,'totals',totals,'coverage',coverage)); END IF;
  END LOOP;
  scenarios:=jsonb_set(scenarios,ARRAY[(jsonb_array_length(scenarios)-1)::text,'systems'],systems);
 END LOOP;
 RETURN jsonb_build_object('master_ledger',jsonb_build_object('version',1,'as_of',statement_timestamp(),
  'scope','supplied_estimate_lines_only','scenarios',scenarios,
  'coverage',jsonb_build_object('source_read_limited',p_limited OR input_limited,'cards_without_estimates',missing_cards,'scope_completeness','not_established'),
  'current_component_value',jsonb_build_object('status','not_estimated'),
  'documented_charges',jsonb_build_object('status','separate_not_added')));
END $function$;

CREATE FUNCTION public.visual_work_build_log_compute(p_vehicle_id uuid, p_tied boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 zones text[]; o record; ref jsonb; image_row record; receipt_row record; baseline record;
 images jsonb; receipts jsonb; effort jsonb; gaps jsonb; result jsonb:='[]';
 qualified boolean; tied boolean; seen integer:=0; missing_receipts integer;
 uuid_pattern constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
 -- The caller owns the access gate: visual_work_build_log under the request's JWT, or
 -- visual_work_build_log_refresh for public vehicles only. p_tied shows receipt amounts.
 PERFORM 1 FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
 tied:=coalesce(p_tied,false);
 FOR o IN SELECT v.* FROM public.vehicle_observations v JOIN public.observation_sources s ON s.id=v.source_id
   WHERE v.vehicle_id=p_vehicle_id AND v.kind='work_record' AND v.is_superseded IS FALSE
    AND s.slug='internal-inference' AND v.extraction_method='visual_work_v1'
    AND v.confidence_score BETWEEN 0 AND .6 AND v.structured_data->>'contract'='visual_work_v1'
   ORDER BY v.observed_at DESC,v.id LIMIT 101 LOOP
  seen:=seen+1; IF seen>100 THEN EXIT; END IF;
  -- A typed review only. All required physical sources must still be current; losing
  -- one withholds the conclusion instead of recycling a surviving after photograph.
  IF jsonb_typeof(o.structured_data->'visual_sources') IS DISTINCT FROM 'array'
    OR jsonb_typeof(o.structured_data->'receipt_links') IS DISTINCT FROM 'array'
    OR jsonb_typeof(o.structured_data->'gaps') IS DISTINCT FROM 'array' THEN CONTINUE; END IF;
  IF jsonb_array_length(o.structured_data->'visual_sources') NOT BETWEEN 1 AND 12
    OR jsonb_array_length(o.structured_data->'receipt_links')>20 OR jsonb_array_length(o.structured_data->'gaps')>8
    OR nullif(left(btrim(public.text_redact_contact(o.structured_data->>'title')),300),'') IS NULL
    OR nullif(left(btrim(public.text_redact_contact(o.structured_data->>'summary')),300),'') IS NULL
    OR coalesce(o.structured_data->>'image_id','') !~ uuid_pattern THEN CONTINUE; END IF;
  images:='[]'; qualified:=true;
  FOR ref IN SELECT value FROM jsonb_array_elements(o.structured_data->'visual_sources') LOOP
   -- pg_timezone_names reads every zone file (~56 ms); list it once per call, not once per image.
   IF zones IS NULL THEN SELECT coalesce(array_agg(z.name),'{}') INTO zones FROM pg_catalog.pg_timezone_names z; END IF;
   IF coalesce(ref->>'image_id','') !~ uuid_pattern OR coalesce(ref->>'role','') NOT IN ('before','during','after','context')
     OR nullif(left(btrim(public.text_redact_contact(ref->>'caption')),300),'') IS NULL OR coalesce(ref->>'source_url','') !~ '^https?://' THEN
    qualified:=false; EXIT;
   END IF;
   IF ref->>'role'='context' THEN
    IF o.structured_data#>>'{estimate_basis,version}' IS DISTINCT FROM '1'
     OR coalesce(o.structured_data#>>'{estimate_basis,scenario}','') NOT IN ('reconstruct_observed','finish_scenario')
     OR nullif(btrim(o.structured_data#>>'{estimate_basis,method}'),'') IS NULL
     OR nullif(btrim(o.structured_data#>>'{estimate_basis,derivation}'),'') IS NULL
     OR jsonb_typeof(o.structured_data->'operations') IS DISTINCT FROM 'array'
     OR coalesce(ref->>'source_observation_id','') !~ uuid_pattern THEN qualified:=false; EXIT; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(o.structured_data->'operations') op
      WHERE op->>'evidence_role' IS DISTINCT FROM CASE o.structured_data#>>'{estimate_basis,scenario}'
       WHEN 'finish_scenario' THEN 'conditional_finish' ELSE 'conditional_reconstruction' END) THEN
     qualified:=false; EXIT;
    END IF;
   END IF;
   SELECT i.id,i.image_url,i.taken_at,
    CASE WHEN i.exif_data->>'capture_time_zone'=ANY(zones)
      THEN i.exif_data->>'capture_time_zone' END AS capture_time_zone,
    nullif(left(btrim(public.text_redact_contact(i.exif_data->>'capture_time_basis')),300),'') AS capture_time_basis
   INTO image_row FROM public.vehicle_images i
    WHERE i.id=(ref->>'image_id')::uuid AND i.vehicle_id=p_vehicle_id
     AND i.image_url=ref->>'source_url' AND isfinite(i.taken_at)
     AND CASE WHEN ref->>'role'='context' THEN
      i.vision_gate_status='approved' AND i.is_sensitive IS NOT TRUE AND i.is_duplicate IS NOT TRUE
      AND i.is_superseded IS NOT TRUE AND i.is_document IS NOT TRUE AND coalesce(i.redaction_level::text,'none')='none'
      AND EXISTS(SELECT 1 FROM public.vehicle_observations ro JOIN public.observation_witnesses rw ON rw.observation_id=ro.id
       WHERE ro.id=(ref->>'source_observation_id')::uuid AND ro.vehicle_id=p_vehicle_id AND ro.is_superseded IS FALSE
        AND ro.extraction_method='reviewed_image_analysis_v1' AND ro.source_url=i.image_url
        AND lower(ro.structured_data->>'image_id')=i.id::text AND rw.image_id=i.id AND rw.witness_role='derived')
     ELSE public.receipt_work_frame_eligible(i) END
     AND coalesce(i.image_vehicle_match_status,'') NOT IN ('mismatch','unrelated');
   IF NOT FOUND OR EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'image_id'=image_row.id::text) THEN
    qualified:=false; EXIT;
   END IF;
   images:=images||jsonb_build_array(jsonb_build_object('image_id',image_row.id,'image_url',image_row.image_url,
    'taken_at',image_row.taken_at,'capture_time_zone',image_row.capture_time_zone,'capture_time_basis',image_row.capture_time_basis,
    'role',ref->>'role','source_observation_id',CASE WHEN ref->>'role'='context' THEN lower(ref->>'source_observation_id') END,
    'date_role',CASE WHEN ref->>'role'='context' THEN 'source_capture_not_work_date' END,'caption',nullif(left(btrim(public.text_redact_contact(ref->>'caption')),300),'')));
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'role'='context')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'role'<>'context') THEN CONTINUE; END IF;
  IF NOT qualified OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(images) x
    JOIN public.observation_witnesses w ON w.observation_id=o.id AND w.image_id::text=x->>'image_id'
    WHERE (x->>'image_id')::uuid=(o.structured_data->>'image_id')::uuid AND x->>'image_url'=o.source_url AND w.witness_role='derived') THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(images) b CROSS JOIN jsonb_array_elements(images) a
    WHERE b->>'role'='before' AND a->>'role'='after' AND (b->>'taken_at')::timestamptz>(a->>'taken_at')::timestamptz) THEN CONTINUE; END IF;
  receipts:='[]'; missing_receipts:=0;
  FOR ref IN SELECT value FROM jsonb_array_elements(o.structured_data->'receipt_links') LOOP
   IF coalesce(ref->>'receipt_id','') !~ uuid_pattern OR coalesce(ref->>'item_id','') !~ uuid_pattern
    OR coalesce(ref->>'link_id','') !~ uuid_pattern OR coalesce(ref->>'source_id','') !~ uuid_pattern
    OR coalesce(ref->>'relation','') NOT IN ('candidate_material','documented_operation') THEN
     missing_receipts:=missing_receipts+1; CONTINUE;
   END IF;
   -- Exact line/link/document, not a SKU or time-window join. Original source URL
   -- stays internal; original page access uses the existing viewer and its policy.
   SELECT i.id AS item_id,r.id AS receipt_id,r.source_document_table,r.source_document_id,r.vendor_name,l.page_date,
    i.description,i.part_number,i.quantity,i.hours,i.total_price,r.currency INTO receipt_row
   FROM public.receipt_items i JOIN public.receipts r ON r.id=i.receipt_id
    JOIN public.receipt_vehicle_links l ON l.id=(ref->>'link_id')::uuid AND l.receipt_id=r.id
   WHERE i.id=(ref->>'item_id')::uuid AND r.id=(ref->>'receipt_id')::uuid
    AND i.description IS NOT DISTINCT FROM ref->>'description' AND i.part_number IS NOT DISTINCT FROM ref->>'part_number'
    AND l.vehicle_id=p_vehicle_id AND l.status='linked' AND l.retired_at IS NULL
    AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
    AND r.source_document_table=ref->>'source_table' AND r.source_document_id=(ref->>'source_id')::uuid
    AND ((r.source_document_table='vehicle_documents' AND EXISTS(SELECT 1 FROM public.vehicle_documents d
       WHERE d.id=r.source_document_id AND d.vehicle_id=p_vehicle_id AND d.file_url=ref->>'source_url'))
     OR (r.source_document_table='vehicle_images' AND EXISTS(SELECT 1 FROM public.vehicle_images i2
       WHERE i2.id=r.source_document_id AND i2.vehicle_id=p_vehicle_id AND i2.image_url=ref->>'source_url'
        AND i2.is_superseded IS NOT TRUE AND i2.is_sensitive IS NOT TRUE AND i2.vision_gate_status='approved')));
   IF NOT FOUND THEN missing_receipts:=missing_receipts+1; CONTINUE; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(receipts) x WHERE x->>'item_id'=receipt_row.item_id::text) THEN CONTINUE; END IF;
   receipts:=receipts||jsonb_build_array(jsonb_build_object('item_id',receipt_row.item_id,'receipt_id',receipt_row.receipt_id,'product',public.receipt_item_product_card(receipt_row.item_id),
    'relation',ref->>'relation','source_table',receipt_row.source_document_table,'source_id',receipt_row.source_document_id,
    'source_url_sha256',encode(sha256(convert_to(ref->>'source_url','UTF8')),'hex'),
    'vendor',nullif(left(btrim(public.text_redact_contact(receipt_row.vendor_name)),300),''),'page_date',receipt_row.page_date,
    'description',nullif(left(btrim(public.text_redact_contact(receipt_row.description)),300),''),'part_number',nullif(left(btrim(public.text_redact_contact(receipt_row.part_number)),300),''),
    'quantity',receipt_row.quantity,'hours',CASE WHEN ref->>'relation'='documented_operation' THEN receipt_row.hours END,
    'amount',CASE WHEN tied THEN receipt_row.total_price END,'currency',receipt_row.currency,'amounts_visible',tied));
  END LOOP;
  effort:=NULL;
  IF coalesce(o.structured_data#>>'{effort_reference,reference_id}','') ~ uuid_pattern
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'role'='before')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'role'='after') THEN
   SELECT m.* INTO baseline FROM public.stage_transition_labor_map m
    WHERE m.id=(o.structured_data#>>'{effort_reference,reference_id}')::uuid
     AND m.from_stage=o.structured_data#>>'{effort_reference,from_stage}'
     AND m.to_stage=o.structured_data#>>'{effort_reference,to_stage}'
     AND m.zone_pattern=o.structured_data#>>'{effort_reference,zone_pattern}'
     AND m.estimated_hours_min>=0 AND m.estimated_hours_max>=m.estimated_hours_min
     AND m.estimated_hours_typical BETWEEN m.estimated_hours_min AND m.estimated_hours_max
     AND m.estimated_hours_max<'Infinity'::real;
   IF FOUND THEN effort:=jsonb_build_object('reference_id',baseline.id,'description',nullif(left(btrim(public.text_redact_contact(baseline.description)),300),''),
    'hours_min',baseline.estimated_hours_min,'hours_max',baseline.estimated_hours_max,
    'hours_typical',baseline.estimated_hours_typical,'basis','seed_uncalibrated'); END IF;
  END IF;
  SELECT coalesce(jsonb_agg(nullif(left(btrim(public.text_redact_contact(value#>>'{}')),300),'')) FILTER(WHERE nullif(left(btrim(public.text_redact_contact(value#>>'{}')),300),'') IS NOT NULL),'[]') INTO gaps
   FROM jsonb_array_elements(o.structured_data->'gaps');
  result:=result||jsonb_build_array(jsonb_build_object('observation_id',o.id,'title',nullif(left(btrim(public.text_redact_contact(o.structured_data->>'title')),300),''),
   'summary',nullif(left(btrim(public.text_redact_contact(o.structured_data->>'summary')),300),''),'images',images,'receipts',receipts,
   'receipt_links_unavailable',missing_receipts,'gaps',gaps,'effort_reference',effort,
   'market_value',jsonb_build_object('status','not_established_by_cited_sources'),
   'paid_labor',jsonb_build_object('status','unreconciled')));
 END LOOP;
 IF result='[]'::jsonb AND seen<=100 THEN RETURN '{}'::jsonb; END IF;
 RETURN jsonb_build_object('visual_work',result,'visual_work_coverage',CASE WHEN seen>100 THEN 'limit_reached' ELSE 'current_reader' END)
  ||public.visual_work_master_cost_fold(p_vehicle_id,result,tied,seen>100);
END $function$;

CREATE FUNCTION public.visual_work_build_log_inputs_digest(p_vehicle_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 -- Every vehicle-scoped row the compute reads, by the columns it reads: the vehicle, its
 -- visual_work_v1 records, cited source observations and their witnesses, cited and witnessed
 -- images, and the linked receipt lines, receipts, links, documents and stage-map rows.
 -- Catalog rows, page snapshots and stock images behind the product cards are included, so a
 -- withdrawal is immediate. Labor rates and reference hours are global and covered by valid_until.
 RETURN (WITH u(p) AS (SELECT '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'::text),
 w AS (SELECT o.id,o.vehicle_id,o.kind,o.is_superseded,o.source_id,o.extraction_method,o.confidence_score,o.observed_at,o.source_url,o.structured_data d,
   (SELECT x.slug FROM public.observation_sources x WHERE x.id=o.source_id) slug
   FROM public.vehicle_observations o WHERE o.vehicle_id=p_vehicle_id AND o.kind='work_record' AND o.extraction_method='visual_work_v1'),
 arr AS (SELECT w.d,k FROM w CROSS JOIN LATERAL unnest(ARRAY['visual_sources','receipt_links','operations','materials']) k),
 el AS (SELECT a.k,e FROM arr a CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.d->a.k)='array' THEN a.d->a.k ELSE '[]' END) e),
 obs_ids AS (SELECT lower(e->>'source_observation_id') id FROM el WHERE k='visual_sources'
   UNION SELECT lower(s#>>'{}') FROM el CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e->'source_observation_ids')='array' THEN e->'source_observation_ids' ELSE '[]' END) s
    WHERE k IN ('operations','materials')),
 refs AS (SELECT o.id,o.vehicle_id,o.kind,o.is_superseded,o.extraction_method,o.source_url,o.structured_data->>'image_id' image_id
   FROM public.vehicle_observations o WHERE o.id IN (SELECT id::uuid FROM obs_ids, u WHERE id ~ u.p)),
 wit AS (SELECT x.observation_id,x.image_id,x.witness_role FROM public.observation_witnesses x
   WHERE x.observation_id IN (SELECT id FROM w UNION SELECT id FROM refs)),
 rl AS (SELECT e FROM el WHERE k='receipt_links'),
 img_ids AS (SELECT lower(e->>'image_id') id FROM el WHERE k='visual_sources' UNION SELECT lower(d->>'image_id') FROM w
   UNION SELECT image_id::text FROM wit UNION SELECT lower(e->>'source_id') FROM rl WHERE e->>'source_table'='vehicle_images'),
 img AS (SELECT i.id,i.vehicle_id,i.image_url,i.taken_at,i.exif_data->>'capture_time_zone' tz,i.exif_data->>'capture_time_basis' tb,
   i.vision_gate_status,i.is_sensitive,i.is_duplicate,i.is_superseded,i.is_document,i.redaction_level,i.image_vehicle_match_status,
   i.ai_scan_metadata#>>'{byok_deep_analysis,scene_type}' scene FROM public.vehicle_images i WHERE i.id IN (SELECT id::uuid FROM img_ids, u WHERE id ~ u.p)),
 items AS (SELECT i.id,i.receipt_id,i.description,i.part_number,i.quantity,i.hours,i.total_price FROM public.receipt_items i
   WHERE i.id IN (SELECT (e->>'item_id')::uuid FROM rl, u WHERE e->>'item_id' ~ u.p)),
 rcp AS (SELECT r.id,r.source_document_table,r.source_document_id,r.vendor_name,r.currency,r.is_superseded,r.duplicate_of FROM public.receipts r
   WHERE r.id IN (SELECT (e->>'receipt_id')::uuid FROM rl, u WHERE e->>'receipt_id' ~ u.p) OR r.id IN (SELECT receipt_id FROM items)),
 lnk AS (SELECT l.id,l.receipt_id,l.vehicle_id,l.status,l.retired_at,l.page_date FROM public.receipt_vehicle_links l
   WHERE l.id IN (SELECT (e->>'link_id')::uuid FROM rl, u WHERE e->>'link_id' ~ u.p)),
 docs AS (SELECT dd.id,dd.vehicle_id,dd.file_url FROM public.vehicle_documents dd
   WHERE dd.id IN (SELECT (e->>'source_id')::uuid FROM rl, u WHERE e->>'source_id' ~ u.p AND e->>'source_table'='vehicle_documents')),
 -- Catalog evidence behind each line's product card: candidate catalog rows, their page
 -- snapshots and retained stock images. Withdrawal of any is a changed input.
 cat AS (SELECT c.id,c.part_number,c.name,c.manufacturer,c.product_image_url,c.supplier_url,c.price_current,c.currency,c.application_data,c.created_at
   FROM public.catalog_parts c WHERE c.application_data ? 'receipt_product_v1'
    AND c.part_number IN (SELECT public.receipt_product_number(i.part_number) FROM items i)),
 snap AS (SELECT s.id,s.success,s.http_status,s.html_sha256,s.listing_url FROM public.listing_page_snapshots s
   WHERE s.id IN (SELECT (c.application_data#>>'{receipt_product_v1,snapshot_id}')::uuid FROM cat c, u
    WHERE c.application_data#>>'{receipt_product_v1,snapshot_id}' ~ u.p)),
 obj AS (SELECT o.name FROM storage.objects o WHERE o.bucket_id='catalog-images'
   AND o.name IN (SELECT c.application_data#>>'{receipt_product_v1,image_storage_path}' FROM cat c)),
 stage AS (SELECT m FROM public.stage_transition_labor_map m WHERE m.id IN (
   SELECT (w.d#>>'{effort_reference,reference_id}')::uuid FROM w, u WHERE w.d#>>'{effort_reference,reference_id}' ~ u.p
   UNION SELECT (e#>>'{reference,stage_map_id}')::uuid FROM el, u WHERE k='operations' AND e#>>'{reference,stage_map_id}' ~ u.p))
 SELECT md5(concat_ws('|',
  (SELECT row(v.id,v.year,v.is_public,v.deleted_at)::text FROM public.vehicles v WHERE v.id=p_vehicle_id),
  (SELECT string_agg(md5(row(w.id,w.vehicle_id,w.kind,w.is_superseded,w.source_id,w.extraction_method,w.confidence_score,w.observed_at,w.source_url,w.d,w.slug)::text),',' ORDER BY w.id) FROM w),
  (SELECT string_agg(r::text,',' ORDER BY r.id) FROM refs r),
  (SELECT string_agg(x::text,',' ORDER BY x.observation_id,x.image_id,x.witness_role) FROM wit x),
  (SELECT string_agg(md5(i::text),',' ORDER BY i.id) FROM img i),
  (SELECT string_agg(md5(i::text),',' ORDER BY i.id) FROM items i),
  (SELECT string_agg(r::text,',' ORDER BY r.id) FROM rcp r),
  (SELECT string_agg(l::text,',' ORDER BY l.id) FROM lnk l),
  (SELECT string_agg(dd::text,',' ORDER BY dd.id) FROM docs dd),
  (SELECT string_agg(s.m::text,',' ORDER BY (s.m).id) FROM stage s),
  (SELECT string_agg(md5(c::text),',' ORDER BY c.id) FROM cat c),
  (SELECT string_agg(s::text,',' ORDER BY s.id) FROM snap s),
  (SELECT string_agg(o.name,',' ORDER BY o.name) FROM obj o),
  -- A deployed change to the compute, the fold or a helper they call is a changed input too.
  (SELECT string_agg(md5(f.prosrc),',' ORDER BY f.oid::regprocedure::text) FROM pg_catalog.pg_proc f
    WHERE f.pronamespace='public'::regnamespace AND f.proname=ANY(ARRAY['visual_work_build_log_compute','visual_work_master_cost_fold',
     'receipt_item_product_card','receipt_work_frame_eligible','receipt_product_supplier','receipt_product_number',
     'receipt_product_eligible','text_redact_contact','listing_plan_resolve_target','resolve_labor_rate','get_service_url'])))));
END $function$;

CREATE OR REPLACE FUNCTION public.visual_work_build_log(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 tied boolean; stored_output jsonb; stored_digest text;
BEGIN
 SELECT auth.role()='service_role' OR (auth.uid() IS NOT NULL AND
   (v.user_id=auth.uid() OR v.owner_id=auth.uid() OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid())))
 INTO tied FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.deleted_at IS NULL AND
   (v.is_public IS TRUE OR auth.role()='service_role' OR v.user_id=auth.uid() OR v.owner_id=auth.uid()
    OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid()));
 IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
 tied:=coalesce(tied,false);
 -- The stored output is served only while every vehicle-scoped input it read is unchanged
 -- (same digest) and no clock-dependent field has turned (valid_until). Otherwise compute now.
 SELECT s.output,s.inputs_digest INTO stored_output,stored_digest FROM public.visual_work_build_log_state s
  WHERE s.vehicle_id=p_vehicle_id AND s.amounts_visible=tied AND s.valid_until>statement_timestamp();
 IF stored_digest IS NOT NULL AND stored_digest=public.visual_work_build_log_inputs_digest(p_vehicle_id) THEN
  RETURN stored_output;
 END IF;
 RETURN public.visual_work_build_log_compute(p_vehicle_id,tied);
END $function$;

CREATE FUNCTION public.visual_work_build_log_refresh(p_max_computes integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v uuid; t boolean; d text; s_digest text; s_until timestamptz; t0 timestamptz; result jsonb; until timestamptz;
 computed integer:=0; fresh integer:=0; deferred integer:=0; removed integer;
BEGIN
 -- Public, undeleted vehicles with current visual work only: the compute runs here without a
 -- JWT, and the fold's own gate admits no other vehicle. Private vehicles always compute live.
 DELETE FROM public.visual_work_build_log_state s WHERE NOT EXISTS(SELECT 1 FROM public.vehicles x
  WHERE x.id=s.vehicle_id AND x.is_public IS TRUE AND x.deleted_at IS NULL AND EXISTS(SELECT 1 FROM public.vehicle_observations o
   WHERE o.vehicle_id=x.id AND o.structured_data @> '{"contract":"visual_work_v1"}' AND o.kind='work_record'
    AND o.extraction_method='visual_work_v1' AND o.is_superseded IS FALSE));
 GET DIAGNOSTICS removed=ROW_COUNT;
 FOR v IN SELECT x.id FROM public.vehicles x WHERE x.is_public IS TRUE AND x.deleted_at IS NULL AND x.id IN (
   -- The contract containment uses the structured_data GIN index (~40 ms; kind alone read 21k pages).
   SELECT o.vehicle_id FROM public.vehicle_observations o WHERE o.structured_data @> '{"contract":"visual_work_v1"}'
    AND o.kind='work_record' AND o.extraction_method='visual_work_v1' AND o.is_superseded IS FALSE) ORDER BY x.id LOOP
  -- The digest is read before the compute: a concurrent input change leaves a stale digest,
  -- which the reader treats as a miss, never stale output under a current digest.
  d:=public.visual_work_build_log_inputs_digest(v);
  FOREACH t IN ARRAY ARRAY[false,true] LOOP
   s_digest:=NULL; s_until:=NULL;
   SELECT x.inputs_digest,x.valid_until INTO s_digest,s_until FROM public.visual_work_build_log_state x WHERE x.vehicle_id=v AND x.amounts_visible=t;
   IF s_digest IS NOT DISTINCT FROM d AND s_until>now()+interval '10 minutes' THEN fresh:=fresh+1; CONTINUE; END IF;
   IF computed>=p_max_computes THEN deferred:=deferred+1; CONTINUE; END IF;
   t0:=clock_timestamp();
   result:=public.visual_work_build_log_compute(v,t);
   -- Clock-dependent output: a catalog quote turns price_stale 7 days after its capture, and a
   -- service fee retrieved in the future becomes valid at that time. Global inputs: one hour.
   SELECT least(now()+interval '1 hour',
     (SELECT min(x.c+interval '7 days') FROM jsonb_path_query(result,'lax $.**.captured_at') j
       CROSS JOIN LATERAL (SELECT CASE WHEN pg_input_is_valid(j#>>'{}','timestamp with time zone') THEN (j#>>'{}')::timestamptz END c) x
       WHERE isfinite(x.c) AND x.c+interval '7 days'>now()),
     (SELECT min(x.c) FROM public.vehicle_observations o
       CROSS JOIN LATERAL jsonb_path_query(o.structured_data,'lax $.operations[*].reference.source_retrieved_at') j
       CROSS JOIN LATERAL (SELECT CASE WHEN pg_input_is_valid(j#>>'{}','timestamp with time zone') THEN (j#>>'{}')::timestamptz END c) x
       WHERE o.vehicle_id=v AND o.kind='work_record' AND o.extraction_method='visual_work_v1' AND isfinite(x.c) AND x.c>now()))
    INTO until;
   INSERT INTO public.visual_work_build_log_state AS x(vehicle_id,amounts_visible,inputs_digest,output,computed_at,valid_until,compute_ms)
   VALUES(v,t,d,result,now(),until,round(extract(epoch FROM clock_timestamp()-t0)*1000))
   ON CONFLICT(vehicle_id,amounts_visible) DO UPDATE SET inputs_digest=excluded.inputs_digest,output=excluded.output,
    computed_at=excluded.computed_at,valid_until=excluded.valid_until,compute_ms=excluded.compute_ms;
   computed:=computed+1;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('computed',computed,'fresh',fresh,'deferred',deferred,'removed',removed);
END $function$;

REVOKE ALL ON FUNCTION public.visual_work_build_log_compute(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.visual_work_build_log_inputs_digest(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.visual_work_build_log_refresh(integer) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.visual_work_build_log_compute(uuid,boolean) IS
'Private: the visual work card reader and cost fold for one vehicle with the amount visibility passed in. No access gate; callers are visual_work_build_log and visual_work_build_log_refresh.';
COMMENT ON FUNCTION public.visual_work_build_log_inputs_digest(uuid) IS
'Private: md5 over the vehicle-scoped rows and columns visual_work_build_log_compute reads. A changed digest makes the stored output a miss.';
COMMENT ON FUNCTION public.visual_work_build_log_refresh(integer) IS
'Private writer of visual_work_build_log_state: recomputes public vehicles whose digest changed or whose valid_until is within 10 minutes, at most p_max_computes per run; deletes rows of vehicles no longer eligible.';

DO $$
BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='visual-work-build-log-refresh') THEN
   PERFORM cron.unschedule('visual-work-build-log-refresh');
  END IF;
  PERFORM cron.schedule('visual-work-build-log-refresh','3-58/5 * * * *',
   $cmd$SET statement_timeout = '90s'; SET lock_timeout = '3s'; SELECT public.visual_work_build_log_refresh();$cmd$);
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
