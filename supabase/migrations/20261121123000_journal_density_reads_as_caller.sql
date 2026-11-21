-- vw_journal_density reads as its caller, and its date bounds stay index conditions for a caller under row security.
--
-- The journal's day index is read by /api/journal, which has no session and reads with the publishable key. With
-- security_invoker the view's photo, receipt and payment counts and its top vehicle come only from rows the caller
-- may read: a caller without owner rights reads what a logged-out visitor reads, and a service-key caller reads what
-- it read before. Columns, meaning and grants are unchanged.
--
-- The three date bounds change type, not meaning. For a caller under row security the planner uses a condition as
-- an index condition only when its operator is leakproof. `taken_at >= current_date - interval '90 days'` compares
-- timestamptz with timestamp (timestamptz_ge_timestamp, not leakproof), so the logged-out role could not use the
-- bound on idx_vehicle_images_user_taken_at: measured 2026-11-21 as the logged-out role, the planner chose a bitmap
-- scan costed at 165,559 (13 for the index probe) and a 7-day read of one user's photos did not finish in 10 s.
-- Cast to the column's own type the comparison is timestamptz_ge (leakproof): the whole view as the logged-out role
-- ran in 30 to 57 ms (91 rows, 1,915 photo rows probed). Receipts (date_ge) and payments (timestamptz_ge) follow.
--
-- A later CREATE OR REPLACE of this view must repeat WITH (security_invoker = true): a replace without it clears
-- the option. supabase/sql/test_journal_density_counts_only.sql holds both rules.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$ BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'vw_journal_density probes per user through public.profiles; it is missing';
  END IF;
END $guard$;

CREATE OR REPLACE VIEW public.vw_journal_density WITH (security_invoker = true) AS
  WITH dates AS (
    SELECT generate_series(current_date - interval '90 days', current_date::timestamp, interval '1 day')::date AS d
  ),
  photo_rows AS MATERIALIZED (
    SELECT i.d, i.vehicle_id
      FROM public.profiles p
      CROSS JOIN LATERAL (
        SELECT v.taken_at::date AS d, v.vehicle_id
          FROM public.vehicle_images v
         WHERE v.user_id = p.id
           AND v.taken_at >= (current_date - interval '90 days')::timestamptz
           AND v.vision_gate_status = 'approved'
           AND coalesce(v.source, '') NOT IN ('bat_import', 'external_import')
        OFFSET 0
      ) i
  ),
  photo AS (
    SELECT d, count(*) AS n FROM photo_rows GROUP BY d
  ),
  top_vehicle AS (
    SELECT DISTINCT ON (d) d, vehicle_id
      FROM (SELECT d, vehicle_id, count(*) AS n FROM photo_rows WHERE vehicle_id IS NOT NULL GROUP BY d, vehicle_id) t
     ORDER BY d, n DESC, vehicle_id
  ),
  rcpt AS (
    SELECT r.receipt_date AS d, count(*) AS n
      FROM public.receipts r
     WHERE r.receipt_date >= current_date - 90
     GROUP BY r.receipt_date
  ),
  pay AS (
    SELECT p.payment_date::date AS d, count(*) AS n
      FROM public.work_order_payments p
     WHERE p.payment_date >= (current_date - interval '90 days')::timestamptz
       AND p.status = 'completed'
     GROUP BY p.payment_date::date
  )
  SELECT dates.d AS date,
         coalesce(photo.n, 0)::bigint AS photo_count,
         coalesce(rcpt.n, 0)::bigint AS receipt_count,
         coalesce(pay.n, 0)::bigint AS payment_count,
         top_vehicle.vehicle_id AS top_vehicle_id
    FROM dates
    LEFT JOIN photo ON photo.d = dates.d
    LEFT JOIN top_vehicle ON top_vehicle.d = dates.d
    LEFT JOIN rcpt ON rcpt.d = dates.d
    LEFT JOIN pay ON pay.d = dates.d
   ORDER BY dates.d DESC;

COMMENT ON VIEW public.vw_journal_density IS
  'The public journal''s day index for the last 90 days: gate-approved photos documented by a user (one (user_id, taken_at) index probe per profile), excluding listing imports, by the day they were taken; receipts; completed payments; the vehicle with the most photos that day. Counts only, no money. Reads as its caller (security_invoker): every count and the top vehicle hold only rows the caller may read.';

COMMIT;
