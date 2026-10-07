-- NOTE (2026-10-07, lead): this file shares its version prefix 20261007100000 with 20261007100000_schema_proposal_apply_add_source.sql (#766); both applied on
-- 2026-10-07. Never rename either: CI applies files a merge commit adds, a rename is an added path, and the md5 guard in
-- the apply-function file would refuse a re-apply. A comment edit like this one is ignored by the deploy.
-- 20261007100000_fold_location_source_passthrough.sql
--
-- fold_external_identity_location (20261007070000) hardcodes metadata.location_source = 'bat_member_page'.
-- The fold is source-agnostic by design — it projects ANY external_identity location observation — so once
-- seller-listing-address and comment-mined locations land (both write structured_data.source), the hardcode
-- would mislabel their provenance. Confirmed finding 2026-10-07: 457/457 located identities are sellers, so
-- the real sources are the listing address and comments, not member pages; provenance matters for the
-- multi-evidence model. Fix: carry the observation's structured_data.source through to metadata.location_source.
-- When the observation has no source, write NO location_source at all (jsonb_strip_nulls drops the NULL) rather
-- than invent one — facts are never invented; those rows are counted in the return (folded_without_source) so the
-- gap is visible and a reader reads "no source" as exactly that. No behavior change otherwise; CREATE OR REPLACE
-- preserves the service_role-only ACL, and the REVOKE/GRANT is re-applied below to keep it explicit.

BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fold_external_identity_location(p_batch integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_writer constant text := 'fold-external-identity-location';
  v_prev_writer text := current_setting('app.writer', true);
  v_changed integer := 0;
  v_candidates integer := 0;
  v_no_source integer := 0;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 50000 THEN
    RAISE EXCEPTION 'fold_external_identity_location: p_batch must be 1..50000, got %', p_batch;
  END IF;

  PERFORM set_config('app.writer', c_writer, true);

  -- Latest non-superseded location observation per identity, among identities whose metadata state/country
  -- is missing or differs from the observation. state/country only; merge, never replace. The observation's
  -- own source is carried through to metadata.location_source (member page, listing address, comment, ...).
  WITH latest AS (
    SELECT DISTINCT ON (o.subject_id)
      o.subject_id,
      nullif(btrim(o.structured_data ->> 'home_state'), '')   AS state,
      nullif(btrim(o.structured_data ->> 'home_country'), '') AS country,
      nullif(btrim(o.structured_data ->> 'source'), '')       AS src,
      o.observed_at
    FROM public.vehicle_observations o
    WHERE o.subject_type = 'external_identity'
      AND o.is_superseded = false
      AND o.structured_data ? 'home_state'
    ORDER BY o.subject_id, o.observed_at DESC NULLS LAST
  ),
  pick AS (
    SELECT l.*
    FROM latest l
    JOIN public.external_identities e ON e.id = l.subject_id
    WHERE (l.state IS NOT NULL OR l.country IS NOT NULL)
      AND ( (e.metadata ->> 'state')   IS DISTINCT FROM l.state
         OR (e.metadata ->> 'country') IS DISTINCT FROM l.country )
    LIMIT p_batch
  ),
  upd AS (
    UPDATE public.external_identities e
    SET metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'state', p.state,
          'country', p.country,
          'location_source', p.src,
          'location_observed_at', p.observed_at
        ))
    FROM pick p
    WHERE e.id = p.subject_id
    RETURNING p.src AS src
  )
  SELECT (SELECT count(*) FROM pick),
         (SELECT count(*) FROM upd),
         (SELECT count(*) FROM upd WHERE src IS NULL)
    INTO v_candidates, v_changed, v_no_source;

  IF v_changed > 0 THEN
    INSERT INTO public.write_receipts (at, tbl, op, rows, writer, db_role, app_name, txid)
    VALUES (now(), 'external_identities', 'UPDATE', v_changed, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object('candidates', v_candidates, 'folded', v_changed,
                            'folded_without_source', v_no_source, 'batch', p_batch,
                            'more', v_candidates >= p_batch);
END
$fn$;

COMMENT ON FUNCTION public.fold_external_identity_location(integer) IS
'Projects a BaT member home location (state + country ONLY, masking) from identity-subject observations into external_identities.metadata (migration 20261007070000; source passthrough 20261007100000). Reads the latest non-superseded vehicle_observations row per subject (subject_type external_identity; structured_data.home_state/home_country) and merges {state, country, location_source = the observation''s structured_data.source (member page, listing address, comment, ...; omitted entirely when the observation has no source, never invented), location_observed_at} into metadata by id, only where state/country differ. Bounded by p_batch (1..50000). Never writes city or finer, never touches platform/handle, merges (never replaces) metadata. app.writer=fold-external-identity-location set in the body and the caller value restored; one write_receipts row per changing call. Returns {candidates, folded, folded_without_source, batch, more}.';

REVOKE ALL ON FUNCTION public.fold_external_identity_location(integer) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.fold_external_identity_location(integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.fold_external_identity_location(integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.fold_external_identity_location(integer) TO service_role;
  END IF;
END $grants$;

COMMIT;
