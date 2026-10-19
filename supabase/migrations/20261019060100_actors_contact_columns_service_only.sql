-- actors contact columns become service-only.
--
-- Live on 2026-10-19 (counts only): actors has 9 rows, 7 carry phone and 3 carry free-text notes. The policy
-- "Anyone can view actors" (USING true, every role) plus a table-wide SELECT grant to anon and authenticated made
-- every column readable through the publishable key at /rest/v1/actors.
--
-- After:
--   * anon and authenticated lose the table-wide SELECT (and REFERENCES/TRIGGER) and get SELECT back on every
--     column except phone, email, website, location and notes. The row policy is unchanged, so names, types,
--     specialties and the other profile columns stay readable.
--   * service_role keeps every privilege; the resource graph reader (service-only) and the actor_profiles view
--     (owner-run; it never selected contact columns) keep working.
--   * A column added to actors later is not readable by anon or authenticated until a migration grants it.
-- No row is changed or deleted. No web, iOS or edge-function caller selects actors directly (searched 2026-10-19).
-- Contract: supabase/sql/test_actors_contact_columns_service_only.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.actors'::regclass AND attnum>0 AND NOT attisdropped
      AND attname IN ('phone','email','website','location','notes')) <> 5 THEN
    RAISE EXCEPTION 'actors contact columns not found as expected';
  END IF;
END $guard$;

REVOKE SELECT, REFERENCES, TRIGGER ON public.actors FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, actor_type, name, organization_name, parent_actor_id, city, state, country, specialties,
  certifications, trust_score, created_at, updated_at, bio, profile_image_url, licenses, training, years_experience,
  specialty_makes, specialty_eras, current_workload, max_concurrent_projects, typical_turnaround_days,
  total_documented_jobs, total_components_touched) ON public.actors TO anon, authenticated;

COMMENT ON COLUMN public.actors.phone IS 'Contact detail; service-only read (no anon/authenticated column grant).';
COMMENT ON COLUMN public.actors.email IS 'Contact detail; service-only read (no anon/authenticated column grant).';
COMMENT ON COLUMN public.actors.website IS 'Contact detail; service-only read (no anon/authenticated column grant).';
COMMENT ON COLUMN public.actors.location IS 'Free-text location that may be an address; service-only read.';
COMMENT ON COLUMN public.actors.notes IS 'Operator notes; service-only read.';
NOTIFY pgrst, 'reload schema';
COMMIT;
