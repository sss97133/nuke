-- Read-time cost reconstruction of attributed work assumptions. No new ledger,
-- job, quote, source reading, payment, installation or measured-time assertion.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.visual_work_build_log(uuid)'::regprocedure)
    IS DISTINCT FROM 'ff21b173ed2bdbd2b2d13049e077ed03'
 OR to_regprocedure('public.visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)') IS NOT NULL THEN
  RAISE EXCEPTION 'Visual work cost owner drifted; inspect current definitions';
 END IF;
END $guard$;

CREATE FUNCTION public.visual_work_master_cost_fold(p_vehicle_id uuid,p_cards jsonb,p_tied boolean,p_limited boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $fold$
DECLARE
 card jsonb; doc jsonb; basis jsonb; line jsonb; kind text; scenario text; physical_key text;
 qty jsonb; qty_value numeric; rate_input jsonb; rate_info jsonb; rate_value numeric; currency text;
 ref jsonb; resolved jsonb; hours jsonb; unit_hours jsonb; cost jsonb; pricing jsonb; product jsonb; price_range jsonb;
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
    rate_info:=NULL; rate_value:=NULL; price_range:=NULL; qty_value:=NULL; reference_ok:=true;
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
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('image_id',i.id,'image_url',i.image_url,
        'source_observation_id',source_row.id,'role',coalesce(ci->>'role','source'),
        'caption',coalesce(nullif(left(public.text_redact_contact(ci->>'caption'),300),''),'Cited source photograph'),
        'taken_at',CASE WHEN isfinite(i.taken_at) THEN i.taken_at END,
        'capture_time_zone',CASE WHEN ci IS NOT NULL THEN ci->>'capture_time_zone'
         WHEN nullif(i.exif_data->>'capture_time_zone','') IS NOT NULL THEN
          CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z
           WHERE z.name=i.exif_data->>'capture_time_zone') THEN i.exif_data->>'capture_time_zone' END END,
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
      'observed_transition_needs_before_and_after','invalid_selection','invalid_overlap_group','shared_access_must_be_separate_additive_line']
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
     'formula',CASE WHEN kind='labor' THEN format('%s %s × (%s / %s / %s) person-hours per %s × %s %s/person-hour',
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
   SELECT jsonb_build_object('hours',CASE WHEN count(*) FILTER(WHERE r->>'kind'='labor' AND r->>'status' IN ('resolved','partial'))>0
     THEN jsonb_build_object('min',sum((r#>>'{hours,min}')::numeric),'typical',sum((r#>>'{hours,typical}')::numeric),'max',sum((r#>>'{hours,max}')::numeric)) END,
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
END $fold$;
REVOKE ALL ON FUNCTION public.visual_work_master_cost_fold(uuid,jsonb,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.visual_work_master_cost_fold(uuid,jsonb,boolean,boolean) IS
'Private read-time fold of current visual-work cost assumptions. Unique physical keys, explicit alternative selection, source-qualified reference/analyst hours and current catalog quotes. Estimates remain separate from documented charges, payments and component/vehicle market value.';
DO $patch$ DECLARE def text; change record; anchor text:=
 $a$RETURN jsonb_build_object('visual_work',result,'visual_work_coverage',CASE WHEN seen>100 THEN 'limit_reached' ELSE 'current_reader' END);$a$;
BEGIN
 def:=pg_get_functiondef('public.visual_work_build_log(uuid)'::regprocedure);
 -- Photographed restoration pages are context, not physical before/after proof.
 -- Only the explicit conditional cost contract may use them, with an exact
 -- current reviewed-image witness and an ordinary physical frame on the card.
 -- The general receipt/work eligibility owner is deliberately unchanged.
 FOR change IN SELECT * FROM (VALUES
  ($a$coalesce(ref->>'role','') NOT IN ('before','during','after')$a$,
   $a$coalesce(ref->>'role','') NOT IN ('before','during','after','context')$a$),
  ($a$   SELECT i.id,i.image_url,i.taken_at,$a$,
   $a$   IF ref->>'role'='context' THEN
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
   SELECT i.id,i.image_url,i.taken_at,$a$),
  ($a$AND i.image_url=ref->>'source_url' AND public.receipt_work_frame_eligible(i) AND isfinite(i.taken_at)$a$,
   $a$AND i.image_url=ref->>'source_url' AND isfinite(i.taken_at)
     AND CASE WHEN ref->>'role'='context' THEN
      i.vision_gate_status='approved' AND i.is_sensitive IS NOT TRUE AND i.is_duplicate IS NOT TRUE
      AND i.is_superseded IS NOT TRUE AND i.is_document IS NOT TRUE AND coalesce(i.redaction_level::text,'none')='none'
      AND EXISTS(SELECT 1 FROM public.vehicle_observations ro JOIN public.observation_witnesses rw ON rw.observation_id=ro.id
       WHERE ro.id=(ref->>'source_observation_id')::uuid AND ro.vehicle_id=p_vehicle_id AND ro.is_superseded IS FALSE
        AND ro.extraction_method='reviewed_image_analysis_v1' AND ro.source_url=i.image_url
        AND lower(ro.structured_data->>'image_id')=i.id::text AND rw.image_id=i.id AND rw.witness_role='derived')
     ELSE public.receipt_work_frame_eligible(i) END$a$),
  ($a$'role',ref->>'role','caption',$a$,
   $a$'role',ref->>'role','source_observation_id',CASE WHEN ref->>'role'='context' THEN lower(ref->>'source_observation_id') END,
    'date_role',CASE WHEN ref->>'role'='context' THEN 'source_capture_not_work_date' END,'caption',$a$),
  ($a$  IF NOT qualified OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(images) x$a$,
   $a$  IF EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'role'='context')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'role'<>'context') THEN CONTINUE; END IF;
  IF NOT qualified OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(images) x$a$)
 ) AS changes(old_text,new_text) LOOP
  IF (length(def)-length(replace(def,change.old_text,'')))/length(change.old_text)<>1 THEN
   RAISE EXCEPTION 'Visual work context anchor drifted';
  END IF;
  def:=replace(def,change.old_text,change.new_text);
 END LOOP;
 IF (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Visual work return anchor drifted'; END IF;
 EXECUTE replace(def,anchor,
 $a$RETURN jsonb_build_object('visual_work',result,'visual_work_coverage',CASE WHEN seen>100 THEN 'limit_reached' ELSE 'current_reader' END)
  ||public.visual_work_master_cost_fold(p_vehicle_id,result,tied,seen>100);$a$);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
