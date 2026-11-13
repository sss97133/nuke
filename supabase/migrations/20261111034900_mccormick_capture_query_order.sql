-- archiveFetch stores sorted query parameters; the intake retains its native URL.
-- Permit only the two native parameter orders, with the same room/appearance ID.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $patch$
DECLARE f text;before text;after text;
BEGIN
 f:=pg_get_functiondef('public.retained_native_listing_source(public.vehicle_observations)'::regprocedure);
 IF position('mccormick_capture_query_order_v1' IN f)>0 THEN RETURN;END IF;
 IF md5(f)<>'f2d8deef6b2802c77cf96e4e28f51c08' THEN
  RAISE EXCEPTION 'Native source qualifier changed; reconcile query-order repair';END IF;
 before:='AND s.listing_url=p.source_url AND s.html_sha256=p.extraction_metadata->>''html_sha256''';
 after:=$replacement$AND s.listing_url IN(p.source_url,
      -- mccormick_capture_query_order_v1: exact stored native alias, no extra parameters.
      CASE p.structured_data->>'presentation'
       WHEN 'archive' THEN 'https://www.classic-carauction.com/auction-results?auctionid='||(p.structured_data->>'source_id')||'&auctionnbr='||(p.structured_data->>'auction_number')
       WHEN 'showroom' THEN 'https://www.classic-carauction.com/Showroom-Inventory?id='||substr(p.structured_data->>'source_id',10)||'&sp=1'
      END)
     AND s.html_sha256=p.extraction_metadata->>'html_sha256'$replacement$;
 IF (length(f)-length(replace(f,before,'')))/length(before)<>1 THEN
  RAISE EXCEPTION 'McCormick snapshot URL anchor changed';END IF;
 EXECUTE replace(f,before,after);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
