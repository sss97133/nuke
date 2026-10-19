-- Open INSERT policies on 15 tables that hold rows: the service-only ones go TO service_role, the ones clients use
-- are scoped to the caller, and anon and authenticated lose the write grants no client uses. The deliberate visitor
-- inserts (app_events, vehicle_views) keep their insert and lose UPDATE, DELETE and TRUNCATE.
--
-- Read on production 2026-10-14: each of these tables had a permissive INSERT policy for PUBLIC with
-- WITH CHECK (true), and INSERT, UPDATE, DELETE and TRUNCATE granted to anon and authenticated. With the
-- publishable key and no sign-in a caller could add rows to the PII audit log, the credit ledger, the API usage log,
-- any user's notifications and any shop's work orders. Rows: ai_scan_sessions 685,781, image_descriptions 182,674,
-- reference_libraries 48,328, vehicle_price_fixes 795, pii_audit_log 373, tool_catalog 126, ds_credit_transactions
-- 29, work_orders 26, user_notifications 21, and six tables of under 10 rows.
--
-- Writers, from the web app, the iOS app, edge functions, scripts, yono and SQL function bodies (2026-10-14), and
-- seven days of API logs (no REST write to any of these tables without the secret key, except the visitor inserts):
--   * ai_scan_sessions, api_usage_logs, ds_credit_transactions, image_descriptions, pii_audit_log,
--     session_narratives, source_census, vehicle_price_fixes: edge functions and yono with the secret key, and
--     SECURITY DEFINER functions (log_pii_access, ds_add_credits, ds_deduct_credit, ds_refund_credit). The insert
--     policy goes TO service_role; anon and authenticated lose INSERT, UPDATE, DELETE and TRUNCATE.
--   * search_analytics: no writer. Its insert policy is dropped and the write grants revoked.
--   * notifications: nobody inserts but SQL functions anon and authenticated cannot execute. The open insert policy
--     is dropped; notifications_insert_self (the caller's own, or an admin) stays.
--   * user_notifications: written only by SECURITY DEFINER functions and an edge function with the secret key. Both
--     open insert policies are dropped (un_insert_any let any signed-in account notify any user); the owner keeps
--     marking their notifications read.
--   * organization_vehicle_notifications: the trigger notify_org_members_of_verification (SECURITY INVOKER) inserts
--     them as the requester when a contributor files a vehicle relationship verification, with created_by_user_id
--     set to the requester. The open insert becomes organization_vehicle_notifications_insert_requester: signed in,
--     and created_by_user_id is the caller.
--   * reference_libraries: the library pages insert as a signed-in user (libraries_authenticated_insert); the
--     PUBLIC insert policy is dropped.
--   * tool_catalog: the toolbox import adds catalog rows as a signed-in user; the insert policy becomes TO
--     authenticated.
--   * work_orders: the shop page and the vehicle inquiry insert as a signed-in customer with customer_id set to
--     themselves; the insert policy becomes TO authenticated WITH CHECK (customer_id = the caller). Shop owners keep
--     "Org owners can manage work orders".
-- Left as they are: concierge_inquiries (its writer is outside this repository) and user_presence (closed in
-- 20261014174500).
-- Contract: supabase/sql/test_open_insert_policies.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Every policy this migration changes, as read on 2026-10-14 and as it leaves it. Each must be in one of the two
-- states (a re-run finds the second); anything else is drift, and nothing changes.
DO $$
DECLARE
  v_drift text;
BEGIN
  WITH want(tbl, pol, cmd, roles_before, chk_before, roles_after, chk_after) AS (VALUES
    ('ai_scan_sessions', 'Service role can create scan sessions', 'a', 'PUBLIC', 'true', 'service_role', 'true'),
    ('api_usage_logs', 'Service role can insert usage logs', 'a', 'PUBLIC', 'true', 'service_role', 'true'),
    ('ds_credit_transactions', 'ds_transactions_service_insert', 'a', 'PUBLIC', 'true', 'service_role', 'true'),
    ('image_descriptions', 'image_descriptions_insert', 'a', 'PUBLIC', 'true', 'service_role', 'true'),
    ('pii_audit_log', 'System can insert audit logs', 'a', 'PUBLIC', 'true', 'service_role', 'true'),
    ('session_narratives', 'session_narratives_insert', 'a', 'PUBLIC', 'true', 'service_role', 'true'),
    ('source_census', 'Service role insert source_census', 'a', 'PUBLIC', 'true', 'service_role', 'true'),
    ('vehicle_price_fixes', 'System can insert price fixes', 'a', 'PUBLIC', 'true', 'service_role', 'true'),
    ('search_analytics', 'Users can insert their own search analytics', 'a', 'PUBLIC', 'true', NULL, NULL),
    ('notifications', 'System can create notifications', 'a', 'PUBLIC', 'true', NULL, NULL),
    ('user_notifications', 'System can insert notifications', 'a', 'PUBLIC', 'true', NULL, NULL),
    ('user_notifications', 'un_insert_any', 'a', 'authenticated', 'true', NULL, NULL),
    ('organization_vehicle_notifications', 'Service role can create notifications', 'a', 'PUBLIC', 'true', NULL, NULL),
    ('organization_vehicle_notifications', 'organization_vehicle_notifications_insert_requester', 'a', NULL, NULL,
      'authenticated', '(created_by_user_id = ( SELECT auth.uid() AS uid))'),
    ('reference_libraries', 'allow_reference_libraries_insert', 'a', 'PUBLIC', 'true', NULL, NULL),
    ('tool_catalog', 'Anyone can insert tool catalog', 'a', 'PUBLIC', 'true', 'authenticated', 'true'),
    ('work_orders', 'Users can create work orders', 'a', 'PUBLIC', 'true', 'authenticated',
      '(customer_id = ( SELECT auth.uid() AS uid))')
  ), live AS (
    SELECT c.relname AS tbl, p.polname AS pol, p.polcmd::text AS cmd, p.polpermissive AS perm,
      CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC'
        ELSE (SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)) END AS roles,
      p.polqual IS NULL AS no_qual,
      regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+', ' ', 'g') AS chk
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  )
  SELECT string_agg(format('%s.%s', w.tbl, w.pol), ', ') INTO v_drift
  FROM want w LEFT JOIN live l ON l.tbl = w.tbl AND l.pol = w.pol
  WHERE NOT (
    (w.roles_before IS NULL AND l.pol IS NULL)
    OR (w.roles_before IS NOT NULL AND l.perm AND l.cmd = w.cmd AND l.no_qual AND l.roles = w.roles_before
        AND l.chk IS NOT DISTINCT FROM w.chk_before)
    OR (w.roles_after IS NULL AND l.pol IS NULL)
    OR (w.roles_after IS NOT NULL AND l.perm AND l.cmd = w.cmd AND l.no_qual AND l.roles = w.roles_after
        AND l.chk IS NOT DISTINCT FROM w.chk_after));
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'open insert policies drifted from the 2026-10-14 read (%); not changing them', v_drift;
  END IF;
END $$;

-- 1. Service-only tables: the insert policy names the service role; no API role writes.
ALTER POLICY "Service role can create scan sessions" ON public.ai_scan_sessions TO service_role;
ALTER POLICY "Service role can insert usage logs" ON public.api_usage_logs TO service_role;
ALTER POLICY ds_transactions_service_insert ON public.ds_credit_transactions TO service_role;
ALTER POLICY image_descriptions_insert ON public.image_descriptions TO service_role;
ALTER POLICY "System can insert audit logs" ON public.pii_audit_log TO service_role;
ALTER POLICY session_narratives_insert ON public.session_narratives TO service_role;
ALTER POLICY "Service role insert source_census" ON public.source_census TO service_role;
ALTER POLICY "System can insert price fixes" ON public.vehicle_price_fixes TO service_role;
DROP POLICY IF EXISTS "Users can insert their own search analytics" ON public.search_analytics;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.ai_scan_sessions, public.api_usage_logs, public.ds_credit_transactions, public.image_descriptions,
  public.pii_audit_log, public.session_narratives, public.source_census, public.vehicle_price_fixes,
  public.search_analytics
  FROM anon, authenticated;

-- 2. Notifications: written by SQL functions and the secret key; owners read and mark their own.
DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.notifications FROM anon;
REVOKE DELETE, TRUNCATE ON public.notifications FROM authenticated;
DROP POLICY IF EXISTS "System can insert notifications" ON public.user_notifications;
DROP POLICY IF EXISTS un_insert_any ON public.user_notifications;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_notifications FROM anon;
REVOKE INSERT, DELETE, TRUNCATE ON public.user_notifications FROM authenticated;

-- 3. organization_vehicle_notifications: the requester's verification trigger, as the requester.
DROP POLICY IF EXISTS "Service role can create notifications" ON public.organization_vehicle_notifications;
DROP POLICY IF EXISTS organization_vehicle_notifications_insert_requester ON public.organization_vehicle_notifications;
CREATE POLICY organization_vehicle_notifications_insert_requester ON public.organization_vehicle_notifications
  FOR INSERT TO authenticated
  WITH CHECK (created_by_user_id = (SELECT auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_vehicle_notifications FROM anon;
REVOKE DELETE, TRUNCATE ON public.organization_vehicle_notifications FROM authenticated;

-- 4. Signed-in client inserts.
DROP POLICY IF EXISTS allow_reference_libraries_insert ON public.reference_libraries;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.reference_libraries FROM anon;
REVOKE DELETE, TRUNCATE ON public.reference_libraries FROM authenticated;
ALTER POLICY "Anyone can insert tool catalog" ON public.tool_catalog TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tool_catalog FROM anon;
REVOKE TRUNCATE ON public.tool_catalog FROM authenticated;
ALTER POLICY "Users can create work orders" ON public.work_orders TO authenticated
  WITH CHECK (customer_id = (SELECT auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.work_orders FROM anon;
REVOKE TRUNCATE ON public.work_orders FROM authenticated;

-- 5. The deliberate visitor inserts keep INSERT only.
REVOKE UPDATE, DELETE, TRUNCATE ON public.app_events, public.vehicle_views FROM anon, authenticated;

-- After: row security is on; no INSERT, UPDATE, DELETE or ALL policy for PUBLIC or anon on these tables checks
-- nothing, except the two deliberate visitor inserts; anon holds no write grant but those two inserts; and on the
-- service-only tables no API role holds one.
DO $$
DECLARE
  v_open text;
BEGIN
  WITH t(tbl, service_only, visitor_insert) AS (VALUES
    ('ai_scan_sessions', true, false), ('api_usage_logs', true, false), ('ds_credit_transactions', true, false),
    ('image_descriptions', true, false), ('pii_audit_log', true, false), ('session_narratives', true, false),
    ('source_census', true, false), ('vehicle_price_fixes', true, false), ('search_analytics', true, false),
    ('notifications', false, false), ('user_notifications', false, false),
    ('organization_vehicle_notifications', false, false), ('reference_libraries', false, false),
    ('tool_catalog', false, false), ('work_orders', false, false),
    ('app_events', false, true), ('vehicle_views', false, true)
  ), api(role_oid) AS (VALUES (0::oid), ('anon'::regrole::oid))
  SELECT string_agg(problem, '; ') INTO v_open FROM (
    SELECT t.tbl || ': row security off' AS problem
    FROM t JOIN pg_class c ON c.oid = ('public.' || t.tbl)::regclass
    WHERE NOT c.relrowsecurity
    UNION ALL
    SELECT t.tbl || '.' || p.polname || ' checks nothing'
    FROM t JOIN pg_policy p ON p.polrelid = ('public.' || t.tbl)::regclass
    WHERE NOT t.visitor_insert AND p.polpermissive AND p.polcmd IN ('a', 'w', 'd', '*')
      AND p.polroles && ARRAY(SELECT role_oid FROM api)
      AND (pg_get_expr(p.polqual, p.polrelid) = 'true' OR pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
        OR (p.polcmd = 'a' AND p.polwithcheck IS NULL))
    UNION ALL
    SELECT t.tbl || ': ' || r.rolname || ' holds ' || g.priv
    FROM t CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
      CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) g(priv)
    WHERE has_table_privilege(r.rolname, ('public.' || t.tbl)::regclass, g.priv)
      AND (t.service_only OR (r.rolname = 'anon' AND NOT (t.visitor_insert AND g.priv = 'INSERT'))
        OR (t.visitor_insert AND g.priv <> 'INSERT'))
  ) found;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'open insert policies: still open after the change: %', v_open;
  END IF;
END $$;

COMMIT;
