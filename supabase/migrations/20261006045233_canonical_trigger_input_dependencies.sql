-- Prepared forward-only repair for existing canonical trigger dependencies.
-- Six current function inputs are absent from UPDATE OF; all six stale-result
-- cases reproduced on disposable PostgreSQL17 using retained live definitions.
-- No helper-body change, testimony rewrite, row replay, permissions or schedule.
-- Serialize via database-root integration and existing Supabase CI; not hand-applied.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.vehicles IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
DECLARE t record; cols text[];
BEGIN
 SELECT * INTO t FROM pg_trigger WHERE tgrelid='public.vehicles'::regclass
   AND tgname='trg_resolve_canonical_columns';
 IF NOT FOUND OR t.tgisinternal OR t.tgtype<>23 OR t.tgenabled<>'O'
   OR t.tgfoid<>'public.trg_resolve_canonical_columns()'::regprocedure
   OR t.tgnargs<>0 OR t.tgqual IS NOT NULL THEN
   RAISE EXCEPTION 'Canonical trigger properties drifted; review before replacement';
 END IF;
 IF md5(pg_get_functiondef(t.tgfoid))<>'86d64a35dc02f9af7035b7485e153db8' THEN -- gitleaks:allow (function-definition fingerprint, not a secret)
   RAISE EXCEPTION 'Canonical resolver body drifted; review its dependencies';
 END IF;
 SELECT array_agg(a.attname::text ORDER BY a.attname) INTO cols
 FROM unnest(t.tgattr::smallint[]) AS n(attnum)
 JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=n.attnum;
 IF cols IS DISTINCT FROM ARRAY['asking_price','auction_source','bat_sold_price','discovery_source','high_bid','listing_source','price','purchase_price','reserve_status','sale_price','sale_status','sold_price','source','winning_bid']::text[] AND cols IS DISTINCT FROM ARRAY['asking_price','auction_outcome','auction_source','bat_sold_price','created_at','discovery_source','discovery_url','high_bid','import_metadata','listing_source','listing_url','notes','price','purchase_price','reserve_status','sale_price','sale_status','sold_price','source','winning_bid']::text[] THEN
   RAISE EXCEPTION 'Canonical trigger input list drifted; do not discard other inputs';
 END IF;
END;
$guard$;
CREATE OR REPLACE TRIGGER trg_resolve_canonical_columns
BEFORE INSERT OR UPDATE OF
  source, listing_source, discovery_source, auction_source,
  price, asking_price, sale_price, sold_price, purchase_price,
  bat_sold_price, high_bid, winning_bid, sale_status, reserve_status,
  auction_outcome, listing_url, discovery_url, notes, import_metadata, created_at
ON public.vehicles FOR EACH ROW
EXECUTE FUNCTION public.trg_resolve_canonical_columns();
COMMIT;
