-- Split the held-asset flow into separate, attributed role claims. Codex coordination 2026-11-09 (Skylar's chat), case ledger
-- §21.4 (PR #3172), exact-head review of PR #3190 at 84a616b. Extends existing owners; no new table, no new column.
--
-- What was wrong (20261109013000_held_assets.sql, 20261109020000_held_asset_proposals.sql):
--   * declare_held_asset and confirm_held_asset each wrote, in one signature, owner_id = signer + holder_declaration + a
--     creation_claim (role creator, attribution direct, party_user_id = signer). Holding implied making; confirming a photo
--     proposal (documenting) implied both.
--   * held_assets_read and asset_profile_read.viewer.is_holder read (owner_id = uid OR creator_id = uid): record origin read as holding.
--
-- Three separate things, never collapsed:
--   1. Testimony: what a person attributed to themself (role claim rows). Recordable without corroboration. claim_state is only
--      stated | withdrawn. A revised statement is a new version that supersedes the old one; the history stays.
--   2. Qualification: what the testimony is currently supportable by. Computed at read time (asset_role_claim_status), never stored,
--      so a cited row that is later superseded or withdrawn disqualifies dependent acceptance and projection with no rewrite.
--      Nothing here ever reads as "verified": library membership, record origin and self-statement are named as such.
--   3. Acceptance: authority to change the current holding projection (owner_id). A separate row (kind role_claim_acceptance)
--      citing the claim lineage. The only acceptance rules are in asset_holding_policy_interim, marked TODO(decision).
--
-- Kinds (asset_observations, source owner-input):
--   role claims  documentation_claim (documenter), creation_claim (creator, fabricator), holding_claim (holder),
--                performance_claim (performer), rights_claim (rights_holder). extraction_method asset_role_claim_v1,
--                source_identifier 'claim:<asset>:<role>:<user>' (the lineage key). structured_data {role, party_user_id,
--                claim_state, basis, evidence[observation ids], statement, version, payload_hash}.
--   acceptance   role_claim_acceptance, source_identifier 'acceptance:<lineage key>', {claim_key, claim_id, role, party_user_id,
--                acceptance_state accepted|ended|revoked, basis, policy, accepted_by_user_id}.
--   documentation_record  confirm_held_asset: the person's own words keeping a photographed work as documentation, citing the
--                current photo_sighting rows. Not a role claim: no maker, holder, performer or photographer identity is implied.
--
-- creator_id stays record/evidence origin (20261028203000_photo_work_ledger.sql COMMENT ON COLUMN). Nothing nulls it. It grants
-- record-origin access only: confirm/dismiss one's own proposal, read one's own private record back, list one's own documentation.
-- It is never read as maker, holder or verified photographer.
--
-- Existing rows (how a migration on a fresh database, or on production, treats them; this migration UPDATEs no row):
--   * creation_claim rows with extraction_method holder_declaration_sign_v1 (written by the old compound declare/confirm) read as
--     qualification legacy_compound_unverified: shown with the person's name, never as a house attribution, never promoted, not
--     counted in asset_creators (which reads party_identity_id only).
--   * assets whose attributes carry declared_by_user_id but no holding_projection (old compound declare/confirm) are legacy compound:
--     their owner_id is kept as written but no longer read as holding by asset_holder_is. The person keeps record access and sees
--     the work under held_assets_read.unresolved (reason legacy_compound). They resolve it by an explicit holder (and, separately,
--     creator) claim; the interim policy accepts a legacy owner's own holding claim like a record origin's.
--   * Other assets with owner_id set by other writers (no declared_by_user_id) keep owner_id as holding, unchanged.
--   * holder_declaration and photo_sighting rows are untouched testimony.
--
-- Serialization: every writer that can change holding locks the asset row (SELECT ... FOR UPDATE) first, then the claim rows, then
-- revalidates under the lock. A per-lineage advisory lock serializes versioning of one person's claim.
-- Skill: asset_claim_actors resolves identity only (approved account_link_claims actor rungs through viewer_identity_bridge). It is
-- not skill evidence: demonstrated activity plus participant identity stays with capability_fold_basis, which this does not feed.
--
-- TODO(decision): acceptance policy (asset_holding_policy_interim), transfer without a cooperating prior holder, who may accept
-- creator / fabricator / performer / rights claims (none can be accepted here), and whether a claimed catalogue identity may ever
-- reach an actor. Clients: nuke_frontend HeldAssets / AssetDeclare / AssetProfile updated in the same PR; no iOS client calls these.
-- Version 20261113200000: after 20261113090000_receipt_work_context_reader.sql on main.
-- Contracts: supabase/sql/test_asset_role_claims.sql (fresh database, PG17), supabase/sql/test_asset_role_claims_upgrade.sql
-- (old compound flow first, then this migration), supabase/sql/test_asset_role_claims_concurrency.mjs (two sessions, real PG17).
-- DRAFT: not applied.
-- Rollback: re-run the function bodies of 20261109020000_held_asset_proposals.sql and 20261109013000_held_assets.sql; DROP FUNCTION
-- the new functions below; DROP INDEX asset_observations_role_claim_party_idx, asset_observations_role_acceptance_key_idx. Rows
-- written by the new writers stay as testimony.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE INDEX IF NOT EXISTS asset_observations_role_claim_party_idx
  ON public.asset_observations (((structured_data->>'party_user_id')), asset_id)
  WHERE kind IN ('documentation_claim', 'creation_claim', 'holding_claim', 'performance_claim', 'rights_claim') AND superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS asset_observations_role_acceptance_key_idx
  ON public.asset_observations (asset_id, source_identifier) WHERE kind = 'role_claim_acceptance' AND superseded_by IS NULL;

CREATE OR REPLACE FUNCTION public.asset_role_claim_kind(p_role text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role WHEN 'documenter' THEN 'documentation_claim' WHEN 'creator' THEN 'creation_claim' WHEN 'fabricator' THEN 'creation_claim'
    WHEN 'holder' THEN 'holding_claim' WHEN 'performer' THEN 'performance_claim' WHEN 'rights_holder' THEN 'rights_claim' END
$$;
COMMENT ON FUNCTION public.asset_role_claim_kind(text) IS 'The asset_observations kind for one role: documenter -> documentation_claim, creator and '
  'fabricator -> creation_claim, holder -> holding_claim, performer -> performance_claim, rights_holder -> rights_claim. Null otherwise.';

-- Is an asset a legacy compound record (old declare/confirm wrote owner_id + creation in one act)?
CREATE OR REPLACE FUNCTION public.asset_is_legacy_compound(p_attributes jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_attributes ? 'declared_by_user_id' AND NOT p_attributes ? 'holding_projection', false)
$$;

-- Cited evidence, read now: each cited id is current when it exists on the asset, is not superseded, and (for testimony rows) is not
-- withdrawn. Returns {cited, current, lapsed[]}.
CREATE OR REPLACE FUNCTION public.asset_evidence_currentness(p_asset_id uuid, p_evidence jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH e AS (SELECT x #>> '{}' AS id FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_evidence) = 'array' THEN p_evidence ELSE '[]'::jsonb END) x),
  chk AS (
    SELECT e.id, EXISTS (SELECT 1 FROM public.asset_observations o
      WHERE o.id = CASE WHEN e.id ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN e.id::uuid END AND o.asset_id = p_asset_id AND o.superseded_by IS NULL
        AND coalesce(o.structured_data->>'claim_state', '') <> 'withdrawn' AND coalesce(o.structured_data->>'record_state', '') <> 'withdrawn'
        AND coalesce(o.structured_data->>'acceptance_state', 'accepted') = 'accepted') AS ok
    FROM e)
  SELECT jsonb_build_object('cited', (SELECT count(*) FROM chk), 'current', (SELECT count(*) FROM chk WHERE ok),
    'lapsed', coalesce((SELECT jsonb_agg(id) FROM chk WHERE NOT ok), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.asset_evidence_currentness(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_evidence_currentness(uuid, jsonb) TO service_role;

-- Evidence a signer may cite: current rows on the same asset, not their own role claims or acceptances.
CREATE OR REPLACE FUNCTION public.asset_role_claim_evidence_ok(p_asset_id uuid, p_evidence jsonb, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) = 'array' AND jsonb_array_length(coalesce(p_evidence, '[]'::jsonb)) <= 200
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) e WHERE jsonb_typeof(e) <> 'string')
    AND (public.asset_evidence_currentness(p_asset_id, p_evidence)->'lapsed') = '[]'::jsonb
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(coalesce(p_evidence, '[]'::jsonb)) e JOIN public.asset_observations o ON o.id = CASE WHEN e ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN e::uuid END
      WHERE o.kind = 'role_claim_acceptance' OR (o.extraction_method = 'asset_role_claim_v1' AND o.structured_data->>'party_user_id' = p_user::text))
$$;
REVOKE ALL ON FUNCTION public.asset_role_claim_evidence_ok(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- A stable hash of the attributed payload: role, statement, and the evidence set (order-free).
CREATE OR REPLACE FUNCTION public.asset_role_claim_payload_hash(p_role text, p_statement text, p_evidence jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(coalesce(p_role, '') || '|' || coalesce(p_statement, '') || '|' ||
    coalesce((SELECT string_agg(DISTINCT lower(x), ',' ORDER BY lower(x)) FROM jsonb_array_elements_text(coalesce(p_evidence, '[]'::jsonb)) x), ''))
$$;

-- Internal: append one testimony version for (asset, role, party), superseding the lineage head. Not callable by clients.
CREATE OR REPLACE FUNCTION public.asset_role_claim_write(p_asset_id uuid, p_role text, p_party uuid, p_state text, p_basis text,
  p_evidence jsonb, p_statement text, p_by uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE owner_source uuid; k text := public.asset_role_claim_kind(p_role); prior record; nid uuid := gen_random_uuid(); ikey text; at_ timestamptz := clock_timestamp();
BEGIN
  IF k IS NULL OR p_party IS NULL OR p_state NOT IN ('stated', 'withdrawn') THEN
    RAISE EXCEPTION 'asset_role_claim_write: bad role, party or state' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  ikey := 'claim:' || p_asset_id::text || ':' || p_role || ':' || p_party::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(ikey, 0));
  SELECT o.id, coalesce((o.structured_data->>'version')::int, 1) AS version INTO prior FROM public.asset_observations o
    WHERE o.asset_id = p_asset_id AND o.kind = k AND o.superseded_by IS NULL AND o.extraction_method = 'asset_role_claim_v1' AND o.source_identifier = ikey
    ORDER BY o.created_at DESC LIMIT 1 FOR UPDATE;
  INSERT INTO public.asset_observations (id, asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence,
    source_identifier, extraction_method, supersedes)
  VALUES (nid, p_asset_id, owner_source, k, at_, format('%s claim (%s)%s', p_role, p_state, coalesce(': ' || p_statement, '')),
    jsonb_strip_nulls(jsonb_build_object('role', p_role, 'party_user_id', p_party, 'claim_state', p_state, 'basis', p_basis,
      'evidence', coalesce(p_evidence, '[]'::jsonb), 'statement', p_statement, 'recorded_by_user_id', p_by,
      'version', coalesce(prior.version, 0) + 1, 'payload_hash', public.asset_role_claim_payload_hash(p_role, p_statement, p_evidence))),
    md5(ikey || '|' || p_state || '|' || nid::text), 0.5, ikey, 'asset_role_claim_v1', prior.id);
  IF prior.id IS NOT NULL THEN UPDATE public.asset_observations SET superseded_by = nid WHERE id = prior.id; END IF;
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.asset_role_claim_write(uuid, text, uuid, text, text, jsonb, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Internal: append one acceptance state for a claim lineage, superseding the lineage's current acceptance.
CREATE OR REPLACE FUNCTION public.asset_role_acceptance_write(p_claim_id uuid, p_state text, p_basis text, p_by uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE c public.asset_observations%ROWTYPE; prior uuid; nid uuid := gen_random_uuid(); akey text; owner_source uuid;
BEGIN
  IF p_state NOT IN ('accepted', 'ended', 'revoked') THEN RAISE EXCEPTION 'bad acceptance state' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.asset_observations WHERE id = p_claim_id;
  IF c.id IS NULL OR c.extraction_method <> 'asset_role_claim_v1' THEN RAISE EXCEPTION 'not a role claim' USING ERRCODE = '22023'; END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  akey := 'acceptance:' || c.source_identifier;
  SELECT o.id INTO prior FROM public.asset_observations o WHERE o.asset_id = c.asset_id AND o.kind = 'role_claim_acceptance'
    AND o.superseded_by IS NULL AND o.source_identifier = akey FOR UPDATE;
  INSERT INTO public.asset_observations (id, asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence,
    source_identifier, extraction_method, supersedes)
  VALUES (nid, c.asset_id, owner_source, 'role_claim_acceptance', clock_timestamp(), format('%s acceptance (%s): %s', c.structured_data->>'role', p_state, p_basis),
    jsonb_build_object('claim_key', c.source_identifier, 'claim_id', c.id, 'role', c.structured_data->>'role', 'party_user_id', c.structured_data->>'party_user_id',
      'acceptance_state', p_state, 'basis', p_basis, 'policy', 'interim_v1', 'accepted_by_user_id', p_by, 'version', 1),
    md5(akey || '|' || p_state || '|' || nid::text), 0.5, akey, 'asset_role_acceptance_v1', prior);
  IF prior IS NOT NULL THEN UPDATE public.asset_observations SET superseded_by = nid WHERE id = prior; END IF;
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.asset_role_acceptance_write(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Qualification of one claim, read now. Never "verified".
--   legacy_compound_unverified  old compound declare/confirm creation claim
--   source_statement            a house or source statement (fold_asset_creation_claims)
--   withdrawn | superseded      the party withdrew it, or a later version replaced it (history)
--   accepted_interim            current, accepted under the interim policy, and every cited row still current
--   acceptance_lapsed           accepted, but a cited row has since been superseded or withdrawn
--   stated_evidence_lapsed      stated (not accepted), and a cited row has lapsed
--   stated_unverified           stated, not accepted; its basis names what it rests on (self statement, own library, record origin)
CREATE OR REPLACE FUNCTION public.asset_role_claim_status(p_claim_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH c AS (SELECT * FROM public.asset_observations WHERE id = p_claim_id),
  ev AS (SELECT public.asset_evidence_currentness(c.asset_id, c.structured_data->'evidence') AS v FROM c),
  acc AS (SELECT o.* FROM public.asset_observations o, c WHERE o.asset_id = c.asset_id AND o.kind = 'role_claim_acceptance'
            AND o.superseded_by IS NULL AND o.source_identifier = 'acceptance:' || c.source_identifier)
  SELECT CASE WHEN (SELECT id FROM c) IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'claim_id', c.id, 'kind', c.kind, 'role', coalesce(c.structured_data->>'role', 'creator'), 'party_user_id', c.structured_data->>'party_user_id',
    'claim_state', coalesce(c.structured_data->>'claim_state', CASE WHEN c.extraction_method = 'holder_declaration_sign_v1' THEN 'stated' ELSE 'source_statement' END),
    'basis', CASE WHEN c.extraction_method = 'holder_declaration_sign_v1' THEN 'legacy_compound_sign' ELSE c.structured_data->>'basis' END,
    'version', (c.structured_data->>'version')::int, 'evidence', (SELECT v FROM ev),
    'acceptance', (SELECT jsonb_build_object('state', a.structured_data->>'acceptance_state', 'basis', a.structured_data->>'basis',
                     'policy', a.structured_data->>'policy', 'accepted_claim_id', a.structured_data->>'claim_id') FROM acc a LIMIT 1),
    'qualification', CASE
      WHEN c.extraction_method = 'holder_declaration_sign_v1' THEN 'legacy_compound_unverified'
      WHEN c.extraction_method IS DISTINCT FROM 'asset_role_claim_v1' THEN 'source_statement'
      WHEN c.superseded_by IS NOT NULL THEN 'superseded'
      WHEN c.structured_data->>'claim_state' = 'withdrawn' THEN 'withdrawn'
      WHEN EXISTS (SELECT 1 FROM acc a WHERE a.structured_data->>'acceptance_state' = 'accepted') THEN
        CASE WHEN ((SELECT v FROM ev)->'lapsed') = '[]'::jsonb THEN 'accepted_interim' ELSE 'acceptance_lapsed' END
      WHEN ((SELECT v FROM ev)->'lapsed') <> '[]'::jsonb THEN 'stated_evidence_lapsed'
      ELSE 'stated_unverified' END)) END
  FROM c
$$;
REVOKE ALL ON FUNCTION public.asset_role_claim_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_role_claim_status(uuid) TO service_role;
COMMENT ON FUNCTION public.asset_role_claim_status(uuid) IS 'Internal: one claim''s testimony, cited-evidence currentness, acceptance and qualification, '
  'computed now. A superseded or withdrawn cited row lapses dependent acceptance (acceptance_lapsed) without rewriting the claim. Never verified.';

-- The holder reader. A role-managed asset: a current accepted holding claim whose cited rows are all current. A legacy compound
-- asset: nobody, until the person makes an explicit holding claim. Any other asset: owner_id as written. Never creator_id.
CREATE OR REPLACE FUNCTION public.asset_holder_is(p_asset_id uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = p_asset_id AND (
    CASE WHEN a.attributes ? 'holding_projection' THEN EXISTS (
           SELECT 1 FROM public.asset_observations h WHERE h.asset_id = a.id AND h.kind = 'holding_claim' AND h.superseded_by IS NULL
             AND h.extraction_method = 'asset_role_claim_v1' AND h.structured_data->>'party_user_id' = p_user::text
             AND public.asset_role_claim_status(h.id)->>'qualification' = 'accepted_interim')
         WHEN public.asset_is_legacy_compound(a.attributes) THEN false
         ELSE a.owner_id = p_user END))
$$;
REVOKE ALL ON FUNCTION public.asset_holder_is(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_holder_is(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.asset_holder_is(uuid, uuid) IS 'Internal holder reader: a current accepted holding claim with current evidence on a '
  'role-managed asset; nobody on a legacy compound asset until an explicit claim; owner_id elsewhere. creator_id is never read as holding.';

-- Re-project owner_id (a cache) from the qualified holding of a role-managed asset. Exactly one qualified holder, or NULL.
-- Writers call it under the asset lock. TODO: writers outside this migration that supersede cited rows do not call it; every reader
-- here uses asset_holder_is, so the cache can be stale but is never read as the answer. Service role may call it by hand.
CREATE OR REPLACE FUNCTION public.asset_holding_reproject(p_asset_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a public.assets%ROWTYPE; holders uuid[]; nowner uuid;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF a.id IS NULL OR NOT a.attributes ? 'holding_projection' THEN RETURN a.owner_id; END IF;
  SELECT array_agg(DISTINCT (h.structured_data->>'party_user_id')::uuid) INTO holders FROM public.asset_observations h
    WHERE h.asset_id = a.id AND h.kind = 'holding_claim' AND h.superseded_by IS NULL AND h.extraction_method = 'asset_role_claim_v1'
      AND public.asset_role_claim_status(h.id)->>'qualification' = 'accepted_interim';
  nowner := CASE WHEN cardinality(holders) = 1 THEN holders[1] END;
  IF nowner IS DISTINCT FROM a.owner_id THEN UPDATE public.assets SET owner_id = nowner, updated_at = now() WHERE id = a.id; END IF;
  RETURN nowner;
END $$;
REVOKE ALL ON FUNCTION public.asset_holding_reproject(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_holding_reproject(uuid) TO service_role;

-- TODO(decision): the interim acceptance policy for holding, isolated here so the mechanical split does not decide it. Today it
-- keeps the pre-split behaviour only where nobody else could be displaced: the record origin (or the legacy compound owner) of an
-- asset with no qualified holder and no other party's current holding claim. Returns the basis, or NULL (stays stated_unverified).
-- It is not verification of title: the basis names what it rests on.
CREATE OR REPLACE FUNCTION public.asset_holding_policy_interim(p_asset_id uuid, p_claimant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN
      (a.creator_id = p_claimant OR (public.asset_is_legacy_compound(a.attributes) AND a.owner_id = p_claimant))
      AND (a.owner_id IS NULL OR a.owner_id = p_claimant)
      AND NOT EXISTS (SELECT 1 FROM public.asset_observations h WHERE h.asset_id = a.id AND h.kind = 'holding_claim' AND h.superseded_by IS NULL
                        AND h.extraction_method = 'asset_role_claim_v1' AND h.structured_data->>'claim_state' = 'stated'
                        AND h.structured_data->>'party_user_id' <> p_claimant::text)
    THEN CASE WHEN public.asset_is_legacy_compound(a.attributes) THEN 'sign_tier_legacy_owner_declaration' ELSE 'sign_tier_record_origin_declaration' END END
  FROM public.assets a WHERE a.id = p_asset_id
$$;
REVOKE ALL ON FUNCTION public.asset_holding_policy_interim(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Sign-tier: the signer states one role on one active asset, for themself only. Testimony is recorded without corroboration.
-- Idempotency binds the payload: the same payload as the current version is a no-op; a changed statement or evidence set is a new
-- version superseding the old one; a retry of an older version's payload while a newer one is current is ignored (no old head restored).
CREATE OR REPLACE FUNCTION public.record_asset_role_claim(p_asset_id uuid, p_role text, p_evidence jsonb DEFAULT '[]'::jsonb, p_statement text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid(); a public.assets%ROWTYPE; basis text; acc text; cid uuid; cur record; ikey text; ph text; k text;
  ev jsonb := coalesce(p_evidence, '[]'::jsonb); stmt text := nullif(btrim(coalesce(p_statement, '')), '');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  k := public.asset_role_claim_kind(p_role);
  IF k IS NULL THEN RAISE EXCEPTION 'Role must be documenter, creator, fabricator, holder, performer or rights_holder' USING ERRCODE = '22023'; END IF;
  IF stmt IS NOT NULL AND length(stmt) > 2000 THEN RAISE EXCEPTION 'Statement is at most 2000 characters' USING ERRCODE = '22023'; END IF;
  -- Lock order: the asset row, then the lineage (advisory, in the writer), then claim rows.
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF a.id IS NULL OR a.asset_type NOT IN ('artwork', 'automobilia', 'memorabilia', 'publication')
     OR NOT (a.visibility = 'public' OR a.creator_id = signer OR public.asset_holder_is(a.id, signer) OR a.owner_id = signer) THEN
    RAISE EXCEPTION 'Asset not found' USING ERRCODE = 'P0002';
  END IF;
  IF a.status <> 'active' THEN RAISE EXCEPTION 'Claims attach to an active asset; keep or discard a proposal first' USING ERRCODE = '22023'; END IF;
  IF NOT public.asset_role_claim_evidence_ok(a.id, ev, signer) THEN
    RAISE EXCEPTION 'Evidence must be current observation ids on this asset, not your own claims' USING ERRCODE = '22023';
  END IF;
  ikey := 'claim:' || a.id::text || ':' || p_role || ':' || signer::text;
  ph := public.asset_role_claim_payload_hash(p_role, stmt, ev);
  PERFORM pg_advisory_xact_lock(hashtextextended(ikey, 0));
  SELECT o.id, o.structured_data->>'claim_state' AS state, o.structured_data->>'payload_hash' AS ph INTO cur FROM public.asset_observations o
    WHERE o.asset_id = a.id AND o.kind = k AND o.superseded_by IS NULL AND o.source_identifier = ikey;
  IF cur.id IS NOT NULL AND cur.state = 'stated' AND cur.ph = ph THEN
    RETURN jsonb_build_object('claim_id', cur.id, 'duplicate', true) || jsonb_build_object('status', public.asset_role_claim_status(cur.id));
  END IF;
  IF cur.id IS NOT NULL AND cur.state = 'stated' AND EXISTS (SELECT 1 FROM public.asset_observations o WHERE o.asset_id = a.id AND o.kind = k
       AND o.source_identifier = ikey AND o.superseded_by IS NOT NULL AND o.structured_data->>'payload_hash' = ph) THEN
    RETURN jsonb_build_object('claim_id', cur.id, 'duplicate', true, 'stale_retry', true) || jsonb_build_object('status', public.asset_role_claim_status(cur.id));
  END IF;

  basis := CASE
    WHEN p_role = 'documenter' AND a.creator_id = signer AND jsonb_array_length(ev) > 0 THEN 'own_library_photo_sightings'
    WHEN jsonb_array_length(ev) > 0 THEN 'self_statement_with_evidence' ELSE 'self_statement' END;
  cid := public.asset_role_claim_write(a.id, p_role, signer, 'stated', basis, ev, stmt, signer);
  IF p_role = 'holder' THEN
    acc := (SELECT s.structured_data->>'acceptance_state' FROM public.asset_observations s WHERE s.asset_id = a.id AND s.kind = 'role_claim_acceptance'
              AND s.superseded_by IS NULL AND s.source_identifier = 'acceptance:' || ikey);
    IF acc IS DISTINCT FROM 'accepted' THEN
      basis := public.asset_holding_policy_interim(a.id, signer);
      IF basis IS NOT NULL THEN
        PERFORM public.asset_role_acceptance_write(cid, 'accepted', basis, signer);
        UPDATE public.assets SET attributes = attributes || '{"holding_projection":"role_claims"}'::jsonb WHERE id = a.id AND NOT attributes ? 'holding_projection';
      END IF;
    END IF;
    PERFORM public.asset_holding_reproject(a.id);
  END IF;
  RETURN jsonb_build_object('claim_id', cid, 'kind', k, 'role', p_role, 'duplicate', false) || jsonb_build_object('status', public.asset_role_claim_status(cid));
END $$;
REVOKE ALL ON FUNCTION public.record_asset_role_claim(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_asset_role_claim(uuid, text, jsonb, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.record_asset_role_claim(uuid, text, jsonb, text) IS 'Sign-tier: the signer states one role (documenter, creator, '
  'fabricator, holder, performer, rights_holder) on one active asset for themself, citing current observation ids on that asset. Recorded '
  'as attributed testimony (stated); never promoted to verified. A changed payload is a new version; the same payload is a no-op; an older '
  'payload is ignored. Only holding can be accepted, and only under asset_holding_policy_interim.';

-- Sign-tier: the current qualified holder hands holding to another party's current holding claim. Serialized per asset.
CREATE OR REPLACE FUNCTION public.accept_asset_holding_claim(p_claim_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE signer uuid := auth.uid(); aid uuid; a public.assets%ROWTYPE; c public.asset_observations%ROWTYPE; claimant uuid; mine record; acc uuid;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT o.asset_id INTO aid FROM public.asset_observations o WHERE o.id = p_claim_id;
  IF aid IS NULL THEN RAISE EXCEPTION 'Not an open holding claim' USING ERRCODE = '22023'; END IF;
  -- 1. Lock the asset; every holding writer takes this lock first, so two handovers of one asset run one after the other.
  SELECT * INTO a FROM public.assets WHERE id = aid FOR UPDATE;
  -- 2. Lock and re-read the claim under the asset lock.
  SELECT * INTO c FROM public.asset_observations WHERE id = p_claim_id FOR UPDATE;
  IF c.kind <> 'holding_claim' OR c.extraction_method <> 'asset_role_claim_v1' OR c.superseded_by IS NOT NULL OR c.structured_data->>'claim_state' <> 'stated' THEN
    RAISE EXCEPTION 'Not an open holding claim' USING ERRCODE = '22023';
  END IF;
  claimant := (c.structured_data->>'party_user_id')::uuid;
  -- 3. Revalidate: the signer is the current qualified holder (not merely owner_id), and is not handing to themself.
  IF claimant = signer OR NOT public.asset_holder_is(a.id, signer) THEN
    RAISE EXCEPTION 'Only the current holder hands a work over, and not to themself' USING ERRCODE = '42501';
  END IF;
  IF public.asset_role_claim_status(c.id)->>'qualification' NOT IN ('stated_unverified') THEN
    RAISE EXCEPTION 'That holding claim is not open for acceptance (%)', public.asset_role_claim_status(c.id)->>'qualification' USING ERRCODE = '22023';
  END IF;
  SELECT h.id INTO mine FROM public.asset_observations h WHERE h.asset_id = a.id AND h.kind = 'holding_claim' AND h.superseded_by IS NULL
    AND h.extraction_method = 'asset_role_claim_v1' AND h.structured_data->>'party_user_id' = signer::text FOR UPDATE;
  acc := public.asset_role_acceptance_write(c.id, 'accepted', 'prior_holder_handover', signer);
  IF mine.id IS NOT NULL THEN PERFORM public.asset_role_acceptance_write(mine.id, 'ended', 'handed_over', signer); END IF;
  UPDATE public.assets SET attributes = attributes || '{"holding_projection":"role_claims"}'::jsonb WHERE id = a.id AND NOT attributes ? 'holding_projection';
  PERFORM public.asset_holding_reproject(a.id);
  RETURN jsonb_build_object('claim_id', c.id, 'acceptance_id', acc, 'asset_id', a.id, 'status', public.asset_role_claim_status(c.id),
    'note', nullif(btrim(coalesce(p_note, '')), ''));
END $$;
REVOKE ALL ON FUNCTION public.accept_asset_holding_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_asset_holding_claim(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.accept_asset_holding_claim(uuid, text) IS 'Sign-tier: the current qualified holder accepts another party''s open holding '
  'claim (basis prior_holder_handover). Locks the asset row, then the claim, and revalidates under the lock. The prior holder''s acceptance '
  'ends; their testimony stays. No authorship is touched. TODO(decision): transfer without a cooperating prior holder.';

-- Sign-tier: the party withdraws their own current claim. The testimony stays as history; a withdrawn holding ends its acceptance.
CREATE OR REPLACE FUNCTION public.withdraw_asset_role_claim(p_claim_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE signer uuid := auth.uid(); aid uuid; c public.asset_observations%ROWTYPE; nid uuid; reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT o.asset_id INTO aid FROM public.asset_observations o WHERE o.id = p_claim_id;
  PERFORM 1 FROM public.assets WHERE id = aid FOR UPDATE;
  SELECT * INTO c FROM public.asset_observations WHERE id = p_claim_id FOR UPDATE;
  IF c.id IS NULL OR c.extraction_method <> 'asset_role_claim_v1' OR c.structured_data->>'party_user_id' IS DISTINCT FROM signer::text THEN
    RAISE EXCEPTION 'Only the party withdraws their own claim' USING ERRCODE = '42501';
  END IF;
  IF c.superseded_by IS NOT NULL OR c.structured_data->>'claim_state' = 'withdrawn' THEN RETURN jsonb_build_object('claim_id', c.id, 'duplicate', true); END IF;
  nid := public.asset_role_claim_write(c.asset_id, c.structured_data->>'role', signer, 'withdrawn', 'party_withdrawal', '[]'::jsonb, reason, signer);
  IF c.kind = 'holding_claim' AND EXISTS (SELECT 1 FROM public.asset_observations s WHERE s.asset_id = c.asset_id AND s.kind = 'role_claim_acceptance'
       AND s.superseded_by IS NULL AND s.source_identifier = 'acceptance:' || c.source_identifier AND s.structured_data->>'acceptance_state' = 'accepted') THEN
    PERFORM public.asset_role_acceptance_write(nid, 'ended', 'party_withdrawal', signer);
  END IF;
  PERFORM public.asset_holding_reproject(c.asset_id);
  RETURN jsonb_build_object('claim_id', nid, 'claim_state', 'withdrawn', 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.withdraw_asset_role_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_asset_role_claim(uuid, text) TO authenticated, service_role;

-- declare_held_asset: same signature. The signer declares a work they hold, in their own words: a holder_declaration, a stated
-- holding claim citing it, and its acceptance (interim policy basis sign_tier_holder_declaration: the declaration created the row,
-- so nobody else can be displaced). No creation claim: whether they made it is a separate statement.
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
  -- creator_id = the signer as record origin (their declaration created the row). owner_id is projected from the accepted claim below.
  INSERT INTO public.assets (asset_type, title, description, creator_id, owner_id, status, visibility, attributes)
  VALUES (p_asset_type, title, notes, signer, NULL, 'active', vis,
    jsonb_build_object('identity_key', ikey, 'identity_basis', 'holder_declaration', 'source', 'owner-input', 'declared', declared,
      'declared_at', signed, 'declared_by_user_id', signer, 'holding_projection', 'role_claims'))
  ON CONFLICT ((attributes->>'identity_key')) WHERE attributes ? 'identity_key' DO NOTHING
  RETURNING id INTO aid;
  IF aid IS NULL THEN
    SELECT a.id INTO aid FROM public.assets a WHERE a.attributes->>'identity_key' = ikey;
    RETURN jsonb_build_object('asset_id', aid, 'duplicate', true, 'visibility', (SELECT a.visibility FROM public.assets a WHERE a.id = aid));
  END IF;
  PERFORM 1 FROM public.assets WHERE id = aid FOR UPDATE;
  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence,
    source_identifier, extraction_method)
  VALUES (aid, owner_source, 'holder_declaration', signed,
    format('The holder declared a %s: "%s"%s.', p_asset_type, title, CASE WHEN yr IS NULL THEN '' ELSE ' (' || yr || ')' END),
    jsonb_build_object('signer_user_id', signer, 'asset_type', p_asset_type, 'title', title, 'declared', declared, 'visibility', vis, 'version', 2),
    md5(ikey || '|declaration|' || signed::text), 0.95, ikey, 'holder_declaration_sign_v2')
  RETURNING id INTO decl_id;
  hid := public.asset_role_claim_write(aid, 'holder', signer, 'stated', 'self_statement_with_evidence', jsonb_build_array(decl_id::text), NULL, signer);
  PERFORM public.asset_role_acceptance_write(hid, 'accepted', 'sign_tier_holder_declaration', signer);
  PERFORM public.asset_holding_reproject(aid);
  RETURN jsonb_build_object('asset_id', aid, 'duplicate', false, 'visibility', vis, 'holding_claim_id', hid, 'authorship', 'not_claimed');
END $$;
COMMENT ON FUNCTION public.declare_held_asset(text, text, text, text, text, text, text, text) IS 'Sign-tier: the signed-in holder declares a work '
  'in their own words. One assets row (creator_id = the signer as record origin, private by default), one holder_declaration, one stated '
  'holding claim citing it and its interim acceptance (owner_id is projected from it). No creation claim: authorship is a separate '
  'record_asset_role_claim. The same declaration twice returns the same row. No price, no value.';

-- confirm_held_asset: same signature. The person whose photos proposed a work keeps it as documentation, in their own words:
-- one documentation_record citing the current photo_sighting rows. No role claim, no holder, no maker. owner_id is not set.
CREATE OR REPLACE FUNCTION public.confirm_held_asset(p_asset_id uuid, p_title text, p_medium text DEFAULT NULL, p_year text DEFAULT NULL,
  p_dimensions text DEFAULT NULL, p_edition text DEFAULT NULL, p_notes text DEFAULT NULL, p_visibility text DEFAULT 'private')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid(); signed timestamptz := now(); owner_source uuid; a public.assets%ROWTYPE; declared jsonb; ev jsonb; did uuid;
  vtitle text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  medium text := nullif(btrim(coalesce(p_medium, '')), ''); yr text := nullif(btrim(coalesce(p_year, '')), '');
  dims text := nullif(btrim(coalesce(p_dimensions, '')), ''); edition text := nullif(btrim(coalesce(p_edition, '')), '');
  notes text := nullif(btrim(coalesce(p_notes, '')), ''); vis text := coalesce(nullif(btrim(p_visibility), ''), 'private');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  -- creator_id gates this as record origin: only the person whose photos proposed the work may keep it.
  IF a.id IS NULL OR a.creator_id IS DISTINCT FROM signer OR a.attributes->>'identity_basis' <> 'photo_proposal' THEN
    RAISE EXCEPTION 'Only the person whose photos proposed a work confirms it' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'active' THEN
    SELECT o.id INTO did FROM public.asset_observations o WHERE o.asset_id = a.id AND o.kind = 'documentation_record' AND o.superseded_by IS NULL
      AND o.structured_data->>'recorded_by_user_id' = signer::text ORDER BY o.created_at DESC LIMIT 1;
    RETURN jsonb_build_object('asset_id', a.id, 'duplicate', true, 'visibility', a.visibility, 'documentation_record_id', did);
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
  SELECT coalesce(jsonb_agg(o.id::text ORDER BY o.observed_at), '[]'::jsonb) INTO ev FROM public.asset_observations o
    WHERE o.asset_id = a.id AND o.kind = 'photo_sighting' AND o.superseded_by IS NULL;
  UPDATE public.assets SET title = vtitle, description = notes, status = 'active', visibility = vis, updated_at = signed,
    attributes = attributes || jsonb_build_object('declared', declared, 'declared_at', signed, 'declared_by_user_id', signer, 'confirmed_from', 'photo_proposal',
      'confirmed_as', 'documentation', 'holding_projection', 'role_claims')
  WHERE id = a.id;
  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence, source_identifier, extraction_method)
  VALUES (a.id, owner_source, 'documentation_record', signed, format('Kept as documentation: "%s".', vtitle),
    jsonb_build_object('recorded_by_user_id', signer, 'record_state', 'kept', 'basis', 'own_library_photo_sightings', 'evidence', ev,
      'title', vtitle, 'declared', declared, 'visibility', vis, 'version', 1),
    md5(a.attributes->>'identity_key' || '|documentation|' || signed::text), 0.5, a.attributes->>'identity_key', 'documentation_record_sign_v1')
  RETURNING id INTO did;
  RETURN jsonb_build_object('asset_id', a.id, 'duplicate', false, 'visibility', vis, 'documentation_record_id', did,
    'holding', 'not_claimed', 'authorship', 'not_claimed');
END $$;
COMMENT ON FUNCTION public.confirm_held_asset(uuid, text, text, text, text, text, text, text) IS 'Sign-tier: the person whose photos proposed a work '
  'keeps it as documentation, in their own words: one documentation_record citing the current photo_sighting rows. No role claim: holding, '
  'authorship and photographer identity are not implied (each is a separate record_asset_role_claim). owner_id is not set. Twice is a no-op.';

-- dismiss_held_asset: same signature. Discards a pending proposal that is not a work worth keeping. Leaves no current claim.
CREATE OR REPLACE FUNCTION public.dismiss_held_asset(p_asset_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE signer uuid := auth.uid(); signed timestamptz := now(); owner_source uuid; a public.assets%ROWTYPE; reason text := nullif(btrim(coalesce(p_reason, '')), ''); c record; n_withdrawn integer := 0;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF a.id IS NULL OR a.creator_id IS DISTINCT FROM signer OR a.attributes->>'identity_basis' <> 'photo_proposal' THEN
    RAISE EXCEPTION 'Only the person whose photos proposed a work dismisses it' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'archived' THEN RETURN jsonb_build_object('asset_id', a.id, 'duplicate', true); END IF;
  IF a.status <> 'pending' THEN RAISE EXCEPTION 'A kept record is not discarded here; withdraw its claims instead' USING ERRCODE = '22023'; END IF;
  IF reason IS NOT NULL AND length(reason) > 400 THEN RAISE EXCEPTION 'Reason is at most 400 characters' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.asset_observations o WHERE o.asset_id = a.id AND o.superseded_by IS NULL
               AND o.kind IN ('documentation_claim', 'creation_claim', 'holding_claim', 'performance_claim', 'rights_claim')
               AND coalesce(o.structured_data->>'claim_state', 'stated') <> 'withdrawn'
               AND o.structured_data->>'party_user_id' IS DISTINCT FROM signer::text) THEN
    RAISE EXCEPTION 'Another party has a current claim on this asset; it is not dismissed here' USING ERRCODE = '22023';
  END IF;
  FOR c IN SELECT o.id FROM public.asset_observations o WHERE o.asset_id = a.id AND o.superseded_by IS NULL
             AND o.extraction_method = 'asset_role_claim_v1' AND o.structured_data->>'party_user_id' = signer::text
             AND o.structured_data->>'claim_state' <> 'withdrawn' LOOP
    PERFORM public.withdraw_asset_role_claim(c.id, coalesce(reason, 'proposal dismissed'));
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

-- held_assets_read: every active record the signed-in person holds, created, or stated a role on, each with its standing:
--   assets      held: asset_holder_is (a current accepted holding claim with current evidence; owner_id only on non-role-managed,
--               non-legacy assets)
--   documented  kept as documentation from their own photos and not held. No role claim is needed to stay listed.
--   recorded    everything else that is theirs to see: legacy compound records (holding and authorship unresolved), works they stated a
--               role on, works whose record they originated. Each carries reasons, so nothing silently drops out of the list.
--   proposed    their pending photo proposals (record-origin access).
CREATE OR REPLACE FUNCTION public.held_assets_read(p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  lim AS (SELECT greatest(1, least(coalesce(p_limit, 200), 1000)) AS n),
  mine_claims AS (
    SELECT o.asset_id, o.id, o.structured_data->>'role' AS role FROM public.asset_observations o, me
    WHERE me.uid IS NOT NULL AND o.superseded_by IS NULL AND o.extraction_method = 'asset_role_claim_v1'
      AND o.structured_data->>'party_user_id' = me.uid::text AND o.structured_data->>'claim_state' = 'stated'),
  base AS (
    SELECT a.*, public.asset_holder_is(a.id, me.uid) AS held, public.asset_is_legacy_compound(a.attributes) AS legacy
    FROM public.assets a, me
    WHERE me.uid IS NOT NULL AND a.status = 'active' AND a.asset_type IN ('artwork', 'automobilia', 'memorabilia', 'publication')
      AND (a.creator_id = me.uid OR a.owner_id = me.uid OR a.id IN (SELECT asset_id FROM mine_claims)
           OR EXISTS (SELECT 1 FROM public.asset_observations h WHERE h.asset_id = a.id AND h.kind = 'holding_claim' AND h.superseded_by IS NULL
                        AND h.structured_data->>'party_user_id' = me.uid::text))),
  classed AS (
    SELECT b.*, CASE WHEN b.held THEN 'held'
                     WHEN NOT b.legacy AND b.attributes->>'identity_basis' = 'photo_proposal' AND b.creator_id = (SELECT uid FROM me) THEN 'documented'
                     ELSE 'recorded' END AS standing
    FROM base b),
  shape AS (
    SELECT c.id, c.created_at, c.standing, jsonb_strip_nulls(jsonb_build_object(
      'id', c.id, 'asset_type', c.asset_type, 'title', c.title, 'visibility', c.visibility, 'created_at', c.created_at,
      'declared', c.attributes->'declared', 'identity_basis', c.attributes->>'identity_basis', 'standing', c.standing,
      'legacy_compound', CASE WHEN c.legacy THEN true END,
      'reasons', (SELECT jsonb_agg(DISTINCT r) FROM (
          SELECT 'legacy_compound' AS r WHERE c.legacy
          UNION ALL SELECT 'record_origin' WHERE c.creator_id = (SELECT uid FROM me) AND c.standing = 'recorded'
          UNION ALL SELECT mc.role || ':' || (public.asset_role_claim_status(mc.id)->>'qualification') FROM mine_claims mc WHERE mc.asset_id = c.id
        ) rr),
      'my_roles', (SELECT jsonb_agg(jsonb_build_object('role', mc.role, 'claim_id', mc.id, 'qualification', public.asset_role_claim_status(mc.id)->>'qualification') ORDER BY mc.role)
                   FROM mine_claims mc WHERE mc.asset_id = c.id),
      'documentation_records', (SELECT count(*) FROM public.asset_observations o WHERE o.asset_id = c.id AND o.kind = 'documentation_record' AND o.superseded_by IS NULL),
      'presentations', (SELECT count(*) FROM public.asset_observations o WHERE o.asset_id = c.id AND o.kind = 'auction_lot' AND o.superseded_by IS NULL),
      'photos', (SELECT count(*) FROM public.asset_observations o WHERE o.asset_id = c.id AND o.kind = 'photo_sighting' AND o.superseded_by IS NULL),
      'public_sale_recorded', EXISTS (SELECT 1 FROM public.asset_observations o WHERE o.asset_id = c.id AND o.kind = 'auction_lot' AND o.superseded_by IS NULL
                                        AND (o.structured_data->>'hammer_price')::numeric > 0))) AS j
    FROM classed c),
  proposed AS (
    SELECT a.* FROM public.assets a, me WHERE me.uid IS NOT NULL AND a.creator_id = me.uid AND a.status = 'pending' AND a.attributes->>'identity_basis' = 'photo_proposal'),
  prow AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', p.id, 'title', p.title, 'kind', p.attributes->'proposal'->>'kind', 'labels', p.attributes->'proposal'->'labels',
      'photos', (p.attributes->'proposal'->>'photos')::int, 'span_from', p.attributes->'proposal'->>'span_from', 'span_to', p.attributes->'proposal'->>'span_to',
      'filenames', p.attributes->'proposal'->'filenames', 'labeller', p.attributes->'proposal'->>'labeller', 'proposed_at', p.attributes->>'proposed_at'))
      ORDER BY (p.attributes->'proposal'->>'span_to')::timestamptz DESC NULLS LAST) AS v
    FROM (SELECT * FROM proposed ORDER BY (attributes->'proposal'->>'span_to')::timestamptz DESC NULLS LAST LIMIT (SELECT n FROM lim)) p)
  SELECT CASE WHEN (SELECT uid FROM me) IS NULL THEN NULL ELSE jsonb_build_object(
    'assets', coalesce((SELECT jsonb_agg(s.j ORDER BY s.created_at DESC) FROM (SELECT * FROM shape WHERE standing = 'held' ORDER BY created_at DESC LIMIT (SELECT n FROM lim)) s), '[]'::jsonb),
    'total', (SELECT count(*) FROM classed WHERE standing = 'held'),
    'by_type', coalesce((SELECT jsonb_object_agg(asset_type, n) FROM (SELECT asset_type, count(*) n FROM classed WHERE standing = 'held' GROUP BY 1) t), '{}'::jsonb),
    'documented', coalesce((SELECT jsonb_agg(s.j ORDER BY s.created_at DESC) FROM (SELECT * FROM shape WHERE standing = 'documented' ORDER BY created_at DESC LIMIT (SELECT n FROM lim)) s), '[]'::jsonb),
    'documented_total', (SELECT count(*) FROM classed WHERE standing = 'documented'),
    'recorded', coalesce((SELECT jsonb_agg(s.j ORDER BY s.created_at DESC) FROM (SELECT * FROM shape WHERE standing = 'recorded' ORDER BY created_at DESC LIMIT (SELECT n FROM lim)) s), '[]'::jsonb),
    'recorded_total', (SELECT count(*) FROM classed WHERE standing = 'recorded'),
    'proposed', coalesce((SELECT v FROM prow), '[]'::jsonb),
    'proposed_total', (SELECT count(*) FROM proposed),
    'as_of', now()) END
$$;
COMMENT ON FUNCTION public.held_assets_read(integer) IS 'The signed-in person''s records with their standing: assets = held (asset_holder_is), '
  'documented = kept as documentation from their own photos (no role claim needed), recorded = legacy compound, stated roles or record origin, '
  'with reasons; proposed = pending photo proposals. creator_id is never read as holding. Null for anon.';

-- asset_profile_read: holder from asset_holder_is; record origin and legacy compound reported; claims with qualification.
CREATE OR REPLACE FUNCTION public.asset_profile_read(p_asset_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH viewer AS (SELECT auth.uid() AS uid),
  a AS (
    SELECT a.* FROM public.assets a, viewer v WHERE a.id = p_asset_id AND a.asset_type IN ('artwork', 'automobilia', 'memorabilia', 'publication')
      AND a.status <> 'archived'
      -- Read access: public; the record origin reading their own record back (creator_id: access only, never maker or holder); the
      -- qualified holder; a legacy compound owner (their record stays readable while holding is unresolved).
      AND (a.visibility = 'public' OR (v.uid IS NOT NULL AND (a.creator_id = v.uid OR public.asset_holder_is(a.id, v.uid)
           OR (public.asset_is_legacy_compound(a.attributes) AND a.owner_id = v.uid))))),
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
      'role', coalesce(c.structured_data->>'role', 'creator'), 'claim_state', public.asset_role_claim_status(c.id)->>'claim_state',
      'qualification', public.asset_role_claim_status(c.id)->>'qualification', 'basis', public.asset_role_claim_status(c.id)->>'basis',
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
    WHERE c.kind = 'creation_claim' AND c.superseded_by IS NULL AND coalesce(c.structured_data->>'claim_state', 'stated') <> 'withdrawn'),
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
      'legacy_compound', public.asset_is_legacy_compound(a.attributes),
      'claims', coalesce((SELECT jsonb_agg(public.asset_role_claim_status(rc.id) ORDER BY rc.observed_at) FROM public.asset_observations rc
        WHERE rc.asset_id = a.id AND rc.superseded_by IS NULL AND rc.extraction_method = 'asset_role_claim_v1'
          AND v.uid IS NOT NULL AND rc.structured_data->>'party_user_id' = v.uid::text), '[]'::jsonb)),
    'declared', a.attributes->'declared',
    'proposal', CASE WHEN a.attributes ? 'proposal' THEN a.attributes->'proposal' || jsonb_build_object('status', a.status, 'photo_sightings', coalesce((SELECT ph.v FROM photos ph), '[]'::jsonb)) END,
    'market', CASE WHEN EXISTS (SELECT 1 FROM lots) THEN 'recorded' ELSE 'none_public' END,
    'image_url', (SELECT l.structured_data->>'image_url' FROM lots l WHERE l.superseded_by IS NULL AND l.structured_data ? 'image_url' ORDER BY l.observed_at DESC LIMIT 1),
    'lots', coalesce((SELECT cl.v FROM current_lots cl), '[]'::jsonb),
    'history', coalesce((SELECT h.v FROM history h), '[]'::jsonb),
    'creation', coalesce((SELECT cr.v FROM creation cr), '[]'::jsonb),
    -- Documentation kept from photographs: counts and clocks only, no party named.
    'documentation', (SELECT jsonb_strip_nulls(jsonb_build_object('records', count(*), 'kept_at', max(d.observed_at),
        'basis', min(d.structured_data->>'basis'))) FROM public.asset_observations d WHERE d.asset_id = a.id AND d.kind = 'documentation_record' AND d.superseded_by IS NULL),
    -- Role claims other than creation, without naming the party: role, testimony state, qualification, clock.
    'role_claims', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', rc.kind, 'role', rc.structured_data->>'role',
      'claim_state', rc.structured_data->>'claim_state', 'qualification', public.asset_role_claim_status(rc.id)->>'qualification',
      'basis', rc.structured_data->>'basis', 'observed_at', rc.observed_at, 'version', (rc.structured_data->>'version')::int) ORDER BY rc.observed_at)
      FROM public.asset_observations rc WHERE rc.asset_id = a.id AND rc.superseded_by IS NULL AND rc.extraction_method = 'asset_role_claim_v1'
        AND rc.kind IN ('documentation_claim', 'holding_claim', 'performance_claim', 'rights_claim')
        AND rc.structured_data->>'claim_state' = 'stated'), '[]'::jsonb),
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
  'unlisted asset for its record origin (creator_id: their own record), its qualified holder, or a legacy compound owner. viewer.is_holder '
  'never reads creator_id; viewer.is_record_origin and viewer.legacy_compound say what the reader''s access rests on; viewer.claims is the '
  'reader''s own claims with qualification. creation carries role, claim_state and qualification (house rows source_statement, old compound '
  'rows legacy_compound_unverified). documentation and role_claims name no party.';

-- Acceptance path (b): identity resolution of each current claim's party to work actors. A user party resolves only through
-- viewer_identity_bridge (approved account_link_claims nuke_actor rungs). A catalogue party resolves to none. This is identity only:
-- it is not skill evidence (demonstrated activity plus participant identity stays with capability_fold_basis, not fed here).
CREATE OR REPLACE FUNCTION public.asset_claim_actors(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE out_ jsonb := '[]'::jsonb; c record; bridge jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'asset_claim_actors is service-only' USING ERRCODE = '42501'; END IF;
  FOR c IN SELECT o.id, o.kind, coalesce(o.structured_data->>'role', 'creator') AS role, public.asset_role_claim_status(o.id)->>'qualification' AS q,
                  (o.structured_data->>'party_user_id')::uuid AS party_user, (o.structured_data->>'party_identity_id')::uuid AS party_identity
           FROM public.asset_observations o WHERE o.asset_id = p_asset_id AND o.superseded_by IS NULL
             AND o.kind IN ('documentation_claim', 'creation_claim', 'holding_claim', 'performance_claim', 'rights_claim')
             AND coalesce(o.structured_data->>'claim_state', 'stated') <> 'withdrawn'
           ORDER BY o.observed_at LOOP
    IF c.party_user IS NOT NULL THEN
      bridge := public.viewer_identity_bridge(c.party_user);
      out_ := out_ || jsonb_build_array(jsonb_build_object('claim_id', c.id, 'kind', c.kind, 'role', c.role, 'qualification', c.q,
        'party_kind', 'user', 'bridge_state', bridge->>'state', 'actor_ids', coalesce(bridge->'evidenced_actor_ids', '[]'::jsonb),
        'actor_basis', 'account_link_claims_approved_actor_rung', 'skill_evidence', 'none_identity_only'));
    ELSIF c.party_identity IS NOT NULL THEN
      out_ := out_ || jsonb_build_array(jsonb_build_object('claim_id', c.id, 'kind', c.kind, 'role', c.role, 'qualification', c.q,
        'party_kind', 'catalogue', 'party_identity_id', c.party_identity, 'actor_ids', '[]'::jsonb,
        'actor_basis', 'catalogue_identity_not_actor', 'skill_evidence', 'none_identity_only'));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('asset_id', p_asset_id, 'claims', out_, 'as_of', now());
END $$;
REVOKE ALL ON FUNCTION public.asset_claim_actors(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_claim_actors(uuid) TO service_role;
COMMENT ON FUNCTION public.asset_claim_actors(uuid) IS 'Service-only: each current claim on an asset with the work actors its party resolves to, '
  'by identity only. User parties resolve only through viewer_identity_bridge; catalogue parties resolve to none. Not skill evidence; '
  'writes nothing; actor_capability_basis is not fed (capability_fold_basis has no asset branch).';
COMMIT;
