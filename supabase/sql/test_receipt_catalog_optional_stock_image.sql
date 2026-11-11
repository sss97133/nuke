-- Empty disposable dm_refinement_ fixture only; all records are synthetic.
-- The existing source-to-day-reader fixture proves the unchanged baseline first.
\set ON_ERROR_STOP on
\ir test_receipt_catalog_enrichment.sql
\ir ../migrations/20261113152000_receipt_catalog_optional_stock_image.sql

DO $$ DECLARE r uuid:='60000000-0000-0000-0000-000000000001'; i uuid:='70000000-0000-0000-0000-000000000001';
 c jsonb; p uuid; with_image uuid; card jsonb; day jsonb; image_key text; q uuid; generation bigint; BEGIN
 UPDATE receipts SET vendor_name='Classic Industries',total=420 WHERE id=r;
 UPDATE receipt_items SET part_number='NO-IMAGE',description='Synthetic part without supplier photo' WHERE id=i;
 INSERT INTO listing_page_snapshots VALUES('a0000000-0000-0000-0000-000000000010','https://www.classicindustries.com/product/no-image.html',repeat('1',64),200,true,now()-interval '8 days');
 c:=jsonb_build_object('parser','receipt_product_page_v1','printed_sku','NO-IMAGE','name','Product with exact price',
 'snapshot_id','a0000000-0000-0000-0000-000000000010','page_sha256',repeat('1',64),'page_url','https://www.classicindustries.com/product/no-image.html',
 'source_role','original_receipt_supplier','match_basis','exact_primary_catalog_sku; installation_not_asserted',
 'image_status','unavailable','price',49.95,'currency','USD','customer_name','PRIVATE NAME','receipt_amount',420);
 p:=record_receipt_catalog_product('classic_industries','NO-IMAGE',c);
 ASSERT p=record_receipt_catalog_product('classic_industries','*no-image',c),'null image identity remains idempotent under the existing writer lock';
 ASSERT (SELECT count(*)=1 FROM catalog_parts WHERE part_number='NO-IMAGE'),'no duplicate capture for null image hash';
 ASSERT (SELECT application_data::text NOT LIKE '%PRIVATE%' AND application_data::text NOT LIKE '%420%' FROM catalog_parts WHERE id=p),'private receipt context still excluded';
 card:=receipt_item_product_card(i);
 ASSERT card->>'quote_price'='49.95' AND card->>'currency'='USD' AND (card->>'price_stale')::boolean;
 ASSERT card->'image_url'='null' AND card->'image_basis'='null' AND card->>'image_status'='unavailable','no fabricated image or stock-image claim';
 PERFORM set_config('test.uid','',false); PERFORM set_config('test.role','anon',false);
 day:=get_vehicle_day_documents('10000000-0000-0000-0000-000000000001','2025-09-08');
 ASSERT day#>>'{documents,0,lines,0,product,quote_price}'='49.95' AND day#>'{documents,0,lines,0,amount}'='null','public quote reaches the real reader while purchase amounts stay masked';
 SELECT id,product_generation INTO q,generation FROM derivation_queue WHERE evidence_id=r;
 UPDATE derivation_queue SET status='claimed',locked_by='image-retry' WHERE id=q;
 ASSERT finish_receipt_products(q,'image-retry',generation,jsonb_build_object('items',jsonb_build_object(i::text,
 jsonb_build_object('status','stock_image_unavailable','catalog_part_id',p,'price_retained',true))),false,3600)='pending',
 'a readable quote does not force a transient image retry to complete';
 ASSERT (SELECT next_attempt_at>now()+interval '59 minutes' AND product_result#>>ARRAY['items',i::text,'catalog_part_id']=p::text FROM derivation_queue WHERE id=q);
 ASSERT receipt_item_product_card(i)->>'quote_price'='49.95','price remains readable while existing queue waits';
 -- An absent image does not relax any source or identity requirement.
 BEGIN PERFORM record_receipt_catalog_product('classic_industries','WRONG',c);RAISE EXCEPTION 'wrong SKU accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Invalid product capture';END;
 BEGIN PERFORM record_receipt_catalog_product('classic_industries','NO-IMAGE',c||jsonb_build_object('page_sha256',repeat('2',64)));RAISE EXCEPTION 'wrong hash accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Product source capture is unavailable';END;
 BEGIN PERFORM record_receipt_catalog_product('classic_industries','NO-IMAGE',c||jsonb_build_object('image_status','anything'));RAISE EXCEPTION 'unknown status accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Invalid product image status';END;
 FOREACH image_key IN ARRAY ARRAY['image_url','image_sha256','image_storage_path','image_source_url'] LOOP
  BEGIN PERFORM record_receipt_catalog_product('classic_industries','NO-IMAGE',c||jsonb_build_object(image_key,'unverified'));RAISE EXCEPTION 'partial image proof accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Unavailable stock image must not carry image proof';END;
 END LOOP;
 UPDATE listing_page_snapshots SET success=false WHERE id='a0000000-0000-0000-0000-000000000010';
 ASSERT receipt_item_product_card(i) IS NULL,'withdrawn primary source still suppresses the whole quote';
 BEGIN PERFORM record_receipt_catalog_product('classic_industries','NO-IMAGE',c);RAISE EXCEPTION 'withdrawn source accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Product source capture is unavailable';END;
 UPDATE listing_page_snapshots SET success=true WHERE id='a0000000-0000-0000-0000-000000000010';
 -- A later retained image can append a qualified revision of the same page.
 INSERT INTO storage.objects VALUES('catalog-images','receipt-products/'||repeat('3',64)||'.jpeg');
 c:=c||jsonb_build_object('image_status','retained','image_sha256',repeat('3',64),'image_storage_path','receipt-products/'||repeat('3',64)||'.jpeg',
 'image_url',get_service_url()||'/storage/v1/object/public/catalog-images/receipt-products/'||repeat('3',64)||'.jpeg','image_source_url','https://cdn.classicindustries.com/product.jpg');
 with_image:=record_receipt_catalog_product('classic_industries','NO-IMAGE',c);
 ASSERT with_image<>p AND (SELECT count(*)=2 FROM catalog_parts WHERE part_number='NO-IMAGE'),'append stock-image evidence without rewriting source quote';
 -- Same SQL statement has one timestamp, so explicitly select the new fixture revision.
 UPDATE catalog_parts SET created_at=created_at+interval '1 second' WHERE id=with_image;
 card:=receipt_item_product_card(i);
 ASSERT card->>'catalog_part_id'=with_image::text AND card->>'image_status'='retained' AND card->>'image_url'=c->>'image_url';
 UPDATE derivation_queue SET status='claimed',locked_by='image-recovered' WHERE id=q;
 ASSERT finish_receipt_products(q,'image-recovered',generation,'{}',true,0)='done','qualified image recovery finishes through the existing queue owner';
 DELETE FROM storage.objects WHERE name='receipt-products/'||repeat('3',64)||'.jpeg';
 card:=receipt_item_product_card(i);
 ASSERT card->>'quote_price'='49.95' AND card->'image_url'='null' AND card->'image_basis'='null' AND card->>'image_status'='unavailable','storage withdrawal removes media only';
 BEGIN PERFORM record_receipt_catalog_product('classic_industries','NO-IMAGE',c);RAISE EXCEPTION 'missing storage accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Stock image is not retained';END;
 BEGIN PERFORM record_receipt_catalog_product('classic_industries','NO-IMAGE',c||jsonb_build_object('image_source_url','https://cdn.classicindustries.com.evil.test/p.jpg'));RAISE EXCEPTION 'wrong CDN accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Invalid product capture';END;
 UPDATE listing_page_snapshots SET listing_url='https://www.classicindustries.com/product/replacement.html' WHERE id='a0000000-0000-0000-0000-000000000010';
 ASSERT receipt_item_product_card(i) IS NULL,'changed supplier page cannot preserve an older product quote';
 ASSERT NOT has_function_privilege('anon','record_receipt_catalog_product(text,text,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','receipt_item_product_card(uuid)','EXECUTE');
 RAISE NOTICE 'optional stock image: real quote reader, null-safe capture replay, independent media withdrawal, page identity and privacy pass';
END $$;

DO $$ DECLARE i uuid:='70000000-0000-0000-0000-000000000001'; c jsonb; p uuid;BEGIN
 UPDATE receipts SET vendor_name='O''Reilly Auto Parts' WHERE id='60000000-0000-0000-0000-000000000001';
 UPDATE receipt_items SET part_number='NO-PHOTO',description='CLAMPS (MTM)' WHERE id=i;
 INSERT INTO listing_page_snapshots VALUES('a0000000-0000-0000-0000-000000000011','https://www.oreillyauto.com/detail/c/example/clamps/mtm0/no-photo',repeat('4',64),200,true,now());
 c:=jsonb_build_object('parser','receipt_product_page_v1','printed_sku','NO-PHOTO','name','Qualified clamp',
 'snapshot_id','a0000000-0000-0000-0000-000000000011','page_sha256',repeat('4',64),'page_url','https://www.oreillyauto.com/detail/c/example/clamps/mtm0/no-photo',
 'source_role','original_receipt_supplier','match_basis','exact_primary_catalog_sku; installation_not_asserted','image_status','unavailable','price',0,'currency',NULL);
 BEGIN PERFORM record_receipt_catalog_product('oreilly','NO-PHOTO',c);RAISE EXCEPTION 'missing line accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Invalid product capture';END;
 p:=record_receipt_catalog_product('oreilly','NO-PHOTO',c||jsonb_build_object('product_line_code','WAL'));
 ASSERT receipt_item_product_card(i) IS NULL,'image-free wrong product line does not match receipt';
 p:=record_receipt_catalog_product('oreilly','NO-PHOTO',c||jsonb_build_object('product_line_code','MTM'));
 ASSERT receipt_item_product_card(i)->>'catalog_part_id'=p::text AND receipt_item_product_card(i)->>'quote_price'='0'
 AND receipt_item_product_card(i)->'currency'='null','right namespace retains literal zero and unknown currency';
 RAISE NOTICE 'optional stock image: exact OReilly namespace remains required';
END $$;
