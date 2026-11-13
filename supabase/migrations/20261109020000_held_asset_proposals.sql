-- Works proposed from the holder's own photographs, confirmed by one tap. Owner, 2026-11-08: "why cant vision api or an agent
-- declare". It can: vision proposes, the holder confirms. Same shape the photo work ledger uses for tools (status pending,
-- creator = the person whose photos found it, owner unset until they say so). Case ledger §21.1. Extends existing owners.
--   * propose_held_assets(person, proposals): service-only. Each proposal is one candidate work seen in the person's photo
--     library: a key (the library's photo uuids hashed), the kind the labeller saw (painting, drawing, sketch, billboard, mural,
--     sculpture, street_art, gallery), the labels as the labeller printed them, the photos (library uuid, taken_at, filename), the
--     span of dates, the labeller's name and version. One assets row per proposal (status pending, visibility private, creator =
--     person, owner NULL, identity_basis photo_proposal), one asset_observations row of kind photo_sighting per photo (source
--     owner-input, source_identifier = the library uuid, extraction_method = the labeller). Idempotent on the proposal key.
--   * confirm_held_asset(asset, title, medium, year, dimensions, edition, notes, visibility): Sign-tier. The creator of a pending
--     proposal confirms it in their own words: owner = signer, status active, the declared words land as holder_declaration and
--     creation_claim exactly as declare_held_asset writes them. Confirming twice is a no-op.
--   * dismiss_held_asset(asset, reason): Sign-tier. The creator archives a proposal that is not a work of theirs (status archived,
--     one observation of kind proposal_dismissed). Nothing is deleted.
--   * held_assets_read: adds 'proposed' (pending proposals, newest span first, with photo counts, labels, span, filenames) and
--     'proposed_total'. asset_profile_read: a pending proposal carries 'proposal' (kind, labels, span, photos) and market none_public.
-- Contract: supabase/sql/test_asset_lots.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.propose_held_assets(p_person uuid, p_proposals jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  owner_source uuid; pr jsonb; ph jsonb; aid uuid; was_new boolean; key text; vkind text; labeller text; span_from timestamptz; span_to timestamptz;
  n_in integer := 0; n_new integer := 0; n_existing integer := 0; n_photos integer := 0; n_refused integer := 0; refused jsonb := '[]'::jsonb; new_obs uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'propose_held_assets is service-only' USING ERRCODE = '42501'; END IF;
  IF p_person IS NULL OR jsonb_typeof(p_proposals) IS DISTINCT FROM 'array' OR jsonb_array_length(p_proposals) > 500 THEN
    RAISE EXCEPTION 'p_proposals must be a JSON array of at most 500 proposals for one person' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;

  FOR pr IN SELECT x FROM jsonb_array_elements(p_proposals) x LOOP
    n_in := n_in + 1;
    key := nullif(btrim(pr->>'proposal_key'), ''); vkind := nullif(btrim(pr->>'kind'), ''); labeller := nullif(btrim(pr->>'labeller'), '');
    IF key IS NULL OR key !~ '^[A-Za-z0-9_.:-]{8,120}$' OR vkind IS NULL
       OR vkind NOT IN ('painting', 'drawing', 'sketch', 'billboard', 'mural', 'sculpture', 'street_art', 'gallery', 'artwork')
       OR labeller IS NULL OR jsonb_typeof(pr->'photos') IS DISTINCT FROM 'array' OR jsonb_array_length(pr->'photos') = 0 OR jsonb_array_length(pr->'photos') > 200 THEN
      n_refused := n_refused + 1; refused := refused || jsonb_build_array(left(coalesce(key, '?'), 120)); CONTINUE;
    END IF;
    SELECT min((p->>'taken_at')::timestamptz), max((p->>'taken_at')::timestamptz) INTO span_from, span_to
      FROM jsonb_array_elements(pr->'photos') p WHERE (p->>'taken_at') ~ '^\d{4}-\d{2}-\d{2}';
    IF span_from IS NULL THEN n_refused := n_refused + 1; refused := refused || jsonb_build_array(key); CONTINUE; END IF;

    INSERT INTO public.assets (asset_type, title, description, creator_id, owner_id, status, visibility, attributes)
    VALUES ('artwork',
      format('Proposed %s, %s', replace(vkind, '_', ' '), to_char(span_from, 'Mon YYYY')), NULL, p_person, NULL, 'pending', 'private',
      jsonb_strip_nulls(jsonb_build_object(
        'identity_key', 'proposal:' || p_person::text || ':' || key, 'identity_basis', 'photo_proposal', 'source', 'owner-input',
        'proposal', jsonb_build_object('key', key, 'kind', vkind, 'labels', pr->'labels', 'labeller', labeller, 'photos', jsonb_array_length(pr->'photos'),
          'span_from', span_from, 'span_to', span_to, 'sittings', pr->'sittings', 'method', pr->>'method',
          'filenames', (SELECT jsonb_agg(p->>'filename') FROM jsonb_array_elements(pr->'photos') p WHERE p ? 'filename'),
          'captions', pr->'captions', 'places', pr->'places', 'place', pr->'place'),
        'proposed_at', now())))
    ON CONFLICT ((attributes->>'identity_key')) WHERE attributes ? 'identity_key' DO NOTHING
    RETURNING id INTO aid;
    was_new := aid IS NOT NULL;
    IF was_new THEN n_new := n_new + 1; ELSE
      SELECT a.id INTO aid FROM public.assets a WHERE a.attributes->>'identity_key' = 'proposal:' || p_person::text || ':' || key;
      n_existing := n_existing + 1;
    END IF;
    FOR ph IN SELECT x FROM jsonb_array_elements(pr->'photos') x WHERE (x->>'taken_at') ~ '^\d{4}-\d{2}-\d{2}' AND nullif(btrim(x->>'uuid'), '') IS NOT NULL LOOP
      INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence,
        source_identifier, extraction_method)
      VALUES (aid, owner_source, 'photo_sighting', (ph->>'taken_at')::timestamptz,
        format('A %s seen in the holder''s photo library (%s).', replace(vkind, '_', ' '), coalesce(ph->>'filename', ph->>'uuid')),
        jsonb_strip_nulls(jsonb_build_object('library', 'apple_photos', 'photo_uuid', ph->>'uuid', 'filename', ph->>'filename', 'labels', ph->'labels',
          'labeller', labeller, 'kind', vkind, 'width', ph->'width', 'height', ph->'height', 'latitude', ph->'latitude', 'longitude', ph->'longitude',
          'camera', ph->>'camera', 'caption', ph->>'caption', 'place', ph->>'place')),
        md5(aid::text || '|' || (ph->>'uuid') || '|' || labeller), coalesce(nullif(pr->>'confidence', '')::numeric, 0.6), ph->>'uuid', labeller)
      ON CONFLICT (asset_id, source_identifier, extraction_method) WHERE kind = 'photo_sighting' DO NOTHING
      RETURNING id INTO new_obs;
      IF new_obs IS NOT NULL THEN n_photos := n_photos + 1; END IF;
      new_obs := NULL;
    END LOOP;
    aid := NULL;
  END LOOP;
  RETURN jsonb_build_object('person', p_person, 'in', n_in, 'proposals_new', n_new, 'proposals_existing', n_existing, 'photo_sightings_new', n_photos,
    'refused', n_refused, 'refused_keys', refused);
END $$;
REVOKE ALL ON FUNCTION public.propose_held_assets(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propose_held_assets(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.propose_held_assets(uuid, jsonb) IS 'Service-only: candidate works seen in a person''s own photo library land as pending, private '
  'assets (creator = the person, owner unset) with one photo_sighting per photo (library uuid as the identifier, the labeller as the method). '
  'The holder confirms or dismisses each; nothing becomes theirs by inference.';

CREATE OR REPLACE FUNCTION public.confirm_held_asset(p_asset_id uuid, p_title text, p_medium text DEFAULT NULL, p_year text DEFAULT NULL,
  p_dimensions text DEFAULT NULL, p_edition text DEFAULT NULL, p_notes text DEFAULT NULL, p_visibility text DEFAULT 'private')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid(); signed timestamptz := now(); owner_source uuid; a public.assets%ROWTYPE; declared jsonb;
  vtitle text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  medium text := nullif(btrim(coalesce(p_medium, '')), ''); yr text := nullif(btrim(coalesce(p_year, '')), '');
  dims text := nullif(btrim(coalesce(p_dimensions, '')), ''); edition text := nullif(btrim(coalesce(p_edition, '')), '');
  notes text := nullif(btrim(coalesce(p_notes, '')), ''); vis text := coalesce(nullif(btrim(p_visibility), ''), 'private');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id;
  IF a.id IS NULL OR a.creator_id IS DISTINCT FROM signer OR a.attributes->>'identity_basis' <> 'photo_proposal' THEN
    RAISE EXCEPTION 'Only the person whose photos proposed a work confirms it' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'active' AND a.owner_id = signer THEN
    RETURN jsonb_build_object('asset_id', a.id, 'duplicate', true, 'visibility', a.visibility);
  END IF;
  IF a.status <> 'pending' THEN RAISE EXCEPTION 'This proposal was already %', a.status USING ERRCODE = '22023'; END IF;
  IF length(vtitle) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title must be 1 to 200 characters' USING ERRCODE = '22023'; END IF;
  IF medium IS NOT NULL AND length(medium) > 200 THEN RAISE EXCEPTION 'Medium is at most 200 characters' USING ERRCODE = '22023'; END IF;
  IF yr IS NOT NULL AND yr !~ '^(c\.\s?)?(1[0-9]{3}|20[0-9]{2})(s|\s?-\s?(1[0-9]{3}|20[0-9]{2}))?$' THEN
    RAISE EXCEPTION 'Year must read like 1965, c. 1965, 1960s or 1998-2001' USING ERRCODE = '22023';
  END IF;
  IF dims IS NOT NULL AND length(dims) > 120 THEN RAISE EXCEPTION 'Dimensions are at most 120 characters' USING ERRCODE = '22023'; END IF;
  IF edition IS NOT NULL AND length(edition) > 80 THEN RAISE EXCEPTION 'Edition is at most 80 characters' USING ERRCODE = '22023'; END IF;
  IF notes IS NOT NULL AND length(notes) > 4000 THEN RAISE EXCEPTION 'Notes are at most 4000 characters' USING ERRCODE = '22023'; END IF;
  IF vis NOT IN ('private', 'unlisted', 'public') THEN RAISE EXCEPTION 'Visibility must be private, unlisted or public' USING ERRCODE = '22023'; END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;

  declared := jsonb_strip_nulls(jsonb_build_object('medium', medium, 'year', yr, 'dimensions', dims, 'edition', edition, 'notes', notes));
  UPDATE public.assets SET title = vtitle, description = notes, owner_id = signer, status = 'active', visibility = vis, updated_at = signed,
    attributes = attributes || jsonb_build_object('declared', declared, 'declared_at', signed, 'declared_by_user_id', signer, 'confirmed_from', 'photo_proposal')
  WHERE id = a.id;
  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence, source_identifier, extraction_method)
  VALUES (a.id, owner_source, 'holder_declaration', signed,
    format('The holder confirmed a proposed work as theirs: "%s"%s.', vtitle, CASE WHEN yr IS NULL THEN '' ELSE ' (' || yr || ')' END),
    jsonb_build_object('signer_user_id', signer, 'asset_type', a.asset_type, 'title', vtitle, 'declared', declared, 'visibility', vis, 'version', 1,
      'confirmed_from', a.attributes->'proposal'),
    md5(a.attributes->>'identity_key' || '|confirmation|' || signed::text), 0.95, a.attributes->>'identity_key', 'holder_declaration_sign_v1');
  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence, source_identifier, extraction_method)
  VALUES (a.id, owner_source, 'creation_claim', signed, vtitle,
    jsonb_build_object('role', 'creator', 'attribution', 'direct', 'layout', 'holder_declaration', 'party_user_id', signer,
      'name_as_printed', (SELECT coalesce(nullif(p.full_name, ''), p.username) FROM public.profiles p WHERE p.id = signer)),
    md5(a.id::text || '|' || (a.attributes->>'identity_key') || '|holder_declaration_sign_v1|' || signer::text), 0.95, a.attributes->>'identity_key', 'holder_declaration_sign_v1')
  ON CONFLICT (asset_id, source_identifier, extraction_method, content_hash) WHERE kind = 'creation_claim' DO NOTHING;
  RETURN jsonb_build_object('asset_id', a.id, 'duplicate', false, 'visibility', vis);
END $$;
REVOKE ALL ON FUNCTION public.confirm_held_asset(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_held_asset(uuid, text, text, text, text, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.confirm_held_asset(uuid, text, text, text, text, text, text, text) IS 'Sign-tier: the person whose photos proposed a work '
  'confirms it in their own words; they become its holder, the words land as holder_declaration and creation_claim. Twice is a no-op.';

CREATE OR REPLACE FUNCTION public.dismiss_held_asset(p_asset_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE signer uuid := auth.uid(); signed timestamptz := now(); owner_source uuid; a public.assets%ROWTYPE; reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id;
  IF a.id IS NULL OR a.creator_id IS DISTINCT FROM signer OR a.attributes->>'identity_basis' <> 'photo_proposal' THEN
    RAISE EXCEPTION 'Only the person whose photos proposed a work dismisses it' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'archived' THEN RETURN jsonb_build_object('asset_id', a.id, 'duplicate', true); END IF;
  IF a.status <> 'pending' THEN RAISE EXCEPTION 'A confirmed work is not dismissed here' USING ERRCODE = '22023'; END IF;
  IF reason IS NOT NULL AND length(reason) > 400 THEN RAISE EXCEPTION 'Reason is at most 400 characters' USING ERRCODE = '22023'; END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  UPDATE public.assets SET status = 'archived', updated_at = signed, attributes = attributes || jsonb_build_object('dismissed_at', signed, 'dismissed_reason', reason) WHERE id = a.id;
  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence, source_identifier, extraction_method)
  VALUES (a.id, owner_source, 'proposal_dismissed', signed, coalesce('Dismissed: ' || reason, 'Dismissed by the holder.'),
    jsonb_strip_nulls(jsonb_build_object('signer_user_id', signer, 'reason', reason)), md5(a.attributes->>'identity_key' || '|dismissed|' || signed::text), 0.95,
    a.attributes->>'identity_key', 'holder_declaration_sign_v1');
  RETURN jsonb_build_object('asset_id', a.id, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.dismiss_held_asset(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_held_asset(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.held_assets_read(p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  mine AS (
    SELECT a.* FROM public.assets a, me WHERE me.uid IS NOT NULL AND (a.owner_id = me.uid OR a.creator_id = me.uid)
      AND a.asset_type IN ('artwork', 'automobilia', 'memorabilia', 'publication') AND a.status = 'active'),
  proposed AS (
    SELECT a.* FROM public.assets a, me WHERE me.uid IS NOT NULL AND a.creator_id = me.uid AND a.status = 'pending' AND a.attributes->>'identity_basis' = 'photo_proposal'),
  rows_ AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', m.id, 'asset_type', m.asset_type, 'title', m.title, 'visibility', m.visibility, 'created_at', m.created_at,
      'declared', m.attributes->'declared', 'identity_basis', m.attributes->>'identity_basis',
      'presentations', (SELECT count(*) FROM public.asset_observations o WHERE o.asset_id = m.id AND o.kind = 'auction_lot' AND o.superseded_by IS NULL),
      'photos', (SELECT count(*) FROM public.asset_observations o WHERE o.asset_id = m.id AND o.kind = 'photo_sighting'),
      'public_sale_recorded', EXISTS (SELECT 1 FROM public.asset_observations o WHERE o.asset_id = m.id AND o.kind = 'auction_lot' AND o.superseded_by IS NULL
                                        AND (o.structured_data->>'hammer_price')::numeric > 0))) ORDER BY m.created_at DESC) AS v
    FROM (SELECT * FROM mine ORDER BY created_at DESC LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))) m),
  prow AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', p.id, 'title', p.title, 'kind', p.attributes->'proposal'->>'kind', 'labels', p.attributes->'proposal'->'labels',
      'photos', (p.attributes->'proposal'->>'photos')::int, 'span_from', p.attributes->'proposal'->>'span_from', 'span_to', p.attributes->'proposal'->>'span_to',
      'filenames', p.attributes->'proposal'->'filenames', 'labeller', p.attributes->'proposal'->>'labeller', 'proposed_at', p.attributes->>'proposed_at'))
      ORDER BY (p.attributes->'proposal'->>'span_to')::timestamptz DESC NULLS LAST) AS v
    FROM (SELECT * FROM proposed ORDER BY (attributes->'proposal'->>'span_to')::timestamptz DESC NULLS LAST LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))) p)
  SELECT CASE WHEN (SELECT uid FROM me) IS NULL THEN NULL ELSE jsonb_build_object(
    'assets', coalesce((SELECT v FROM rows_), '[]'::jsonb),
    'total', (SELECT count(*) FROM mine),
    'by_type', coalesce((SELECT jsonb_object_agg(asset_type, n) FROM (SELECT asset_type, count(*) n FROM mine GROUP BY 1) t), '{}'::jsonb),
    'proposed', coalesce((SELECT v FROM prow), '[]'::jsonb),
    'proposed_total', (SELECT count(*) FROM proposed),
    'as_of', now()) END
$$;

CREATE OR REPLACE FUNCTION public.asset_profile_read(p_asset_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH viewer AS (SELECT auth.uid() AS uid),
  a AS (
    SELECT a.* FROM public.assets a, viewer v WHERE a.id = p_asset_id AND a.asset_type IN ('artwork', 'automobilia', 'memorabilia', 'publication')
      AND a.status <> 'archived'
      AND (a.visibility = 'public' OR (v.uid IS NOT NULL AND (a.owner_id = v.uid OR a.creator_id = v.uid)))),
  lots AS (
    SELECT o.*, s.slug AS source_slug, s.display_name AS source_name, coalesce(s.base_trust_score, 0.5) AS source_trust
    FROM public.asset_observations o JOIN a ON a.id = o.asset_id
    LEFT JOIN public.observation_sources s ON s.id = o.source_id
    WHERE o.kind = 'auction_lot'),
  current_lots AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'statement_id', l.id, 'source', jsonb_build_object('slug', l.source_slug, 'name', l.source_name, 'trust', l.source_trust),
      'house_category', l.structured_data->>'department_name', 'department_code', l.structured_data->>'department_code',
      'house_group', l.structured_data->>'house_group', 'lot_number', l.structured_data->>'lot_number',
      'sale_key', l.structured_data->>'sale_key', 'sale_name', l.structured_data->>'sale_name', 'sale_ends_at', l.structured_data->>'sale_ends_at',
      'result', l.structured_data->>'result', 'price_basis', l.structured_data->>'price_basis',
      'hammer_price', l.structured_data->'hammer_price', 'hammer_premium', l.structured_data->'hammer_premium', 'high_bid', l.structured_data->'high_bid',
      'estimate_low', l.structured_data->'estimate_low', 'estimate_high', l.structured_data->'estimate_high', 'currency', l.structured_data->>'currency',
      'observed_at', l.observed_at, 'observed_at_basis', l.structured_data->>'observed_at_basis', 'url', l.source_url,
      'lines', l.structured_data->'lines', 'catalog_text', l.content_text,
      'printed_sections', public.art_printed_sections(l.structured_data->>'footnotes'),
      'symbols', l.structured_data->'symbols', 'image_url', l.structured_data->>'image_url', 'country', l.structured_data->>'country',
      'landed_at', l.created_at)) ORDER BY l.observed_at DESC) AS v
    FROM lots l WHERE l.superseded_by IS NULL),
  history AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'statement_id', l.id, 'source', l.source_slug, 'observed_at', l.observed_at, 'observed_at_basis', l.structured_data->>'observed_at_basis',
      'result', l.structured_data->>'result', 'hammer_price', l.structured_data->'hammer_price', 'high_bid', l.structured_data->'high_bid',
      'estimate_low', l.structured_data->'estimate_low', 'estimate_high', l.structured_data->'estimate_high', 'currency', l.structured_data->>'currency',
      'landed_at', l.created_at, 'superseded', (l.superseded_by IS NOT NULL))) ORDER BY l.created_at, l.observed_at) AS v
    FROM lots l),
  creation AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'claim_id', c.id, 'attribution', c.structured_data->>'attribution', 'layout', c.structured_data->>'layout',
      'name_as_printed', c.structured_data->>'name_as_printed', 'qualifier_as_printed', c.structured_data->>'qualifier_as_printed',
      'party', CASE
        WHEN e.id IS NOT NULL THEN jsonb_build_object(
          'id', e.id, 'kind', 'catalogue', 'display_name', e.display_name, 'qualifier_as_printed', e.metadata->>'qualifier_as_printed',
          'claimed', (e.claimed_by_user_id IS NOT NULL OR e.user_id IS NOT NULL),
          'lots_direct', (SELECT count(*) FROM public.asset_observations x WHERE x.kind = 'creation_claim' AND x.superseded_by IS NULL
                            AND x.structured_data->>'party_identity_id' = e.id::text AND x.structured_data->>'attribution' = 'direct'),
          'priced_lots', (SELECT count(*) FROM public.asset_observations x
                            JOIN public.asset_observations y ON y.asset_id = x.asset_id AND y.kind = 'auction_lot' AND y.source_id = x.source_id
                              AND y.source_identifier = x.source_identifier AND y.superseded_by IS NULL
                            WHERE x.kind = 'creation_claim' AND x.superseded_by IS NULL AND x.structured_data->>'party_identity_id' = e.id::text
                              AND x.structured_data->>'attribution' = 'direct' AND (y.structured_data->>'hammer_price')::numeric > 0))
        WHEN p.id IS NOT NULL THEN jsonb_build_object(
          'id', p.id, 'kind', 'user', 'display_name', coalesce(nullif(p.full_name, ''), p.username, 'a Nuke user'), 'claimed', true,
          'lots_direct', (SELECT count(*) FROM public.asset_observations x WHERE x.kind = 'creation_claim' AND x.superseded_by IS NULL
                            AND x.structured_data->>'party_user_id' = p.id::text AND x.structured_data->>'attribution' = 'direct'),
          'priced_lots', 0)
        ELSE NULL END,
      'executor', c.structured_data->'executor',
      'source', s.slug, 'observed_at', c.observed_at, 'confidence', c.confidence)) ORDER BY c.observed_at DESC) AS v
    FROM public.asset_observations c JOIN a ON a.id = c.asset_id
    LEFT JOIN public.observation_sources s ON s.id = c.source_id
    LEFT JOIN public.external_identities e ON e.id = (c.structured_data->>'party_identity_id')::uuid
    LEFT JOIN public.profiles p ON p.id = (c.structured_data->>'party_user_id')::uuid
    WHERE c.kind = 'creation_claim' AND c.superseded_by IS NULL),
  photos AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('taken_at', o.observed_at, 'filename', o.structured_data->>'filename', 'labels', o.structured_data->'labels',
      'library', o.structured_data->>'library', 'place', o.structured_data->>'place', 'camera', o.structured_data->>'camera', 'caption', o.structured_data->>'caption')) ORDER BY o.observed_at) AS v, count(*) AS n
    FROM public.asset_observations o JOIN a ON a.id = o.asset_id WHERE o.kind = 'photo_sighting')
  SELECT CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
    'asset', jsonb_strip_nulls(jsonb_build_object(
      'id', a.id, 'asset_type', a.asset_type, 'title', a.title, 'house_category', a.attributes->>'house_category',
      'house_category_code', a.attributes->>'house_category_code', 'source', a.attributes->>'source',
      'identity_basis', a.attributes->>'identity_basis', 'first_seen_at', a.attributes->>'first_seen_at', 'created_at', a.created_at,
      'visibility', a.visibility, 'status', a.status)),
    'viewer', jsonb_build_object('is_holder', (v.uid IS NOT NULL AND (a.owner_id = v.uid OR a.creator_id = v.uid))),
    'declared', a.attributes->'declared',
    'proposal', CASE WHEN a.attributes ? 'proposal' THEN a.attributes->'proposal' || jsonb_build_object('status', a.status, 'photo_sightings', coalesce((SELECT ph.v FROM photos ph), '[]'::jsonb)) END,
    'market', CASE WHEN EXISTS (SELECT 1 FROM lots) THEN 'recorded' ELSE 'none_public' END,
    'image_url', (SELECT l.structured_data->>'image_url' FROM lots l WHERE l.superseded_by IS NULL AND l.structured_data ? 'image_url' ORDER BY l.observed_at DESC LIMIT 1),
    'lots', coalesce((SELECT cl.v FROM current_lots cl), '[]'::jsonb),
    'history', coalesce((SELECT h.v FROM history h), '[]'::jsonb),
    'creation', coalesce((SELECT cr.v FROM creation cr), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'presentations', (SELECT count(*) FROM lots l WHERE l.superseded_by IS NULL),
      'statements', (SELECT count(*) FROM lots),
      'photos', coalesce((SELECT ph.n FROM photos ph), 0),
      'claims', (SELECT count(*) FROM public.asset_observations c WHERE c.asset_id = a.id AND c.kind = 'creation_claim' AND c.superseded_by IS NULL
                   AND (c.structured_data ? 'party_identity_id' OR c.structured_data ? 'party_user_id')),
      'sources', (SELECT coalesce(jsonb_agg(DISTINCT l.source_slug), '[]'::jsonb) FROM lots l),
      'as_of', now())) END
  FROM a, viewer v
$$;
GRANT EXECUTE ON FUNCTION public.asset_profile_read(uuid) TO anon, authenticated, service_role;
COMMIT;
