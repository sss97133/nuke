BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Which of a book owner's vehicles were photographed around a purchase date. The expense-use editor shows these as
-- suggestions when a reviewer assigns a cost to a vehicle: a part bought on day D is usually fitted between D and D+3,
-- and the owner photographs the work, so the vehicles in his photos from the day before to three days after are the
-- likely recipients. A day on which five or more of his vehicles were photographed (an inventory or show session) says
-- nothing about one purchase and is left out. The reader returns photo dates only; the reviewer chooses the vehicle.
-- SECURITY INVOKER: vehicles and vehicle_images are read under the caller's own policies, so a reviewer sees photo dates
-- only for vehicles they can already see. Uses vehicle_images_taken_date (vehicle_id, taken_at).
CREATE OR REPLACE FUNCTION public.accounting_vehicle_photo_days(p_owner_id uuid, p_date date)
RETURNS TABLE(vehicle_id uuid, photo_days date[], images bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH owned AS (
    SELECT v.id FROM vehicles v
    WHERE (v.owner_id = p_owner_id OR v.user_id = p_owner_id) AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
  ), shots AS (
    SELECT i.vehicle_id, (i.taken_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n
    FROM vehicle_images i JOIN owned o ON o.id = i.vehicle_id
    WHERE p_date IS NOT NULL AND i.taken_at >= (p_date - 1)::timestamp AT TIME ZONE 'UTC'
      AND i.taken_at < (p_date + 4)::timestamp AT TIME ZONE 'UTC'
    GROUP BY 1, 2
  ), bulk AS (
    SELECT day FROM shots GROUP BY day HAVING count(*) >= 5
  )
  SELECT s.vehicle_id, array_agg(s.day ORDER BY s.day), sum(s.n)::bigint
  FROM shots s
  WHERE s.day NOT IN (SELECT day FROM bulk)
  GROUP BY s.vehicle_id
  ORDER BY count(*) DESC, sum(s.n) DESC, s.vehicle_id
  LIMIT 5
$$;

REVOKE ALL ON FUNCTION public.accounting_vehicle_photo_days(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_vehicle_photo_days(uuid, date) TO authenticated, service_role;

COMMIT;
