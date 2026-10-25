-- O31: build_activity_snapshots is monthly build spend (total/part/tool spend, top vendors with amounts).
-- Rule: the build record is public, its costs are owner-only. Anon could read every row over PostgREST
-- (47 rows, e.g. the 1977 Blazer's monthly vendor spend in BuildTimelineChart).
-- Every row is spend-derived, so reads are row-gated to the vehicle's owner. SELECT stays granted so the
-- car file's query returns an empty list (no error) for the public; service_role bypasses RLS for writers.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.build_activity_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'build_activity_snapshots'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.build_activity_snapshots', p.policyname);
  END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.build_activity_snapshots FROM anon, authenticated;
GRANT SELECT ON public.build_activity_snapshots TO anon, authenticated;

CREATE POLICY build_activity_snapshots_owner_read ON public.build_activity_snapshots
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = build_activity_snapshots.vehicle_id
      AND (v.owner_id = auth.uid() OR v.user_id = auth.uid() OR v.uploaded_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.vehicle_ownerships o
                   WHERE o.vehicle_id = v.id AND o.owner_profile_id = auth.uid() AND o.is_current = true)
        OR EXISTS (SELECT 1 FROM public.ownership_verifications ov
                   WHERE ov.vehicle_id = v.id AND ov.user_id = auth.uid() AND ov.status = 'approved'))
  ));
