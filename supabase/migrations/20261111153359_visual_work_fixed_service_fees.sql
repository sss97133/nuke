-- A supplied commercial service comparison prices labor without inventing hours.
-- Extend the current private fold only; no data, access or owner changes.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $patch$
DECLARE def text; change record;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)'::regprocedure)
    IS DISTINCT FROM '938e78ffb37d0bbcb1e80b058f8cc33b' THEN
  RAISE EXCEPTION 'Visual work cost fold drifted; inspect current owner';
 END IF;
 def:=pg_get_functiondef('public.visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)'::regprocedure);
 FOR change IN SELECT * FROM (VALUES
 ($old$ref jsonb; resolved jsonb; hours jsonb;$old$,
  $new$ref jsonb; resolved jsonb; fixed_service boolean; fee_valid boolean; hours jsonb;$new$),
 ($old$rate_info:=NULL; rate_value:=NULL; price_range:=NULL; qty_value:=NULL; reference_ok:=true;$old$,
  $new$rate_info:=NULL; rate_value:=NULL; price_range:=NULL; qty_value:=NULL; reference_ok:=true; fixed_service:=false;$new$),
 ($old$     ref:=line->'reference';
     IF ref->>'type'='labor_operation' THEN$old$,
  $new$     ref:=line->'reference';
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
     IF ref->>'type'='labor_operation' THEN$new$),
 ($old$    ELSE
     pricing:=line->'pricing';$old$,
  $new$     END IF;
    ELSE
     pricing:=line->'pricing';$new$),
 ($old$'observed_transition_needs_before_and_after','invalid_selection','invalid_overlap_group','shared_access_must_be_separate_additive_line']$old$,
  $new$'observed_transition_needs_before_and_after','invalid_selection','invalid_overlap_group','shared_access_must_be_separate_additive_line',
      'fixed_service_scope_unqualified','fixed_service_selection_required']$new$),
 ($old$'formula',CASE WHEN kind='labor' THEN format($old$,
  $new$'formula',CASE WHEN kind='labor' AND fixed_service THEN format('%s %s × (%s / %s / %s) %s per %s; person-hours unknown',
       coalesce(qty_value::text,'unknown'),left(public.text_redact_contact(qty->>'unit'),80),
       coalesce(price_range->>'min','unknown'),coalesce(price_range->>'typical','unknown'),coalesce(price_range->>'max','unknown'),
       coalesce(currency,'currency unknown'),left(public.text_redact_contact(qty->>'unit'),80))
      WHEN kind='labor' THEN format($new$),
 ($old$   SELECT jsonb_build_object('hours',CASE WHEN count(*) FILTER(WHERE r->>'kind'='labor' AND r->>'status' IN ('resolved','partial'))>0
     THEN jsonb_build_object('min',sum((r#>>'{hours,min}')::numeric),'typical',sum((r#>>'{hours,typical}')::numeric),'max',sum((r#>>'{hours,max}')::numeric)) END,$old$,
  $new$   SELECT jsonb_build_object('hours',CASE WHEN count(*) FILTER(WHERE r->>'kind'='labor'
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
        OR p_limited OR input_limited THEN 'partial' ELSE 'complete_for_supplied_lines' END),$new$)
 ) changes(old_text,new_text) LOOP
  IF (length(def)-length(replace(def,change.old_text,'')))/length(change.old_text)<>1 THEN
   RAISE EXCEPTION 'Visual work service-fee anchor drifted';
  END IF;
  def:=replace(def,change.old_text,change.new_text);
 END LOOP;
 EXECUTE def;
END $patch$;
COMMENT ON FUNCTION public.visual_work_master_cost_fold(uuid,jsonb,boolean,boolean) IS
'Private current-source cost fold: physical keys and explicit alternatives; reference/analyst hours times rate or attributed public service-menu fee times quantity. Service fees leave hours unknown with separate hour coverage. No quote, measured time, payment or vehicle value is inferred.';
NOTIFY pgrst,'reload schema';
COMMIT;
