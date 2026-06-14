-- Fix image_sets_select_policy performance for anon profile loads.
--
-- Problem (measured on prod 2026-06-11, anon key): SELECT ... FROM image_sets
-- WHERE vehicle_id=eq.<k5> took 15.4s and 500'd against the anon 15s
-- statement_timeout. This single query was the longest stall in the
-- signed-out vehicle-profile load.
--
-- Two defects in the old policy:
--   1. creator clause was a correlated subquery over the ENTIRE vehicles
--      table: vehicle_id IN (SELECT id FROM vehicles WHERE image_sets.created_by = auth.uid())
--   2. public clause was an uncorrelated IN over all ~900K vehicle ids:
--      vehicle_id IN (SELECT id FROM vehicles WHERE is_draft = false)
--      which the generic (prepared) plan materializes per-row instead of hashing.
--
-- Fix: express the public clause as a correlated EXISTS (drives vehicles_pkey,
-- O(1) per image_sets row in every plan shape) and the creator clause as a
-- direct comparison. Semantics preserved:
--   1. anyone can see sets of non-draft vehicles
--   2. users with a role on the vehicle can see its sets
--   3. the creator can see sets they created
ALTER POLICY image_sets_select_policy ON public.image_sets
USING (
  EXISTS (SELECT 1 FROM vehicles v WHERE v.id = image_sets.vehicle_id AND v.is_draft = false)
  OR (vehicle_id IN (
    SELECT user_vehicle_roles.vehicle_id FROM user_vehicle_roles
    WHERE user_vehicle_roles.user_id = (SELECT auth.uid())
  ))
  OR (created_by = (SELECT auth.uid()))
);
