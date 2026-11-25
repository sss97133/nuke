-- user_associated_vehicle_ids(uuid) counts a car reached through an organization link only when
-- organization_vehicle_link_grants() (20261126031500) accepts the link, as the six read policies do from 20261126034500.
--
-- Why (PG17, live body verbatim, 2026-11-25). Any signed-in user creates an organization, becomes its active owner and
-- links someone else's car through the client policies; the link's organization seed then puts that car among the
-- caller's associated vehicles. device_file_media_document authorizes on this set ('refused_not_associated' otherwise),
-- then files the caller's screen capture onto the car and writes a vehicle_documents row and vehicle_price_observations;
-- device_create_vehicle_profile and device_file_images_as call it too, as do iOS (AttributionEngine, ScreenCaptureSync,
-- VideoSyncEngine, MediaAttributionGate) and check-image-vehicle-match.
--
-- What changes (catalog only): the organization seed adds the rule, by an anchored edit of the live definition (the anchor
-- must occur once; a marker makes it idempotent). The rule sits in a CASE on the membership row so it runs as a join
-- filter, only on links the caller is an active member through (live, 2026-11-25: the largest member organization holds
-- 154 active links). The function is registered in private_row_policy_copies beside the three readers of 20261126034500.
-- Effect today: 391 links carry a linker, 0 untied; no current answer changes.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE m text := md5(pg_get_functiondef('public.user_associated_vehicle_ids(uuid)'::regprocedure));
BEGIN
  IF to_regprocedure('public.organization_vehicle_link_grants(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'organization_vehicle_link_grants(uuid, uuid) is missing; apply 20261126031500 first';
  END IF;
  IF m NOT IN ('b3938e826cb79d0c4b961d429eef8612', -- gitleaks:allow (function body md5 read 2026-11-25, not a secret)
               '05c5ce51b108ebbcf24bf017a8022634') THEN -- gitleaks:allow (function body md5 after this migration, not a secret)
    RAISE EXCEPTION 'user_associated_vehicle_ids changed since 2026-11-25 (md5 %); review first', m;
  END IF;
END
$guard$;

DO $edit$
DECLARE
  d text := pg_get_functiondef('public.user_associated_vehicle_ids(uuid)'::regprocedure);
  anchor constant text := E'    JOIN organization_vehicles ov ON ov.organization_id = oc.organization_id AND ov.status = ''active''\n  )';
  n int;
BEGIN
  IF position('org_link_reads_tied_linker_v1' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  IF n <> 1 THEN
    RAISE EXCEPTION 'user_associated_vehicle_ids organization seed found % times; review the definition first', n;
  END IF;
  EXECUTE replace(d, anchor, E'    JOIN organization_vehicles ov ON ov.organization_id = oc.organization_id AND ov.status = ''active''\n'
    || E'      AND CASE WHEN oc.status = ''active'' THEN public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id)\n'
    || E'               ELSE false END /* org_link_reads_tied_linker_v1 */\n  )');
END
$edit$;

INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
SELECT 'user_associated_vehicle_ids(uuid)', 'vehicle_images', 'p.policyname = ''Organization members can view org vehicle images''',
       h.policy_hash, 'ta-packet',
       '20261126051500: the organization seed restates the organization-member rule with organization_vehicle_link_grants'
FROM public.private_row_policy_hash('vehicle_images', 'p.policyname = ''Organization members can view org vehicle images''') h
ON CONFLICT (reader, relation, policy_filter) DO UPDATE SET recorded_hash = EXCLUDED.recorded_hash, recorded_at = now();

COMMIT;
