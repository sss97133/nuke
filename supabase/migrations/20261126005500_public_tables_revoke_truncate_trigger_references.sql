-- anon and authenticated lose TRUNCATE, TRIGGER and REFERENCES on every relation in public, now and for new ones.
--
-- Census (live, read-only, 2026-11-25), 1,807 tables in public:
--   anon holds TRUNCATE on 1,198 and TRIGGER and REFERENCES on 1,422.
--   authenticated holds TRUNCATE on 1,209 and TRIGGER and REFERENCES on 1,432.
-- Source: pg_default_acl. For tables created by postgres (and by supabase_admin) the default grants arwdDxt to anon and
-- authenticated, so each new table got all seven verbs.
--
-- None of the three is reachable through PostgREST, which issues only SELECT, INSERT, UPDATE and DELETE, so no API
-- consumer can depend on them. Row level security governs none of them, so where they are held they are live:
-- TRUNCATE empties a table whatever its policies say.
--
-- What changes:
--   * REVOKE TRUNCATE, TRIGGER, REFERENCES on every table, view, materialized view and foreign table in public that
--     postgres owns: 1,806 tables, 333 views and 68 materialized views on 2026-11-25. Three relations owned by
--     supabase_admin (spatial_ref_sys and two PostGIS views) cannot be changed by this role and are not touched.
--   * ALTER DEFAULT PRIVILEGES FOR ROLE postgres, so tables postgres creates later do not get them. supabase_admin's
--     default is outside this role's reach.
--   * SELECT, INSERT, UPDATE and DELETE are untouched. Dead DELETE, UPDATE and INSERT grants (RLS on, no policy for
--     the verb) are a per-table question with a consumer grep, handled separately.
--
-- Locks (measured on PG17): a REVOKE takes no lock on the table. It updates the relation's pg_class row (relacl) and
-- sends a relcache invalidation. Concurrent reads and writes on the tables continue. DDL or GRANTs on the same
-- relations wait until this transaction commits, and so does ANALYZE on a touched table (ta-skeptic2 measured an
-- autovacuum-style ANALYZE waiting 2.95 s behind a REVOKE held open), and every backend rebuilds its relcache entries
-- afterwards (one cache reset per backend for the 2,208 pg_class rows). Measured runtime on PG17 at live scale: 0.06 to
-- 0.20 s. Install
-- in a quiet window: no index build, and v_job_health showing the fewest lots near close.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $revoke$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('anon', c.oid, 'TRIGGER')
         OR has_table_privilege('anon', c.oid, 'REFERENCES') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE')
         OR has_table_privilege('authenticated', c.oid, 'TRIGGER') OR has_table_privilege('authenticated', c.oid, 'REFERENCES'))
     ORDER BY c.oid
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %s FROM anon, authenticated', r.rel);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'revoked TRUNCATE, TRIGGER, REFERENCES from anon, authenticated on % relations', n;
END
$revoke$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

-- Refuse to commit if any relation this role owns in public still grants one of the three.
DO $check$
DECLARE left_over int;
BEGIN
  SELECT count(*) INTO left_over
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
     AND EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) ro, unnest(ARRAY['TRUNCATE', 'TRIGGER', 'REFERENCES']) v
                  WHERE has_table_privilege(ro, c.oid, v));
  IF left_over > 0 THEN
    RAISE EXCEPTION '% relations still grant TRUNCATE, TRIGGER or REFERENCES to anon or authenticated', left_over;
  END IF;
END
$check$;

COMMIT;
