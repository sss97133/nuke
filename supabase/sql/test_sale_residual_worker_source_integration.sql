-- Same session after the canonical source suite and county integration.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database()<>'dm_refinement_sale_receipt' THEN RAISE EXCEPTION 'Disposable source suite only'; END IF; END $$;
SELECT pg_temp.base();
SELECT pg_temp.seed(11,'{"date":"2025-07-15","fetched_at":"2025-07-16T00:00:00Z","ingested_at":"2025-07-16T06:00:00Z","protected_parsed_at":"2025-07-16T12:00:00Z","parsed_at":"2025-07-16T12:00:00Z"}');
\ir helpers/sale_residual_worker_fixture.sql
\ir ../migrations/20261007192300_sale_residual_standing_fold.sql
UPDATE public.sale_residual_fold_queue SET enabled=false;
SELECT public.enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-07-01');
UPDATE public.sale_residual_fold_queue SET next_due_at='2020-01-01' WHERE enabled;
DO $$ DECLARE w jsonb:=public.drain_sale_residual_fold(); c jsonb; BEGIN
 PERFORM pg_temp.ok('actual qualified source parser reaches persistent residual and witness edge',
  w->>'status'='processed' AND w->>'episodes_landed'='1' AND w->>'location_edges_landed'='1');
 c:=public.read_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-07-01');
 PERFORM pg_temp.ok('cached source consumer preserves baseline, source hash and county qualification',
  c#>>'{receipt,baseline,n}'='10' AND c#>>'{receipt,sales,0,county_fips}'='32003'
  AND c#>>'{receipt,source_receipt,eligible,0,sourceSha256}' IS NOT NULL AND c->>'stale'='false');
END $$;
-- Only synthetic fixture mutation: corrupting retained raw content changes
-- today's revision while the earlier qualified receipt stays inspectable.
UPDATE public.listing_page_snapshots SET html=html||'tampered' WHERE id=md5('snapshot-11')::uuid;
SELECT public.enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-07-01','USD',true);
UPDATE public.sale_residual_fold_queue SET next_due_at='2020-01-01' WHERE enabled;
SELECT public.drain_sale_residual_fold();
SELECT pg_temp.ok('source hash invalidation removes target in new revision and retains earlier source receipt',
 (SELECT count(*)=2 FROM public.sale_residual_fold_runs)
 AND (SELECT count(*)=1 FROM public.sale_residual_episode_measurements)
 AND public.read_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-07-01')#>>'{receipt,coverage,qualified_target_sales}'='0');
