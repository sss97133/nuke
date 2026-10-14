-- vw_journal_density: the public journal's day index, counts only, over every documented photo.
--
-- Measured 2026-10-14 01:25Z: the view counted photos only where vehicle_images.source = 'iphoto_60d', the label of
-- one sync run, so every other source (iphoto, agent_verified_iphoto, owner_upload, daily_receipt, user_upload,
-- hd_archive, ...) was invisible to the journal; and it carried receipt_total and payment_total, money, which the
-- public /api/journal served with the service role to anyone. Nothing has landed in its 90-day window since
-- April (receipts: last 2026-04-15; payments: last 2026-03-29; photos: nothing from the phone since 09-29), so no
-- amount reached a visitor, but the door was open.
--
-- Now: photo_count counts gate-approved photos of any owner source by the day they were taken (listing imports
-- excluded: a BaT photo is not shop work), receipt_count and payment_count count, top_vehicle_id is the vehicle
-- with the most photos that day, and no money column exists. The owner's money reads through the authenticated
-- day receipt (jsonb_mask_money), never through this view.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DROP VIEW IF EXISTS public.vw_journal_density;
CREATE VIEW public.vw_journal_density AS
  WITH dates AS (
    SELECT generate_series(current_date - interval '90 days', current_date::timestamp, interval '1 day')::date AS d
  ),
  photo AS (
    SELECT i.taken_at::date AS d, count(*) AS n
      FROM public.vehicle_images i
     WHERE i.taken_at >= current_date - interval '90 days'
       AND i.taken_at IS NOT NULL
       AND i.vision_gate_status = 'approved'
       AND coalesce(i.source, '') NOT IN ('bat_import', 'external_import')
     GROUP BY i.taken_at::date
  ),
  top_vehicle AS (
    SELECT DISTINCT ON (d) d, vehicle_id
      FROM (
        SELECT i.taken_at::date AS d, i.vehicle_id, count(*) AS n
          FROM public.vehicle_images i
         WHERE i.taken_at >= current_date - interval '90 days'
           AND i.taken_at IS NOT NULL
           AND i.vehicle_id IS NOT NULL
           AND i.vision_gate_status = 'approved'
           AND coalesce(i.source, '') NOT IN ('bat_import', 'external_import')
         GROUP BY i.taken_at::date, i.vehicle_id
      ) t
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
  'The public journal''s day index for the last 90 days: gate-approved photos of any owner source by the day they were taken (listing imports excluded), receipts, completed payments, and the vehicle with the most photos. Counts only; no money. Read by nuke_frontend/api/journal/index.ts.';
GRANT SELECT ON public.vw_journal_density TO service_role;

COMMIT;
