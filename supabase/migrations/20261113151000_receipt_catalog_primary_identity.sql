-- Runtime source-to-reader repair: O'Reilly primary MPN, official image CDN,
-- and receipt product-line namespace. No receipt contents or amounts change.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
DO $$ DECLARE def text; anchor text; BEGIN
 def:=pg_get_functiondef('public.record_receipt_catalog_product(text,text,jsonb)'::regprocedure);
 anchor:=$a$images\.oreillyauto\.com$a$;
 IF (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Catalog image host anchor drift'; END IF;
 def:=replace(def,anchor,$a$images(-prod)?\.oreillyauto\.com$a$);
 anchor:=$a$OR p_capture->>'parser' IS DISTINCT FROM 'receipt_product_page_v1'$a$;
 IF position(anchor in def)=0 THEN RAISE EXCEPTION 'Catalog product-line validation anchor drift'; END IF;
 def:=replace(def,anchor,anchor||$a$
 OR (p_supplier='oreilly' AND coalesce(p_capture->>'product_line_code','') !~ '^[A-Z0-9]{2,3}$')$a$);
 anchor:=$a$'supplier_key',p_supplier,'snapshot_id',s.id$a$;
 IF position(anchor in def)=0 THEN RAISE EXCEPTION 'Catalog product-line metadata anchor drift'; END IF;
 def:=replace(def,anchor,$a$'supplier_key',p_supplier,'line_code',p_capture->>'product_line_code','snapshot_id',s.id$a$);
 EXECUTE def;

 def:=pg_get_functiondef('public.receipt_item_product_card(uuid)'::regprocedure);
 anchor:='supplier text; pn text;';
 IF position(anchor in def)=0 THEN RAISE EXCEPTION 'Catalog reader declaration drift'; END IF;
 def:=replace(def,anchor,'supplier text; pn text; line_code text;');
 anchor:='public.receipt_product_number(i.part_number) INTO supplier,pn';
 IF position(anchor in def)=0 THEN RAISE EXCEPTION 'Catalog receipt identity anchor drift'; END IF;
 def:=replace(def,anchor,$a$public.receipt_product_number(i.part_number),substring(upper(i.description) from '\(([A-Z0-9]{2,3})(?:,|\))') INTO supplier,pn,line_code$a$);
 anchor:='IF supplier IS NULL THEN RETURN NULL; END IF;';
 IF position(anchor in def)=0 THEN RAISE EXCEPTION 'Catalog receipt qualification drift'; END IF;
 def:=replace(def,anchor,'IF supplier IS NULL OR (supplier=''oreilly'' AND line_code IS NULL) THEN RETURN NULL; END IF;');
 anchor:=$a$AND application_data#>>'{receipt_product_v1,supplier_key}'=supplier ORDER BY$a$;
 IF position(anchor in def)=0 THEN RAISE EXCEPTION 'Catalog product namespace anchor drift'; END IF;
 def:=replace(def,anchor,$a$AND application_data#>>'{receipt_product_v1,supplier_key}'=supplier
 AND (supplier<>'oreilly' OR application_data#>>'{receipt_product_v1,line_code}'=line_code) ORDER BY$a$);
 EXECUTE def;
END $$;
COMMENT ON FUNCTION public.receipt_item_product_card(uuid) IS 'Internal receipt-to-catalog reader; caller qualifies receipt visibility. OReilly identity includes the printed product-line code, because part numbers repeat across brands. Latest source withdrawal suppresses that product card.';
NOTIFY pgrst,'reload schema';
COMMIT;
