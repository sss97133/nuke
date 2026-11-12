-- Synthetic local fixture only; current real source reader/catalog owners and canonical witness trigger.
-- No production observation is imported, admitted or replayed.
\set ON_ERROR_STOP on
\ir test_visual_work_receipt_text.sql
-- Exact current catalog read owners with synthetic retained source/capture rows.
CREATE TABLE listing_page_snapshots(id uuid PRIMARY KEY,listing_url text,html_sha256 text,http_status int,success boolean,fetched_at timestamptz);
CREATE TABLE catalog_parts(id uuid PRIMARY KEY,part_number text,name text,manufacturer text,product_image_url text,supplier_url text,price_current numeric,currency text,application_data jsonb,created_at timestamptz);
CREATE SCHEMA storage;
CREATE TABLE storage.objects(bucket_id text,name text);
CREATE OR REPLACE FUNCTION public.receipt_product_number(p_number text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$ SELECT upper(regexp_replace(btrim(coalesce(p_number,'')),'^\*+','','g')) $function$;

CREATE OR REPLACE FUNCTION public.receipt_product_supplier(p_vendor text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN lower(btrim(p_vendor))='classic industries' THEN 'classic_industries'
 WHEN lower(btrim(p_vendor)) ~ '^o[''’]?reilly auto parts( *\(store [0-9]+\))?$' THEN 'oreilly'
 WHEN lower(btrim(p_vendor))='ames performance' THEN 'ames' END;
$function$;

CREATE OR REPLACE FUNCTION public.receipt_product_eligible(p_number text, p_description text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT length(public.receipt_product_number(p_number)) BETWEEN 1 AND 100
 AND public.receipt_product_number(p_number) !~ '[{}]'
 AND coalesce(p_description,'') !~* 'freight|shipping|handling|core (charge|return|exchange)';
$function$;

CREATE OR REPLACE FUNCTION public.receipt_item_product_card(p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.catalog_parts%ROWTYPE; meta jsonb; supplier text; pn text; line_code text;
BEGIN
 SELECT public.receipt_product_supplier(r.vendor_name),public.receipt_product_number(i.part_number),substring(upper(i.description) from '\(([A-Z0-9]{2,3})(?:,|\))') INTO supplier,pn,line_code
 FROM public.receipt_items i JOIN public.receipts r ON r.id=i.receipt_id
 WHERE i.id=p_item AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
 AND public.receipt_product_eligible(i.part_number,i.description);
 IF supplier IS NULL OR (supplier='oreilly' AND line_code IS NULL) THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.catalog_parts WHERE part_number=pn
 AND application_data#>>'{receipt_product_v1,supplier_key}'=supplier
 AND (supplier<>'oreilly' OR application_data#>>'{receipt_product_v1,line_code}'=line_code) ORDER BY created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 meta:=c.application_data->'receipt_product_v1';
 -- Withdrawal of the latest source does not fall back to a superseded capture.
 IF NOT EXISTS(SELECT 1 FROM public.listing_page_snapshots s WHERE s.id=(meta->>'snapshot_id')::uuid
 AND s.success IS TRUE AND s.http_status=200 AND s.html_sha256=meta->>'page_sha256' AND s.listing_url=c.supplier_url)
 OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='catalog-images' AND name=meta->>'image_storage_path') THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('catalog_part_id',c.id,'name',c.name,'manufacturer',c.manufacturer,'part_number',c.part_number,
 'image_url',c.product_image_url,'page_url',c.supplier_url,'captured_at',meta->>'captured_at','source_role',meta->>'source_role',
 'quote_price',c.price_current,'currency',c.currency,'price_stale',(meta->>'captured_at')::timestamptz<now()-interval '7 days',
 'price_basis','current_supplier_quote','image_basis','catalog_stock_image');
END $function$;

INSERT INTO listing_page_snapshots VALUES('a0000000-0000-0000-0000-000000000001','https://www.classicindustries.com/product/test-1.html',repeat('a',64),200,true,now());
INSERT INTO catalog_parts VALUES('c0000000-0000-0000-0000-000000000001','TEST-1','Synthetic replacement bracket','Synthetic supplier',
 'https://images.example/catalog.jpg','https://www.classicindustries.com/product/test-1.html',50,'USD',
 jsonb_build_object('receipt_product_v1',jsonb_build_object('supplier_key','classic_industries','snapshot_id','a0000000-0000-0000-0000-000000000001',
 'page_sha256',repeat('a',64),'image_storage_path','receipt-products/'||repeat('b',64)||'.jpeg','captured_at',now(),'source_role','original_receipt_supplier')),now());

-- Exact live visual-work definition, inspected 2026-11-11; this captures the
-- existing contact-text and catalog enrichment so the migration's drift guard runs.
CREATE OR REPLACE FUNCTION public.visual_work_build_log(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 o record; ref jsonb; image_row record; receipt_row record; baseline record;
 images jsonb; receipts jsonb; effort jsonb; gaps jsonb; result jsonb:='[]';
 qualified boolean; tied boolean; seen integer:=0; missing_receipts integer;
 uuid_pattern constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
 SELECT auth.role()='service_role' OR (auth.uid() IS NOT NULL AND
   (v.user_id=auth.uid() OR v.owner_id=auth.uid() OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid())))
 INTO tied FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.deleted_at IS NULL AND
   (v.is_public IS TRUE OR auth.role()='service_role' OR v.user_id=auth.uid() OR v.owner_id=auth.uid()
    OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid()));
 IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
 tied:=coalesce(tied,false);
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
   IF coalesce(ref->>'image_id','') !~ uuid_pattern OR coalesce(ref->>'role','') NOT IN ('before','during','after')
     OR nullif(left(btrim(public.text_redact_contact(ref->>'caption')),300),'') IS NULL OR coalesce(ref->>'source_url','') !~ '^https?://' THEN
    qualified:=false; EXIT;
   END IF;
   SELECT i.id,i.image_url,i.taken_at,
    CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=i.exif_data->>'capture_time_zone')
      THEN i.exif_data->>'capture_time_zone' END AS capture_time_zone,
    nullif(left(btrim(public.text_redact_contact(i.exif_data->>'capture_time_basis')),300),'') AS capture_time_basis
   INTO image_row FROM public.vehicle_images i
    WHERE i.id=(ref->>'image_id')::uuid AND i.vehicle_id=p_vehicle_id
     AND i.image_url=ref->>'source_url' AND public.receipt_work_frame_eligible(i) AND isfinite(i.taken_at)
     AND coalesce(i.image_vehicle_match_status,'') NOT IN ('mismatch','unrelated');
   IF NOT FOUND OR EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'image_id'=image_row.id::text) THEN
    qualified:=false; EXIT;
   END IF;
   images:=images||jsonb_build_array(jsonb_build_object('image_id',image_row.id,'image_url',image_row.image_url,
    'taken_at',image_row.taken_at,'capture_time_zone',image_row.capture_time_zone,'capture_time_basis',image_row.capture_time_basis,
    'role',ref->>'role','caption',nullif(left(btrim(public.text_redact_contact(ref->>'caption')),300),'')));
  END LOOP;
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
 RETURN jsonb_build_object('visual_work',result,'visual_work_coverage',CASE WHEN seen>100 THEN 'limit_reached' ELSE 'current_reader' END);
END $function$;

ALTER TABLE vehicles ADD year integer DEFAULT 1973;
ALTER TABLE stage_transition_labor_map ADD category text,ADD materials_cost_min real,ADD materials_cost_max real,ADD confidence text;
UPDATE stage_transition_labor_map SET category='interior',materials_cost_min=1500,materials_cost_max=5000,confidence='low';
CREATE TABLE labor_operations(code text PRIMARY KEY,name text,base_hours numeric,system text,model_year_min integer,model_year_max integer,notes text);
INSERT INTO labor_operations VALUES('MECH-SUSPENSION-FRONT','Front suspension rebuild',8,'mechanical',1960,2000,'Synthetic reference fixture'),
 ('GLASS-DOOR','Door glass R&R',1,'glass',1960,2000,'Per door');
CREATE TABLE businesses(id uuid,labor_rate numeric);
INSERT INTO businesses(labor_rate) VALUES(120),(150),(160),(200);
CREATE FUNCTION public.listing_plan_resolve_target(p_target jsonb, p_year integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE lo record; rows jsonb := '[]'::jsonb; missing jsonb := '[]'::jsonb; rw jsonb; sr record; k jsonb;
BEGIN
  IF p_target->>'type' = 'labor_operation' THEN
    SELECT * INTO lo FROM public.labor_operations WHERE code = p_target->>'code';
    IF lo.code IS NULL THEN RETURN jsonb_build_object('type', 'labor_operation', 'code', p_target->>'code', 'state', 'code_absent_from_reference'); END IF;
    RETURN jsonb_build_object('type', 'labor_operation', 'code', lo.code, 'name', lo.name, 'system', lo.system, 'state', 'resolved',
      'hours', jsonb_build_object('min', NULL, 'typical', lo.base_hours, 'max', NULL), 'range_basis', 'single_book_value_no_range',
      'materials', NULL, 'method', 'labor_operations.base_hours', 'label', 'seed_uncalibrated',
      'year_applicability', CASE WHEN lo.model_year_min IS NULL AND lo.model_year_max IS NULL THEN 'unstated' WHEN p_year IS NULL THEN 'vehicle_year_unknown'
        WHEN (lo.model_year_min IS NULL OR p_year >= lo.model_year_min) AND (lo.model_year_max IS NULL OR p_year <= lo.model_year_max) THEN 'in_range' ELSE 'out_of_range' END);
  END IF;
  FOR rw IN SELECT x FROM jsonb_array_elements(CASE WHEN p_target->>'type' = 'stage_chain' THEN p_target->'rows' ELSE jsonb_build_array(p_target) END) WITH ORDINALITY z(x, n) ORDER BY n LOOP
    k := jsonb_build_object('category', rw->>'category', 'from_stage', rw->>'from_stage', 'to_stage', rw->>'to_stage', 'zone_pattern', rw->>'zone_pattern');
    SELECT * INTO sr FROM public.stage_transition_labor_map m WHERE m.category = rw->>'category' AND m.from_stage = rw->>'from_stage'
      AND m.to_stage = rw->>'to_stage' AND m.zone_pattern = rw->>'zone_pattern' ORDER BY m.id LIMIT 1;
    IF sr.id IS NULL THEN missing := missing || jsonb_build_array(k);
    ELSE rows := rows || jsonb_build_array(jsonb_build_object('key', k, 'stage_map_id', sr.id, 'description', sr.description,
      'hours', jsonb_build_object('min', sr.estimated_hours_min, 'typical', sr.estimated_hours_typical, 'max', sr.estimated_hours_max),
      'materials', jsonb_build_object('min', sr.materials_cost_min, 'max', sr.materials_cost_max, 'currency', 'unstated_in_reference'),
      'author_declared_confidence', sr.confidence)); END IF;
    sr := NULL;
  END LOOP;
  IF p_target->>'type' = 'stage_row' THEN
    IF jsonb_array_length(rows) = 0 THEN RETURN jsonb_build_object('type', 'stage_row', 'key', missing->0, 'state', 'row_absent_from_reference'); END IF;
    RETURN jsonb_build_object('type', 'stage_row', 'state', 'resolved', 'range_basis', 'author_declared_min_typical_max',
      'method', 'stage_transition_labor_map', 'label', 'seed_uncalibrated') || (rows->0);
  END IF;
  IF jsonb_array_length(missing) > 0 THEN RETURN jsonb_build_object('type', 'stage_chain', 'state', 'incomplete_chain', 'missing', missing); END IF;
  RETURN jsonb_build_object('type', 'stage_chain', 'state', 'resolved', 'rows', rows,
    'hours', jsonb_build_object('min', (SELECT round(sum((r#>>'{hours,min}')::numeric), 2) FROM jsonb_array_elements(rows) r),
      'typical', (SELECT round(sum((r#>>'{hours,typical}')::numeric), 2) FROM jsonb_array_elements(rows) r),
      'max', (SELECT round(sum((r#>>'{hours,max}')::numeric), 2) FROM jsonb_array_elements(rows) r)),
    'materials', jsonb_build_object('min', (SELECT round(sum((r#>>'{materials,min}')::numeric), 2) FROM jsonb_array_elements(rows) r),
      'max', (SELECT round(sum((r#>>'{materials,max}')::numeric), 2) FROM jsonb_array_elements(rows) r), 'currency', 'unstated_in_reference'),
    'range_basis', 'sum_of_author_declared_rows', 'method', 'sum_of_stage_transition_labor_map_rows', 'label', 'seed_uncalibrated');
END $$;
CREATE OR REPLACE FUNCTION resolve_labor_rate(
  p_organization_id UUID DEFAULT NULL, p_user_id UUID DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL, p_client_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_contract_rate NUMERIC; v_user_rate NUMERIC; v_org_rate NUMERIC;
  v_sample_median NUMERIC; v_market_n INT;
  v_spitball NUMERIC := 160.00; v_auth_threshold INT := 30;
  v_resolved_rate NUMERIC; v_source TEXT; v_rate_conf TEXT; v_authenticated BOOLEAN;
BEGIN
  SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY labor_rate))::numeric, count(*)
    INTO v_sample_median, v_market_n
  FROM businesses WHERE labor_rate IS NOT NULL AND labor_rate > 0;
  v_market_n := COALESCE(v_market_n, 0);

  IF p_client_id IS NOT NULL AND p_organization_id IS NOT NULL THEN
    SELECT agreed_labor_rate INTO v_contract_rate FROM work_contracts
    WHERE client_id = p_client_id AND organization_id = p_organization_id
      AND status = 'active' AND (vehicle_id IS NULL OR vehicle_id = p_vehicle_id)
    ORDER BY vehicle_id NULLS LAST LIMIT 1;
    IF v_contract_rate IS NOT NULL THEN v_resolved_rate := v_contract_rate; v_source := 'contract'; END IF;
  END IF;
  IF v_resolved_rate IS NULL AND p_user_id IS NOT NULL THEN
    SELECT hourly_rate INTO v_user_rate FROM user_labor_rates
    WHERE user_id = p_user_id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF v_user_rate IS NOT NULL THEN v_resolved_rate := v_user_rate; v_source := 'user'; END IF;
  END IF;
  IF v_resolved_rate IS NULL AND p_organization_id IS NOT NULL THEN
    SELECT labor_rate INTO v_org_rate FROM businesses WHERE id = p_organization_id;
    IF v_org_rate IS NOT NULL AND v_org_rate > 0 THEN v_resolved_rate := v_org_rate; v_source := 'organization'; END IF;
  END IF;

  IF v_resolved_rate IS NULL THEN
    v_authenticated := v_market_n >= v_auth_threshold;
    v_resolved_rate := CASE WHEN v_authenticated THEN v_sample_median ELSE v_spitball END;
    v_source        := CASE WHEN v_authenticated THEN 'market_estimate' ELSE 'spitball' END;
  ELSE v_authenticated := NULL; END IF;

  v_rate_conf := CASE
    WHEN v_source IN ('contract','user','organization') THEN 'reported'
    WHEN v_market_n >= v_auth_threshold THEN 'market'
    WHEN v_market_n >= 5 THEN 'spitball' ELSE 'spitball_no_data' END;

  RETURN jsonb_build_object(
    'rate', v_resolved_rate, 'source', v_source, 'rate_confidence', v_rate_conf,
    'is_estimated', v_source IN ('market_estimate','spitball'),
    'is_authenticated_market', COALESCE(v_authenticated, false),
    'is_user_reported', v_source IN ('contract','user','organization'),
    'contract_rate', v_contract_rate, 'user_rate', v_user_rate, 'org_rate', v_org_rate,
    'sample_median', v_sample_median, 'authenticated_sample_n', v_market_n,
    'authentication_threshold', v_auth_threshold,
    'note', CASE WHEN v_source = 'spitball'
      THEN format('~$%s is a spitball — only %s unverified shop rates, below the %s needed to state a market rate. Posted rate is widely resisted; the accepted/effective rate is likely lower.', v_resolved_rate, v_market_n, v_auth_threshold)
      ELSE NULL END);
END; $$;

\ir ../migrations/20261111122632_visual_work_master_cost_fold.sql

-- Restore a current synthetic card after the prior owners' withdrawal controls.
UPDATE vehicles SET deleted_at=NULL,is_public=true;
UPDATE vehicle_images SET is_sensitive=false;
UPDATE receipts SET vendor_name='Classic Industries' WHERE id='60000000-0000-0000-0000-000000000001';
UPDATE receipt_items SET part_number='TEST-1',description='Replacement bracket' WHERE id='70000000-0000-0000-0000-000000000001';
UPDATE listing_page_snapshots SET success=true;
INSERT INTO storage.objects VALUES('catalog-images','receipt-products/'||repeat('b',64)||'.jpeg');
INSERT INTO vehicle_observations(id,vehicle_id,source_id,source_url,kind,confidence_score,extraction_method,structured_data)
VALUES('a5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
 'https://images.example/after.jpg','condition',.6,'synthetic_current_reading','{"image_id":"4abcdef1-0000-0000-0000-000000000002"}');
UPDATE vehicle_observations SET structured_data=jsonb_build_object(
 'contract','visual_work_v1','title','Front assembly','summary','The current source shows a completed assembly; estimates are conditional reconstruction.',
 'image_id','4abcdef1-0000-0000-0000-000000000002','visual_sources',jsonb_build_array(jsonb_build_object(
  'image_id','4abcdef1-0000-0000-0000-000000000002','source_url','https://images.example/after.jpg','role','after','caption','Current assembly')),
 'gaps','[]'::jsonb,'receipt_links',jsonb_build_array(jsonb_build_object(
  'receipt_id','60000000-0000-0000-0000-000000000001','item_id','70000000-0000-0000-0000-000000000001',
  'link_id','80000000-0000-0000-0000-000000000001','source_table','vehicle_documents','source_id','50000000-0000-0000-0000-000000000001',
  'source_url','https://private.example/original.pdf','relation','candidate_material','description','Replacement bracket','part_number','TEST-1')),
 'estimate_basis',jsonb_build_object('version',1,'scenario','reconstruct_observed','method','synthetic_scenario_v1',
  'derivation','One conditional reconstruction of the current appearance; no elapsed time inference.'),
 'rate_basis',jsonb_build_object('kind','explicit_assumption','rate',160,'currency','USD','derivation','Explicit scenario rate, not a provider quote.'),
 'operations',jsonb_build_array(jsonb_build_object('physical_operation_key','front.rebuild','system_key','suspension','label','Rebuild front assembly',
  'source_observation_ids',jsonb_build_array('a5000000-0000-0000-0000-000000000001'),
  'quantity',jsonb_build_object('value',1,'unit','assembly','basis','explicit_assumption','derivation','One assembly in this scenario.'),
  'reference',jsonb_build_object('type','labor_operation','code','MECH-SUSPENSION-FRONT'),
  'evidence_role','conditional_reconstruction','shared_access',false)),
 'materials',jsonb_build_array(jsonb_build_object('physical_material_key','front.brackets','system_key','suspension','label','Two replacement brackets',
  'source_observation_ids',jsonb_build_array('a5000000-0000-0000-0000-000000000001'),
  'quantity',jsonb_build_object('value',2,'unit','each','basis','explicit_assumption','derivation','Two brackets assumed by the scenario.'),
  'pricing',jsonb_build_object('kind','catalog','receipt_item_id','70000000-0000-0000-0000-000000000001'))))
WHERE id='a0000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE baseline_packet AS SELECT structured_data packet FROM vehicle_observations WHERE id='a0000000-0000-0000-0000-000000000001';
INSERT INTO vehicle_observations(id,vehicle_id,source_id,source_url,kind,confidence_score,extraction_method,structured_data)
SELECT 'a0000000-0000-0000-0000-000000000003',vehicle_id,source_id,source_url,kind,confidence_score,extraction_method,structured_data
FROM vehicle_observations WHERE id='a0000000-0000-0000-0000-000000000001';

DO $$ DECLARE j jsonb; s jsonb; r jsonb; v uuid:='10000000-0000-0000-0000-000000000001'; BEGIN
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 ASSERT NOT has_function_privilege('anon','visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)','EXECUTE');
 j:=vehicle_build_log_public(v,false); s:=j#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{coverage,lines}'='2' AND s#>>'{coverage,duplicate_claims_folded}'='2',j::text;
 ASSERT s#>>'{totals,hours,typical}'='8' AND (s#>>'{totals,currencies,0,cost,typical}')::numeric=1380,j::text;
 ASSERT (s#>>'{totals,labor_currencies,0,cost,typical}')::numeric=1280
  AND (s#>>'{totals,material_currencies,0,cost,typical}')::numeric=100,j::text;
 ASSERT s#>>'{rows,0,formula}'='1 assembly × (8 / 8 / 8) person-hours per assembly × 160 USD/person-hour';
 ASSERT s#>'{rows,0,reference,hours_per_unit}'='{"min":8,"typical":8,"max":8}';
 ASSERT s#>>'{rows,1,formula}'='2 each × (50 / 50 / 50) USD per each';
 ASSERT s#>>'{rows,1,evidence_role}'='conditional_reconstruction';
 ASSERT s#>'{systems,0,totals}'=s->'totals','System and whole-vehicle folds agree';
 ASSERT jsonb_array_length(s#>'{rows,0,work_observation_ids}')=2 AND s#>>'{rows,0,claim_count}'='2';
 ASSERT j#>'{visual_work,0,receipts,0,amount}'='null' AND j#>>'{master_ledger,documented_charges,status}'='separate_not_added';
 ASSERT j#>>'{master_ledger,current_component_value,status}'='not_estimated';
 ASSERT (SELECT count(*) FROM observation_witnesses WHERE observation_id IN
  ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003','a5000000-0000-0000-0000-000000000001'))=3;
 -- Same physical key, disagreeing quantity: withhold this operation, not add it.
 UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{operations,0,quantity,value}','2')
 WHERE id='a0000000-0000-0000-0000-000000000003';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{rows,0,status}'='unresolved' AND s#>'{rows,0,reasons}' ? 'conflicting_physical_key',s::text;
 ASSERT (s#>>'{totals,currencies,0,cost,typical}')::numeric=100 AND s#>'{totals,hours}'='null',s::text;
 UPDATE vehicle_observations SET structured_data=(SELECT packet FROM baseline_packet) WHERE id='a0000000-0000-0000-0000-000000000003';
 -- Canonical basis withdrawal preserves the card, but not the estimate.
 UPDATE vehicle_observations SET is_superseded=true WHERE id='a5000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{totals,currencies}'='[]' AND s#>'{totals,hours}'='null',s::text;
 ASSERT s#>>'{coverage,unresolved_lines}'='2';
 UPDATE vehicle_observations SET is_superseded=false WHERE id='a5000000-0000-0000-0000-000000000001';
 UPDATE vehicle_images SET is_sensitive=true WHERE image_url='https://images.example/after.jpg';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger'),'Privacy withdrawal also withdraws folded cost';
 UPDATE vehicle_images SET is_sensitive=false;
 UPDATE vehicles SET is_public=false;
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 PERFORM set_config('test.role','authenticated',false); PERFORM set_config('test.uid','20000000-0000-0000-0000-000000000001',false);
 ASSERT vehicle_build_log_public(v,false)#>>'{master_ledger,scenarios,0,coverage,resolved_lines}'='2';
 UPDATE vehicles SET deleted_at=now();
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicles SET deleted_at=NULL,is_public=true;
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 RAISE NOTICE 'master cost: actual public-reader path, witnessed inputs, whole-car dedup/conflict, private charges and source/parent withdrawal pass';
END $$;

DO $$ DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; p jsonb; op jsonb; j jsonb; s jsonb; BEGIN
 SELECT packet INTO p FROM baseline_packet; op:=p#>'{operations,0}';
 UPDATE vehicle_observations SET is_superseded=true WHERE id='a0000000-0000-0000-0000-000000000003';
 -- Broad and child alternatives require an explicit, exclusive selection.
 UPDATE vehicle_observations SET structured_data=p||jsonb_build_object('materials','[]'::jsonb,'operations',jsonb_build_array(
  op||'{"physical_operation_key":"front.broad","overlap_group":"front.scope"}',
  op||'{"physical_operation_key":"front.child","overlap_group":"front.scope"}'))
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{totals,currencies}'='[]' AND s#>>'{coverage,unresolved_lines}'='2',s::text;
 UPDATE vehicle_observations SET structured_data=jsonb_set(jsonb_set(structured_data,'{operations,0,selected}','true'),'{operations,1,selected}','false')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT (s#>>'{totals,currencies,0,cost,typical}')::numeric=1280 AND s#>>'{coverage,excluded_lines}'='1',s::text;
 -- Separate additive access appears in two cards but is charged once.
 UPDATE vehicle_observations SET structured_data=structured_data||jsonb_build_object('operations',(structured_data->'operations')||jsonb_build_array(
  op||'{"physical_operation_key":"front.access","shared_access":true}')) WHERE id='a0000000-0000-0000-0000-000000000001';
 UPDATE vehicle_observations SET is_superseded=false,structured_data=p||jsonb_build_object('materials','[]'::jsonb,
  'operations',jsonb_build_array(op||'{"physical_operation_key":"front.access","shared_access":true}'))
 WHERE id='a0000000-0000-0000-0000-000000000003';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{totals,hours,typical}'='16' AND s#>>'{coverage,duplicate_claims_folded}'='1',s::text;
 -- A reference year outside applicability remains missing, not a zero cost.
 UPDATE vehicles SET year=2025;
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{totals,currencies}'='[]',s::text;
 UPDATE vehicles SET year=1973;
 UPDATE vehicle_observations SET is_superseded=true WHERE id='a0000000-0000-0000-0000-000000000003';
 UPDATE vehicle_observations SET structured_data=p||'{"materials":[]}' WHERE id='a0000000-0000-0000-0000-000000000001';
 -- Current appearance permits conditional reconstruction, never an observed transition.
 UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{operations,0,evidence_role}','"observed_transition"')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{rows,0,reasons}' ? 'observed_transition_needs_before_and_after';
 ASSERT s#>'{totals,hours}'='null';
 -- Missing explicit quantity does not default to one.
 UPDATE vehicle_observations SET structured_data=jsonb_set(p||'{"materials":[]}','{operations,0,quantity,value}','null')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{rows,0,reasons}' ? 'quantity_unresolved' AND s#>'{totals,currencies}'='[]';
 -- Default rate retains its source; currency must be a separate explicit assumption.
 UPDATE vehicle_observations SET structured_data=p||'{"materials":[],"rate_basis":{"kind":"resolved_default"}}'
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{rows,0,rate_basis,source}'='spitball' AND s#>>'{rows,0,status}'='partial';
 ASSERT s#>>'{totals,hours,typical}'='8' AND s#>'{totals,currencies}'='[]';
 UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{rate_basis}',
  '{"kind":"resolved_default","currency":"USD","derivation":"Explicit currency assumption for this scenario"}')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 ASSERT (vehicle_build_log_public(v,false)#>>'{master_ledger,scenarios,0,totals,currencies,0,cost,typical}')::numeric=1280;
 -- Reported private money is never accepted without a numeric source binding.
 UPDATE vehicle_observations SET structured_data=p||'{"materials":[],"rate_basis":{"kind":"reported","rate":777,"currency":"USD"}}'
 WHERE id='a0000000-0000-0000-0000-000000000001';
 j:=vehicle_build_log_public(v,false);
 ASSERT j#>'{master_ledger,scenarios,0,rows,0,rate_basis}'='{"kind":"reported","status":"unresolved"}'::jsonb
 AND NOT jsonb_path_exists(j,'$.** ? (@ == 777 || @ == "777")')
 AND j#>'{master_ledger,scenarios,0,rows,0,reasons}' ? 'private_rate_withheld';
 RAISE NOTICE 'master cost: overlap alternatives, additive shared access, year applicability, transition role, quantities and rate provenance pass';
END $$;

DO $$ DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; p jsonb; op jsonb; j jsonb; s jsonb; BEGIN
 SELECT packet INTO p FROM baseline_packet; op:=p#>'{operations,0}';
 UPDATE vehicle_observations SET structured_data=p WHERE id='a0000000-0000-0000-0000-000000000001';
 INSERT INTO vehicle_observations(id,vehicle_id,source_id,source_url,kind,confidence_score,extraction_method,structured_data)
 SELECT 'a0000000-0000-0000-0000-000000000004',vehicle_id,source_id,source_url,kind,confidence_score,extraction_method,
  p||jsonb_build_object('estimate_basis',jsonb_set(p->'estimate_basis','{scenario}','"finish_scenario"'),
   'materials','[]'::jsonb,'operations',jsonb_build_array(op||jsonb_build_object(
    'physical_operation_key','glass.finish','system_key','glass','evidence_role','conditional_finish',
    'reference',jsonb_build_object('type','analyst_range','hours',jsonb_build_object('min',2,'typical',3,'max',4),'derivation','Attributed explicit finishing scenario.'))))
 FROM vehicle_observations WHERE id='a0000000-0000-0000-0000-000000000001';
 j:=vehicle_build_log_public(v,false);
 ASSERT jsonb_array_length(j#>'{master_ledger,scenarios}')=2,j::text;
 ASSERT (j#>>'{master_ledger,scenarios,0,totals,currencies,0,cost,typical}')::numeric=1380;
 s:=j#>'{master_ledger,scenarios,1}';
 ASSERT s->>'scenario'='finish_scenario' AND s#>>'{totals,hours,min}'='2' AND s#>>'{totals,hours,max}'='4';
 ASSERT (s#>>'{totals,currencies,0,cost,typical}')::numeric=480 AND s#>>'{rows,0,reference,label}'='attributed_scenario_uncalibrated';
 ASSERT s#>'{rows,0,reference,hours}'='{"min":2,"typical":3,"max":4}'
  AND s#>'{rows,0,reference,hours_per_unit}'='{"min":2,"typical":3,"max":4}';
 ASSERT s#>>'{rows,0,formula}'='1 assembly × (2 / 3 / 4) person-hours per assembly × 160 USD/person-hour';
 -- A stale supplier quote is missing replacement price, not historical purchase money.
 UPDATE listing_page_snapshots SET fetched_at=now()-interval '8 days' WHERE id='a0000000-0000-0000-0000-000000000001';
 UPDATE catalog_parts SET application_data=jsonb_set(application_data,'{receipt_product_v1,captured_at}',to_jsonb((now()-interval '8 days')::text))
 WHERE part_number='TEST-1';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{coverage,unresolved_lines}'='1' AND (s#>>'{totals,currencies,0,cost,typical}')::numeric=1280,s::text;
 ASSERT s#>>'{coverage,status}'='partial';
 -- Source invalidation cannot be bypassed with an otherwise valid quote.
 UPDATE receipt_vehicle_links SET retired_at=now();
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{rows,1,status}'='unresolved' AND s#>'{rows,1,cost}'='null',s::text;
 UPDATE receipt_vehicle_links SET retired_at=NULL;
 -- Unknown source, malformed UUID, malformed range and unit all fail closed.
 UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{operations,0,source_observation_ids}','["not-a-uuid"]')
 WHERE id='a0000000-0000-0000-0000-000000000004';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,1}';
 ASSERT s#>'{rows,0,reasons}' ? 'source_unavailable' AND s#>'{totals,currencies}'='[]';
 ASSERT s#>'{rows,0,source_observation_ids}'='[]';
 RAISE NOTICE 'master cost: scenario separation, attributed analyst ranges, stale/missing quote, partial totals and malformed source controls pass';
END $$;

DO $$ DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; p jsonb; op jsonb; mat jsonb; s jsonb; BEGIN
 SELECT packet INTO p FROM baseline_packet; op:=p#>'{operations,0}'; mat:=p#>'{materials,0}';
 UPDATE vehicle_observations SET is_superseded=true WHERE id='a0000000-0000-0000-0000-000000000004';
 -- An invalid range is unresolved; it never becomes a negative or averaged cost.
 UPDATE vehicle_observations SET structured_data=p||jsonb_build_object('materials','[]'::jsonb,
  'operations',jsonb_build_array(op||jsonb_build_object('reference',jsonb_build_object('type','analyst_range',
    'hours',jsonb_build_object('min',5,'typical',3,'max',4),'derivation','Invalid order control'))))
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{rows,0,reasons}' ? 'hours_range_invalid' AND s#>'{totals,hours}'='null';
 -- A documented zero scenario is zero; a separate missing price is still unknown.
 UPDATE vehicle_observations SET structured_data=p||jsonb_build_object('operations','[]'::jsonb,
  'materials',jsonb_build_array(
   mat||jsonb_build_object('physical_material_key','zero.control','pricing',jsonb_build_object('kind','analyst_range',
    'unit_price',jsonb_build_object('min',0,'typical',0,'max',0),'currency','USD','derivation','Explicit zero scenario control')),
   mat||jsonb_build_object('physical_material_key','unknown.control','pricing',jsonb_build_object('kind','unpriced')),
   mat||jsonb_build_object('physical_material_key','eur.control','pricing',jsonb_build_object('kind','analyst_range',
    'unit_price',jsonb_build_object('min',2,'typical',3,'max',4),'currency','EUR','derivation','Explicit independent currency control'))))
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT jsonb_array_length(s#>'{totals,currencies}')=2 AND s#>>'{coverage,unresolved_lines}'='1';
 ASSERT s#>>'{totals,currencies,0,currency}'='EUR' AND (s#>>'{totals,currencies,0,cost,typical}')::numeric=6;
 ASSERT s#>>'{totals,currencies,1,currency}'='USD' AND (s#>>'{totals,currencies,1,cost,typical}')::numeric=0;
 ASSERT s#>>'{coverage,status}'='partial' AND s#>'{totals,hours}'='null';
 -- URL replacement invalidates source-backed readings even when IDs still agree.
 UPDATE vehicle_images SET image_url='https://images.example/replaced.jpg' WHERE image_url='https://images.example/after.jpg';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_images SET image_url='https://images.example/after.jpg' WHERE image_url='https://images.example/replaced.jpg';
 RAISE NOTICE 'master cost: invalid ranges, known zero versus unknown, separate currencies and URL withdrawal pass';
END $$;

-- A photographed restoration page can support a conditional reconstruction,
-- with its existing reviewed reading. It cannot become a physical transition.
INSERT INTO vehicle_images(id,vehicle_id,image_url,taken_at,vision_gate_status,is_document,redaction_level,ai_scan_metadata)
VALUES('4abcdef2-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',
 'https://images.example/restoration-page.jpg','2026-11-01T12:00:00Z','approved',false,'none',
 '{"byok_deep_analysis":{"scene_type":"cross_reference"}}');
INSERT INTO vehicle_observations(id,vehicle_id,source_id,source_url,kind,confidence_score,extraction_method,structured_data)
VALUES('a5000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
 'https://images.example/restoration-page.jpg','condition',.6,'reviewed_image_analysis_v1',
 '{"image_id":"4abcdef2-0000-0000-0000-000000000003","scene_type":"cross_reference"}');
DO $$ DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; p jsonb; c jsonb; j jsonb; s jsonb; BEGIN
 SELECT packet INTO p FROM baseline_packet;
 c:=jsonb_build_object('image_id','4abcdef2-0000-0000-0000-000000000003','source_url','https://images.example/restoration-page.jpg',
  'source_observation_id','a5000000-0000-0000-0000-000000000002','role','context','caption','Photograph of a retained restoration page; work date is unknown.');
 p:=jsonb_set(p,'{visual_sources}',(p->'visual_sources')||jsonb_build_array(c));
 p:=jsonb_set(p,'{operations,0,source_observation_ids}','["a5000000-0000-0000-0000-000000000002"]');
 p:=jsonb_set(p,'{materials,0,source_observation_ids}','["a5000000-0000-0000-0000-000000000002"]');
 UPDATE vehicle_observations SET structured_data=p WHERE id='a0000000-0000-0000-0000-000000000001';
 j:=vehicle_build_log_public(v,false); s:=j#>'{master_ledger,scenarios,0}';
 ASSERT jsonb_array_length(j->'visual_work')=1 AND s#>>'{rows,0,status}'='resolved',j::text;
 ASSERT j#>>'{visual_work,0,images,1,role}'='context'
  AND j#>>'{visual_work,0,images,1,source_observation_id}'='a5000000-0000-0000-0000-000000000002';
 ASSERT j#>>'{visual_work,0,images,1,date_role}'='source_capture_not_work_date'
  AND j#>'{visual_work,0,effort_reference}'='null';
 ASSERT NOT receipt_work_frame_eligible((SELECT i FROM vehicle_images i WHERE id='4abcdef2-0000-0000-0000-000000000003')),
  'The general receipt/work eligibility owner is unchanged';
 -- The same packet cannot use the context frame as before/after or observed work.
 UPDATE vehicle_observations SET structured_data=jsonb_set(p,'{operations,0,evidence_role}','"observed_transition"')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_observations SET structured_data=jsonb_set(p,'{visual_sources,1,role}','"before"')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 -- Context-only is insufficient even when its own canonical witness is present.
 UPDATE vehicle_observations SET source_url='https://images.example/restoration-page.jpg',
  structured_data=jsonb_set(jsonb_set(p,'{visual_sources}',jsonb_build_array(c)),'{image_id}',c->'image_id')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 INSERT INTO observation_witnesses(observation_id,image_id,witness_role) VALUES
  ('a0000000-0000-0000-0000-000000000001','4abcdef2-0000-0000-0000-000000000003','derived');
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_observations SET source_url='https://images.example/after.jpg',structured_data=p
 WHERE id='a0000000-0000-0000-0000-000000000001';
 -- The explicit cost contract and existing reviewed producer are both required.
 UPDATE vehicle_observations SET structured_data=p-'estimate_basis' WHERE id='a0000000-0000-0000-0000-000000000001';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_observations SET structured_data=p WHERE id='a0000000-0000-0000-0000-000000000001';
 UPDATE vehicle_observations SET extraction_method='uncited_control' WHERE id='a5000000-0000-0000-0000-000000000002';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_observations SET extraction_method='reviewed_image_analysis_v1',is_superseded=true WHERE id='a5000000-0000-0000-0000-000000000002';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_observations SET is_superseded=false,source_url='https://images.example/old-page.jpg' WHERE id='a5000000-0000-0000-0000-000000000002';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_observations SET source_url='https://images.example/restoration-page.jpg' WHERE id='a5000000-0000-0000-0000-000000000002';
 UPDATE observation_witnesses SET witness_role='other' WHERE observation_id='a5000000-0000-0000-0000-000000000002';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE observation_witnesses SET witness_role='derived' WHERE observation_id='a5000000-0000-0000-0000-000000000002';
 UPDATE vehicle_images SET is_sensitive=true WHERE id='4abcdef2-0000-0000-0000-000000000003';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_images SET is_sensitive=false,redaction_level='full' WHERE id='4abcdef2-0000-0000-0000-000000000003';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_images SET redaction_level='none',is_duplicate=true WHERE id='4abcdef2-0000-0000-0000-000000000003';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_images SET is_duplicate=false,is_superseded=true WHERE id='4abcdef2-0000-0000-0000-000000000003';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_images SET is_superseded=false,vehicle_id=NULL WHERE id='4abcdef2-0000-0000-0000-000000000003';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_images SET vehicle_id=v,image_url='https://images.example/new-page.jpg' WHERE id='4abcdef2-0000-0000-0000-000000000003';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_images SET image_url='https://images.example/restoration-page.jpg' WHERE id='4abcdef2-0000-0000-0000-000000000003';
 UPDATE vehicles SET is_public=false;
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicles SET is_public=true;
 ASSERT vehicle_build_log_public(v,false)#>>'{master_ledger,scenarios,0,rows,0,status}'='resolved';
 RAISE NOTICE 'master cost: canonical binder context, physical anchor, no transition/time promotion, source and privacy withdrawal pass';
END $$;

DO $$ DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; p jsonb; op jsonb; s jsonb; BEGIN
 SELECT packet INTO p FROM baseline_packet; op:=p#>'{operations,0}';
 -- The undecided broad option must not become selected when its unselected
 -- sibling's source is withdrawn. This was previously bypassed by group n=1.
 UPDATE vehicle_observations SET structured_data=p||jsonb_build_object('materials','[]'::jsonb,'operations',jsonb_build_array(
  op||'{"physical_operation_key":"withdrawal.broad","overlap_group":"withdrawal.scope"}'))
 WHERE id='a0000000-0000-0000-0000-000000000001';
 UPDATE vehicle_observations SET is_superseded=false,structured_data=p||jsonb_build_object('materials','[]'::jsonb,'operations',jsonb_build_array(
  op||'{"physical_operation_key":"withdrawal.child","overlap_group":"withdrawal.scope","selected":false}'))
 WHERE id='a0000000-0000-0000-0000-000000000003';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{totals,currencies}'='[]' AND s#>>'{coverage,unresolved_lines}'='2';
 UPDATE vehicle_observations SET is_superseded=true WHERE id='a0000000-0000-0000-0000-000000000003';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{totals,currencies}'='[]' AND s#>>'{coverage,unresolved_lines}'='1';
 ASSERT s#>'{rows,0,reasons}' ? 'overlap_selection_unresolved';
 UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{operations,0,selected}','true')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT (s#>>'{totals,currencies,0,cost,typical}')::numeric=1280;
 RAISE NOTICE 'master cost: withdrawn overlap sibling cannot select the sole survivor or increase subtotal';
END $$;

INSERT INTO vehicle_images(id,vehicle_id,image_url,taken_at,vision_gate_status,exif_data)
VALUES('4abcdef3-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',
 'https://images.example/separate-line-witness.jpg','2025-10-01T23:45:00Z','approved',
 '{"capture_time_zone":"America/Los_Angeles","capture_time_basis":"Retained source clock"}');
INSERT INTO vehicle_observations(id,vehicle_id,source_id,source_url,kind,confidence_score,extraction_method,structured_data)
VALUES('a5000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
 'https://images.example/separate-line-witness.jpg','condition',.6,'synthetic_current_reading',
 '{"image_id":"4abcdef3-0000-0000-0000-000000000004","agent_notes":"PRIVATE CONTEXT MUST NOT BECOME A PHOTO CAPTION"}'),
 ('a5000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
 'https://images.example/separate-line-witness.jpg','condition',.6,'synthetic_current_reading',
 '{"image_id":"4abcdef3-0000-0000-0000-000000000004"}');
CREATE TEMP TABLE retained_test_witness AS SELECT * FROM observation_witnesses WHERE observation_id='a5000000-0000-0000-0000-000000000003';
DO $$ DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; p jsonb; s jsonb; j jsonb; BEGIN
 SELECT packet INTO p FROM baseline_packet;
 p:=jsonb_set(p||'{"materials":[]}','{operations,0,source_observation_ids}','["a5000000-0000-0000-0000-000000000003"]');
 UPDATE vehicle_observations SET structured_data=p WHERE id='a0000000-0000-0000-0000-000000000001';
 j:=vehicle_build_log_public(v,false);s:=j#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{rows,0,status}'='resolved' AND jsonb_array_length(s#>'{rows,0,source_images}')=1;
 ASSERT s#>>'{rows,0,source_images,0,image_id}'='4abcdef3-0000-0000-0000-000000000004'
  AND j#>>'{visual_work,0,images,0,image_id}'='4abcdef1-0000-0000-0000-000000000002';
 ASSERT s#>>'{rows,0,source_images,0,image_url}'='https://images.example/separate-line-witness.jpg'
  AND s#>>'{rows,0,source_images,0,role}'='source' AND s#>>'{rows,0,source_images,0,caption}'='Cited source photograph';
 ASSERT s#>>'{rows,0,source_images,0,capture_time_zone}'='America/Los_Angeles'
  AND s#>>'{rows,0,source_images,0,date_role}'='source_capture_not_work_date' AND s::text NOT LIKE '%PRIVATE CONTEXT%';
 -- Different witnesses/timestamps are evidence unions, never numeric conflicts.
 UPDATE vehicle_observations SET is_superseded=false,structured_data=(SELECT packet||'{"materials":[]}' FROM baseline_packet)
 WHERE id='a0000000-0000-0000-0000-000000000003';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{rows,0,status}'='resolved' AND s#>>'{rows,0,claim_count}'='2'
  AND jsonb_array_length(s#>'{rows,0,source_images}')=2 AND (s#>>'{totals,currencies,0,cost,typical}')::numeric=1280;
 -- Two readings of one image retain both citation IDs but show one photograph.
 UPDATE vehicle_observations SET structured_data=jsonb_set(p,'{operations,0,source_observation_ids}','["a5000000-0000-0000-0000-000000000004"]')
 WHERE id='a0000000-0000-0000-0000-000000000003';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{rows,0,status}'='resolved' AND jsonb_array_length(s#>'{rows,0,source_images}')=1
  AND jsonb_array_length(s#>'{rows,0,source_images,0,source_observation_ids}')=2;
 UPDATE vehicle_observations SET is_superseded=true WHERE id='a0000000-0000-0000-0000-000000000003';
 -- Source withdrawal withholds both the cost and the actual cited photograph.
 UPDATE vehicle_images SET is_sensitive=true WHERE id='4abcdef3-0000-0000-0000-000000000004';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{rows,0,status}'='unresolved' AND s#>'{rows,0,source_images}'='[]' AND s#>'{rows,0,cost}'='null';
 UPDATE vehicle_images SET is_sensitive=false,image_url='https://images.example/replaced-line-witness.jpg' WHERE id='4abcdef3-0000-0000-0000-000000000004';
 ASSERT vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0,rows,0,source_images}'='[]';
 UPDATE vehicle_images SET image_url='https://images.example/separate-line-witness.jpg' WHERE id='4abcdef3-0000-0000-0000-000000000004';
 UPDATE vehicle_observations SET is_superseded=true WHERE id='a5000000-0000-0000-0000-000000000003';
 ASSERT vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0,rows,0,source_images}'='[]';
 UPDATE vehicle_observations SET is_superseded=false WHERE id='a5000000-0000-0000-0000-000000000003';
 DELETE FROM observation_witnesses WHERE observation_id='a5000000-0000-0000-0000-000000000003';
 ASSERT vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0,rows,0,source_images}'='[]';
 INSERT INTO observation_witnesses SELECT * FROM retained_test_witness;
 UPDATE vehicle_images SET ai_scan_metadata='{"byok_deep_analysis":{"scene_type":"receipt_document"}}'
 WHERE id='4abcdef3-0000-0000-0000-000000000004';
 ASSERT vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0,rows,0,source_images}'='[]',
  'An out-of-card document does not bypass the scoped context contract';
 UPDATE vehicle_images SET ai_scan_metadata=NULL WHERE id='4abcdef3-0000-0000-0000-000000000004';
 ASSERT vehicle_build_log_public(v,false)#>>'{master_ledger,scenarios,0,rows,0,status}'='resolved';
 RAISE NOTICE 'master cost: exact out-of-card source photos, witness union, no numeric conflict and current-source withdrawal pass';
END $$;
