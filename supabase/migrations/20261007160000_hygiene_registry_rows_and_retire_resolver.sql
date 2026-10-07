-- 20261007160000_hygiene_registry_rows_and_retire_resolver.sql
--
-- Three small repairs from the night of 2026-10-07, each the mechanism behind a finding already recorded:
--
-- 1. pipeline_registry: observation_sources and observation_extractors gained a second writer when #766
--    (20261007100000_schema_proposal_apply_add_source.sql) taught fn_schema_proposal_apply to insert the
--    observation_sources row and, if declared, the observation_extractors reader row for an approved add_source
--    proposal. The table-level registry rows (column_name NULL) still name only migrations (and derive-dispatch /
--    evaluate_agent_tier for updates). write_via gains the function, appended once; owned_by is unchanged.
--    Table-level rows are keyed by (table_name, column_name IS NULL), never by ON CONFLICT (NULLs never conflict).
--
-- 2. resolve_organization_from_url(p_url text, p_extracted_name text, p_org_type text) is retired. Read-only check
--    2026-10-07 06:23:41Z (skylar-66's lane): a scheme-less website yields an empty domain that matches every
--    organization; a lookup for nsf.gov matched 232 organizations and would have returned the wrong one. No caller
--    on main in supabase/functions, nuke_frontend/src or scripts; pipeline_registry names create-org-from-url as the
--    organizations owner, and the function is not SECURITY DEFINER. Retirement = REVOKE EXECUTE from every role and a
--    COMMENT; no DROP, so it can be fixed and re-granted later with a contract.
--
-- 3. (documentation only, in the two files themselves) 20261007100000_fold_location_source_passthrough.sql (#759)
--    and 20261007100000_schema_proposal_apply_add_source.sql (#766) share a version prefix. Neither is renamed:
--    CI applies files a merge commit adds, a rename shows as an added path, and #766's md5 guard would refuse the
--    re-apply. Each file gets a header line saying so.
--
-- Bounded: registry UPDATE (2 rows), REVOKE, COMMENT. No testimony table touched. Idempotent.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

UPDATE public.pipeline_registry
SET write_via = write_via || ' fn_schema_proposal_apply (add_source branch, 20261007100000): inserts the observation_sources row when an add_source proposal is approved (2026-10-07).',
    updated_at = now()
WHERE table_name = 'observation_sources' AND column_name IS NULL
  AND write_via NOT LIKE '%fn_schema_proposal_apply%';

UPDATE public.pipeline_registry
SET write_via = write_via || ' fn_schema_proposal_apply (add_source branch, 20261007100000): inserts the declared observation_extractors reader row when an add_source proposal is approved (2026-10-07).',
    updated_at = now()
WHERE table_name = 'observation_extractors' AND column_name IS NULL
  AND write_via NOT LIKE '%fn_schema_proposal_apply%';

DO $retire$
BEGIN
  IF to_regprocedure('public.resolve_organization_from_url(text, text, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.resolve_organization_from_url(text, text, text) FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.resolve_organization_from_url(text, text, text) FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON FUNCTION public.resolve_organization_from_url(text, text, text) FROM authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      REVOKE ALL ON FUNCTION public.resolve_organization_from_url(text, text, text) FROM service_role;
    END IF;
    COMMENT ON FUNCTION public.resolve_organization_from_url(text, text, text) IS
    'RETIRED 2026-10-07 (migration 20261007160000): EXECUTE revoked from every role. A scheme-less website gives an empty domain that matches every organization (nsf.gov matched 232 organizations in a read-only check 2026-10-07 06:23Z and would have returned the wrong one). No caller on main. Organizations are created by create-org-from-url (pipeline_registry owner). Fix the empty-domain case with a PG17 contract before re-granting.';
  END IF;
END
$retire$;

COMMIT;
