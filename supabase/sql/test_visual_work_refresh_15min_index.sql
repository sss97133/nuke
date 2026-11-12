-- Disposable synthetic contract for 20261116030000: the input digest is byte-identical after its receipts lookup
-- changes, the refresh rebuilds a row within 20 minutes of valid_until, and the partial index exists and is valid.
\set ON_ERROR_STOP on
\ir test_visual_work_ledger_image_map.sql

UPDATE vehicle_observations SET is_superseded=false,structured_data=(SELECT packet FROM baseline_packet)
 WHERE id='a0000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE fifteen_before_digest AS
 SELECT v.id, public.visual_work_build_log_inputs_digest(v.id) d FROM vehicles v;
DO $$ BEGIN
 ASSERT (SELECT count(DISTINCT d) FROM fifteen_before_digest WHERE d IS NOT NULL)>=1,'fixture digests';
 PERFORM public.visual_work_build_log_refresh();
END $$;

\ir ../migrations/20261116030000_visual_work_refresh_15min_index.sql

DO $$
DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; r jsonb;
BEGIN
 ASSERT (SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass('public.idx_vobs_visual_work')),'index valid';
 ASSERT (SELECT pg_get_expr(indpred,indrelid) FROM pg_index WHERE indexrelid=to_regclass('public.idx_vobs_visual_work'))
  LIKE '%work_record%visual_work_v1%','index predicate';
 -- The digest hashes the same rows: every vehicle's value is unchanged.
 ASSERT NOT EXISTS (SELECT 1 FROM fifteen_before_digest b WHERE b.d IS DISTINCT FROM public.visual_work_build_log_inputs_digest(b.id)),
  'digest values unchanged';
 ASSERT position('UNION SELECT receipt_id FROM items' IN pg_get_functiondef('public.visual_work_build_log_inputs_digest(uuid)'::regprocedure))>0;
 -- Stored rows from before the change stay fresh: nothing to recompute.
 r:=public.visual_work_build_log_refresh();
 ASSERT (r->>'computed')::int=0 AND (r->>'fresh')::int>=2, r::text;
 -- A row 15 minutes from valid_until is inside the new 20-minute margin and is rebuilt.
 UPDATE public.visual_work_build_log_state SET valid_until=now()+interval '15 minutes' WHERE vehicle_id=v AND amounts_visible;
 r:=public.visual_work_build_log_refresh();
 ASSERT (r->>'computed')::int=1, r::text;
 ASSERT (SELECT valid_until>now()+interval '20 minutes' FROM public.visual_work_build_log_state WHERE vehicle_id=v AND amounts_visible);
 -- A row 25 minutes out is still fresh.
 UPDATE public.visual_work_build_log_state SET valid_until=now()+interval '25 minutes' WHERE vehicle_id=v AND amounts_visible;
 r:=public.visual_work_build_log_refresh();
 ASSERT (r->>'computed')::int=0, r::text;
 IF to_regnamespace('cron') IS NOT NULL THEN
  ASSERT (SELECT schedule FROM cron.job WHERE jobname='visual-work-build-log-refresh')='11-59/15 * * * *';
 END IF;
END $$;
SELECT 'visual work refresh 15 min index contract passed' AS result;
