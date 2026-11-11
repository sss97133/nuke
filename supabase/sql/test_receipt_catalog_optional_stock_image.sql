-- Empty disposable dm_refinement_ fixture only; all records are synthetic.
-- The existing source-to-day-reader fixture proves the unchanged baseline first.
\set ON_ERROR_STOP on
\ir test_receipt_catalog_enrichment.sql
\ir ../migrations/20261113152000_receipt_catalog_optional_stock_image.sql

DO $$ DECLARE r uuid:='60000000-0000-0000-0000-000000000001'; i uuid:='70000000-0000-0000-0000-000000000001';
 c jsonb; p uuid; with_image uuid; without_image uuid; recovered uuid; recaptured uuid; card jsonb; day jsonb; image_key text; q uuid; generation bigint; BEGIN
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
 card:=receipt_item_product_card(i);
 ASSERT card->>'catalog_part_id'=with_image::text AND card->>'image_status'='retained' AND card->>'image_url'=c->>'image_url';
 UPDATE derivation_queue SET status='claimed',locked_by='image-recovered' WHERE id=q;
 ASSERT finish_receipt_products(q,'image-recovered',generation,'{}',true,0)='done','qualified image recovery finishes through the existing queue owner';
 DELETE FROM storage.objects WHERE name='receipt-products/'||repeat('3',64)||'.jpeg';
 card:=receipt_item_product_card(i);
 ASSERT card->>'quote_price'='49.95' AND card->'image_url'='null' AND card->'image_basis'='null' AND card->>'image_status'='unavailable','storage withdrawal removes media only';
 BEGIN PERFORM record_receipt_catalog_product('classic_industries','NO-IMAGE',c);RAISE EXCEPTION 'missing storage accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Stock image is not retained';END;
 BEGIN PERFORM record_receipt_catalog_product('classic_industries','NO-IMAGE',c||jsonb_build_object('image_source_url','https://cdn.classicindustries.com.evil.test/p.jpg'));RAISE EXCEPTION 'wrong CDN accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Invalid product capture';END;
 -- A -> image withdrawal -> B (no image) -> same bytes recover as C.
 -- An old matching capture must not acknowledge C while the reader still sees B.
 without_image:=record_receipt_catalog_product('classic_industries','NO-IMAGE',
 (c-ARRAY['image_url','image_sha256','image_storage_path','image_source_url'])||jsonb_build_object('image_status','unavailable'));
 ASSERT without_image<>p AND without_image<>with_image AND (SELECT count(*)=3 FROM catalog_parts WHERE part_number='NO-IMAGE'),
 'a historical no-image revision cannot acknowledge a new withdrawal';
 ASSERT receipt_item_product_card(i)->>'catalog_part_id'=without_image::text AND receipt_item_product_card(i)->>'image_status'='unavailable';
 INSERT INTO storage.objects VALUES('catalog-images','receipt-products/'||repeat('3',64)||'.jpeg');
 recovered:=record_receipt_catalog_product('classic_industries','NO-IMAGE',c);
 ASSERT recovered<>with_image AND recovered<>without_image AND (SELECT count(*)=4 FROM catalog_parts WHERE part_number='NO-IMAGE'),
 'recovering identical old image bytes appends a current revision';
 card:=receipt_item_product_card(i);
 ASSERT card->>'catalog_part_id'=recovered::text AND card->>'image_url'=c->>'image_url' AND card->>'image_status'='retained',
 'writer recovery is the actual current reader revision without fixture timestamp edits';
 ASSERT record_receipt_catalog_product('classic_industries','NO-IMAGE',c)=recovered
 AND (SELECT count(*)=4 FROM catalog_parts WHERE part_number='NO-IMAGE'),'only current-revision replay is idempotent';
 -- Exact same page bytes from a new retained capture carry their own source.
 INSERT INTO listing_page_snapshots VALUES('a0000000-0000-0000-0000-000000000012',c->>'page_url',repeat('1',64),200,true,now());
 recaptured:=record_receipt_catalog_product('classic_industries','NO-IMAGE',c||jsonb_build_object('snapshot_id','a0000000-0000-0000-0000-000000000012'));
 ASSERT recaptured<>recovered AND receipt_item_product_card(i)->>'catalog_part_id'=recaptured::text,'new source receipt does not acknowledge the previous source';
 UPDATE listing_page_snapshots SET success=false WHERE id='a0000000-0000-0000-0000-000000000012';
 ASSERT (SELECT success FROM listing_page_snapshots WHERE id='a0000000-0000-0000-0000-000000000010')
 AND receipt_item_product_card(i) IS NULL,'withdrawal of the latest source does not fall back to older valid source/image revisions';
 BEGIN PERFORM record_receipt_catalog_product('classic_industries','NO-IMAGE',c||jsonb_build_object('snapshot_id','a0000000-0000-0000-0000-000000000012'));RAISE EXCEPTION 'withdrawn latest source accepted';EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Product source capture is unavailable';END;
 UPDATE listing_page_snapshots SET success=true WHERE id='a0000000-0000-0000-0000-000000000012';
 UPDATE listing_page_snapshots SET listing_url='https://www.classicindustries.com/product/replacement.html' WHERE id='a0000000-0000-0000-0000-000000000012';
 ASSERT receipt_item_product_card(i) IS NULL,'changed supplier page cannot preserve an older product quote';
 ASSERT NOT has_function_privilege('anon','record_receipt_catalog_product(text,text,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','receipt_item_product_card(uuid)','EXECUTE');
 RAISE NOTICE 'optional stock image: real quote reader, null-safe capture replay, independent media withdrawal, page identity and privacy pass';
END $$;

-- Removing historical-content uniqueness must not weaken concurrent replay.
-- The retained writer's namespace lock is the authority for current identity.
INSERT INTO listing_page_snapshots VALUES('a0000000-0000-0000-0000-000000000013','https://www.classicindustries.com/product/lock-replay.html',repeat('5',64),200,true,now());
CREATE FUNCTION fixture_catalog_replay() RETURNS uuid LANGUAGE sql AS $$
 SELECT record_receipt_catalog_product('classic_industries','LOCK-REPLAY',jsonb_build_object(
 'parser','receipt_product_page_v1','printed_sku','LOCK-REPLAY','name','Synthetic concurrent product',
 'snapshot_id','a0000000-0000-0000-0000-000000000013','page_sha256',repeat('5',64),'page_url','https://www.classicindustries.com/product/lock-replay.html',
 'source_role','original_receipt_supplier','match_basis','exact_primary_catalog_sku; installation_not_asserted',
 'image_status','not_provided','price',12,'currency','USD'))
$$;
CREATE EXTENSION dblink;
DO $$ DECLARE connection text; first_id uuid; replay_id uuid; waiting boolean:=false; BEGIN
 connection:=format('dbname=%L host=%L port=%L user=%L',current_database(),
 split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_user);
 PERFORM dblink_connect('catalog_first',connection);
 PERFORM dblink_connect('catalog_replay',connection||' application_name=catalog_replay_fixture');
 PERFORM dblink_exec('catalog_first','BEGIN');
 SELECT value INTO first_id FROM dblink('catalog_first','SELECT fixture_catalog_replay()') AS t(value uuid);
 PERFORM dblink_send_query('catalog_replay','SELECT fixture_catalog_replay()');
 FOR attempt IN 1..100 LOOP
  SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='catalog_replay_fixture' AND wait_event_type='Lock') INTO waiting;
  EXIT WHEN waiting;
  PERFORM pg_sleep(0.01);
 END LOOP;
 ASSERT waiting,'concurrent replay must wait for the current namespace revision';
 PERFORM dblink_exec('catalog_first','COMMIT');
 SELECT value INTO replay_id FROM dblink_get_result('catalog_replay') AS t(value uuid);
 ASSERT first_id=replay_id AND (SELECT count(*)=1 FROM catalog_parts WHERE part_number='LOCK-REPLAY'),
 'waiting replay reads the newly committed revision and does not duplicate it';
 ASSERT to_regclass('public.catalog_parts_receipt_product_current') IS NOT NULL,'current-reader index is preserved';
 PERFORM dblink_disconnect('catalog_replay'); PERFORM dblink_disconnect('catalog_first');
 RAISE NOTICE 'optional stock image: actual concurrent current-revision replay remains idempotent';
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
