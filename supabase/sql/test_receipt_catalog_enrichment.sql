-- Empty local synthetic fixtures only. Real work reader and current day reader.
\set ON_ERROR_STOP on
\ir test_visual_work_build_log.sql
UPDATE vehicles SET deleted_at=NULL,is_public=true;
ALTER TABLE receipts ADD user_id uuid,ADD created_by uuid,ADD vendor_address text,ADD invoice_number text,ADD document_kind text,ADD raw_json jsonb,
 ADD file_url text,ADD subtotal numeric,ADD tax numeric,ADD total numeric,ADD payment_method text;
ALTER TABLE receipt_items ADD unit_price numeric,ADD line_date date,ADD performer text;
ALTER TABLE receipt_vehicle_links ADD page_date_source text,ADD basis text,ADD confidence numeric;
ALTER TABLE vehicle_images ADD apple_ml_labels text[];
CREATE TABLE organizations(id uuid PRIMARY KEY,name text,logo_url text,website text,is_public boolean);
CREATE TABLE supply_vendors(vendor_slug text PRIMARY KEY,organization_id uuid);
CREATE TABLE supply_vendor_aliases(alias_key text,vendor_slug text);
CREATE FUNCTION supply_vendor_key(text) RETURNS text LANGUAGE sql AS $$ SELECT lower($1) $$;
CREATE FUNCTION receipt_line_photo_zone(text) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION receipt_zone_labels(text) RETURNS text[] LANGUAGE sql AS $$ SELECT '{}'::text[] $$;
CREATE FUNCTION jsonb_mask_money(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j) WHEN 'object' THEN coalesce((SELECT jsonb_object_agg(k,CASE WHEN k=ANY(ARRAY['price','amount','unit_price','subtotal','total','tax','shipping','discount']) THEN 'null'::jsonb ELSE jsonb_mask_money(v) END) FROM jsonb_each(j) e(k,v)),'{}')
 WHEN 'array' THEN coalesce((SELECT jsonb_agg(jsonb_mask_money(v)) FROM jsonb_array_elements(j) e(v)),'[]') ELSE j END $$;
CREATE FUNCTION jsonb_mask_keys(j jsonb,p_keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(j) WHEN 'object' THEN coalesce((SELECT jsonb_object_agg(k,CASE WHEN k=ANY(p_keys) THEN 'null'::jsonb ELSE jsonb_mask_keys(v,p_keys) END) FROM jsonb_each(j) e(k,v)),'{}')
 WHEN 'array' THEN coalesce((SELECT jsonb_agg(jsonb_mask_keys(v,p_keys)) FROM jsonb_array_elements(j) e(v)),'[]') ELSE j END $$;
\ir fixtures/receipt_catalog_day_reader.sql
CREATE TYPE observation_kind AS ENUM ('work_record');
CREATE TABLE observation_extractors(source_id uuid,slug text UNIQUE,display_name text,extractor_type text,edge_function_name text,extractor_config jsonb,produces_kinds observation_kind[],is_active boolean,schedule_type text,rate_limit_per_hour int,min_interval_seconds int);
INSERT INTO observation_sources VALUES(gen_random_uuid(),'receipt-scan');
CREATE TABLE derivation_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,evidence_type text,evidence_id uuid,extractor_slug text,requested_by text,request_note text,status text,priority int,attempts int DEFAULT 0,max_attempts int DEFAULT 3,next_attempt_at timestamptz DEFAULT now(),locked_at timestamptz,locked_by text,completed_at timestamptz,error_message text,created_at timestamptz DEFAULT now(),UNIQUE(evidence_type,evidence_id,extractor_slug));
CREATE FUNCTION claim_derivation_work(p_worker text,p_batch_size integer DEFAULT 5,p_user_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,user_id uuid,evidence_type text,evidence_id uuid,extractor_slug text,attempts integer,request_note text)
LANGUAGE sql AS $$
 WITH picked AS (SELECT q.id FROM public.derivation_queue q WHERE q.status='pending'
 AND q.evidence_type<>'listing_page_snapshot' AND q.next_attempt_at<=now() AND q.attempts<q.max_attempts
 AND (p_user_id IS NULL OR q.user_id=p_user_id) ORDER BY q.priority,q.created_at LIMIT p_batch_size FOR UPDATE SKIP LOCKED)
 UPDATE public.derivation_queue q SET status='claimed',locked_at=now(),locked_by=p_worker,attempts=q.attempts+1
 FROM picked WHERE q.id=picked.id RETURNING q.id,q.user_id,q.evidence_type,q.evidence_id,q.extractor_slug,q.attempts,q.request_note;
$$;
CREATE TABLE listing_page_snapshots(id uuid PRIMARY KEY,listing_url text,html_sha256 text,http_status int,success boolean,fetched_at timestamptz);
CREATE TABLE catalog_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,provider text,base_url text,created_at timestamptz DEFAULT now());
CREATE TABLE catalog_parts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),catalog_id uuid,part_number text,name text,manufacturer text,description text,product_image_url text,supplier_url text,price_current numeric,currency text,application_data jsonb,created_at timestamptz,updated_at timestamptz);
CREATE SCHEMA storage;
CREATE TABLE storage.objects(bucket_id text,name text);
CREATE FUNCTION get_service_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://fixture.supabase.co' $$;
CREATE TABLE firecrawl_source_params(source text PRIMARY KEY,firecrawl_dependent boolean,credits_per_lot numeric,cost_basis text,supply_kind text,event_platforms text[],observed_on date,snapshot_platforms text[],hosts text[],cap_note text,paused jsonb);
CREATE TABLE firecrawl_spend_log(credits numeric,spent_at timestamptz,historical boolean);
CREATE FUNCTION firecrawl_param(text,numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT CASE $1 WHEN 'monthly_credits' THEN 1000 WHEN 'reserve_fraction' THEN .15 ELSE $2 END $$;
CREATE FUNCTION firecrawl_allowance(p_source text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE v_start date:=date_trunc('month',current_date)::date;v_end date;v_spent_today numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM firecrawl_source_params WHERE source=p_source AND paused IS NOT NULL) THEN RETURN 0;END IF;
 v_end := (v_start + interval '1 month')::date;
 RETURN 5;
END $$;
\ir ../migrations/20261113150000_receipt_catalog_enrichment.sql
\ir ../migrations/20261113151000_receipt_catalog_primary_identity.sql

DO $$ DECLARE r uuid:='60000000-0000-0000-0000-000000000001'; i uuid:='70000000-0000-0000-0000-000000000001';q uuid;g bigint;c jsonb;p uuid;j jsonb;BEGIN
 UPDATE receipts SET user_id='20000000-0000-0000-0000-000000000001',vendor_name='Classic Industries',total=420 WHERE id=r;
 UPDATE receipt_items SET part_number='*TEST-1',description='Test part' WHERE id=i;
 SELECT id,product_generation INTO q,g FROM derivation_queue WHERE evidence_id=r;
 ASSERT q IS NOT NULL AND (SELECT count(*)=1 FROM derivation_queue),'one deduplicated request per receipt';
 ASSERT NOT receipt_product_eligible('CORE','Core charge') AND NOT receipt_product_eligible(NULL,'Labor') AND NOT receipt_product_eligible('S/H','Shipping');
 ASSERT receipt_product_eligible('TEST-1','Return item'),'returns are product references, never installation';
 ASSERT receipt_product_supplier('O’Reilly Auto Parts (Store 1532)')='oreilly';
 PERFORM claim_derivation_work('worker',1,NULL);
 UPDATE receipt_items SET description='Corrected part' WHERE id=i;
 ASSERT finish_receipt_products(q,'worker',g,'{"items":{}}',true,60)='pending','a concurrent correction prevents old completion';
 PERFORM claim_derivation_work('worker2',1,NULL);
 SELECT product_generation INTO g FROM derivation_queue WHERE id=q;
 BEGIN PERFORM finish_receipt_products(q,'worker',g,'{}',true,0);RAISE EXCEPTION 'old lease accepted'; EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Receipt catalog lease lost';END;
 ASSERT finish_receipt_products(q,'worker2',g,'{"items":{}}',false,3600)='pending';
 ASSERT (SELECT attempts=0 AND next_attempt_at>now()+interval '59 minutes' FROM derivation_queue WHERE id=q),'refusal retries without exhausting claims';
 UPDATE derivation_queue SET status='claimed',locked_at=now()-interval '20 minutes',locked_by='dead' WHERE id=q;
 PERFORM claim_derivation_work('recovery',1,NULL);
 ASSERT (SELECT status='pending' AND locked_by IS NULL FROM derivation_queue WHERE id=q),'stale lease recovered';
 INSERT INTO listing_page_snapshots VALUES('a0000000-0000-0000-0000-000000000001','https://www.oerparts.com/product/test-1.html',repeat('a',64),200,true,now());
 INSERT INTO storage.objects VALUES('catalog-images','receipt-products/'||repeat('b',64)||'.jpeg');
 c:=jsonb_build_object('source_role','catalog_cross_reference','match_basis','exact_primary_catalog_sku; installation_not_asserted','parser','receipt_product_page_v1','printed_sku','TEST-1','name','Public test product','snapshot_id','a0000000-0000-0000-0000-000000000001','page_sha256',repeat('a',64),'image_sha256',repeat('b',64),'page_url','https://www.oerparts.com/product/test-1.html','image_url',get_service_url()||'/storage/v1/object/public/catalog-images/receipt-products/'||repeat('b',64)||'.jpeg','image_source_url','https://cdn.oerparts.com/assets/test.jpeg','image_storage_path','receipt-products/'||repeat('b',64)||'.jpeg','price',50,'currency','USD','customer_name','PRIVATE NAME','receipt_amount',420,'receipt_id',r);
 p:=record_receipt_catalog_product('classic_industries','TEST-1',c);
 ASSERT p=record_receipt_catalog_product('classic_industries','*TEST-1',c),'idempotent capture';
 ASSERT (SELECT application_data::text NOT LIKE '%PRIVATE%' AND application_data::text NOT LIKE '%420%' AND application_data::text NOT LIKE '%'||r::text||'%' FROM catalog_parts WHERE id=p),'private context excluded';
 ASSERT receipt_item_product_card(i)->>'catalog_part_id'=p::text;
 BEGIN PERFORM record_receipt_catalog_product('classic_industries','WRONG',c);RAISE EXCEPTION 'wrong SKU accepted'; EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Invalid product capture';END;
 BEGIN PERFORM record_receipt_catalog_product('oreilly','TEST-1',c||jsonb_build_object('product_line_code','ORC'));RAISE EXCEPTION 'wrong supplier accepted'; EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Supplier source mismatch';END;
 PERFORM set_config('test.uid','',false);PERFORM set_config('test.role','anon',false);
 j:=get_vehicle_day_documents('10000000-0000-0000-0000-000000000001','2025-09-08');
 ASSERT j#>>'{documents,0,lines,0,product,name}'='Public test product',j::text;
 ASSERT j#>'{documents,0,lines,0,amount}'='null' AND j#>>'{documents,0,lines,0,product,quote_price}'='50','public quote and private purchase stay separate';
 UPDATE listing_page_snapshots SET success=false;
 ASSERT receipt_item_product_card(i) IS NULL,'source withdrawal removes catalog card';
 UPDATE listing_page_snapshots SET success=true;
 DELETE FROM storage.objects;
 ASSERT receipt_item_product_card(i) IS NULL,'missing stock bytes remove catalog card';
 ASSERT NOT has_function_privilege('anon','record_receipt_catalog_product(text,text,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','receipt_item_product_card(uuid)','EXECUTE');
 ASSERT firecrawl_allowance('receipt-products')=850 AND firecrawl_allowance('unrelated')=5;
 INSERT INTO firecrawl_spend_log VALUES(852,now(),false);
 ASSERT firecrawl_allowance('receipt-products')=0,'existing non-reserve account budget enforced';
 RAISE NOTICE 'receipt catalog: automatic intake, revision and lease fencing, recovery, exact identity, public quote, private masking and withdrawal pass';
END $$;

DO $$ DECLARE r uuid:='60000000-0000-0000-0000-000000000001'; i uuid:='70000000-0000-0000-0000-000000000001'; c jsonb; matched uuid; other uuid;BEGIN
 UPDATE receipts SET vendor_name='O''Reilly Auto Parts' WHERE id=r;
 UPDATE receipt_items SET part_number='55173',description='HOSE CLAMPS (MTM)' WHERE id=i;
 INSERT INTO listing_page_snapshots VALUES
 ('a0000000-0000-0000-0000-000000000002','https://www.oreillyauto.com/detail/c/dorman-help/hose-clamps/dag0/55173?q=55173',repeat('c',64),200,true,now()),
 ('a0000000-0000-0000-0000-000000000003','https://www.oreillyauto.com/detail/c/walker/exhaust/wal0/55173?q=55173',repeat('e',64),200,true,now());
 INSERT INTO storage.objects VALUES('catalog-images','receipt-products/'||repeat('d',64)||'.jpeg');
 c:=jsonb_build_object('source_role','original_receipt_supplier','match_basis','exact_primary_catalog_sku; installation_not_asserted','parser','receipt_product_page_v1','printed_sku','55173','name','Hose clamps','product_line_code','MTM','snapshot_id','a0000000-0000-0000-0000-000000000002','page_sha256',repeat('c',64),'image_sha256',repeat('d',64),'page_url','https://www.oreillyauto.com/detail/c/dorman-help/hose-clamps/dag0/55173?q=55173','image_url',get_service_url()||'/storage/v1/object/public/catalog-images/receipt-products/'||repeat('d',64)||'.jpeg','image_source_url','https://images-prod.oreillyauto.com/parts/clamps.jpg','image_storage_path','receipt-products/'||repeat('d',64)||'.jpeg');
 matched:=record_receipt_catalog_product('oreilly','55173',c);
 c:=c||jsonb_build_object('name','Wrong brand exhaust','product_line_code','WAL','snapshot_id','a0000000-0000-0000-0000-000000000003','page_sha256',repeat('e',64),'page_url','https://www.oreillyauto.com/detail/c/walker/exhaust/wal0/55173?q=55173');
 other:=record_receipt_catalog_product('oreilly','55173',c);
 ASSERT matched<>other AND receipt_item_product_card(i)->>'catalog_part_id'=matched::text,'same number on a different product line must not replace receipt product';
 ASSERT get_vehicle_day_documents('10000000-0000-0000-0000-000000000001','2025-09-08')#>>'{documents,0,lines,0,product,name}'='Hose clamps','actual public reader carries the right product';
 UPDATE receipt_items SET description='Without a printed brand code' WHERE id=i;
 ASSERT receipt_item_product_card(i) IS NULL,'no number-only brand guess';
 UPDATE receipt_items SET description='HOSE CLAMPS (MTM, warranty)' WHERE id=i;
 ASSERT receipt_item_product_card(i)->>'catalog_part_id'=matched::text,'comma-terminated receipt line code';
 UPDATE listing_page_snapshots SET success=false WHERE id='a0000000-0000-0000-0000-000000000002';
 ASSERT receipt_item_product_card(i) IS NULL,'withdrawal cannot fall back to another brand';
 BEGIN PERFORM record_receipt_catalog_product('oreilly','55173',c||jsonb_build_object('image_source_url','https://images-prod.oreillyauto.com.evil.test/clamps.jpg'));RAISE EXCEPTION 'unapproved CDN accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Invalid product capture'; END;
 RAISE NOTICE 'receipt catalog runtime: official CDN, product-line namespace, public reader and withdrawal pass';
END $$;
