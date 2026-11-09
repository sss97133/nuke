-- Split the held-asset flow into separate role claims. Codex coordination 2026-11-09 (Skylar's chat), case ledger §21.4
-- (PR #3172): documenting, making (creator, fabricator), holding, performance and rights are separate acts, each its own
-- claim with its own evidence. No all-in-one confirmation. Extends existing owners; no new table, no new column.
--
-- What was wrong (20261109013000_held_assets.sql, 20261109020000_held_asset_proposals.sql):
--   * declare_held_asset and confirm_held_asset each wrote, in one signature, owner_id = signer + holder_declaration + a
--     creation_claim (role creator, attribution direct, party_user_id = signer). Holding implied making; confirming a photo
--     proposal (documenting) implied both. A museum visitor confirming a photo of someone else's work became its holder and maker.
--   * held_assets_read and asset_profile_read.viewer.is_holder read (owner_id = uid OR creator_id = uid): record origin read as holding.
--
-- What this keeps:
--   * assets.creator_id stays record/evidence origin (20261028203000_photo_work_ledger.sql COMMENT ON COLUMN). Nothing here nulls
--     it, and no reader below reads it as maker or holder. It still gates who may confirm or dismiss their own photo proposal and who
--     may read their own private record back (record-origin access), and it is reported as viewer.is_record_origin.
--   * assets.owner_id stays the existing holder owner. It is set only by an accepted holding claim and cleared when that holder withdraws.
--   * House statements (creation_claim rows from fold_asset_creation_claims, party_identity_id) are untouched; they read as
--     claim_state source_statement. asset_creators reads only party_identity_id, so user role claims never enter market tables.
--
-- Claims (asset_observations, source owner-input, extraction_method asset_role_claim_v1, source_identifier
-- 'claim:<asset>:<role>:<user>'; structured_data {role, party_user_id, claim_state, basis, evidence[observation ids], statement}):
--   role          kind                 written by
--   documenter    documentation_claim  confirm_held_asset (evidence = the signer's photo_sighting rows) or record_asset_role_claim
--   creator       creation_claim       record_asset_role_claim only (self_reported)
--   fabricator    creation_claim       record_asset_role_claim only (self_reported); a printed executor stays the house's nested executor
--   holder        holding_claim        declare_held_asset (accepted), record_asset_role_claim, accept_asset_holding_claim (handover)
--   performer     performance_claim    record_asset_role_claim only (self_reported)
--   rights_holder rights_claim         record_asset_role_claim only (self_reported)
-- claim_state: self_reported | evidenced | accepted | withdrawn | ended. A change is a new row that supersedes the old one
-- (superseded_by), so the testimony log keeps every state. Holding never writes a creation claim; documenting writes neither.
--
-- Acceptance (who may move a claim past self_reported):
--   * documenter: evidenced when every cited evidence row is a photo_sighting on this asset and the asset's record origin is the signer
--     (propose_held_assets writes photo_sighting rows only from the person's own library). Documentation proves the documenting act only.
--   * holder: accepted at sign tier only when (i) the signer declares a new work (declare_held_asset), or (ii) the signer is the record
--     origin, owner_id is NULL and no other party has a current holding claim (the basis confirm_held_asset used for owner_id before
--     this migration). Otherwise self_reported until the current holder hands over (accept_asset_holding_claim).
--   * creator, fabricator, performer, rights_holder: self_reported. TODO(decision): no non-self attestation owner exists for asset role
--     claims (the vehicle side has work_order_resource_attestations / co_sign). Until one is chosen they stay quarantined: shown with
--     their state, never counted as attribution.
--
-- Identity (acceptance path b): asset_claim_actors(asset) resolves a user party to actors only through viewer_identity_bridge
-- (approved account_link_claims nuke_actor rows at work_evidence / co_sign / authenticated_sign). A catalogue party
-- (external_identities art_catalogue, a printed name) resolves to no actor, even when a user has claimed that identity row.
-- Nothing matches names. Nothing here writes actor_capability_basis: capability_fold_basis has no asset_observations branch (missing edge).
--
-- Dismiss: a pending proposal carries no role claims (record_asset_role_claim refuses pending and archived assets). dismiss_held_asset
-- still withdraws any current claim of the signer's, refuses when another party holds a current claim, and leaves none current.
--
-- Behaviour change for clients: after confirm_held_asset the person is the documenter, not the holder; holding and authorship are
-- separate calls (record_asset_role_claim). TODO(decision): iOS / web confirm UI must offer them as separate, explicit acts.
-- Version 20261113200000: after 20261113090000_receipt_work_context_reader.sql on main.
-- Contract: supabase/sql/test_asset_role_claims.sql (PG17). DRAFT: not applied.
-- Rollback: re-run 20261109020000_held_asset_proposals.sql and 20261109013000_held_assets.sql function bodies; DROP FUNCTION the
-- new functions below; DROP INDEX asset_observations_role_claim_party_idx. Rows written by the new writers stay as testimony.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE INDEX IF NOT EXISTS asset_observations_role_claim_party_idx
  ON public.asset_observations (((structured_data->>'party_user_id')), asset_id)
  WHERE kind IN ('documentation_claim', 'creation_claim', 'holding_claim', 'performance_claim', 'rights_claim') AND superseded_by IS NULL;

CREATE OR REPLACE FUNCTION public.asset_role_claim_kind(p_role text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role WHEN 'documenter' THEN 'documentation_claim' WHEN 'creator' THEN 'creation_claim' WHEN 'fabricator' THEN 'creation_claim'
    WHEN 'holder' THEN 'holding_claim' WHEN 'performer' THEN 'performance_claim' WHEN 'rights_holder' THEN 'rights_claim' END
$$;
COMMENT ON FUNCTION public.asset_role_claim_kind(text) IS 'The asset_observations kind for one role: documenter -> documentation_claim, creator and '
  'fabricator -> creation_claim, holder -> holding_claim, performer -> performance_claim, rights_holder -> rights_claim. Null for any other role.';

-- The holder reader: owner_id or a current accepted holding claim. Never creator_id.
CREATE OR REPLACE FUNCTION public.asset_holder_is(p_asset_id uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.assets a WHERE a.id = p_asset_id AND a.owner_id = p_user)
    OR EXISTS (SELECT 1 FROM public.asset_observations h WHERE h.asset_id = p_asset_id AND h.kind = 'holding_claim' AND h.superseded_by IS NULL
                 AND h.structured_data->>'claim_state' = 'accepted' AND h.structured_data->>'party_user_id' = p_user::text))
$$;
REVOKE ALL ON FUNCTION public.asset_holder_is(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_holder_is(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.asset_holder_is(uuid, uuid) IS 'Internal holder reader: true when the user is assets.owner_id or has a current accepted '
  'holding_claim. assets.creator_id (record origin) is never read as holding.';

-- Internal writer: one claim row, superseding the party's current row for the same asset and role. Not callable by clients.
CREATE OR REPLACE FUNCTION public.asset_role_claim_write(p_asset_id uuid, p_role text, p_party uuid, p_state text, p_basis text,
  p_evidence jsonb, p_statement text, p_by uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE owner_source uuid; k text := public.asset_role_claim_kind(p_role); prior uuid; nid uuid := gen_random_uuid(); ikey text; at_ timestamptz := clock_timestamp();
BEGIN
  IF k IS NULL OR p_party IS NULL OR p_state NOT IN ('self_reported', 'evidenced', 'accepted', 'withdrawn', 'ended') THEN
    RAISE EXCEPTION 'asset_role_claim_write: bad role, party or state' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  ikey := 'claim:' || p_asset_id::text || ':' || p_role || ':' || p_party::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(ikey, 0));
  SELECT o.id INTO prior FROM public.asset_observations o WHERE o.asset_id = p_asset_id AND o.kind = k AND o.superseded_by IS NULL
    AND o.extraction_method = 'asset_role_claim_v1' AND o.source_identifier = ikey ORDER BY o.created_at DESC LIMIT 1;
  INSERT INTO public.asset_observations (id, asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence,
    source_identifier, extraction_method, supersedes)
  VALUES (nid, p_asset_id, owner_source, k, at_,
    format('%s claim (%s)%s', p_role, p_state, coalesce(': ' || p_statement, '')),
    jsonb_strip_nulls(jsonb_build_object('role', p_role, 'party_user_id', p_party, 'claim_state', p_state, 'basis', p_basis,
      'evidence', coalesce(p_evidence, '[]'::jsonb), 'statement', p_statement, 'recorded_by_user_id', p_by, 'version', 1)),
    md5(ikey || '|' || p_state || '|' || nid::text), CASE p_state WHEN 'accepted' THEN 0.95 WHEN 'evidenced' THEN 0.8 ELSE 0.5 END,
    ikey, 'asset_role_claim_v1', prior);
  IF prior IS NOT NULL THEN UPDATE public.asset_observations SET superseded_by = nid WHERE id = prior; END IF;
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.asset_role_claim_write(uuid, text, uuid, text, text, jsonb, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.asset_role_claim_write(uuid, text, uuid, text, text, jsonb, text, uuid) IS 'Internal: appends one role claim row and '
  'supersedes the party''s current row for the same asset and role. Called only by the definer functions in 20261113200000.';

-- Evidence must be current rows on the same asset that are not the signer's own claims.
CREATE OR REPLACE FUNCTION public.asset_role_claim_evidence_ok(p_asset_id uuid, p_evidence jsonb, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) = 'array' AND jsonb_array_length(coalesce(p_evidence, '[]'::jsonb)) <= 200
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) e
      WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
        OR NOT EXISTS (SELECT 1 FROM public.asset_observations o WHERE o.id = (e #>> '{}')::uuid AND o.asset_id = p_asset_id
                         AND NOT (o.extraction_method = 'asset_role_claim_v1' AND o.structured_data->>'party_user_id' = p_user::text)))
$$;
REVOKE ALL ON FUNCTION public.asset_role_claim_evidence_ok(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Sign-tier: the signer states one role on one asset, for themself only, with its own evidence.
CREATE OR REPLACE FUNCTION public.record_asset_role_claim(p_asset_id uuid, p_role text, p_evidence jsonb DEFAULT '[]'::jsonb, p_statement text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid(); a public.assets%ROWTYPE; st text; basis text; cid uuid; cur record; ev jsonb := coalesce(p_evidence, '[]'::jsonb);
  stmt text := nullif(btrim(coalesce(p_statement, '')), '');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF public.asset_role_claim_kind(p_role) IS NULL THEN
    RAISE EXCEPTION 'Role must be documenter, creator, fabricator, holder, performer or rights_holder' USING ERRCODE = '22023';
  END IF;
  IF stmt IS NOT NULL AND length(stmt) > 2000 THEN RAISE EXCEPTION 'Statement is at most 2000 characters' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id;
  IF a.id IS NULL OR a.asset_type NOT IN ('artwork', 'automobilia', 'memorabilia', 'publication')
     OR NOT (a.visibility = 'public' OR a.creator_id = signer OR public.asset_holder_is(a.id, signer)) THEN
    RAISE EXCEPTION 'Asset not found' USING ERRCODE = 'P0002';
  END IF;
  IF a.status <> 'active' THEN RAISE EXCEPTION 'Claims attach to an active asset; confirm or dismiss a proposal first' USING ERRCODE = '22023'; END IF;
  IF NOT public.asset_role_claim_evidence_ok(a.id, ev, signer) THEN
    RAISE EXCEPTION 'Evidence must be observation ids on this asset, not your own claims' USING ERRCODE = '22023';
  END IF;
  SELECT o.id, o.structured_data->>'claim_state' AS state INTO cur FROM public.asset_observations o
    WHERE o.asset_id = a.id AND o.kind = public.asset_role_claim_kind(p_role) AND o.superseded_by IS NULL
      AND o.source_identifier = 'claim:' || a.id::text || ':' || p_role || ':' || signer::text;
  IF cur.id IS NOT NULL AND cur.state IN ('self_reported', 'evidenced', 'accepted') THEN
    RETURN jsonb_build_object('claim_id', cur.id, 'claim_state', cur.state, 'duplicate', true);
  END IF;

  IF p_role = 'documenter' THEN
    IF jsonb_array_length(ev) > 0 AND a.creator_id = signer AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(ev) e JOIN public.asset_observations o ON o.id = e::uuid WHERE o.kind <> 'photo_sighting') THEN
      st := 'evidenced'; basis := 'own_photo_sightings';
    ELSE st := 'self_reported'; basis := 'self_statement'; END IF;
  ELSIF p_role = 'holder' THEN
    IF a.creator_id = signer AND a.owner_id IS NULL AND NOT EXISTS (
         SELECT 1 FROM public.asset_observations h WHERE h.asset_id = a.id AND h.kind = 'holding_claim' AND h.superseded_by IS NULL
           AND h.structured_data->>'claim_state' IN ('self_reported', 'evidenced', 'accepted') AND h.structured_data->>'party_user_id' <> signer::text) THEN
      -- TODO(decision): sign-tier self-declaration of holding by the record origin is accepted, as confirm_held_asset did before.
      st := 'accepted'; basis := 'sign_tier_record_origin_declaration';
    ELSE st := 'self_reported'; basis := 'self_statement'; END IF;
  ELSE
    st := 'self_reported'; basis := CASE WHEN jsonb_array_length(ev) > 0 THEN 'self_statement_with_evidence' ELSE 'self_statement' END;
  END IF;

  cid := public.asset_role_claim_write(a.id, p_role, signer, st, basis, ev, stmt, signer);
  IF p_role = 'holder' AND st = 'accepted' THEN UPDATE public.assets SET owner_id = signer, updated_at = now() WHERE id = a.id; END IF;
  RETURN jsonb_build_object('claim_id', cid, 'kind', public.asset_role_claim_kind(p_role), 'role', p_role, 'claim_state', st, 'basis', basis, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.record_asset_role_claim(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_asset_role_claim(uuid, text, jsonb, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.record_asset_role_claim(uuid, text, jsonb, text) IS 'Sign-tier: the signer states one role (documenter, creator, '
  'fabricator, holder, performer, rights_holder) on one active asset for themself, citing observation ids on that asset as evidence. One claim, '
  'one role: holding writes no creation claim, documenting writes neither. Self-reported unless the role''s acceptance rule is met.';

-- Sign-tier: the current holder hands holding over to another party's self-reported holding claim (non-self attestation).
CREATE OR REPLACE FUNCTION public.accept_asset_holding_claim(p_claim_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE signer uuid := auth.uid(); c public.asset_observations%ROWTYPE; a public.assets%ROWTYPE; claimant uuid; nid uuid; note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.asset_observations WHERE id = p_claim_id;
  IF c.id IS NULL OR c.kind <> 'holding_claim' OR c.superseded_by IS NOT NULL OR c.structured_data->>'claim_state' <> 'self_reported' THEN
    RAISE EXCEPTION 'Not an open holding claim' USING ERRCODE = '22023';
  END IF;
  claimant := (c.structured_data->>'party_user_id')::uuid;
  SELECT * INTO a FROM public.assets WHERE id = c.asset_id;
  IF a.owner_id IS DISTINCT FROM signer OR claimant = signer THEN
    RAISE EXCEPTION 'Only the current holder hands a work over, and not to themself' USING ERRCODE = '42501';
  END IF;
  nid := public.asset_role_claim_write(a.id, 'holder', claimant, 'accepted', 'prior_holder_handover',
    coalesce(c.structured_data->'evidence', '[]'::jsonb) || jsonb_build_array(c.id::text), note, signer);
  PERFORM public.asset_role_claim_write(a.id, 'holder', signer, 'ended', 'handed_over', jsonb_build_array(nid::text), note, signer);
  UPDATE public.assets SET owner_id = claimant, updated_at = now() WHERE id = a.id;
  RETURN jsonb_build_object('claim_id', nid, 'asset_id', a.id, 'claim_state', 'accepted');
END $$;
REVOKE ALL ON FUNCTION public.accept_asset_holding_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_asset_holding_claim(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.accept_asset_holding_claim(uuid, text) IS 'Sign-tier: the current holder (owner_id) accepts another party''s open holding '
  'claim. The claimant''s holding becomes accepted (basis prior_holder_handover), the prior holder''s ends, owner_id moves. No authorship is '
  'touched. TODO(decision): transfer without a cooperating prior holder (sale evidence, estate) has no acceptance owner yet.';

-- Sign-tier: the signer withdraws their own current claim. Withdrawing an accepted holding clears owner_id if it is theirs.
CREATE OR REPLACE FUNCTION public.withdraw_asset_role_claim(p_claim_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE signer uuid := auth.uid(); c public.asset_observations%ROWTYPE; nid uuid; reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.asset_observations WHERE id = p_claim_id;
  IF c.id IS NULL OR c.extraction_method <> 'asset_role_claim_v1' OR c.structured_data->>'party_user_id' IS DISTINCT FROM signer::text THEN
    RAISE EXCEPTION 'Only the party withdraws their own claim' USING ERRCODE = '42501';
  END IF;
  IF c.superseded_by IS NOT NULL OR c.structured_data->>'claim_state' IN ('withdrawn', 'ended') THEN
    RETURN jsonb_build_object('claim_id', c.id, 'duplicate', true);
  END IF;
  nid := public.asset_role_claim_write(c.asset_id, c.structured_data->>'role', signer, 'withdrawn', 'party_withdrawal', '[]'::jsonb, reason, signer);
  IF c.kind = 'holding_claim' THEN UPDATE public.assets SET owner_id = NULL, updated_at = now() WHERE id = c.asset_id AND owner_id = signer; END IF;
  RETURN jsonb_build_object('claim_id', nid, 'claim_state', 'withdrawn', 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.withdraw_asset_role_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_asset_role_claim(uuid, text) TO authenticated, service_role;

-- declare_held_asset: same signature. The signer declares a work they hold: holder_declaration + an accepted holding claim.
-- No creation claim: whether the holder also made it is a separate act (record_asset_role_claim role creator).
CREATE OR REPLACE FUNCTION public.declare_held_asset(p_asset_type text, p_title text, p_medium text DEFAULT NULL, p_year text DEFAULT NULL,
  p_dimensions text DEFAULT NULL, p_edition text DEFAULT NULL, p_notes text DEFAULT NULL, p_visibility text DEFAULT 'private')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid(); signed timestamptz := now(); owner_source uuid; aid uuid; ikey text; declared jsonb; decl_id uuid; hid uuid;
  title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  medium text := nullif(btrim(coalesce(p_medium, '')), ''); yr text := nullif(btrim(coalesce(p_year, '')), '');
  dims text := nullif(btrim(coalesce(p_dimensions, '')), ''); edition text := nullif(btrim(coalesce(p_edition, '')), '');
  notes text := nullif(btrim(coalesce(p_notes, '')), ''); vis text := coalesce(nullif(btrim(p_visibility), ''), 'private');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_asset_type IS NULL OR p_asset_type NOT IN ('artwork', 'automobilia', 'memorabilia', 'publication') THEN
    RAISE EXCEPTION 'Type must be artwork, automobilia, memorabilia or publication' USING ERRCODE = '22023';
  END IF;
  IF length(title) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title must be 1 to 200 characters' USING ERRCODE = '22023'; END IF;
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
  ikey := 'holder:' || signer::text || ':' || md5(lower(title) || '|' || coalesce(lower(medium), '') || '|' || coalesce(yr, '') || '|' || coalesce(lower(dims), '') || '|' || coalesce(lower(edition), ''));
  -- creator_id = the signer as record origin (their declaration created the row); owner_id = the signer as holder.
  INSERT INTO public.assets (asset_type, title, description, creator_id, owner_id, status, visibility, attributes)
  VALUES (p_asset_type, title, notes, signer, signer, 'active', vis,
    jsonb_build_object('identity_key', ikey, 'identity_basis', 'holder_declaration', 'source', 'owner-input', 'declared', declared,
      'declared_at', signed, 'declared_by_user_id', signer))
  ON CONFLICT ((attributes->>'identity_key')) WHERE attributes ? 'identity_key' DO NOTHING
  RETURNING id INTO aid;
  IF aid IS NULL THEN
    SELECT a.id INTO aid FROM public.assets a WHERE a.attributes->>'identity_key' = ikey;
    RETURN jsonb_build_object('asset_id', aid, 'duplicate', true, 'visibility', (SELECT a.visibility FROM public.assets a WHERE a.id = aid));
  END IF;

  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence,
    source_identifier, extraction_method)
  VALUES (aid, owner_source, 'holder_declaration', signed,
    format('The holder declared a %s: "%s"%s.', p_asset_type, title, CASE WHEN yr IS NULL THEN '' ELSE ' (' || yr || ')' END),
    jsonb_build_object('signer_user_id', signer, 'asset_type', p_asset_type, 'title', title, 'declared', declared, 'visibility', vis, 'version', 2),
    md5(ikey || '|declaration|' || signed::text), 0.95, ikey, 'holder_declaration_sign_v1')
  RETURNING id INTO decl_id;
  hid := public.asset_role_claim_write(aid, 'holder', signer, 'accepted', 'sign_tier_holder_declaration', jsonb_build_array(decl_id::text), NULL, signer);
  RETURN jsonb_build_object('asset_id', aid, 'duplicate', false, 'visibility', vis, 'holding_claim_id', hid, 'authorship', 'not_claimed');
END $$;
COMMENT ON FUNCTION public.declare_held_asset(text, text, text, text, text, text, text, text) IS 'Sign-tier: the signed-in holder declares a work '
  'in their own words. One assets row (creator_id = the signer as record origin, owner_id = the signer as holder, private by default), one '
  'holder_declaration and one accepted holding_claim citing it. No creation claim: authorship is record_asset_role_claim role creator. The '
  'same declaration twice returns the same row. No price, no value.';

-- confirm_held_asset: same signature. The person whose photos proposed a work confirms it is a work they documented, in their own
-- words. One documentation claim citing every photo_sighting. owner_id stays as it was (NULL for a proposal); no creation claim.
CREATE OR REPLACE FUNCTION public.confirm_held_asset(p_asset_id uuid, p_title text, p_medium text DEFAULT NULL, p_year text DEFAULT NULL,
  p_dimensions text DEFAULT NULL, p_edition text DEFAULT NULL, p_notes text DEFAULT NULL, p_visibility text DEFAULT 'private')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid(); signed timestamptz := now(); a public.assets%ROWTYPE; declared jsonb; ev jsonb; did uuid;
  vtitle text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  medium text := nullif(btrim(coalesce(p_medium, '')), ''); yr text := nullif(btrim(coalesce(p_year, '')), '');
  dims text := nullif(btrim(coalesce(p_dimensions, '')), ''); edition text := nullif(btrim(coalesce(p_edition, '')), '');
  notes text := nullif(btrim(coalesce(p_notes, '')), ''); vis text := coalesce(nullif(btrim(p_visibility), ''), 'private');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id;
  -- creator_id gates this as record origin: only the person whose photos proposed the work may confirm it.
  IF a.id IS NULL OR a.creator_id IS DISTINCT FROM signer OR a.attributes->>'identity_basis' <> 'photo_proposal' THEN
    RAISE EXCEPTION 'Only the person whose photos proposed a work confirms it' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'active' THEN
    SELECT o.id INTO did FROM public.asset_observations o WHERE o.asset_id = a.id AND o.kind = 'documentation_claim' AND o.superseded_by IS NULL
      AND o.structured_data->>'party_user_id' = signer::text;
    RETURN jsonb_build_object('asset_id', a.id, 'duplicate', true, 'visibility', a.visibility, 'documentation_claim_id', did);
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

  declared := jsonb_strip_nulls(jsonb_build_object('medium', medium, 'year', yr, 'dimensions', dims, 'edition', edition, 'notes', notes));
  SELECT coalesce(jsonb_agg(o.id::text ORDER BY o.observed_at), '[]'::jsonb) INTO ev FROM public.asset_observations o
    WHERE o.asset_id = a.id AND o.kind = 'photo_sighting';
  UPDATE public.assets SET title = vtitle, description = notes, status = 'active', visibility = vis, updated_at = signed,
    attributes = attributes || jsonb_build_object('declared', declared, 'declared_at', signed, 'declared_by_user_id', signer, 'confirmed_from', 'photo_proposal',
      'confirmed_as', 'documentation')
  WHERE id = a.id;
  did := public.asset_role_claim_write(a.id, 'documenter', signer, CASE WHEN jsonb_array_length(ev) > 0 THEN 'evidenced' ELSE 'self_reported' END,
    CASE WHEN jsonb_array_length(ev) > 0 THEN 'own_photo_sightings' ELSE 'self_statement' END, ev, vtitle, signer);
  RETURN jsonb_build_object('asset_id', a.id, 'duplicate', false, 'visibility', vis, 'documentation_claim_id', did,
    'holding', 'not_claimed', 'authorship', 'not_claimed');
END $$;
COMMENT ON FUNCTION public.confirm_held_asset(uuid, text, text, text, text, text, text, text) IS 'Sign-tier: the person whose photos proposed a work '
  'confirms it as a work they documented, in their own words. One documentation_claim citing the photo_sighting rows. Holding and authorship '
  'are not implied: they are separate record_asset_role_claim acts. owner_id is not set here. Twice is a no-op.';

-- dismiss_held_asset: same signature. Archives a pending proposal and leaves no current claim behind.
CREATE OR REPLACE FUNCTION public.dismiss_held_asset(p_asset_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE signer uuid := auth.uid(); signed timestamptz := now(); owner_source uuid; a public.assets%ROWTYPE; reason text := nullif(btrim(coalesce(p_reason, '')), ''); c record; n_withdrawn integer := 0;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id;
  IF a.id IS NULL OR a.creator_id IS DISTINCT FROM signer OR a.attributes->>'identity_basis' <> 'photo_proposal' THEN
    RAISE EXCEPTION 'Only the person whose photos proposed a work dismisses it' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'archived' THEN RETURN jsonb_build_object('asset_id', a.id, 'duplicate', true); END IF;
  IF a.status <> 'pending' THEN RAISE EXCEPTION 'A confirmed work is not dismissed here; withdraw its claims instead' USING ERRCODE = '22023'; END IF;
  IF reason IS NOT NULL AND length(reason) > 400 THEN RAISE EXCEPTION 'Reason is at most 400 characters' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.asset_observations o WHERE o.asset_id = a.id AND o.superseded_by IS NULL
               AND o.kind IN ('documentation_claim', 'creation_claim', 'holding_claim', 'performance_claim', 'rights_claim')
               AND coalesce(o.structured_data->>'claim_state', 'source_statement') NOT IN ('withdrawn', 'ended')
               AND o.structured_data->>'party_user_id' IS DISTINCT FROM signer::text) THEN
    RAISE EXCEPTION 'Another party has a current claim on this asset; it is not dismissed here' USING ERRCODE = '22023';
  END IF;
  FOR c IN SELECT o.structured_data->>'role' AS role FROM public.asset_observations o WHERE o.asset_id = a.id AND o.superseded_by IS NULL
             AND o.extraction_method = 'asset_role_claim_v1' AND o.structured_data->>'party_user_id' = signer::text
             AND o.structured_data->>'claim_state' NOT IN ('withdrawn', 'ended') LOOP
    PERFORM public.asset_role_claim_write(a.id, c.role, signer, 'withdrawn', 'proposal_dismissed', '[]'::jsonb, reason, signer);
    n_withdrawn := n_withdrawn + 1;
  END LOOP;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  UPDATE public.assets SET status = 'archived', updated_at = signed, attributes = attributes || jsonb_build_object('dismissed_at', signed, 'dismissed_reason', reason) WHERE id = a.id;
  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence, source_identifier, extraction_method)
  VALUES (a.id, owner_source, 'proposal_dismissed', signed, coalesce('Dismissed: ' || reason, 'Dismissed by the person whose photos proposed it.'),
    jsonb_strip_nulls(jsonb_build_object('signer_user_id', signer, 'reason', reason, 'claims_withdrawn', n_withdrawn)),
    md5(a.attributes->>'identity_key' || '|dismissed|' || signed::text), 0.95, a.attributes->>'identity_key', 'holder_declaration_sign_v1');
  RETURN jsonb_build_object('asset_id', a.id, 'duplicate', false, 'claims_withdrawn', n_withdrawn);
END $$;

-- held_assets_read: 'assets' are works the signer holds (owner_id or an accepted holding claim); 'documented' are works they
-- documented and do not hold; 'proposed' are their pending photo proposals (record-origin access). creator_id is never read as holding.
CREATE OR REPLACE FUNCTION public.held_assets_read(p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  lim AS (SELECT greatest(1, least(coalesce(p_limit, 200), 1000)) AS n),
  mine AS (
    SELECT a.* FROM public.assets a, me WHERE me.uid IS NOT NULL AND public.asset_holder_is(a.id, me.uid)
      AND a.asset_type IN ('artwork', 'automobilia', 'memorabilia', 'publication') AND a.status = 'active'),
  documented AS (
    SELECT a.* FROM public.assets a, me WHERE me.uid IS NOT NULL AND a.status = 'active'
      AND a.asset_type IN ('artwork', 'automobilia', 'memorabilia', 'publication') AND NOT public.asset_holder_is(a.id, me.uid)
      AND EXISTS (SELECT 1 FROM public.asset_observations d WHERE d.asset_id = a.id AND d.kind = 'documentation_claim' AND d.superseded_by IS NULL
                    AND d.structured_data->>'party_user_id' = me.uid::text AND d.structured_data->>'claim_state' IN ('self_reported', 'evidenced', 'accepted'))),
  proposed AS (
    SELECT a.* FROM public.assets a, me WHERE me.uid IS NOT NULL AND a.creator_id = me.uid AND a.status = 'pending' AND a.attributes->>'identity_basis' = 'photo_proposal'),
  shape AS (
    SELECT m.id, m.created_at, jsonb_strip_nulls(jsonb_build_object(
      'id', m.id, 'asset_type', m.asset_type, 'title', m.title, 'visibility', m.visibility, 'created_at', m.created_at,
      'declared', m.attributes->'declared', 'identity_basis', m.attributes->>'identity_basis',
      'my_roles', (SELECT jsonb_agg(DISTINCT r.structured_data->>'role') FROM public.asset_observations r, me WHERE r.asset_id = m.id AND r.superseded_by IS NULL
                     AND r.extraction_method = 'asset_role_claim_v1' AND r.structured_data->>'party_user_id' = me.uid::text
                     AND r.structured_data->>'claim_state' IN ('self_reported', 'evidenced', 'accepted')),
      'presentations', (SELECT count(*) FROM public.asset_observations o WHERE o.asset_id = m.id AND o.kind = 'auction_lot' AND o.superseded_by IS NULL),
      'photos', (SELECT count(*) FROM public.asset_observations o WHERE o.asset_id = m.id AND o.kind = 'photo_sighting'),
      'public_sale_recorded', EXISTS (SELECT 1 FROM public.asset_observations o WHERE o.asset_id = m.id AND o.kind = 'auction_lot' AND o.superseded_by IS NULL
                                        AND (o.structured_data->>'hammer_price')::numeric > 0))) AS j, m.src
    FROM (SELECT *, 'held' AS src FROM mine UNION ALL SELECT *, 'documented' AS src FROM documented) m),
  prow AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', p.id, 'title', p.title, 'kind', p.attributes->'proposal'->>'kind', 'labels', p.attributes->'proposal'->'labels',
      'photos', (p.attributes->'proposal'->>'photos')::int, 'span_from', p.attributes->'proposal'->>'span_from', 'span_to', p.attributes->'proposal'->>'span_to',
      'filenames', p.attributes->'proposal'->'filenames', 'labeller', p.attributes->'proposal'->>'labeller', 'proposed_at', p.attributes->>'proposed_at'))
      ORDER BY (p.attributes->'proposal'->>'span_to')::timestamptz DESC NULLS LAST) AS v
    FROM (SELECT * FROM proposed ORDER BY (attributes->'proposal'->>'span_to')::timestamptz DESC NULLS LAST LIMIT (SELECT n FROM lim)) p)
  SELECT CASE WHEN (SELECT uid FROM me) IS NULL THEN NULL ELSE jsonb_build_object(
    'assets', coalesce((SELECT jsonb_agg(s.j ORDER BY s.created_at DESC) FROM (SELECT * FROM shape WHERE src = 'held' ORDER BY created_at DESC LIMIT (SELECT n FROM lim)) s), '[]'::jsonb),
    'total', (SELECT count(*) FROM mine),
    'by_type', coalesce((SELECT jsonb_object_agg(asset_type, n) FROM (SELECT asset_type, count(*) n FROM mine GROUP BY 1) t), '{}'::jsonb),
    'documented', coalesce((SELECT jsonb_agg(s.j ORDER BY s.created_at DESC) FROM (SELECT * FROM shape WHERE src = 'documented' ORDER BY created_at DESC LIMIT (SELECT n FROM lim)) s), '[]'::jsonb),
    'documented_total', (SELECT count(*) FROM documented),
    'proposed', coalesce((SELECT v FROM prow), '[]'::jsonb),
    'proposed_total', (SELECT count(*) FROM proposed),
    'as_of', now()) END
$$;
COMMENT ON FUNCTION public.held_assets_read(integer) IS 'The signed-in person''s works: assets = held (owner_id or an accepted holding claim), '
  'documented = documented by them and not held, proposed = their pending photo proposals; each with their own current roles. creator_id '
  '(record origin) is never read as holding. Null for anon.';

-- asset_profile_read: holder from public.asset_holder_is; record origin reported separately; claim role and state shown; role claims listed without naming a party.
CREATE OR REPLACE FUNCTION public.asset_profile_read(p_asset_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH viewer AS (SELECT auth.uid() AS uid),
  a AS (
    SELECT a.* FROM public.assets a, viewer v WHERE a.id = p_asset_id AND a.asset_type IN ('artwork', 'automobilia', 'memorabilia', 'publication')
      AND a.status <> 'archived'
      -- Record-origin access: the person whose evidence created the row may read it back (creator_id). That is access to their own
      -- record, never a reading of who made or holds the work; holding is public.asset_holder_is.
      AND (a.visibility = 'public' OR (v.uid IS NOT NULL AND (a.creator_id = v.uid OR public.asset_holder_is(a.id, v.uid))))),
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
      'role', coalesce(c.structured_data->>'role', 'creator'), 'claim_state', coalesce(c.structured_data->>'claim_state', 'source_statement'),
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
    WHERE c.kind = 'creation_claim' AND c.superseded_by IS NULL
      AND coalesce(c.structured_data->>'claim_state', 'source_statement') <> 'withdrawn'),
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
    'viewer', jsonb_build_object('is_holder', coalesce(public.asset_holder_is(a.id, v.uid), false),
      'is_record_origin', (v.uid IS NOT NULL AND a.creator_id = v.uid),
      'claims', coalesce((SELECT jsonb_agg(jsonb_build_object('claim_id', rc.id, 'kind', rc.kind, 'role', rc.structured_data->>'role',
        'claim_state', rc.structured_data->>'claim_state') ORDER BY rc.observed_at) FROM public.asset_observations rc
        WHERE rc.asset_id = a.id AND rc.superseded_by IS NULL AND rc.kind IN ('documentation_claim', 'creation_claim', 'holding_claim', 'performance_claim', 'rights_claim')
          AND v.uid IS NOT NULL AND rc.structured_data->>'party_user_id' = v.uid::text), '[]'::jsonb)),
    'declared', a.attributes->'declared',
    'proposal', CASE WHEN a.attributes ? 'proposal' THEN a.attributes->'proposal' || jsonb_build_object('status', a.status, 'photo_sightings', coalesce((SELECT ph.v FROM photos ph), '[]'::jsonb)) END,
    'market', CASE WHEN EXISTS (SELECT 1 FROM lots) THEN 'recorded' ELSE 'none_public' END,
    'image_url', (SELECT l.structured_data->>'image_url' FROM lots l WHERE l.superseded_by IS NULL AND l.structured_data ? 'image_url' ORDER BY l.observed_at DESC LIMIT 1),
    'lots', coalesce((SELECT cl.v FROM current_lots cl), '[]'::jsonb),
    'history', coalesce((SELECT h.v FROM history h), '[]'::jsonb),
    'creation', coalesce((SELECT cr.v FROM creation cr), '[]'::jsonb),
    -- Role claims other than creation, without naming the party (a holder or documenter is never named here): role, state, clock.
    'role_claims', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', rc.kind, 'role', rc.structured_data->>'role',
      'claim_state', rc.structured_data->>'claim_state', 'basis', rc.structured_data->>'basis', 'observed_at', rc.observed_at,
      'evidence_count', jsonb_array_length(coalesce(rc.structured_data->'evidence', '[]'::jsonb))) ORDER BY rc.observed_at)
      FROM public.asset_observations rc WHERE rc.asset_id = a.id AND rc.superseded_by IS NULL
        AND rc.kind IN ('documentation_claim', 'holding_claim', 'performance_claim', 'rights_claim')
        AND rc.structured_data->>'claim_state' IN ('self_reported', 'evidenced', 'accepted')), '[]'::jsonb),
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
COMMENT ON FUNCTION public.asset_profile_read(uuid) IS 'The asset profile''s one typed read, viewer-aware: public assets for anyone; a private or '
  'unlisted asset for its record origin (creator_id: their own record) or its holder (owner_id or an accepted holding claim). viewer.is_holder '
  'never reads creator_id; viewer.is_record_origin says whose evidence created the row; viewer.claims lists the viewer''s own current claims. '
  'creation carries role and claim_state (house rows read source_statement); role_claims lists documentation, holding, performance and rights '
  'claims by role and state without naming the party.';

-- Acceptance path (b): who are this asset's contributors as work actors? A user party resolves only through viewer_identity_bridge
-- (approved account_link_claims nuke_actor rows). A catalogue party (external_identities, a printed name) resolves to no actor,
-- even when a user has claimed that row: no accepted catalogue-identity -> actor link exists (missing edge). Nothing matches names.
CREATE OR REPLACE FUNCTION public.asset_claim_actors(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE out_ jsonb := '[]'::jsonb; c record; bridge jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'asset_claim_actors is service-only' USING ERRCODE = '42501'; END IF;
  FOR c IN SELECT o.id, o.kind, coalesce(o.structured_data->>'role', 'creator') AS role, coalesce(o.structured_data->>'claim_state', 'source_statement') AS state,
                  (o.structured_data->>'party_user_id')::uuid AS party_user, (o.structured_data->>'party_identity_id')::uuid AS party_identity
           FROM public.asset_observations o WHERE o.asset_id = p_asset_id AND o.superseded_by IS NULL
             AND o.kind IN ('documentation_claim', 'creation_claim', 'holding_claim', 'performance_claim', 'rights_claim')
             AND coalesce(o.structured_data->>'claim_state', 'source_statement') NOT IN ('withdrawn', 'ended')
           ORDER BY o.observed_at LOOP
    IF c.party_user IS NOT NULL THEN
      bridge := public.viewer_identity_bridge(c.party_user);
      out_ := out_ || jsonb_build_array(jsonb_build_object('claim_id', c.id, 'kind', c.kind, 'role', c.role, 'claim_state', c.state,
        'party_kind', 'user', 'bridge_state', bridge->>'state', 'actor_ids', coalesce(bridge->'evidenced_actor_ids', '[]'::jsonb),
        'actor_basis', 'account_link_claims_approved_actor_rung'));
    ELSIF c.party_identity IS NOT NULL THEN
      out_ := out_ || jsonb_build_array(jsonb_build_object('claim_id', c.id, 'kind', c.kind, 'role', c.role, 'claim_state', c.state,
        'party_kind', 'catalogue', 'party_identity_id', c.party_identity, 'actor_ids', '[]'::jsonb,
        'actor_basis', 'catalogue_identity_not_actor'));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('asset_id', p_asset_id, 'claims', out_, 'as_of', now());
END $$;
REVOKE ALL ON FUNCTION public.asset_claim_actors(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_claim_actors(uuid) TO service_role;
COMMENT ON FUNCTION public.asset_claim_actors(uuid) IS 'Service-only: each current role claim on an asset with the work actors its party resolves '
  'to. User parties resolve only through viewer_identity_bridge (approved nuke_actor link claims). Catalogue parties resolve to none '
  '(catalogue_identity_not_actor). Nothing is matched by name. Writes nothing; actor_capability_basis is not fed (capability_fold_basis has no asset branch).';

COMMIT;
