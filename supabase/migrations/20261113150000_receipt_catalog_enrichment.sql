-- Receipt lines request catalog enrichment; existing derivation queue and catalog own it.
-- Public product testimony contains no receipt IDs, private amounts, names or addresses.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';

CREATE FUNCTION public.receipt_product_supplier(p_vendor text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN lower(btrim(p_vendor))='classic industries' THEN 'classic_industries'
 WHEN lower(btrim(p_vendor)) ~ '^o[''’]?reilly auto parts( *\(store [0-9]+\))?$' THEN 'oreilly'
 WHEN lower(btrim(p_vendor))='ames performance' THEN 'ames' END;
$$;
CREATE FUNCTION public.receipt_product_number(p_number text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT upper(regexp_replace(btrim(coalesce(p_number,'')),'^\*+','','g')) $$;
CREATE FUNCTION public.receipt_product_eligible(p_number text,p_description text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT length(public.receipt_product_number(p_number)) BETWEEN 1 AND 100
 AND public.receipt_product_number(p_number) !~ '[{}]'
 AND coalesce(p_description,'') !~* 'freight|shipping|handling|core (charge|return|exchange)';
$$;
ALTER TABLE public.derivation_queue ADD COLUMN product_result jsonb, ADD COLUMN product_generation bigint NOT NULL DEFAULT 0;
CREATE INDEX derivation_queue_receipt_product_leases ON public.derivation_queue(locked_at,id)
 WHERE extractor_slug='receipt-products-v1' AND status='claimed';
CREATE INDEX derivation_queue_receipt_product_due ON public.derivation_queue(priority,created_at,id,next_attempt_at)
 WHERE extractor_slug='receipt-products-v1' AND status='pending';
COMMENT ON COLUMN public.derivation_queue.product_result IS 'Receipt product worker outcomes keyed by item ID, input fingerprint and catalog capture. Private operational state, never expenses or installed-parts assertions.';

INSERT INTO public.observation_extractors(source_id,slug,display_name,extractor_type,edge_function_name,
 extractor_config,produces_kinds,is_active,schedule_type,rate_limit_per_hour,min_interval_seconds)
SELECT id,'receipt-products-v1','Receipt product catalog capture','edge_function','index-reference-document',
 '{"mode":"receipt_products","model_calls":0,"max_new_items_per_call":2}'::jsonb,
 '{}'::public.observation_kind[],true,'on_demand',30,600
FROM public.observation_sources WHERE slug='receipt-scan';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.observation_extractors WHERE slug='receipt-products-v1')
 THEN RAISE EXCEPTION 'Receipt source missing'; END IF; END $$;

CREATE FUNCTION public.enqueue_receipt_products(p_receipt uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.receipts%ROWTYPE; q uuid;
BEGIN
 SELECT * INTO r FROM public.receipts WHERE id=p_receipt;
 IF NOT FOUND OR r.is_superseded IS TRUE OR r.duplicate_of IS NOT NULL OR coalesce(r.user_id,r.created_by) IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.receipt_items WHERE receipt_id=r.id AND public.receipt_product_eligible(part_number,description)) THEN RETURN NULL; END IF;
 INSERT INTO public.derivation_queue(user_id,evidence_type,evidence_id,extractor_slug,requested_by,request_note,status,priority,max_attempts)
 VALUES(coalesce(r.user_id,r.created_by),'receipt',r.id,'receipt-products-v1','trigger','Receipt product source enrichment','pending',30,3)
 ON CONFLICT(evidence_type,evidence_id,extractor_slug) DO UPDATE SET
 user_id=EXCLUDED.user_id,status=CASE WHEN derivation_queue.status='claimed' THEN 'claimed' ELSE 'pending' END,
 attempts=CASE WHEN derivation_queue.status='claimed' THEN derivation_queue.attempts ELSE 0 END,
 next_attempt_at=now(),completed_at=NULL,product_generation=derivation_queue.product_generation+1
 RETURNING id INTO q;
 RETURN q;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_receipt_products(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_receipt_products(uuid) TO service_role;
CREATE FUNCTION public.receipt_product_enqueue_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_TABLE_NAME='receipts' THEN PERFORM public.enqueue_receipt_products(NEW.id);
 ELSIF TG_OP='DELETE' THEN PERFORM public.enqueue_receipt_products(OLD.receipt_id);
 ELSE PERFORM public.enqueue_receipt_products(NEW.receipt_id); END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER receipt_product_enqueue AFTER INSERT OR DELETE OR UPDATE OF part_number,description,receipt_id ON public.receipt_items
 FOR EACH ROW EXECUTE FUNCTION public.receipt_product_enqueue_trigger();
CREATE TRIGGER receipt_product_vendor_enqueue AFTER UPDATE OF vendor_name,is_superseded,duplicate_of,user_id,created_by ON public.receipts
 FOR EACH ROW EXECUTE FUNCTION public.receipt_product_enqueue_trigger();

-- A source edit during a capture invalidates completion; abandoned leases recover
-- through the existing drain. Supplier refusals retain reasons and retry clocks.
CREATE FUNCTION public.finish_receipt_products(p_id uuid,p_worker text,p_generation bigint,p_result jsonb,p_complete boolean,p_retry integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.derivation_queue%ROWTYPE; next_status text; BEGIN
 SELECT * INTO q FROM public.derivation_queue WHERE id=p_id AND extractor_slug='receipt-products-v1' FOR UPDATE;
 IF NOT FOUND OR q.status<>'claimed' OR q.locked_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'Receipt catalog lease lost'; END IF;
 IF p_result IS NOT NULL AND (jsonb_typeof(p_result)<>'object' OR octet_length(p_result::text)>500000) THEN RAISE EXCEPTION 'Invalid product result'; END IF;
 next_status:=CASE WHEN p_complete IS TRUE AND q.product_generation=p_generation
 AND NOT EXISTS(SELECT 1 FROM public.receipt_items i JOIN public.receipts r ON r.id=i.receipt_id
 WHERE r.id=q.evidence_id AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
 AND public.receipt_product_eligible(i.part_number,i.description) AND public.receipt_item_product_card(i.id) IS NULL)
 THEN 'done' ELSE 'pending' END;
 UPDATE public.derivation_queue SET status=next_status,locked_at=NULL,locked_by=NULL,attempts=0,
 product_result=coalesce(p_result,product_result),completed_at=CASE WHEN next_status='done' THEN now() END,
 error_message=CASE WHEN next_status='pending' THEN 'Receipt catalog enrichment incomplete; see product_result' END,
 next_attempt_at=now()+make_interval(secs=>CASE WHEN p_generation>=0 AND q.product_generation<>p_generation THEN 0 ELSE greatest(60,least(coalesce(p_retry,3600),604800)) END)
 WHERE id=p_id;
 RETURN next_status;
END $$;
REVOKE ALL ON FUNCTION public.finish_receipt_products(uuid,text,bigint,jsonb,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_receipt_products(uuid,text,bigint,jsonb,boolean,integer) TO service_role;

DO $$ DECLARE def text; anchor text:='WITH picked AS ('; BEGIN
 def:=pg_get_functiondef('public.claim_derivation_work(text,integer,uuid)'::regprocedure);
 IF (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Derivation claim anchor drift'; END IF;
 -- Recovery is scoped to this reader and runs before a subsequent tick can claim it.
 -- A data-modifying CTE does not make its updates visible to the same statement's pick.
 def:=replace(def,anchor,$patch$WITH recovered AS (
 UPDATE public.derivation_queue SET status='pending',locked_at=NULL,locked_by=NULL,attempts=0,next_attempt_at=now(),
 error_message='Receipt catalog worker lease expired; retry scheduled'
 WHERE extractor_slug='receipt-products-v1' AND status='claimed' AND locked_at<now()-interval '15 minutes'
 RETURNING id), picked AS ($patch$);
 anchor:='AND q.evidence_type<>''listing_page_snapshot''';
 IF (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Derivation route anchor drift'; END IF;
 EXECUTE replace(def,anchor,anchor||$patch$
 AND (q.extractor_slug<>'receipt-products-v1' OR q.id=(SELECT rp.id FROM public.derivation_queue rp
 WHERE rp.extractor_slug='receipt-products-v1' AND rp.status='pending' AND rp.next_attempt_at<=now() AND rp.attempts<rp.max_attempts
 AND (p_user_id IS NULL OR rp.user_id=p_user_id) ORDER BY rp.priority,rp.created_at,rp.id LIMIT 1))$patch$);
END $$;

CREATE INDEX catalog_parts_receipt_product_current ON public.catalog_parts
 ((application_data#>>'{receipt_product_v1,supplier_key}'),part_number,created_at DESC,id)
 WHERE application_data ? 'receipt_product_v1';
CREATE UNIQUE INDEX catalog_parts_receipt_product_capture ON public.catalog_parts
 ((application_data#>>'{receipt_product_v1,supplier_key}'),part_number,(application_data#>>'{receipt_product_v1,page_sha256}'),(application_data#>>'{receipt_product_v1,image_sha256}'))
 WHERE application_data ? 'receipt_product_v1';

CREATE FUNCTION public.record_receipt_catalog_product(p_supplier text,p_number text,p_capture jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.listing_page_snapshots%ROWTYPE; source_id uuid; part_id uuid; host text; pn text:=public.receipt_product_number(p_number); c jsonb;
BEGIN
 IF p_supplier IS NULL OR p_supplier NOT IN ('classic_industries','oreilly') OR length(pn) NOT BETWEEN 1 AND 100
 OR p_capture->>'parser' IS DISTINCT FROM 'receipt_product_page_v1'
 OR public.receipt_product_number(p_capture->>'printed_sku') IS DISTINCT FROM pn
 OR coalesce(p_capture->>'page_sha256','') !~ '^[0-9a-f]{64}$'
 OR coalesce(p_capture->>'image_sha256','') !~ '^[0-9a-f]{64}$'
 OR coalesce(p_capture->>'name','')='' OR length(p_capture->>'name')>1000
 OR coalesce(p_capture->>'image_url','') !~ '^https://'
 OR coalesce(p_capture->>'image_source_url','') !~ '^https://(cdn\.oerparts\.com|cdn\.classicindustries\.com|images\.oreillyauto\.com)/'
 OR coalesce(p_capture->>'source_role','') NOT IN ('original_receipt_supplier','catalog_cross_reference')
 OR p_capture->>'match_basis' IS DISTINCT FROM 'exact_primary_catalog_sku; installation_not_asserted' THEN RAISE EXCEPTION 'Invalid product capture'; END IF;
 SELECT * INTO s FROM public.listing_page_snapshots WHERE id=(p_capture->>'snapshot_id')::uuid;
 IF NOT FOUND OR s.success IS DISTINCT FROM true OR s.http_status IS DISTINCT FROM 200
 OR s.html_sha256 IS DISTINCT FROM p_capture->>'page_sha256' OR s.listing_url IS DISTINCT FROM p_capture->>'page_url'
 THEN RAISE EXCEPTION 'Product source capture is unavailable'; END IF;
 host:=lower(substring(s.listing_url from '^https://([^/:?#]+)'));
 IF (p_supplier='classic_industries' AND host NOT IN ('www.classicindustries.com','classicindustries.com','www.oerparts.com','oerparts.com'))
 OR (p_supplier='oreilly' AND host NOT IN ('www.oreillyauto.com','oreillyauto.com'))
 OR host IS NULL OR s.listing_url !~ '^https://[a-zA-Z0-9.]+/'
 OR (host IN ('oerparts.com','www.oerparts.com')) IS DISTINCT FROM (p_capture->>'source_role'='catalog_cross_reference') THEN RAISE EXCEPTION 'Supplier source mismatch'; END IF;
 IF p_capture->>'image_url' IS DISTINCT FROM public.get_service_url()||'/storage/v1/object/public/catalog-images/'||(p_capture->>'image_storage_path')
 OR coalesce(p_capture->>'image_storage_path','') !~ ('^receipt-products/'||(p_capture->>'image_sha256')||'\.(jpeg|png|webp)$')
 OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='catalog-images' AND name=p_capture->>'image_storage_path')
 THEN RAISE EXCEPTION 'Stock image is not retained'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('receipt_catalog:'||p_supplier||':'||pn,0));
 SELECT id INTO part_id FROM public.catalog_parts WHERE part_number=pn
 AND application_data#>>'{receipt_product_v1,supplier_key}'=p_supplier
 AND application_data#>>'{receipt_product_v1,page_sha256}'=s.html_sha256
 AND application_data#>>'{receipt_product_v1,image_sha256}'=p_capture->>'image_sha256';
 IF FOUND THEN RETURN part_id; END IF;
 SELECT id INTO source_id FROM public.catalog_sources WHERE provider=host AND base_url='https://'||host ORDER BY created_at,id LIMIT 1;
 IF source_id IS NULL THEN INSERT INTO public.catalog_sources(name,provider,base_url) VALUES(host||' product pages',host,'https://'||host) RETURNING id INTO source_id; END IF;
 -- Explicit allowlist: never copy the worker's receipt/owner context into a public catalog row.
 c:=jsonb_build_object('supplier_key',p_supplier,'snapshot_id',s.id,'page_sha256',s.html_sha256,'captured_at',s.fetched_at,
 'image_sha256',p_capture->>'image_sha256','image_source_url',p_capture->>'image_source_url',
 'image_storage_path',p_capture->>'image_storage_path','source_role',p_capture->>'source_role',
 'parser','receipt_product_page_v1','match_basis',p_capture->>'match_basis','image_basis','catalog_stock_image');
 INSERT INTO public.catalog_parts(catalog_id,part_number,name,manufacturer,description,product_image_url,supplier_url,
 price_current,currency,application_data,created_at,updated_at)
 VALUES(source_id,pn,p_capture->>'name',p_capture->>'manufacturer',left(p_capture->>'description',12000),p_capture->>'image_url',s.listing_url,
 CASE WHEN p_capture->>'price' ~ '^\d+(\.\d+)?$' THEN (p_capture->>'price')::numeric END,p_capture->>'currency',
 jsonb_build_object('receipt_product_v1',c),statement_timestamp(),statement_timestamp()) RETURNING id INTO part_id;
 RETURN part_id;
END $$;
REVOKE ALL ON FUNCTION public.record_receipt_catalog_product(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_receipt_catalog_product(text,text,jsonb) TO service_role;

CREATE FUNCTION public.receipt_item_product_card(p_item uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.catalog_parts%ROWTYPE; meta jsonb; supplier text; pn text;
BEGIN
 SELECT public.receipt_product_supplier(r.vendor_name),public.receipt_product_number(i.part_number) INTO supplier,pn
 FROM public.receipt_items i JOIN public.receipts r ON r.id=i.receipt_id
 WHERE i.id=p_item AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
 AND public.receipt_product_eligible(i.part_number,i.description);
 IF supplier IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.catalog_parts WHERE part_number=pn
 AND application_data#>>'{receipt_product_v1,supplier_key}'=supplier ORDER BY created_at DESC,id DESC LIMIT 1;
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
END $$;
REVOKE ALL ON FUNCTION public.receipt_item_product_card(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_item_product_card(uuid) TO service_role;

-- Supplier scraping uses the existing account and meter. It can consume only
-- the unspent non-reserve portion of the configured monthly account budget.
-- Existing per-source pauses and other source allocations remain unchanged.
INSERT INTO public.firecrawl_source_params(source,firecrawl_dependent,credits_per_lot,cost_basis,supply_kind,event_platforms,observed_on,snapshot_platforms,hosts,cap_note)
VALUES('receipt-products',true,1,'Public product/search page; deterministic SKU extraction','live','{}',current_date,
 ARRAY['receipt-products'],ARRAY['classicindustries.com','oerparts.com','oreillyauto.com'],
 'Owner-requested receipt product enrichment; existing account budget, reserve, source pauses and request meter apply. No plan change.');
DO $$ DECLARE def text; anchor text:='v_end := (v_start + interval ''1 month'')::date;'; BEGIN
 def:=pg_get_functiondef('public.firecrawl_allowance(text)'::regprocedure);
 IF (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Firecrawl budget anchor drift'; END IF;
 EXECUTE replace(def,anchor,anchor||$patch$
  IF p_source='receipt-products' THEN
    SELECT coalesce(sum(credits),0) INTO v_spent_today FROM public.firecrawl_spend_log
    WHERE spent_at>=v_start AND spent_at<v_end AND NOT historical;
    RETURN greatest(0,floor(public.firecrawl_param('monthly_credits',0)
      *(1-public.firecrawl_param('reserve_fraction',0.15))-v_spent_today));
  END IF;$patch$);
END $$;

-- Enrich only receipt lines already qualified by the current public reader.
DO $$ DECLARE rd text; anchor text; BEGIN
 rd:=pg_get_functiondef('public.visual_work_build_log(uuid)'::regprocedure);
 anchor:=$a$'item_id',receipt_row.item_id,'receipt_id',receipt_row.receipt_id,$a$;
 IF (length(rd)-length(replace(rd,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Visual work reader anchor drift'; END IF;
 EXECUTE replace(rd,anchor,anchor||$a$'product',public.receipt_item_product_card(receipt_row.item_id),$a$);
 rd:=pg_get_functiondef('public.get_vehicle_day_documents(uuid,date)'::regprocedure);
 anchor:=$a$'line_number', i.line_number, 'description', i.description, 'part_number', i.part_number,$a$;
 IF (length(rd)-length(replace(rd,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Receipt day reader anchor drift'; END IF;
 EXECUTE replace(rd,anchor,anchor||$a$'product',public.receipt_item_product_card(i.id),$a$);
END $$;
COMMENT ON FUNCTION public.record_receipt_catalog_product(text,text,jsonb) IS 'Catalog owner: append a source-hashed, SKU-checked product revision after the public stock image is retained. Never asserts vehicle installation or alters receipt amounts.';
COMMENT ON FUNCTION public.receipt_item_product_card(uuid) IS 'Internal receipt-to-catalog reader; caller must qualify receipt visibility. Returns public product facts only. Latest source withdrawal suppresses the card.';
NOTIFY pgrst,'reload schema';
COMMIT;
