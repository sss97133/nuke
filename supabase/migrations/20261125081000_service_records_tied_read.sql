-- service_records_tied_read_v1: a vehicle's service records (cost, shop, work performed) are read only by viewers tied
-- to that vehicle, by the same test the spend readers use (vehicle_viewer_tied, vehicle_spend_viewer_v1).
--
-- WHY. Audit 2026-11-24 (ta-skeptic, Trans Am war board): the only SELECT policy was
-- allow_authenticated_read_service_records USING (true) TO authenticated, so any signed-in user read cost on all 242
-- rows (one vehicle, 182 with a cost). Anon had no policy and read none. The table appears in no repo migration; the
-- policy was applied outside one.
--
-- WHAT CHANGES. That policy is replaced by service_records_tied_read: TO authenticated USING
-- (public.vehicle_viewer_tied(vehicle_id)), so the vehicle's owner_id / user_id / created_by_user_id / uploaded_by,
-- or a user vehicle_user_has_access admits, read the rows; anyone else reads none, as anon already did. The whole row
-- follows the tie (shop and work text included), as receipts do. Writes are unchanged (no write policy exists; the
-- service role writes). anon keeps no policy.
--
-- CONSUMERS (grep 2026-11-24): VehicleDocumentIntelligence.tsx (select * by vehicle_id; imported by no page);
-- analyze-vehicle-documents (service role, writes); compute_vehicle_grade (SECURITY INVOKER: an untied caller now
-- counts 0 records, as anon already did; jobs run it as the service role, which bypasses RLS).
--
-- REVERT. supabase/sql/revert_20261125081000_service_records_tied_read.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP POLICY IF EXISTS allow_authenticated_read_service_records ON public.service_records;
DROP POLICY IF EXISTS service_records_tied_read ON public.service_records;
CREATE POLICY service_records_tied_read ON public.service_records FOR SELECT TO authenticated
  USING (public.vehicle_viewer_tied(vehicle_id));
COMMENT ON POLICY service_records_tied_read ON public.service_records IS
  'service_records_tied_read_v1: rows (cost, shop, work) only for viewers vehicle_viewer_tied admits; anon has no policy.';
