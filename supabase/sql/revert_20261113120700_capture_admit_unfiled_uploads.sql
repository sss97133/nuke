-- Revert 20261113120700: restore the six landing bodies and capture_filing_trust saved before the patch, then drop
-- capture_set_photo_admits. The saved-defs table is renamed, not dropped.
SET lock_timeout = '5s';
DO $$
DECLARE r record; n int := 0;
BEGIN
  IF to_regclass('public.capture_admit_uploads_prev_defs') IS NULL THEN RAISE EXCEPTION 'nothing to revert: no saved bodies'; END IF;
  FOR r IN SELECT proname, def, md5 FROM public.capture_admit_uploads_prev_defs ORDER BY proname LOOP
    EXECUTE r.def;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                    WHERE ns.nspname = 'public' AND p.proname = r.proname AND md5(pg_get_functiondef(p.oid)) = r.md5) THEN
      RAISE EXCEPTION 'revert did not restore %', r.proname;
    END IF;
    n := n + 1;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
              WHERE ns.nspname = 'public' AND p.prokind = 'f' AND position('capture_set_photo_admits(' IN pg_get_functiondef(p.oid)) > 0
                AND p.proname <> 'capture_set_photo_admits') THEN
    RAISE EXCEPTION 'a body still calls capture_set_photo_admits; not dropping it';
  END IF;
  DROP FUNCTION public.capture_set_photo_admits(text, uuid, jsonb);
  EXECUTE format('ALTER TABLE public.capture_admit_uploads_prev_defs RENAME TO %I',
                 'capture_admit_uploads_prev_defs_reverted_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'));
  RAISE NOTICE 'restored % bodies', n;
END $$;
