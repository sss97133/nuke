-- vw_journal_density: count photos per user through (user_id, taken_at), not over the whole image table.
--
-- 20261014013500 (#1106, applied 03:51Z) made the journal's day index count every approved owner photo by the
-- day it was taken. Its filter (taken_at in the last 90 days, gate approved, not a listing import) has no index
-- that leads with taken_at, so the planner walked all of idx_vehicle_images_user_taken_at (vehicle_images: 52.5M
-- rows, 49 GB heap): over 60 s measured 03:55Z, so /api/journal would time out. The old view was fast only because
-- it counted a single source label and returned zeros.
--
-- Now the photo rows come from one index probe per user (public.profiles: 19 rows, every auth user has one),
-- fenced with OFFSET 0 so the planner cannot flatten the probes into a full index walk: 1.1 s cold for all users,
-- measured 03:58Z (29 approved owner photos over 15 days in the window). A photo with no user is not shop work
-- documented by anyone and does not count. Columns, meaning and grants are unchanged.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$ BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'vw_journal_density probes per user through public.profiles; it is missing';
  END IF;
END $guard$;

CREATE OR REPLACE VIEW public.vw_journal_density AS
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
           AND v.taken_at >= current_date - interval '90 days'
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
     WHERE r.receipt_date >= current_date - interval '90 days'
     GROUP BY r.receipt_date
  ),
  pay AS (
    SELECT p.payment_date::date AS d, count(*) AS n
      FROM public.work_order_payments p
     WHERE p.payment_date >= current_date - interval '90 days'
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
  'The public journal''s day index for the last 90 days: gate-approved photos documented by a user (one (user_id, taken_at) index probe per profile), excluding listing imports, by the day they were taken; receipts; completed payments; the vehicle with the most photos. Counts only; no money. Read by nuke_frontend/api/journal/index.ts.';

COMMIT;
