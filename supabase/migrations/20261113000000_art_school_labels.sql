-- School labels are attribution labels, not artists. The creation fold read "British School" / "(19th century)" as a party
-- line and minted an art_catalogue identity named "british school", so every school-labelled lot became one "artist"
-- (read-only 2026-11-09, one reader, UNVERIFIED: 491 current claims under 37 school-label keys, e.g. british school,
-- american school, anglo/american school). Follows 20261108233000; same signatures, same readers.
--   * art_is_school_label(name): true for "<place or adjective> School" as printed (case-insensitive). Narrow on purpose:
--     "School of X", "Circle of", "Follower of" are already attributions on a named party via art_attribution_from_line.
--   * fold_asset_creation_claims: a school-label line now lands as a creation_claim with attribution school_label,
--     label_as_printed and qualifier_as_printed, and NO party_identity_id / party_key. Everything else is unchanged.
--     Receipt gains school_labels.
--   * reclassify_school_label_claims(p_limit): service-only, bounded. Appends a school_label claim superseding each current
--     claim that named a school label as a party (structured_data.reclassified_from = prior claim). Nothing is deleted;
--     the old art_catalogue identities stay as rows nothing current points at.
--   * NOT here, on purpose: art_party_key is unchanged. Same-name undated people (8 keys today, e.g. dennis croteau with
--     different qualifiers, and bare first names like "john") are an open identity question; this migration neither splits
--     nor merges them. How catalogue parties reach actors is the open shared-contribution repair (data-machine-cases §21.4).
-- Rollback: re-run fold_asset_creation_claims from 20261108233000; then, service role,
--   UPDATE asset_observations o SET superseded_by = NULL FROM asset_observations n
--    WHERE n.kind = 'creation_claim' AND n.structured_data ? 'reclassified_from' AND o.id = (n.structured_data->>'reclassified_from')::uuid;
--   DELETE FROM asset_observations WHERE kind = 'creation_claim' AND structured_data ? 'reclassified_from';
--   DROP FUNCTION public.reclassify_school_label_claims(integer); DROP FUNCTION public.art_is_school_label(text);
--   (claims the new fold wrote for new lots carry attribution school_label; delete those too, and re-fold.)
-- DRAFT: not applied. Counts before/after: /workspace/nuke-art/sql/bug_counts.sql (read-only).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.art_is_school_label(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(btrim(p_name) ~* '^[a-z][a-z .''&/-]{1,60}\s+school$', false)
$$;
COMMENT ON FUNCTION public.art_is_school_label(text) IS 'True when a printed creator line is a school label ("British School"): an attribution '
  'label, not an individual. The fold records it as attribution school_label with no party.';

CREATE OR REPLACE FUNCTION public.fold_asset_creation_claims(p_source_slug text, p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  src record; r record; att record; key text; pid uuid; was_new boolean; exec_name text; exec_dates text; exec_key text; exec_pid uuid; qual text; hash text;
  method constant text := 'house_catalogue_lines_v1'; layout text; name_only text;
  n_labels integer := 0; n_read integer := 0; n_claims integer := 0; n_same integer := 0; n_parties_new integer := 0; n_skipped integer := 0; new_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'fold_asset_creation_claims is service-only' USING ERRCODE = '42501';
  END IF;
  SELECT s.id, s.slug, coalesce(s.base_trust_score, 0.5) AS trust INTO src FROM public.observation_sources s WHERE s.slug = p_source_slug;
  IF src.id IS NULL THEN RAISE EXCEPTION 'unknown observation source %', p_source_slug USING ERRCODE = '22023'; END IF;

  FOR r IN
    SELECT o.id AS lot_obs_id, o.asset_id, o.source_identifier, o.source_url, o.observed_at,
           o.structured_data->'lines'->>0 AS line1, o.structured_data->'lines'->>1 AS line2, o.structured_data->>'department_code' AS dept
    FROM public.asset_observations o
    JOIN public.assets a ON a.id = o.asset_id
    WHERE o.source_id = src.id AND o.kind = 'auction_lot' AND o.superseded_by IS NULL AND a.asset_type = 'artwork'
      AND NOT EXISTS (SELECT 1 FROM public.asset_observations c WHERE c.asset_id = o.asset_id AND c.kind = 'creation_claim'
                        AND c.source_identifier = o.source_identifier AND c.extraction_method = method AND c.superseded_by IS NULL)
    ORDER BY o.created_at
    LIMIT greatest(1, least(coalesce(p_limit, 500), 5000))
  LOOP
    n_read := n_read + 1;
    SELECT * INTO att FROM public.art_attribution_from_line(r.line1);
    -- Two layouts the house itself uses. A: first line the party, second line a parenthesised qualifier "(Nationality, dates)".
    -- B (the Copenhagen sales): first line "Name: description", second line that same description without the name, so the
    -- name is exactly what the house put before the colon. Anything else printed no party line: that is recorded too, so
    -- the lot is not re-read every run.
    qual := nullif(btrim(substring(coalesce(r.line2, '') FROM '^\(([^)]*)\)')), '');
    layout := NULL; name_only := NULL;
    IF att.name_as_printed IS NOT NULL AND length(att.name_as_printed) BETWEEN 2 AND 120 AND qual IS NOT NULL THEN
      layout := 'party_then_qualifier';
    ELSIF r.line2 IS NOT NULL AND length(r.line2) >= 8 AND position(': ' || left(r.line2, 40) IN coalesce(r.line1, '')) > 2 THEN
      name_only := btrim(left(r.line1, position(': ' || left(r.line2, 40) IN r.line1) - 1));
      IF length(name_only) BETWEEN 2 AND 80 AND name_only !~ '\d' THEN
        layout := 'name_colon_description';
        SELECT * INTO att FROM public.art_attribution_from_line(name_only);
      END IF;
    END IF;
    IF layout IS NOT NULL AND lower(att.name_as_printed) IN ('various artists', 'unknown artist', 'anonymous', 'unknown', 'artist unknown') THEN
      layout := NULL;
    END IF;
    IF layout IS NULL THEN
      n_skipped := n_skipped + 1;
      INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash,
        confidence, source_url, source_identifier, extraction_method)
      VALUES (r.asset_id, src.id, 'creation_claim', r.observed_at, concat_ws(E'\n', r.line1, r.line2),
        jsonb_strip_nulls(jsonb_build_object('attribution', 'none_printed', 'lot_observation_id', r.lot_obs_id, 'department_code', r.dept, 'layout', 'none')),
        md5(concat_ws('|', r.asset_id::text, r.source_identifier, method, 'none_printed')), src.trust, r.source_url, r.source_identifier, method)
      ON CONFLICT (asset_id, source_identifier, extraction_method, content_hash) WHERE kind = 'creation_claim' DO NOTHING;
      CONTINUE;
    END IF;
    -- A school label ("British School", "Anglo/American School") is an attribution label, not an individual: the claim keeps
    -- the label and qualifier as printed and names no party, so no artist identity is minted from it.
    IF public.art_is_school_label(att.name_as_printed) THEN
      INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash,
        confidence, source_url, source_identifier, extraction_method)
      VALUES (r.asset_id, src.id, 'creation_claim', r.observed_at, concat_ws(E'\n', r.line1, r.line2),
        jsonb_strip_nulls(jsonb_build_object('role', 'creator', 'attribution', 'school_label', 'label_as_printed', att.name_as_printed,
          'qualifier_as_printed', qual, 'lot_observation_id', r.lot_obs_id, 'department_code', r.dept, 'layout', layout)),
        md5(concat_ws('|', r.asset_id::text, r.source_identifier, method, 'school_label', lower(att.name_as_printed), coalesce(qual, ''))),
        src.trust, r.source_url, r.source_identifier, method)
      ON CONFLICT (asset_id, source_identifier, extraction_method, content_hash) WHERE kind = 'creation_claim' DO NOTHING;
      n_labels := n_labels + 1;
      CONTINUE;
    END IF;
    key := public.art_party_key(att.name_as_printed, qual);
    INSERT INTO public.external_identities (platform, handle, display_name, metadata, first_seen_at, last_seen_at)
    VALUES ('art_catalogue', key, att.name_as_printed,
            jsonb_build_object('qualifier_as_printed', qual, 'first_source', src.slug, 'role', 'artist'), r.observed_at, r.observed_at)
    ON CONFLICT (platform, handle) DO UPDATE SET last_seen_at = greatest(public.external_identities.last_seen_at, EXCLUDED.last_seen_at)
    RETURNING id, (xmax = 0) INTO pid, was_new;
    IF was_new THEN n_parties_new := n_parties_new + 1; END IF;

    -- The technician: "(dates) by <name> (dates)" after the artist line.
    exec_name := nullif(btrim(substring(coalesce(r.line2, '') FROM '^\([^)]*\)\s+by\s+([^(]+)')), '');
    exec_dates := nullif(btrim(substring(coalesce(r.line2, '') FROM '^\([^)]*\)\s+by\s+[^(]+\(([^)]*)\)')), '');
    exec_pid := NULL;
    IF exec_name IS NOT NULL AND length(exec_name) BETWEEN 2 AND 120 THEN
      exec_key := public.art_party_key(exec_name, exec_dates);
      INSERT INTO public.external_identities (platform, handle, display_name, metadata, first_seen_at, last_seen_at)
      VALUES ('art_catalogue', exec_key, exec_name,
              jsonb_build_object('qualifier_as_printed', exec_dates, 'first_source', src.slug, 'role', 'executor'), r.observed_at, r.observed_at)
      ON CONFLICT (platform, handle) DO UPDATE SET last_seen_at = greatest(public.external_identities.last_seen_at, EXCLUDED.last_seen_at)
      RETURNING id INTO exec_pid;
    END IF;

    hash := md5(concat_ws('|', r.asset_id::text, r.source_identifier, method, key, att.attribution, coalesce(exec_key, '')));
    INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash,
      confidence, source_url, source_identifier, extraction_method)
    VALUES (r.asset_id, src.id, 'creation_claim', r.observed_at, concat_ws(E'\n', r.line1, r.line2),
      jsonb_strip_nulls(jsonb_build_object(
        'role', 'creator', 'attribution', att.attribution, 'name_as_printed', att.name_as_printed, 'qualifier_as_printed', qual,
        'party_identity_id', pid, 'party_key', key, 'lot_observation_id', r.lot_obs_id, 'department_code', r.dept, 'layout', layout,
        'executor', CASE WHEN exec_pid IS NULL THEN NULL ELSE jsonb_build_object('role', 'executor', 'name_as_printed', exec_name,
                      'qualifier_as_printed', exec_dates, 'party_identity_id', exec_pid, 'party_key', exec_key) END)),
      hash, src.trust, r.source_url, r.source_identifier, method)
    ON CONFLICT (asset_id, source_identifier, extraction_method, content_hash) WHERE kind = 'creation_claim' DO NOTHING
    RETURNING id INTO new_id;
    IF new_id IS NULL THEN n_same := n_same + 1; ELSE n_claims := n_claims + 1; END IF;
    new_id := NULL; exec_key := NULL;
  END LOOP;
  RETURN jsonb_build_object('source', src.slug, 'lots_read', n_read, 'claims_new', n_claims, 'claims_same', n_same,
    'parties_new', n_parties_new, 'no_party_printed', n_skipped, 'school_labels', n_labels);
END $$;


CREATE OR REPLACE FUNCTION public.reclassify_school_label_claims(p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE r record; new_id uuid; n_read integer := 0; n_done integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'reclassify_school_label_claims is service-only' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT c.* FROM public.asset_observations c
    WHERE c.kind = 'creation_claim' AND c.superseded_by IS NULL AND c.structured_data ? 'party_identity_id'
      AND public.art_is_school_label(c.structured_data->>'name_as_printed')
    ORDER BY c.created_at
    LIMIT greatest(1, least(coalesce(p_limit, 500), 2000))
  LOOP
    n_read := n_read + 1;
    INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash,
      confidence, source_url, source_identifier, extraction_method, supersedes)
    VALUES (r.asset_id, r.source_id, 'creation_claim', r.observed_at, r.content_text,
      jsonb_strip_nulls(jsonb_build_object('role', 'creator', 'attribution', 'school_label',
        'label_as_printed', r.structured_data->>'name_as_printed', 'qualifier_as_printed', r.structured_data->>'qualifier_as_printed',
        'lot_observation_id', r.structured_data->'lot_observation_id', 'department_code', r.structured_data->>'department_code',
        'layout', r.structured_data->>'layout', 'reclassified_from', r.id)),
      md5(concat_ws('|', r.content_hash, 'school_label_v1')), r.confidence, r.source_url, r.source_identifier, r.extraction_method, r.id)
    ON CONFLICT (asset_id, source_identifier, extraction_method, content_hash) WHERE kind = 'creation_claim' DO NOTHING
    RETURNING id INTO new_id;
    IF new_id IS NOT NULL THEN
      UPDATE public.asset_observations SET superseded_by = new_id WHERE id = r.id AND superseded_by IS NULL;
      n_done := n_done + 1;
    END IF;
    new_id := NULL;
  END LOOP;
  RETURN jsonb_build_object('claims_read', n_read, 'claims_reclassified', n_done);
END $$;

REVOKE ALL ON FUNCTION public.fold_asset_creation_claims(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fold_asset_creation_claims(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.reclassify_school_label_claims(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclassify_school_label_claims(integer) TO service_role;

COMMIT;
