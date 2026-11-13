-- The master ledger repeated each cited source photograph inside every row that cites it:
-- on the one vehicle with visual work, 807 photo objects for 33 photos (521 KB of a 1.41 MB
-- reply), plus a copy of each catalog product card under rows[].pricing.product (112 KB) that
-- no reader uses (the page takes the product from visual_work[].receipts[].product).
-- master_ledger.images now holds each source photograph once, keyed by image_id; a row's
-- source_images entry is that image_id. A photograph whose cited form differs between rows
-- (role, caption or source observations) stays inline as an object in each row, so expanding
-- the map gives the previous rows exactly. rows[].pricing.product is dropped.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';

CREATE FUNCTION public.visual_work_master_ledger_compact(p_scenarios jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 WITH scenarios AS (
  SELECT s,so FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_scenarios)='array' THEN p_scenarios ELSE '[]' END)
   WITH ORDINALITY x(s,so)),
 cited AS (
  SELECT si FROM scenarios
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s->'rows')='array' THEN s->'rows' ELSE '[]' END) r
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r->'source_images')='array' THEN r->'source_images' ELSE '[]' END) si
  WHERE jsonb_typeof(si)='object' AND jsonb_typeof(si->'image_id')='string'),
 -- Only a photograph cited identically by every row is mapped.
 map AS (
  SELECT coalesce(jsonb_object_agg(id,v),'{}') images FROM (
   SELECT si->>'image_id' id,(array_agg(si))[1] v FROM cited GROUP BY 1 HAVING count(DISTINCT si)=1) g)
 SELECT jsonb_build_object('images',map.images,'scenarios',coalesce((
  SELECT jsonb_agg(CASE WHEN jsonb_typeof(s->'rows')='array' THEN s||jsonb_build_object('rows',(
    SELECT coalesce(jsonb_agg(r
      ||CASE WHEN jsonb_typeof(r->'source_images')='array' THEN jsonb_build_object('source_images',(
        SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(si)='object' AND jsonb_typeof(si->'image_id')='string'
           AND map.images->(si->>'image_id')=si THEN si->'image_id' ELSE si END ORDER BY io),'[]')
        FROM jsonb_array_elements(r->'source_images') WITH ORDINALITY y(si,io))) ELSE '{}'::jsonb END
      -- The product card is already in visual_work[].receipts[].product; the row keeps receipt_item_id.
      ||CASE WHEN jsonb_typeof(r->'pricing')='object' AND r->'pricing' ? 'product'
        THEN jsonb_build_object('pricing',(r->'pricing')-'product') ELSE '{}'::jsonb END
     ORDER BY ro),'[]')
    FROM jsonb_array_elements(s->'rows') WITH ORDINALITY z(r,ro))) ELSE s END ORDER BY so)
  FROM scenarios),'[]'))
 FROM map
$function$;
REVOKE ALL ON FUNCTION public.visual_work_master_ledger_compact(jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.visual_work_master_ledger_compact(jsonb) IS
'Private: master ledger scenarios with each identically cited source photograph moved to one images map keyed by image_id (rows keep the id) and the unused rows[].pricing.product copy dropped. Called by visual_work_master_cost_fold.';

DO $patch$
DECLARE def text; change record;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)'::regprocedure)
    IS DISTINCT FROM 'bc32083de68ba41ec9389a4952712623'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.visual_work_build_log_inputs_digest(uuid)'::regprocedure)
    IS DISTINCT FROM 'e2157e8cad1c34f7830279f9a5aa488f' THEN
  RAISE EXCEPTION 'Visual work cost fold or input digest drifted; inspect current owner';
 END IF;
 def:=pg_get_functiondef('public.visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)'::regprocedure);
 FOR change IN SELECT * FROM (VALUES
  ($old$ zones text[]; card jsonb;$old$,$new$ zones text[]; compact jsonb; card jsonb;$new$),
  ($old$ RETURN jsonb_build_object('master_ledger',jsonb_build_object('version',1,'as_of',statement_timestamp(),
  'scope','supplied_estimate_lines_only','scenarios',scenarios,$old$,
   $new$ -- Each identically cited source photograph is sent once, in master_ledger.images.
 compact:=public.visual_work_master_ledger_compact(scenarios);
 RETURN jsonb_build_object('master_ledger',jsonb_build_object('version',1,'as_of',statement_timestamp(),
  'scope','supplied_estimate_lines_only','scenarios',compact->'scenarios','images',compact->'images',$new$)
 ) changes(old_text,new_text) LOOP
  IF (length(def)-length(replace(def,change.old_text,'')))/length(change.old_text)<>1 THEN
   RAISE EXCEPTION 'Visual work cost fold anchor drifted';
  END IF;
  def:=replace(def,change.old_text,change.new_text);
 END LOOP;
 EXECUTE def;
 -- A deployed change to the new helper invalidates stored build logs like the others.
 def:=pg_get_functiondef('public.visual_work_build_log_inputs_digest(uuid)'::regprocedure);
 IF (length(def)-length(replace(def,$old$'receipt_product_eligible','text_redact_contact',$old$,'')))
    /length($old$'receipt_product_eligible','text_redact_contact',$old$)<>1 THEN
  RAISE EXCEPTION 'Visual work input digest anchor drifted';
 END IF;
 EXECUTE replace(def,$old$'receipt_product_eligible','text_redact_contact',$old$,
  $new$'receipt_product_eligible','text_redact_contact','visual_work_master_ledger_compact',$new$);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
