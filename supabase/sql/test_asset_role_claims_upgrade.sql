-- Disposable PG17 only. Synthetic fixtures. Upgrade contract: rows written by the OLD compound declare/confirm flow exist first,
-- then 20261113200000_asset_role_claims_split.sql is applied. Proves the migration rewrites no row, reads old compound claims as
-- legacy_compound_unverified (never a house attribution, never promoted), stops reading legacy owner_id as holding, keeps the
-- record readable and listed, and lets the person resolve holding only by an explicit claim.
\ir asset_role_claims_fixture.sql

-- 1. The old flow, before the migration: a compound declaration, a compound photo confirmation, and a still-pending proposal.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.propose_held_assets('0b9f107a-0000-4000-8000-000000000001', $j$[
  {"proposal_key":"old:proposal:0001","kind":"painting","labeller":"apple_photos_on_device_v1","photos":[{"uuid":"OLD-1","taken_at":"2025-01-01T10:00:00Z"}]},
  {"proposal_key":"old:proposal:0002","kind":"painting","labeller":"apple_photos_on_device_v1","photos":[{"uuid":"OLD-2","taken_at":"2025-02-01T10:00:00Z"}]}]$j$::jsonb);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000001"}', false);
SELECT public.declare_held_asset('artwork', 'Old declared work', 'oil', '2020', NULL, NULL, NULL, 'private');
SELECT public.confirm_held_asset((SELECT id FROM public.assets WHERE attributes->>'identity_key' = 'proposal:0b9f107a-0000-4000-8000-000000000001:old:proposal:0001'),
  'Old confirmed work', NULL, NULL, NULL, NULL, NULL, 'private');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.asset_observations WHERE kind = 'creation_claim' AND extraction_method = 'holder_declaration_sign_v1') <> 2
     OR (SELECT count(*) FROM public.assets WHERE owner_id = '0b9f107a-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'fixture: the old flow wrote two compound records'; END IF;
END $$;
CREATE TABLE public._snap_obs AS SELECT id, asset_id, kind, structured_data, superseded_by, extraction_method FROM public.asset_observations;
CREATE TABLE public._snap_assets AS SELECT id, owner_id, creator_id, status, visibility, attributes FROM public.assets;
RESET request.jwt.claims;

-- 2. The migration.
\ir ../migrations/20261113200000_asset_role_claims_split.sql

-- 3. Nothing was rewritten.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public._snap_obs s FULL JOIN public.asset_observations o USING (id)
             WHERE o.id IS NULL OR s.id IS NULL OR o.structured_data IS DISTINCT FROM s.structured_data OR o.superseded_by IS DISTINCT FROM s.superseded_by
               OR o.kind IS DISTINCT FROM s.kind) THEN RAISE EXCEPTION 'upgrade: observations rewritten'; END IF;
  IF EXISTS (SELECT 1 FROM public._snap_assets s FULL JOIN public.assets a USING (id)
             WHERE a.id IS NULL OR s.id IS NULL OR a.owner_id IS DISTINCT FROM s.owner_id OR a.creator_id IS DISTINCT FROM s.creator_id
               OR a.attributes IS DISTINCT FROM s.attributes OR a.status IS DISTINCT FROM s.status) THEN RAISE EXCEPTION 'upgrade: assets rewritten'; END IF;
END $$;

-- 4. Read-time qualification of the old rows.
DO $$ DECLARE decl uuid; conf uuid; pend uuid; mine jsonb; p jsonb; hc jsonb; r jsonb; BEGIN
  SELECT id INTO decl FROM public.assets WHERE title = 'Old declared work';
  SELECT id INTO conf FROM public.assets WHERE title = 'Old confirmed work';
  SELECT id INTO pend FROM public.assets WHERE attributes->>'identity_key' = 'proposal:0b9f107a-0000-4000-8000-000000000001:old:proposal:0002';
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000001"}', true);
  IF public.asset_holder_is(decl, '0b9f107a-0000-4000-8000-000000000001') OR public.asset_holder_is(conf, '0b9f107a-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'upgrade: a legacy compound owner_id is not read as holding'; END IF;
  mine := public.held_assets_read(50);
  IF (mine->>'total')::int <> 0 OR (mine->>'recorded_total')::int <> 2 OR (mine->>'proposed_total')::int <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(mine->'recorded') x WHERE (x->>'legacy_compound')::boolean AND (x->'reasons') ? 'legacy_compound') <> 2 THEN
    RAISE EXCEPTION 'upgrade: both legacy records stay listed as unresolved: %', mine; END IF;
  p := public.asset_profile_read(decl);
  IF p IS NULL OR NOT (p->'viewer'->>'legacy_compound')::boolean OR (p->'viewer'->>'is_holder')::boolean
     OR p->'creation'->0->>'qualification' <> 'legacy_compound_unverified' OR p->'creation'->0->>'basis' <> 'legacy_compound_sign' THEN
    RAISE EXCEPTION 'upgrade: the old creation claim reads legacy_compound_unverified: %', p; END IF;
  IF public.asset_profile_read(conf)->'creation'->0->>'qualification' <> 'legacy_compound_unverified' THEN RAISE EXCEPTION 'upgrade: old confirm creation legacy'; END IF;
  -- Resolving holding is an explicit act; the legacy authorship claim is not promoted by it.
  hc := public.record_asset_role_claim(decl, 'holder', '[]'::jsonb, 'I still hold it.');
  IF hc->'status'->>'qualification' <> 'accepted_interim' OR hc->'status'->'acceptance'->>'basis' <> 'sign_tier_legacy_owner_declaration'
     OR NOT public.asset_holder_is(decl, '0b9f107a-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'upgrade: explicit holding resolves: %', hc; END IF;
  IF public.asset_profile_read(decl)->'creation'->0->>'qualification' <> 'legacy_compound_unverified' THEN RAISE EXCEPTION 'upgrade: legacy authorship not promoted'; END IF;
  -- The old pending proposal now confirms under the new flow: documentation only.
  r := public.confirm_held_asset(pend, 'Kept after the upgrade', NULL, NULL, NULL, NULL, NULL, 'private');
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = pend AND kind IN ('creation_claim', 'holding_claim', 'holder_declaration')) <> 0 THEN
    RAISE EXCEPTION 'upgrade: a pending proposal confirms as documentation only'; END IF;
  mine := public.held_assets_read(50);
  IF (mine->>'total')::int <> 1 OR (mine->>'documented_total')::int <> 1 OR (mine->>'recorded_total')::int <> 1 THEN RAISE EXCEPTION 'upgrade: lists after resolution: %', mine; END IF;
END $$;
DROP TABLE public._snap_obs; DROP TABLE public._snap_assets;
SELECT 'test_asset_role_claims_upgrade: old compound rows qualified, nothing rewritten' AS result;
