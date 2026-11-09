-- Disposable PG17 only. Synthetic fixtures. Fresh-database contract for 20261113200000_asset_role_claims_split.sql: acceptance paths
-- (a) museum visitor, (b) same person doing vehicle and art work, (c) artist / fabricator / later holder, plus cited-evidence
-- currentness (supersede, withdraw) and claim revision history. Old-flow upgrade: test_asset_role_claims_upgrade.sql. Two-session
-- handover race: test_asset_role_claims_concurrency.mjs.
\ir asset_role_claims_fixture.sql
\ir ../migrations/20261113200000_asset_role_claims_split.sql
INSERT INTO public.profiles (id, username, full_name) VALUES ('0b9f107a-0000-4000-8000-000000000007', 'archive', 'An Own Archive');

-- (a) A museum visitor photographs someone else's work. Keeping it writes one documentation_record and no role claim at all:
--     creator_id stays the visitor as record origin; no maker, holder, photographer or holder declaration. It stays listed and
--     readable. A documenter statement is optional, recorded as testimony, and never promoted.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ DECLARE r jsonb; c jsonb; p jsonb; mine jsonb; aid uuid; bid uuid; dc jsonb; BEGIN
  r := public.propose_held_assets('0b9f107a-0000-4000-8000-000000000001', $j$[
    {"proposal_key":"museum:visit:0001","kind":"painting","labels":["Painting"],"labeller":"apple_photos_on_device_v1",
     "photos":[{"uuid":"MUSE-1","taken_at":"2026-10-01T15:00:00Z","filename":"IMG_10.HEIC","place":"A museum"},
               {"uuid":"MUSE-2","taken_at":"2026-10-01T15:01:00Z","filename":"IMG_11.HEIC","place":"A museum"}]},
    {"proposal_key":"museum:visit:0002","kind":"sculpture","labels":["Sculpture"],"labeller":"apple_photos_on_device_v1",
     "photos":[{"uuid":"MUSE-3","taken_at":"2026-10-01T15:05:00Z","filename":"IMG_12.HEIC"}]}]$j$::jsonb);
  IF (r->>'proposals_new')::int <> 2 THEN RAISE EXCEPTION 'a: proposals not written: %', r; END IF;
  SELECT id INTO aid FROM public.assets WHERE attributes->>'identity_key' = 'proposal:0b9f107a-0000-4000-8000-000000000001:museum:visit:0001';
  SELECT id INTO bid FROM public.assets WHERE attributes->>'identity_key' = 'proposal:0b9f107a-0000-4000-8000-000000000001:museum:visit:0002';

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000001"}', true);
  BEGIN
    PERFORM public.record_asset_role_claim(aid, 'creator');
    RAISE EXCEPTION 'a: a pending proposal must refuse claims';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  c := public.confirm_held_asset(aid, 'A painting seen at a museum', NULL, NULL, NULL, NULL, 'Photographed on a visit.', 'private');
  IF (c->>'duplicate')::boolean OR c->>'holding' <> 'not_claimed' OR c->>'authorship' <> 'not_claimed' OR c->>'documentation_record_id' IS NULL THEN RAISE EXCEPTION 'a: keep receipt wrong: %', c; END IF;
  IF (SELECT creator_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'a: creator_id must stay record origin'; END IF;
  IF (SELECT owner_id FROM public.assets WHERE id = aid) IS NOT NULL THEN RAISE EXCEPTION 'a: documenting must not set a holder'; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind IN ('documentation_claim', 'creation_claim', 'holding_claim',
        'performance_claim', 'rights_claim', 'role_claim_acceptance', 'holder_declaration')) <> 0 THEN RAISE EXCEPTION 'a: keeping documentation writes no role claim'; END IF;
  IF (SELECT jsonb_array_length(structured_data->'evidence') FROM public.asset_observations WHERE id = (c->>'documentation_record_id')::uuid) <> 2 THEN
    RAISE EXCEPTION 'a: the documentation record cites both current photos'; END IF;
  c := public.confirm_held_asset(aid, 'A painting seen at a museum', NULL, NULL, NULL, NULL, NULL, 'private');
  IF NOT (c->>'duplicate')::boolean OR (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'documentation_record') <> 1 THEN
    RAISE EXCEPTION 'a: keeping twice is a no-op'; END IF;
  mine := public.held_assets_read(50);
  IF (mine->>'total')::int <> 0 OR (mine->>'documented_total')::int <> 1 OR mine->'documented'->0->>'id' <> aid::text
     OR mine->'documented'->0 ? 'my_roles' OR (mine->'documented'->0->>'documentation_records')::int <> 1 THEN
    RAISE EXCEPTION 'a: the visitor''s documentation stays listed with no role claim: %', mine; END IF;
  p := public.asset_profile_read(aid);
  IF p IS NULL OR (p->'viewer'->>'is_holder')::boolean OR NOT (p->'viewer'->>'is_record_origin')::boolean OR jsonb_array_length(p->'creation') <> 0
     OR jsonb_array_length(p->'role_claims') <> 0 OR (p->'documentation'->>'records')::int <> 1 THEN RAISE EXCEPTION 'a: profile wrong: %', p; END IF;
  -- Optional documenter statement: stated, basis own library, unverified; the record stays documented either way.
  dc := public.record_asset_role_claim(aid, 'documenter', (SELECT jsonb_agg(id::text) FROM public.asset_observations WHERE asset_id = aid AND kind = 'photo_sighting'), 'I took these.');
  IF dc->'status'->>'qualification' <> 'stated_unverified' OR dc->'status'->>'basis' <> 'own_library_photo_sightings' THEN RAISE EXCEPTION 'a: documenter is testimony only: %', dc; END IF;
  IF ((public.held_assets_read(50))->>'documented_total')::int <> 1 THEN RAISE EXCEPTION 'a: still documented'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000005"}', true);
  IF public.asset_profile_read(aid) IS NOT NULL THEN RAISE EXCEPTION 'a: a private record is not readable by another user'; END IF;
  -- Discard the second proposal: archived, no current claim, testimony kept.
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000001"}', true);
  c := public.dismiss_held_asset(bid, 'not a work, a plinth');
  IF (SELECT status FROM public.assets WHERE id = bid) <> 'archived' THEN RAISE EXCEPTION 'a: dismiss archives'; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = bid AND superseded_by IS NULL
        AND kind IN ('documentation_claim', 'creation_claim', 'holding_claim', 'performance_claim', 'rights_claim')
        AND coalesce(structured_data->>'claim_state', 'stated') <> 'withdrawn') <> 0 THEN RAISE EXCEPTION 'a: dismiss leaves no current claim'; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = bid AND kind = 'photo_sighting') <> 1 THEN RAISE EXCEPTION 'a: dismiss keeps testimony'; END IF;
  BEGIN
    PERFORM public.record_asset_role_claim(bid, 'holder');
    RAISE EXCEPTION 'a: an archived proposal must refuse claims';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- (b) One person does vehicle work and art work. Art claims resolve to work actors only through an approved account_link_claims
--     actor link (viewer_identity_bridge). A catalogue identity is not a technician actor, even when claimed by that person. A
--     same-name user resolves to nothing. Resolution is identity only, never skill evidence.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
INSERT INTO public.actors (id, display_name) VALUES ('ac700000-0000-4000-8000-000000000001', 'Two Trades shop actor'),
  ('ac700000-0000-4000-8000-000000000002', 'Unproven actor');
INSERT INTO public.account_link_claims (user_id, platform, handle, actor_id, status, verification_method, reviewed_by_user_id, reviewed_at)
VALUES ('0b9f107a-0000-4000-8000-000000000002', 'nuke_actor', 'ac700000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
        'approved', 'work_evidence', '0b9f107a-0000-4000-8000-000000000003', now()),
       ('0b9f107a-0000-4000-8000-000000000006', 'nuke_actor', 'ac700000-0000-4000-8000-000000000002', 'ac700000-0000-4000-8000-000000000002',
        'pending', 'self_claim', NULL, NULL);
INSERT INTO public.external_identities (id, platform, handle, display_name, claimed_by_user_id, claimed_at)
VALUES ('e7000000-0000-4000-8000-000000000001', 'art_catalogue', 'jane doe|1970', 'Jane Doe', '0b9f107a-0000-4000-8000-000000000002', now());
INSERT INTO public.assets (id, asset_type, title, creator_id, owner_id, status, visibility, attributes)
VALUES ('a5500000-0000-4000-8000-000000000001', 'artwork', 'Jane Doe (born 1970) Untitled', NULL, NULL, 'active', 'public',
        '{"identity_key":"test:house:1","identity_basis":"house_lot","source":"bonhams"}');
INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, source_identifier, extraction_method)
VALUES ('a5500000-0000-4000-8000-000000000001', 'ad7104a3-48aa-486e-afff-f9f8af614883', 'creation_claim', '2025-05-01T12:00:00Z', 'Untitled',
        '{"role":"creator","attribution":"direct","layout":"lines","party_identity_id":"e7000000-0000-4000-8000-000000000001","name_as_printed":"Jane Doe"}',
        'test-house-claim-1', 'test-lot-1', 'house_catalogue_lines_v1');
DO $$ DECLARE r jsonb; hc jsonb; tc jsonb; nc jsonb; BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000002"}', true);
  tc := public.record_asset_role_claim('a5500000-0000-4000-8000-000000000001', 'performer', '[]'::jsonb, 'Installed the work.');
  IF tc->'status'->>'qualification' <> 'stated_unverified' THEN RAISE EXCEPTION 'b: a performance claim is testimony: %', tc; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000006"}', true);
  nc := public.record_asset_role_claim('a5500000-0000-4000-8000-000000000001', 'creator', '[]'::jsonb, 'I am Jane Doe.');
  IF nc->'status'->>'qualification' <> 'stated_unverified' THEN RAISE EXCEPTION 'b: a name match is not evidence: %', nc; END IF;
  BEGIN
    PERFORM public.record_asset_role_claim('a5500000-0000-4000-8000-000000000001', 'rights_holder', jsonb_build_array(nc->>'claim_id'), NULL);
    RAISE EXCEPTION 'b: own claim as evidence must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000002"}', true);
  BEGIN
    PERFORM public.asset_claim_actors('a5500000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'b: asset_claim_actors is service-only';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.asset_claim_actors('a5500000-0000-4000-8000-000000000001');
  SELECT x INTO hc FROM jsonb_array_elements(r->'claims') x WHERE x->>'party_kind' = 'catalogue';
  IF hc IS NULL OR hc->'actor_ids' <> '[]'::jsonb OR hc->>'actor_basis' <> 'catalogue_identity_not_actor' OR hc->>'qualification' <> 'source_statement' THEN
    RAISE EXCEPTION 'b: a catalogue identity is not an actor, even when claimed: %', hc; END IF;
  SELECT x INTO tc FROM jsonb_array_elements(r->'claims') x WHERE x->>'claim_id' = tc->>'claim_id';
  IF tc->'actor_ids' <> '["ac700000-0000-4000-8000-000000000001"]'::jsonb OR tc->>'bridge_state' <> 'evidenced' OR tc->>'skill_evidence' <> 'none_identity_only' THEN
    RAISE EXCEPTION 'b: the person resolves through the approved actor link only, as identity: %', tc; END IF;
  SELECT x INTO nc FROM jsonb_array_elements(r->'claims') x WHERE x->>'claim_id' = nc->>'claim_id';
  IF nc->'actor_ids' <> '[]'::jsonb OR nc->>'bridge_state' <> 'claimed' THEN RAISE EXCEPTION 'b: a pending self-claimed actor link resolves nothing: %', nc; END IF;
  IF jsonb_array_length(r->'claims') <> 3 THEN RAISE EXCEPTION 'b: three current claims expected: %', r; END IF;
  BEGIN
    INSERT INTO public.account_link_claims (user_id, platform, handle, actor_id, external_identity_id, status, verification_method)
    VALUES ('0b9f107a-0000-4000-8000-000000000002', 'nuke_actor', 'ac700000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000001', 'pending', 'self_claim');
    RAISE EXCEPTION 'b: actor + catalogue identity in one row must fail';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = 'a5500000-0000-4000-8000-000000000001' AND kind = 'creation_claim'
        AND structured_data ? 'party_identity_id' AND superseded_by IS NULL) <> 1 THEN RAISE EXCEPTION 'b: the house claim stays current'; END IF;
END $$;

-- (c) Artist, fabricator and later holder: distinct claims. Declaring holds (accepted under the interim policy) but does not author.
--     Authorship is separate testimony, never promoted. The later holder writes no authorship. creator_id stays record origin.
--     Revisions keep history (finding 5); a withdrawn cited claim lapses dependent evidence without touching the citing testimony.
DO $$ DECLARE d jsonb; aid uuid; cr jsonb; cr2 jsonb; cr3 jsonb; cr4 jsonb; fb jsonb; rt jsonb; lh jsonb; h jsonb; mine jsonb; p jsonb; d2 jsonb; BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000003"}', true);
  d := public.declare_held_asset('artwork', 'Edition of a fabricated sculpture', 'powder-coated steel', '2025', NULL, '1/3', NULL, 'public');
  aid := (d->>'asset_id')::uuid;
  IF d->>'authorship' <> 'not_claimed' OR (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'creation_claim') <> 0 THEN
    RAISE EXCEPTION 'c: declaring a held work writes no authorship: %', d; END IF;
  IF public.asset_role_claim_status((d->>'holding_claim_id')::uuid)->>'qualification' <> 'accepted_interim'
     OR (SELECT owner_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000003' THEN RAISE EXCEPTION 'c: the declarer holds (interim)'; END IF;
  BEGIN
    PERFORM public.record_asset_role_claim(aid, 'creator', jsonb_build_array(d->>'holding_claim_id'), NULL);
    RAISE EXCEPTION 'c: own holding claim cited for authorship must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  cr := public.record_asset_role_claim(aid, 'creator', '[]'::jsonb, 'I conceived and designed it.');
  IF cr->>'kind' <> 'creation_claim' OR cr->'status'->>'qualification' <> 'stated_unverified' THEN RAISE EXCEPTION 'c: artist creator claim: %', cr; END IF;
  -- Finding 5: same payload is a no-op; a corrected statement is version 2 superseding version 1; a retry of version 1 is ignored.
  IF NOT (public.record_asset_role_claim(aid, 'creator', '[]'::jsonb, 'I conceived and designed it.')->>'duplicate')::boolean THEN RAISE EXCEPTION 'c: same payload is a no-op'; END IF;
  cr2 := public.record_asset_role_claim(aid, 'creator', '[]'::jsonb, 'I conceived, designed and supervised it.');
  IF (cr2->>'duplicate')::boolean OR (cr2->'status'->>'version')::int <> 2 OR (SELECT superseded_by FROM public.asset_observations WHERE id = (cr->>'claim_id')::uuid) <> (cr2->>'claim_id')::uuid THEN
    RAISE EXCEPTION 'c: a revised statement is a new version: %', cr2; END IF;
  cr3 := public.record_asset_role_claim(aid, 'creator', '[]'::jsonb, 'I conceived and designed it.');
  IF NOT (cr3->>'stale_retry')::boolean OR cr3->>'claim_id' <> cr2->>'claim_id' THEN RAISE EXCEPTION 'c: an old retry must not restore the old head: %', cr3; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'creation_claim') <> 2 THEN RAISE EXCEPTION 'c: both versions kept'; END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000004"}', true);
  fb := public.record_asset_role_claim(aid, 'fabricator', '[]'::jsonb, 'Cut and welded the edition.');
  IF fb->>'kind' <> 'creation_claim' OR fb->>'role' <> 'fabricator' THEN RAISE EXCEPTION 'c: fabricator claim: %', fb; END IF;
  -- Finding 3: the fabricator cites the artist's current creator claim for a rights statement; the artist later withdraws it.
  rt := public.record_asset_role_claim(aid, 'rights_holder', jsonb_build_array(cr2->>'claim_id'), 'Licensed to reproduce the edition.');
  BEGIN
    PERFORM public.record_asset_role_claim(aid, 'performer', jsonb_build_array(cr->>'claim_id'), NULL);
    RAISE EXCEPTION 'c: a superseded row cannot be cited';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.accept_asset_holding_claim((d->>'holding_claim_id')::uuid);
    RAISE EXCEPTION 'c: only the current holder hands over';
  EXCEPTION WHEN invalid_parameter_value OR insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000005"}', true);
  lh := public.record_asset_role_claim(aid, 'holder', '[]'::jsonb, 'Bought it from the artist.');
  IF lh->'status'->>'qualification' <> 'stated_unverified' OR (SELECT owner_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000003' THEN
    RAISE EXCEPTION 'c: a later holder is testimony until handover: %', lh; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000004"}', true);
  BEGIN
    PERFORM public.accept_asset_holding_claim((lh->>'claim_id')::uuid);
    RAISE EXCEPTION 'c: the fabricator is not the holder and cannot hand over';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000003"}', true);
  h := public.accept_asset_holding_claim((lh->>'claim_id')::uuid, 'sold 2026');
  IF h->'status'->>'qualification' <> 'accepted_interim' OR (SELECT owner_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000005'
     OR (SELECT creator_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000003' THEN
    RAISE EXCEPTION 'c: holding moves, record origin stays: %', h; END IF;
  IF public.asset_holder_is(aid, '0b9f107a-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'c: the artist no longer holds'; END IF;
  -- The artist withdraws the cited creator claim: the fabricator's rights claim keeps its testimony and its evidence lapses.
  PERFORM public.withdraw_asset_role_claim((cr2->>'claim_id')::uuid, 'restating later');
  IF public.asset_role_claim_status((rt->>'claim_id')::uuid)->>'qualification' <> 'stated_evidence_lapsed'
     OR (SELECT structured_data->>'statement' FROM public.asset_observations WHERE id = (rt->>'claim_id')::uuid) <> 'Licensed to reproduce the edition.'
     OR (SELECT superseded_by FROM public.asset_observations WHERE id = (rt->>'claim_id')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'c: withdrawing a cited claim lapses dependent evidence, testimony kept: %', public.asset_role_claim_status((rt->>'claim_id')::uuid); END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'creation_claim' AND structured_data->>'party_user_id' = '0b9f107a-0000-4000-8000-000000000005') <> 0 THEN
    RAISE EXCEPTION 'c: the later holder has no authorship claim'; END IF;
  -- Re-statement after the party's own withdrawal (decision: new attributed testimony). Even the v1 payload lands as version 4,
  -- marked restated_after_withdrawal; v1..v3 stay as history; the rights claim that cited v2 stays lapsed (it cites a row, not a name).
  cr4 := public.record_asset_role_claim(aid, 'creator', '[]'::jsonb, 'I conceived and designed it.');
  IF (cr4->>'duplicate')::boolean OR cr4 ? 'stale_retry' OR NOT (cr4->>'restated_after_withdrawal')::boolean OR (cr4->'status'->>'version')::int <> 4
     OR cr4->'status'->>'qualification' <> 'stated_unverified'
     OR (SELECT (structured_data->>'restates_after_version')::int FROM public.asset_observations WHERE id = (cr4->>'claim_id')::uuid) <> 3 THEN
    RAISE EXCEPTION 'c: a statement after withdrawal is a new marked version: %', cr4; END IF;
  IF public.asset_role_claim_status((rt->>'claim_id')::uuid)->>'qualification' <> 'stated_evidence_lapsed' THEN RAISE EXCEPTION 'c: re-statement does not revive cited v2'; END IF;
  -- With a stated head again, stale-retry protection is back: the same payload is a no-op, the superseded v2 payload is ignored.
  IF NOT (public.record_asset_role_claim(aid, 'creator', '[]'::jsonb, 'I conceived and designed it.')->>'duplicate')::boolean THEN RAISE EXCEPTION 'c: restated head is idempotent'; END IF;
  cr3 := public.record_asset_role_claim(aid, 'creator', '[]'::jsonb, 'I conceived, designed and supervised it.');
  IF NOT (cr3->>'stale_retry')::boolean OR cr3->>'claim_id' <> cr4->>'claim_id' THEN RAISE EXCEPTION 'c: stale retry after re-statement: %', cr3; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'creation_claim' AND structured_data->>'party_user_id' = '0b9f107a-0000-4000-8000-000000000003') <> 4 THEN
    RAISE EXCEPTION 'c: four artist versions kept'; END IF;
  mine := public.held_assets_read(50);
  IF (mine->>'total')::int <> 0 OR (mine->>'recorded_total')::int <> 1 OR NOT (mine->'recorded'->0->'reasons') ? 'record_origin' THEN
    RAISE EXCEPTION 'c: the artist no longer holds but keeps the record in view: %', mine; END IF;
  p := public.asset_profile_read(aid);
  IF (p->'viewer'->>'is_holder')::boolean OR NOT (p->'viewer'->>'is_record_origin')::boolean THEN RAISE EXCEPTION 'c: artist viewer wrong: %', p->'viewer'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p->'creation') x WHERE x->>'qualification' = 'stated_unverified') <> 2 THEN RAISE EXCEPTION 'c: creation shows the fabricator''s and the restated artist''s claims: %', p->'creation'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000005"}', true);
  mine := public.held_assets_read(50);
  IF (mine->>'total')::int <> 1 OR mine->'assets'->0->'my_roles'->0->>'qualification' <> 'accepted_interim' THEN RAISE EXCEPTION 'c: the later holder holds: %', mine; END IF;
  d2 := public.declare_held_asset('artwork', 'A print bought at a fair', NULL, NULL, NULL, NULL, NULL, 'private');
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = (d2->>'asset_id')::uuid AND kind = 'creation_claim') <> 0 THEN RAISE EXCEPTION 'c: declaration is not authorship'; END IF;
  PERFORM public.withdraw_asset_role_claim((lh->>'claim_id')::uuid, 'consigned away');
  IF (SELECT owner_id FROM public.assets WHERE id = aid) IS NOT NULL OR public.asset_holder_is(aid, '0b9f107a-0000-4000-8000-000000000005') THEN
    RAISE EXCEPTION 'c: withdrawal ends holding'; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'holding_claim') <> 3
     OR (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'role_claim_acceptance') <> 4 THEN
    RAISE EXCEPTION 'c: holding testimony (3) and acceptance history (4) kept'; END IF;
END $$;

-- Finding 3, projection: an own-archive holder accepted under the interim policy cites a photo. A reread supersedes that photo:
-- holding is disqualified at once (reader-time), owner_id is re-projected to NULL, and the holding testimony is unchanged.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ DECLARE r jsonb; aid uuid; ph uuid; ph2 uuid; hc jsonb; BEGIN
  r := public.propose_held_assets('0b9f107a-0000-4000-8000-000000000007', $j$[{"proposal_key":"archive:own:0001","kind":"painting","labeller":"apple_photos_on_device_v1",
    "photos":[{"uuid":"ARCH-1","taken_at":"2024-01-01T10:00:00Z"}]}]$j$::jsonb);
  SELECT id INTO aid FROM public.assets WHERE attributes->>'identity_key' = 'proposal:0b9f107a-0000-4000-8000-000000000007:archive:own:0001';
  SELECT id INTO ph FROM public.asset_observations WHERE asset_id = aid AND kind = 'photo_sighting';
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000007"}', true);
  PERFORM public.confirm_held_asset(aid, 'A painting in my studio', NULL, NULL, NULL, NULL, NULL, 'private');
  hc := public.record_asset_role_claim(aid, 'holder', jsonb_build_array(ph::text), 'It hangs in my studio.');
  IF hc->'status'->>'qualification' <> 'accepted_interim' OR hc->'status'->'acceptance'->>'basis' <> 'sign_tier_record_origin_declaration'
     OR NOT public.asset_holder_is(aid, '0b9f107a-0000-4000-8000-000000000007') THEN RAISE EXCEPTION 'e: interim acceptance: %', hc; END IF;
  -- A reread lands a new sighting and supersedes the cited one (as a re-reading writer would).
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, structured_data, content_hash, source_identifier, extraction_method)
  VALUES (aid, 'ad7104a3-48aa-486e-afff-f9f8af614800', 'photo_sighting', '2024-01-01T10:00:00Z', '{"reread":true}', 'reread-1', 'ARCH-1', 'reread_v2') RETURNING id INTO ph2;
  UPDATE public.asset_observations SET superseded_by = ph2 WHERE id = ph;
  IF public.asset_holder_is(aid, '0b9f107a-0000-4000-8000-000000000007') THEN RAISE EXCEPTION 'e: a superseded cited photo disqualifies holding'; END IF;
  IF public.asset_role_claim_status((hc->>'claim_id')::uuid)->>'qualification' <> 'acceptance_lapsed' THEN RAISE EXCEPTION 'e: acceptance lapsed'; END IF;
  -- Gap (a): the superseding UPDATE itself re-projects (trigger), so the owner_id cache is already cleared; no writer call needed.
  IF (SELECT owner_id FROM public.assets WHERE id = aid) IS NOT NULL THEN RAISE EXCEPTION 'e: owner_id follows the supersede at once'; END IF;
  IF public.asset_holding_reproject(aid) IS NOT NULL THEN RAISE EXCEPTION 'e: re-projection finds no qualified holder'; END IF;
  IF (SELECT structured_data->>'claim_state' FROM public.asset_observations WHERE id = (hc->>'claim_id')::uuid) <> 'stated' THEN RAISE EXCEPTION 'e: testimony kept'; END IF;
  -- The person sees it, now under documented (still their own photos), with the lapsed holding as a reason.
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000007"}', true);
  r := public.held_assets_read(50);
  IF (r->>'total')::int <> 0 OR (r->>'documented_total')::int <> 1 OR NOT (r->'documented'->0->'reasons') ? 'holder:acceptance_lapsed' THEN RAISE EXCEPTION 'e: listed with its lapsed holding: %', r; END IF;
  -- The lapsed photo cannot be cited again; the current reread can.
  BEGIN
    PERFORM public.record_asset_role_claim(aid, 'holder', jsonb_build_array(ph::text), 'It hangs in my studio.');
    RAISE EXCEPTION 'e: a superseded photo cannot be cited';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  hc := public.record_asset_role_claim(aid, 'holder', jsonb_build_array(ph2::text), 'It hangs in my studio.');
  IF hc->'status'->>'qualification' <> 'accepted_interim' OR (hc->'status'->>'version')::int <> 2 THEN RAISE EXCEPTION 'e: restated on current evidence: %', hc; END IF;
END $$;

-- Gap (a), a writer on main: record_asset_lots supersedes a lot row that a holder claim cites; the projection follows inside that
-- writer's own transaction. A deleted cited row does the same. An asset not on holding_projection keeps its owner_id untouched.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ DECLARE r jsonb; aid uuid; aid2 uuid; lot uuid; hc jsonb; ps uuid; BEGIN
  r := public.record_asset_lots('bonhams', $j$[
    {"identity_key":"bonhams:follow-1","asset_type":"artwork","source_identifier":"follow-1","title":"A lot cited by a holder","observed_at":"2026-10-01T00:00:00Z","result":"unknown"},
    {"identity_key":"bonhams:follow-2","asset_type":"artwork","source_identifier":"follow-2","title":"A lot held elsewhere","observed_at":"2026-10-01T00:00:00Z","result":"unknown"}]$j$::jsonb);
  SELECT id INTO aid FROM public.assets WHERE attributes->>'identity_key' = 'bonhams:follow-1';
  SELECT id INTO aid2 FROM public.assets WHERE attributes->>'identity_key' = 'bonhams:follow-2';
  SELECT id INTO lot FROM public.asset_observations WHERE asset_id = aid AND kind = 'auction_lot' AND superseded_by IS NULL;
  -- Fixture only: stands in for a record origin on this asset, and for another writer's owner_id on the second.
  UPDATE public.assets SET creator_id = '0b9f107a-0000-4000-8000-000000000007' WHERE id = aid;
  UPDATE public.assets SET owner_id = '0b9f107a-0000-4000-8000-000000000006' WHERE id = aid2;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000007"}', true);
  hc := public.record_asset_role_claim(aid, 'holder', jsonb_build_array(lot::text), 'Bought at this sale.');
  IF hc->'status'->>'qualification' <> 'accepted_interim' OR (SELECT owner_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000007' THEN
    RAISE EXCEPTION 'f: holder accepted on the cited lot: %', hc; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.record_asset_lots('bonhams', $j$[
    {"identity_key":"bonhams:follow-1","asset_type":"artwork","source_identifier":"follow-1","title":"A lot cited by a holder","observed_at":"2026-10-02T00:00:00Z","result":"sold","hammer_price":1000,"currency":"USD"},
    {"identity_key":"bonhams:follow-2","asset_type":"artwork","source_identifier":"follow-2","title":"A lot held elsewhere","observed_at":"2026-10-02T00:00:00Z","result":"sold","hammer_price":900,"currency":"USD"}]$j$::jsonb);
  IF (r->>'observations_superseded')::int <> 2 THEN RAISE EXCEPTION 'f: the lot writer superseded both: %', r; END IF;
  IF (SELECT owner_id FROM public.assets WHERE id = aid) IS NOT NULL OR public.asset_role_claim_status((hc->>'claim_id')::uuid)->>'qualification' <> 'acceptance_lapsed'
     OR (SELECT structured_data->>'claim_state' FROM public.asset_observations WHERE id = (hc->>'claim_id')::uuid) <> 'stated' THEN
    RAISE EXCEPTION 'f: owner_id follows record_asset_lots at once, testimony kept'; END IF;
  IF (SELECT owner_id::text FROM public.assets WHERE id = aid2) <> '0b9f107a-0000-4000-8000-000000000006' THEN RAISE EXCEPTION 'f: assets off holding_projection untouched'; END IF;
  -- Delete path: restate on a fresh current row, then that row is deleted.
  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, structured_data, content_hash, source_identifier, extraction_method)
  VALUES (aid, 'ad7104a3-48aa-486e-afff-f9f8af614800', 'photo_sighting', '2026-10-03T00:00:00Z', '{}', 'follow-photo', 'FOLLOW-1', 'fixture_v1') RETURNING id INTO ps;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000007"}', true);
  hc := public.record_asset_role_claim(aid, 'holder', jsonb_build_array(ps::text), 'Bought at this sale.');
  IF hc->'status'->>'qualification' <> 'accepted_interim' OR (SELECT owner_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000007' THEN
    RAISE EXCEPTION 'f: restated on current evidence: %', hc; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  DELETE FROM public.asset_observations WHERE id = ps;
  IF (SELECT owner_id FROM public.assets WHERE id = aid) IS NOT NULL THEN RAISE EXCEPTION 'f: owner_id follows a deleted cited row'; END IF;
END $$;

DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  BEGIN
    PERFORM public.record_asset_role_claim('a5500000-0000-4000-8000-000000000001', 'holder');
    RAISE EXCEPTION 'anon claim must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'test_asset_role_claims: all acceptance paths passed' AS result;
