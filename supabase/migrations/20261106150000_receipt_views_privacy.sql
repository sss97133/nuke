-- user_receipt_summary answers only its own user; vehicle_receipts_rollup_v answers for public vehicles and for the caller's own.
--
-- Both views run as their owner (postgres, which bypasses row-level security) over receipts, whose policies answer the paying user and the
-- uploader of the vehicle. A view that runs as its owner without a filter of its own is a door past those policies. Measured read-only on prod,
-- 2026-10-29, with the API roles simulated inside a transaction that was rolled back (counts only):
--   user_receipt_summary       SELECT for authenticated. anon has no SELECT but still has INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER,
--                              which nothing can use on an aggregate view. 1 row in all, the single paying user's. A random signed-in uid with no
--                              receipts read it: 1 of 1 rows belonged to someone else. The row holds the spending total, the first and last receipt
--                              dates, the average, the total per vendor and the total per category.
--   vehicle_receipts_rollup_v  SELECT for anon and authenticated, and no test of vehicles.is_public in the definition. 8 rollup rows, one per vehicle:
--                              8 on public vehicles, 0 on non-public ones, 0 on a vehicle with no row. Nothing private shows today. The first receipt
--                              scoped to a non-public vehicle, or a vehicle made non-public, would have shown its lifetime, 90-day and 365-day totals
--                              to every visitor.
-- Callers: none. Neither name is in a repository file outside its own migrations and the generated dictionary, in a function body, view, materialized
-- view, rule, policy or pg_cron job on prod, in the API edge log (24 hours is the most the log query reaches; the same window holds 168,852 requests
-- for the receipts and vehicles paths, so the filter does see REST traffic), or in a PostgREST statement in pg_stat_statements since its reset on
-- 2026-10-17. The vehicle profile reads receipts as the owner (row-level security) and receipts_public_summary otherwise; neither changes.
--
-- Now:
--   user_receipt_summary       WITH (security_invoker = true), so receipts and line_items answer as the caller and their policies apply, and the view
--                              keeps only user_id = auth.uid() (in each aggregate and on the result). The signed-in owner gets their own row with the
--                              same numbers as before. Another user, a signed-in account with no receipts, and a request with no user (service_role
--                              carries none) get no row, and so does an uploader who can read another user's receipt on their vehicle. anon loses
--                              every privilege on it; authenticated keeps SELECT and loses the rest.
--   vehicle_receipts_rollup_v  still owner-run, because it totals the receipts of public vehicles that the caller cannot read, so its row filter is the
--                              gate. A vehicle's rollup is returned when the vehicle is public and not deleted (the whole visibility test of
--                              .claude/rules/db-safety.md), or when the caller is its owner, uploader or a contributor with access: the rule
--                              20261014050000_build_manifest_money_owner_only.sql applies to money (owner_id, user_id, created_by_user_id,
--                              uploaded_by, or vehicle_user_has_access). The totals are unchanged. A vehicle with no row in vehicles has no rollup.
--                              WITH (security_barrier = true), like receipts_public_summary, so a filter the caller writes cannot run before the
--                              gate unless it is leakproof. anon and authenticated keep SELECT and lose the rest.
-- receipts_public_summary is not touched. A later CREATE OR REPLACE of either view must keep these filters; the contract is
-- supabase/sql/test_receipt_views_privacy.sql. Replay-safe: CREATE OR REPLACE, REVOKE and GRANT, and one transaction.
SET lock_timeout = '90s';
SET statement_timeout = '120s';

BEGIN;

-- Stop, rather than undo a later change, if a live definition has lost a filter this migration was written from (2026-10-29).
DO $guard$
DECLARE d text;
BEGIN
  d := pg_get_viewdef('public.user_receipt_summary'::regclass);
  IF d NOT LIKE '%amount_check%' OR d NOT LIKE '%duplicate_of%' OR d NOT LIKE '%line_items%' THEN
    RAISE EXCEPTION 'user_receipt_summary differs from the definition this migration was written from';
  END IF;
  d := pg_get_viewdef('public.vehicle_receipts_rollup_v'::regclass);
  IF d NOT LIKE '%receipt_doc_kind_excluded%' OR d NOT LIKE '%amount_check%' OR d NOT LIKE '%duplicate_of%' THEN
    RAISE EXCEPTION 'vehicle_receipts_rollup_v differs from the definition this migration was written from';
  END IF;
END
$guard$;

-- 1. The signed-in user's own spending summary.
CREATE OR REPLACE VIEW public.user_receipt_summary WITH (security_invoker = true) AS
 WITH vendor_counts AS (
         SELECT r.user_id,
            r.vendor_name,
            count(*) AS receipt_count,
            sum(r.total_amount) AS vendor_total
           FROM public.receipts r
          WHERE r.user_id = (SELECT auth.uid()) AND r.vendor_name IS NOT NULL AND r.processing_status = 'completed'::text AND r.duplicate_of IS NULL AND (r.amount_check = ANY (ARRAY['verified'::public.receipt_amount_check, 'plausible'::public.receipt_amount_check]))
          GROUP BY r.user_id, r.vendor_name
        ), category_totals AS (
         SELECT li.user_id,
            COALESCE(li.category, 'uncategorized'::text) AS category,
            sum(li.total_price) AS category_total,
            count(*) AS item_count
           FROM public.line_items li
          WHERE li.user_id = (SELECT auth.uid()) AND li.total_price IS NOT NULL
          GROUP BY li.user_id, (COALESCE(li.category, 'uncategorized'::text))
        ), user_stats AS (
         SELECT r.user_id,
            count(DISTINCT r.id) AS total_receipts,
            sum(r.total_amount) AS total_spending,
            min(r.transaction_date) AS first_receipt_date,
            max(r.transaction_date) AS last_receipt_date,
            avg(r.total_amount) AS avg_receipt_amount
           FROM public.receipts r
          WHERE r.user_id = (SELECT auth.uid()) AND r.processing_status = 'completed'::text AND r.duplicate_of IS NULL AND (r.amount_check = ANY (ARRAY['verified'::public.receipt_amount_check, 'plausible'::public.receipt_amount_check]))
          GROUP BY r.user_id
        )
 SELECT us.user_id,
    us.total_receipts,
    us.total_spending,
    us.first_receipt_date,
    us.last_receipt_date,
    us.avg_receipt_amount,
    COALESCE(( SELECT jsonb_object_agg(vc.vendor_name, jsonb_build_object('count', vc.receipt_count, 'total', vc.vendor_total)) AS jsonb_object_agg
           FROM vendor_counts vc
          WHERE vc.user_id = us.user_id), '{}'::jsonb) AS vendor_breakdown,
    COALESCE(( SELECT jsonb_object_agg(ct.category, jsonb_build_object('total', ct.category_total, 'items', ct.item_count)) AS jsonb_object_agg
           FROM category_totals ct
          WHERE ct.user_id = us.user_id), '{}'::jsonb) AS spending_by_category
   FROM user_stats us
  WHERE us.user_id = (SELECT auth.uid());

REVOKE ALL ON public.user_receipt_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_receipt_summary TO authenticated;
COMMENT ON VIEW public.user_receipt_summary IS
  'Spending summary of the signed-in user''s own receipts: one row for auth.uid(), none for anyone else and none for anon. Security-invoker over receipts and line_items (2026-10-29).';

-- 2. Receipt totals per vehicle: public vehicles for everyone, any other vehicle for its owner, uploader or a contributor with access.
CREATE OR REPLACE VIEW public.vehicle_receipts_rollup_v WITH (security_barrier = true) AS
 SELECT g.vehicle_id,
    g.total_lifetime,
    g.total_90d,
    g.total_365d,
    g.receipts_count
   FROM ( SELECT (r.scope_id)::uuid AS vehicle_id,
            sum(
                CASE
                    WHEN (COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) THEN r.total_amount
                    ELSE (0)::numeric
                END) AS total_lifetime,
            sum(
                CASE
                    WHEN ((COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (r.transaction_date >= ((now() - '90 days'::interval))::date)) THEN r.total_amount
                    ELSE (0)::numeric
                END) AS total_90d,
            sum(
                CASE
                    WHEN ((COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (r.transaction_date >= ((now() - '365 days'::interval))::date)) THEN r.total_amount
                    ELSE (0)::numeric
                END) AS total_365d,
            count(*) FILTER (WHERE (COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text]))) AS receipts_count
           FROM public.receipts r
          WHERE ((r.scope_type = 'vehicle'::text) AND (NOT public.receipt_doc_kind_excluded(r.document_kind)) AND ((r.duplicate_of IS NULL) AND (r.amount_check = ANY (ARRAY['verified'::public.receipt_amount_check, 'plausible'::public.receipt_amount_check]))))
          GROUP BY r.scope_id) g
     JOIN public.vehicles v ON v.id = g.vehicle_id
  WHERE (v.is_public = true AND v.deleted_at IS NULL)
     OR ((SELECT auth.uid()) IS NOT NULL
         AND ((SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
              OR public.vehicle_user_has_access(v.id, (SELECT auth.uid()))));

REVOKE ALL ON public.vehicle_receipts_rollup_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_receipts_rollup_v TO anon, authenticated;
COMMENT ON VIEW public.vehicle_receipts_rollup_v IS
  'Receipt totals per vehicle. A public, undeleted vehicle for everyone; any other vehicle only for its owner, uploader or a contributor with access (vehicle_user_has_access). Owner-run with a security barrier: the row filter is the gate (2026-10-29).';

-- This migration's own result, last, in the same transaction: a wrong end state rolls everything back.
DO $check$
DECLARE r regclass;
BEGIN
  r := 'public.user_receipt_summary'::regclass;
  IF has_table_privilege('anon', r, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege('anon', r, 'SELECT,INSERT,UPDATE,REFERENCES')
     OR NOT has_table_privilege('authenticated', r, 'SELECT')
     OR has_table_privilege('authenticated', r, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = r), false) THEN
    RAISE EXCEPTION 'user_receipt_summary: grants or options are not the intended ones';
  END IF;
  r := 'public.vehicle_receipts_rollup_v'::regclass;
  IF NOT has_table_privilege('anon', r, 'SELECT')
     OR NOT has_table_privilege('authenticated', r, 'SELECT')
     OR has_table_privilege('anon', r, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', r, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege('anon', r, 'INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('authenticated', r, 'INSERT,UPDATE,REFERENCES')
     OR NOT coalesce((SELECT 'security_barrier=true' = ANY (reloptions) FROM pg_class WHERE oid = r), false) THEN
    RAISE EXCEPTION 'vehicle_receipts_rollup_v: grants or options are not the intended ones';
  END IF;
END
$check$;

COMMIT;
