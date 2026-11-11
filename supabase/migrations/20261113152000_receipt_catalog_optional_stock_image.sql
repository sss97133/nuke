-- Retain exact product/page testimony independently of optional stock media.
-- Existing supplier/SKU/line-code, source withdrawal, privacy and grants remain.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.record_receipt_catalog_product(text,text,jsonb)'::regprocedure)) <> '09cfb9726f32a8813650a1ae6d89bb4c'
 OR md5(pg_get_functiondef('public.receipt_item_product_card(uuid)'::regprocedure)) <> '23a24947ee9315222264cad6441decf6'
 THEN RAISE EXCEPTION 'Receipt catalog owner drift'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_receipt_catalog_product(p_supplier text, p_number text, p_capture jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE s public.listing_page_snapshots%ROWTYPE; source_id uuid; part_id uuid; host text; pn text:=public.receipt_product_number(p_number); c jsonb; image_status text; has_image boolean;
BEGIN
 image_status:=coalesce(p_capture->>'image_status','retained');
 has_image:=image_status='retained';
 IF image_status NOT IN ('retained','not_provided','unavailable','unqualified') THEN RAISE EXCEPTION 'Invalid product image status'; END IF;
 IF p_supplier IS NULL OR p_supplier NOT IN ('classic_industries','oreilly') OR length(pn) NOT BETWEEN 1 AND 100
 OR p_capture->>'parser' IS DISTINCT FROM 'receipt_product_page_v1'
 OR (p_supplier='oreilly' AND coalesce(p_capture->>'product_line_code','') !~ '^[A-Z0-9]{2,3}$')
 OR public.receipt_product_number(p_capture->>'printed_sku') IS DISTINCT FROM pn
 OR coalesce(p_capture->>'page_sha256','') !~ '^[0-9a-f]{64}$'
 OR coalesce(p_capture->>'name','')='' OR length(p_capture->>'name')>1000
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
 IF has_image THEN
 IF coalesce(p_capture->>'image_sha256','') !~ '^[0-9a-f]{64}$'
 OR coalesce(p_capture->>'image_url','') !~ '^https://'
 OR coalesce(p_capture->>'image_source_url','') !~ '^https://(cdn\.oerparts\.com|cdn\.classicindustries\.com|images(-prod)?\.oreillyauto\.com)/'
 THEN RAISE EXCEPTION 'Invalid product capture'; END IF;
 IF p_capture->>'image_url' IS DISTINCT FROM public.get_service_url()||'/storage/v1/object/public/catalog-images/'||(p_capture->>'image_storage_path')
 OR coalesce(p_capture->>'image_storage_path','') !~ ('^receipt-products/'||(p_capture->>'image_sha256')||'\.(jpeg|png|webp)$')
 OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='catalog-images' AND name=p_capture->>'image_storage_path')
 THEN RAISE EXCEPTION 'Stock image is not retained'; END IF;
 ELSE
 IF p_capture->>'image_url' IS NOT NULL OR p_capture->>'image_sha256' IS NOT NULL
 OR p_capture->>'image_source_url' IS NOT NULL OR p_capture->>'image_storage_path' IS NOT NULL
 THEN RAISE EXCEPTION 'Unavailable stock image must not carry image proof'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('receipt_catalog:'||p_supplier||':'||pn,0));
 SELECT id INTO part_id FROM public.catalog_parts WHERE part_number=pn
 AND application_data#>>'{receipt_product_v1,supplier_key}'=p_supplier
 AND coalesce(application_data#>>'{receipt_product_v1,line_code}','')=CASE WHEN p_supplier='oreilly' THEN p_capture->>'product_line_code' ELSE '' END
 AND application_data#>>'{receipt_product_v1,page_sha256}'=s.html_sha256
 AND (application_data#>>'{receipt_product_v1,image_sha256}') IS NOT DISTINCT FROM (p_capture->>'image_sha256');
 IF FOUND THEN RETURN part_id; END IF;
 SELECT id INTO source_id FROM public.catalog_sources WHERE provider=host AND base_url='https://'||host ORDER BY created_at,id LIMIT 1;
 IF source_id IS NULL THEN INSERT INTO public.catalog_sources(name,provider,base_url) VALUES(host||' product pages',host,'https://'||host) RETURNING id INTO source_id; END IF;
 -- Explicit allowlist: never copy the worker's receipt/owner context into a public catalog row.
 c:=jsonb_build_object('supplier_key',p_supplier,'line_code',CASE WHEN p_supplier='oreilly' THEN p_capture->>'product_line_code' END,'snapshot_id',s.id,'page_sha256',s.html_sha256,'captured_at',s.fetched_at,
 'image_sha256',p_capture->>'image_sha256','image_source_url',p_capture->>'image_source_url',
 'image_storage_path',p_capture->>'image_storage_path','source_role',p_capture->>'source_role',
 'parser','receipt_product_page_v1','match_basis',p_capture->>'match_basis','image_status',image_status,'image_basis',CASE WHEN has_image THEN 'catalog_stock_image' END);
 INSERT INTO public.catalog_parts(catalog_id,part_number,name,manufacturer,description,product_image_url,supplier_url,
 price_current,currency,application_data,created_at,updated_at)
 VALUES(source_id,pn,p_capture->>'name',p_capture->>'manufacturer',left(p_capture->>'description',12000),p_capture->>'image_url',s.listing_url,
 CASE WHEN p_capture->>'price' ~ '^\d+(\.\d+)?$' THEN (p_capture->>'price')::numeric END,p_capture->>'currency',
 jsonb_build_object('receipt_product_v1',c),statement_timestamp(),statement_timestamp()) RETURNING id INTO part_id;
 RETURN part_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.receipt_item_product_card(p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.catalog_parts%ROWTYPE; meta jsonb; supplier text; pn text; line_code text; image_available boolean;
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
 AND s.success IS TRUE AND s.http_status=200 AND s.html_sha256=meta->>'page_sha256' AND s.listing_url=c.supplier_url) THEN RETURN NULL; END IF;
 -- Image withdrawal is independent of the retained primary product/quote.
 -- Every published image still needs the original stock-source and byte proof.
 image_available:=coalesce(
 c.product_image_url=public.get_service_url()||'/storage/v1/object/public/catalog-images/'||(meta->>'image_storage_path')
 AND meta->>'image_sha256' ~ '^[0-9a-f]{64}$'
 AND meta->>'image_storage_path' ~ ('^receipt-products/'||(meta->>'image_sha256')||'\.(jpeg|png|webp)$')
 AND meta->>'image_source_url' ~ '^https://(cdn\.oerparts\.com|cdn\.classicindustries\.com|images(-prod)?\.oreillyauto\.com)/'
 AND EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='catalog-images' AND name=meta->>'image_storage_path'),false);
 RETURN jsonb_build_object('catalog_part_id',c.id,'name',c.name,'manufacturer',c.manufacturer,'part_number',c.part_number,
 'image_url',CASE WHEN image_available THEN c.product_image_url END,'page_url',c.supplier_url,'captured_at',meta->>'captured_at','source_role',meta->>'source_role',
 'quote_price',c.price_current,'currency',c.currency,'price_stale',(meta->>'captured_at')::timestamptz<now()-interval '7 days',
 'price_basis','current_supplier_quote','image_basis',CASE WHEN image_available THEN 'catalog_stock_image' END,
 'image_status',CASE WHEN image_available THEN 'retained' WHEN meta->>'image_status' IN ('not_provided','unqualified') THEN meta->>'image_status' ELSE 'unavailable' END);
END $function$
;

COMMENT ON FUNCTION public.receipt_item_product_card(uuid) IS 'Internal qualified receipt-to-catalog reader. Exact supplier/SKU/product-line and latest retained page remain required. Unavailable stock bytes suppress only the image, not the source-linked quote. Caller qualifies receipt visibility.';
NOTIFY pgrst,'reload schema';
COMMIT;
