-- Synthetic local fixture supplement only, after the original family contract.
-- Exact live reader/privacy owners captured 2026-10-15. No production testimony.
ALTER TYPE public.observation_kind ADD VALUE IF NOT EXISTS 'activity';
ALTER TYPE public.observation_kind ADD VALUE IF NOT EXISTS 'work_record';
CREATE OR REPLACE FUNCTION public.observation_is_public(p_kind observation_kind, p_data jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_kind IN ('listing', 'sale_result', 'comment', 'bid', 'specification', 'condition', 'media', 'splice')
     AND COALESCE(p_data::text, '') !~* ('"(invoice_number|line_items|subtotal|tax|total_amount|receipt_id|file_url'
                                         '|receipt_type|vendor_address|client_billing|billing|billed_usd|paid_usd|cost_usd'
                                         '|price_usd|amount_usd|payment_method|payment|payments|amount_paid|balance_due'
                                         '|order_number|order_contents|order|client|correct_owner|prior_owner_id'
                                         '|correct_owner_discovered_person_id|customer_name|client_name|email|phone'
                                         '|total_?paid|balance_?remaining|full_?name|first_?name|last_?name'
                                         '|given_?name|family_?name|legal_?name|buyer_?name|seller_?name'
                                         '|owner_?name|person_?name|technician_?name|participant_?name|contact_?name)"\s*:')
     AND NOT (p_kind IN ('condition', 'media') AND COALESCE(p_data::text, '') ~* '(invoice|receipt|\$\s?[0-9])');
$function$
;
CREATE OR REPLACE FUNCTION public.public_text(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p IS NULL OR btrim(p) = '' THEN NULL
    WHEN p ~* '(\$\s?[0-9]|invoice|billed|\mpaid\M|payment|\mcard\M|client|customer|@|\m\d{3}[-.\s]\d{3}[-.\s]\d{4}\M)' THEN NULL
    ELSE left(btrim(p), 300)
  END;
$function$
;
CREATE OR REPLACE FUNCTION public.vehicle_build_log_public(p_vehicle_id uuid)
 RETURNS TABLE(observation_id uuid, done_on date, item text, category text, supplier text, labor_minutes numeric, build_stage text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT o.id,
         COALESCE(CASE WHEN o.structured_data->>'transaction_date' ~ '^\d{4}-\d{2}-\d{2}'
                       THEN left(o.structured_data->>'transaction_date', 10)::date END,
                  o.observed_at::date),
         public.public_text(COALESCE(o.structured_data->>'item', o.structured_data->>'task',
                                     o.structured_data->>'title', o.structured_data->>'work_performed')),
         public.public_text(o.structured_data->>'category'),
         public.public_text(o.structured_data->>'supplier'),
         CASE WHEN o.structured_data->>'labor_minutes' ~ '^\d+(\.\d+)?$'
              THEN (o.structured_data->>'labor_minutes')::numeric END,
         public.public_text(COALESCE(o.structured_data->>'build_stage', o.structured_data->>'phase'))
  FROM public.vehicle_observations o
  JOIN public.vehicles v ON v.id = o.vehicle_id
  WHERE o.vehicle_id = p_vehicle_id
    AND o.kind = 'work_record'
    AND o.is_superseded IS NOT TRUE
    AND jsonb_typeof(o.structured_data) = 'object'
    AND NOT (o.structured_data ?| ARRAY['receipt_id', 'invoice_number', 'file_url'])
    AND COALESCE(o.structured_data->>'subject', '') <> 'client_invoice'
    AND COALESCE(o.structured_data->>'item', o.structured_data->>'task', o.structured_data->>'title',
                 o.structured_data->>'work_performed', o.structured_data->>'category') IS NOT NULL
    AND v.deleted_at IS NULL
    AND (v.is_public = true
         OR v.user_id = (SELECT auth.uid())
         OR v.owner_id = (SELECT auth.uid())
         OR v.uploaded_by = (SELECT auth.uid()))
  ORDER BY 2 DESC NULLS LAST, 1;
$function$
;
REVOKE ALL ON FUNCTION public.vehicle_build_log_public(uuid),public.public_text(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_build_log_public(uuid),public.public_text(text) TO anon,authenticated,service_role;
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vo_authenticated_read ON public.vehicle_observations FOR SELECT TO PUBLIC USING (
 EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=vehicle_observations.vehicle_id AND
 (v.user_id=(SELECT auth.uid()) OR v.owner_id=(SELECT auth.uid()) OR v.uploaded_by=(SELECT auth.uid()) OR
 (v.is_public=true AND public.observation_is_public(vehicle_observations.kind,vehicle_observations.structured_data)))));
-- Local service_role does not carry the managed platform's BYPASSRLS attribute.
CREATE POLICY fixture_service_role ON public.vehicle_observations TO service_role USING(true) WITH CHECK(true);
DROP TRIGGER trg_retained_listing_property_source ON public.vehicle_observations;
CREATE TRIGGER trg_retained_listing_property_source_insert BEFORE INSERT ON public.vehicle_observations FOR EACH ROW WHEN (((new.source_observation_id IS NOT NULL) OR (new.extraction_method = 'retained_listing_property_projection_v1'::text))) EXECUTE FUNCTION validate_retained_listing_property_source();
CREATE TRIGGER trg_retained_listing_property_source_update BEFORE UPDATE ON public.vehicle_observations FOR EACH ROW WHEN (((old.source_observation_id IS NOT NULL) OR (new.source_observation_id IS NOT NULL))) EXECUTE FUNCTION validate_retained_listing_property_source();

-- Exact live BaT capability before the held release, synthetic local registry.
UPDATE public.observation_sources SET supported_observations=ARRAY['listing','sale_result','comment','bid','condition','specification']::public.observation_kind[]
 WHERE id='4cdc735c-f117-42f2-889f-ba33805639a5';
INSERT INTO public.observation_sources(id,slug,display_name,category,base_trust_score,supported_observations)
 VALUES('33333333-3333-4333-8333-333333333333','reported-work-control','Synthetic activity/confirmed-work control','auction',.6,ARRAY['activity','work_record']::public.observation_kind[]);
