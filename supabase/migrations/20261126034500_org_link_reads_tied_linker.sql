-- The read policies and definer readers that admit a member of any organization linked to a vehicle now count only links
-- that organization_vehicle_link_grants() (20261126031500) accepts: the stamp trigger intact, and a service or tied linker.
--
-- Why (PG17, live policy text verbatim, real authenticated role, 2026-11-25). Any signed-in user creates an organization,
-- becomes its active owner and links someone else's private car through the client policies; then, as that user:
--   vehicle_images                      "Organization members can view org vehicle images"  every photo of the car: YES
--   image_work_extractions              "View work extractions"                             the car's extractions: YES
--   work_organization_matches           "View work matches"                                 the car's matches: YES
--   vehicle_relationship_verifications  three policies                                       other links' rows: no; its own
--                                                                                            link: insert, self-approve
-- Three SECURITY DEFINER readers restate the same organization-member rule in their bodies:
-- work_order_evidence_image_visible(uuid,uuid), vehicle_card_images(uuid[]) and get_vehicle_profile_data(uuid).
--
-- What changes (catalog only; no row is read or written):
--   * the six policies: each organization_vehicles subquery adds organization_vehicle_link_grants(ov.vehicle_id,
--     ov.linked_by_user_id); each applies to authenticated only (every branch needs auth.uid(), and the rule is not
--     executable by anon).
--   * the three readers: the same condition is added to their organization-member EXISTS, by an anchored edit of the live
--     definition (the anchor must occur exactly once; a marker makes it idempotent).
--   * private_row_policy_copies: the three readers are registered as copies of the vehicle_images organization policy;
--     the two existing vehicle_images copies (get_image_deep_analysis, intake_live_state) restate no organization branch,
--     were re-read, and get the new hash.
-- Effect today (live, 2026-11-25): 391 links carry a linker, 0 untied; no current read changes.
--
-- Locks: ALTER POLICY takes ACCESS EXCLUSIVE on each table for the catalog change only; lock_timeout 3 s, run in a quiet
-- window (vehicle_images is read on every gallery).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE h text;
BEGIN
  IF to_regprocedure('public.organization_vehicle_link_grants(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'organization_vehicle_link_grants(uuid, uuid) is missing; apply 20261126031500 first';
  END IF;
  SELECT md5(string_agg(c.relname || '.' || p.polname || ':' || p.polcmd::text || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '|' ORDER BY c.relname, p.polname)) INTO h
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('vehicle_images', 'image_work_extractions', 'vehicle_relationship_verifications', 'work_organization_matches')
    AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'organization_vehicles';
  IF h NOT IN ('dde57bb446994ca0f6340a406e466910', -- gitleaks:allow (policy fingerprint read 2026-11-25, not a secret)
               'd440dd11ce134c13aa6ec3e1ab712bb1') THEN -- gitleaks:allow (policy fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'the organization-link read policies changed since 2026-11-25 (md5 %); review first', h;
  END IF;
END
$guard$;

ALTER POLICY "Organization members can view org vehicle images" ON public.vehicle_images
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((ov.organization_id = oc.organization_id)))
  WHERE ((ov.vehicle_id = vehicle_images.vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text)
    AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id)))));

ALTER POLICY "View work extractions" ON public.image_work_extractions
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM organization_vehicles ov
  WHERE ((ov.vehicle_id = image_work_extractions.vehicle_id) AND (EXISTS ( SELECT 1
           FROM organization_contributors oc
          WHERE ((oc.organization_id = ov.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text))))
    AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id)))) OR (EXISTS ( SELECT 1
   FROM vehicle_images vi
  WHERE ((vi.id = image_work_extractions.image_id) AND (vi.user_id = ( SELECT auth.uid() AS uid)))))));

ALTER POLICY "View work matches" ON public.work_organization_matches
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = work_organization_matches.matched_organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text)))) OR (EXISTS ( SELECT 1
   FROM organization_vehicles ov
  WHERE ((ov.vehicle_id = work_organization_matches.vehicle_id) AND (EXISTS ( SELECT 1
           FROM organization_contributors oc2
          WHERE ((oc2.organization_id = ov.organization_id) AND (oc2.user_id = ( SELECT auth.uid() AS uid)) AND (oc2.status = 'active'::text))))
    AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id))))));

ALTER POLICY "Org members can create verifications" ON public.vehicle_relationship_verifications
  TO authenticated
  WITH CHECK (((EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((oc.organization_id = ov.organization_id)))
  WHERE ((ov.id = vehicle_relationship_verifications.organization_vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text)
    AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id)))) AND (requested_by_user_id = ( SELECT auth.uid() AS uid))));

ALTER POLICY "Org members can view verifications" ON public.vehicle_relationship_verifications
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((oc.organization_id = ov.organization_id)))
  WHERE ((ov.id = vehicle_relationship_verifications.organization_vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text)
    AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id)))));

ALTER POLICY "Org owners can manage verifications" ON public.vehicle_relationship_verifications
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((oc.organization_id = ov.organization_id)))
  WHERE ((ov.id = vehicle_relationship_verifications.organization_vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text, 'manager'::text, 'board_member'::text]))
    AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id)))));

-- The three definer readers: anchored edits of the live definitions.
DO $readers$
DECLARE
  r record; d text; n int;
  marker constant text := 'org_link_reads_tied_linker_v1';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.work_order_evidence_image_visible(uuid,uuid)',
     $a$WHERE ov.vehicle_id = vi.vehicle_id AND oc.user_id = p_viewer AND oc.status = 'active')$a$,
     $b$WHERE ov.vehicle_id = vi.vehicle_id AND oc.user_id = p_viewer AND oc.status = 'active'
          AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id) /* org_link_reads_tied_linker_v1 */)$b$),
    ('public.vehicle_card_images(uuid[])',
     $a$WHERE ov.vehicle_id = v.id AND oc.user_id = me.uid AND oc.status = 'active')$a$,
     $b$WHERE ov.vehicle_id = v.id AND oc.user_id = me.uid AND oc.status = 'active'
                           AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id) /* org_link_reads_tied_linker_v1 */)$b$),
    ('public.get_vehicle_profile_data(uuid)',
     E'      AND oc.user_id = v_uid\n      AND oc.status = ''active''\n  );',
     E'      AND oc.user_id = v_uid\n      AND oc.status = ''active''\n      AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id) /* org_link_reads_tied_linker_v1 */\n  );')
  ) AS t(fn, anchor, replacement) LOOP
    d := pg_get_functiondef(r.fn::regprocedure);
    IF position(marker IN d) > 0 THEN CONTINUE; END IF;
    n := (length(d) - length(replace(d, r.anchor, ''))) / length(r.anchor);
    IF n <> 1 THEN
      RAISE EXCEPTION '% organization-member anchor found % times; review the definition first', r.fn, n;
    END IF;
    EXECUTE replace(d, r.anchor, r.replacement);
  END LOOP;
END
$readers$;

-- Policy copies: record what each reader restates.
UPDATE public.private_row_policy_copies c
SET recorded_hash = h.policy_hash, recorded_at = now(),
    note = c.note || ' | 20261126034500: re-read, restates no organization branch; hash moved with the organization policy'
FROM public.private_row_policy_hash('vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')') h
WHERE c.relation = 'vehicle_images' AND c.policy_filter = 'p.cmd IN (''SELECT'', ''ALL'')'
  AND c.reader IN ('get_image_deep_analysis(uuid)', 'intake_live_state(integer,integer)')
  AND c.recorded_hash IS DISTINCT FROM h.policy_hash;

INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
SELECT r.reader, 'vehicle_images', 'p.policyname = ''Organization members can view org vehicle images''', h.policy_hash, 'ta-packet',
       '20261126034500: the body restates the organization-member image rule with organization_vehicle_link_grants'
FROM (VALUES ('work_order_evidence_image_visible(uuid,uuid)'), ('vehicle_card_images(uuid[])'), ('get_vehicle_profile_data(uuid)')) r(reader)
CROSS JOIN public.private_row_policy_hash('vehicle_images', 'p.policyname = ''Organization members can view org vehicle images''') h
ON CONFLICT (reader, relation, policy_filter) DO UPDATE SET recorded_hash = EXCLUDED.recorded_hash, recorded_at = now();

COMMIT;
