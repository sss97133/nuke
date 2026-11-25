-- Revert 20261125081000_service_records_tied_read: restores the USING (true) read for every signed-in user.
SET lock_timeout = '5s';
DROP POLICY IF EXISTS service_records_tied_read ON public.service_records;
CREATE POLICY allow_authenticated_read_service_records ON public.service_records FOR SELECT TO authenticated USING (true);
