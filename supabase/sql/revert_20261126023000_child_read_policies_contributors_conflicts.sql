-- Reverses 20261126023000_child_read_policies_contributors_conflicts.sql: the three open read policies come back as they
-- were read live on 2026-11-25, the four replacements go, and the two watch rows are switched off (kept, not deleted).
-- The EXECUTE grant on vehicle_publicly_readable to PUBLIC stays: 20261125225000 and 20261125225500 make the same grant.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
DROP POLICY IF EXISTS vehicle_contributors_public_read ON public.vehicle_contributors;
DROP POLICY IF EXISTS vehicle_contributors_tied_read ON public.vehicle_contributors;
DROP POLICY IF EXISTS read_contributors ON public.vehicle_contributors;
DROP POLICY IF EXISTS "Allow authenticated reads" ON public.vehicle_contributors;
CREATE POLICY read_contributors ON public.vehicle_contributors FOR SELECT TO public USING (true);
CREATE POLICY "Allow authenticated reads" ON public.vehicle_contributors FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS timeline_event_conflicts_tied_read ON public.timeline_event_conflicts;
DROP POLICY IF EXISTS timeline_event_conflicts_public_read ON public.timeline_event_conflicts;
CREATE POLICY timeline_event_conflicts_public_read ON public.timeline_event_conflicts FOR SELECT TO public USING (true);
DO $w$
BEGIN
  IF to_regclass('public.private_row_probes') IS NOT NULL THEN
    UPDATE public.private_row_probes SET active = false
     WHERE reader = '' AND owner_lane = 'ta-provenance' AND position('20261126023000' in note) > 0
       AND relation IN ('vehicle_contributors', 'timeline_event_conflicts');
  END IF;
END $w$;
COMMIT;
