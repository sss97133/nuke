-- 20261007070000_fold_external_identity_location.sql
--
-- A standing domino, built ahead of its data (identity-origin harvest, docs/features/identity-origin/SPEC.md).
-- It is valid with zero rows today and begins to function the moment the fetcher (PR #3) lands its first
-- external_identity location observations — the framework lands first, the data pushes it.
--
-- WHAT: fold_external_identity_location() projects a BaT member's home location (STATE + COUNTRY only) from
-- identity-subject observations into external_identities.metadata, where the 457 existing seller-sourced
-- locations already live under the top-level keys {state, country} (sample 2026-01-29). This is the buyer-home
-- signal the demand-origin map reads; it is distinct from bat_identity_stats_v1.top_purchase_locations (the
-- car's listing_location, not the person's home).
--
-- THE #2<->#3 OBSERVATION CONTRACT (this fold reads exactly what the fetcher writes):
--   vehicle_observations row with subject_type='external_identity', subject_id=external_identities.id,
--   is_superseded=false, kind='specification', and structured_data carrying:
--     { "home_state": "<2-letter or name>", "home_country": "<country>", "grain": "state_country",
--       "source": "bat_member_page" }
--   observed_at = the member-page fetch time; source_id = the listing_page_snapshots receipt's source.
--   The fetcher never emits a finer grain than state (masking happens before the observation is written).
--
-- MASKING (observation_is_public spectrum, state/country public grain): this fold writes ONLY metadata.state
--   and metadata.country. It never writes city or anything finer, never touches platform or handle, and merges
--   (metadata || patch) so no other metadata key is disturbed.
--
-- WRITER: external_identities is not a testimony table; the metadata merge is the sanctioned path the
--   data-model lead pre-approved (update by id, jsonb merge, never replace). app.writer is set in the body and
--   the caller's value restored; the function self-writes one write_receipts row per call that changed rows.
--
-- CONTRACT (PostgreSQL 17): supabase/sql/test_fold_external_identity_location.sql.
--
-- TODAY: 0 external_identity location observations exist (the subject value went live at 2026-10-07 02:50Z in
--   20261007053000). So this call folds 0 rows until the fetcher runs; that is the domino standing, as intended.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- Owner of the computed metadata location keys (upsert: a skipped registration would leave an older owner named).
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES (
  'external_identities', 'metadata',
  'fold-external-identity-location',
  'metadata.state / metadata.country (and metadata.location_source, metadata.location_observed_at) for a BaT member are the home location at STATE/COUNTRY grain, projected from identity-subject observations (subject_type external_identity, structured_data.home_state/home_country) by fold_external_identity_location(). Other metadata keys are written elsewhere; this owner names only the location keys. Never city or finer (masking). Derived, never testimony.',
  false,
  'fold_external_identity_location(p_batch) — bounded, app.writer=fold-external-identity-location, jsonb merge by id; see docs/features/identity-origin/SPEC.md.')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();

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
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 50000 THEN
    RAISE EXCEPTION 'fold_external_identity_location: p_batch must be 1..50000, got %', p_batch;
  END IF;

  PERFORM set_config('app.writer', c_writer, true);

  -- Latest non-superseded location observation per identity, among identities whose metadata state/country
  -- is missing or differs from the observation. state/country only; merge, never replace.
  WITH latest AS (
    SELECT DISTINCT ON (o.subject_id)
      o.subject_id,
      nullif(btrim(o.structured_data ->> 'home_state'), '')   AS state,
      nullif(btrim(o.structured_data ->> 'home_country'), '') AS country,
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
          'location_source', 'bat_member_page',
          'location_observed_at', p.observed_at
        ))
    FROM pick p
    WHERE e.id = p.subject_id
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM pick), (SELECT count(*) FROM upd) INTO v_candidates, v_changed;

  IF v_changed > 0 THEN
    INSERT INTO public.write_receipts (at, tbl, op, rows, writer, db_role, app_name, txid)
    VALUES (now(), 'external_identities', 'update', v_changed, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  -- Restore the caller's writer value (empty string if none was set).
  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object('candidates', v_candidates, 'folded', v_changed, 'batch', p_batch,
                            'more', v_candidates >= p_batch);
END
$fn$;

COMMENT ON FUNCTION public.fold_external_identity_location(integer) IS
'Projects a BaT member home location (state + country ONLY, masking) from identity-subject observations into external_identities.metadata (migration 20261007070000). Reads the latest non-superseded vehicle_observations row per subject (subject_type external_identity; structured_data.home_state/home_country written by the extract-bat-profile-vehicles fetcher) and merges {state, country, location_source, location_observed_at} into metadata by id, only where state/country differ. Bounded by p_batch (1..50000). Never writes city or finer, never touches platform/handle, merges (never replaces) metadata. Sets app.writer=fold-external-identity-location in the body and restores the caller value; writes one write_receipts row per call that changed rows. Returns {candidates, folded, batch, more}. Stands ahead of data: folds 0 until the fetcher lands observations.';

COMMIT;
