-- Public provider profile: "a spot for people to investigate if the technician they have is any good or not"
-- (owner, 2026-10-19). Open under the privacy doctrine: no e-mail, phone, street address or private legal names
-- (people by handle / profile id), no money, contact only as a brokered placeholder.
--
-- provider_profile_read(p_user_id, p_actor_id): exactly one subject.
--   * user: a public profile (or the caller's own). Handle and profile id, city/state as published on the public
--     profile, member_since. actor: a canonical work actor, shown by role, as 'unnamed party' unless an evidenced
--     identity bridge links it to a public profile handle; no name, city or contact.
--   * claims: what the account (or the actor record) states about itself; never counted as capability.
--   * capabilities: actor_capabilities rows of the subject's actor(s) only, with evidence counts and clocks. The
--     existing rows record no basis ids, which is reported.
--   * tools, by rung: seen_in_frame = tool sightings in the subject's most recent 1,000 approved photos on public
--     vehicles (occurrences, not distinct objects; coverage states the cap); claimed_owned = user_tools and
--     tool_inventory rows by category (no purchase, depreciation or market values here); co_signed = supporting
--     attestations by someone else on resources the subject supplies or performs.
--   * facilities: user_org_relations memberships with relation weight, plus owned organizations; organizations by
--     name and city/state when the organization is public, with a pointer to actor_profile_read.
--   * identity_bridge: account_link_claims state and highest rung.
--   * work_record: signed work days and capture span hours (photo timestamps, labelled as capture span, not labor)
--     on public vehicles; provider jobs (shop owner, evidenced performer) counted by job-path completion state, with
--     inconsistency counts. Private-vehicle work counts only for the subject themself or a slot holder.
-- provider_job_ids is the shared internal list of a subject's provider jobs (used by provider_job_record_read).
-- Contract: supabase/sql/test_provider_profile_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.provider_job_ids(p_user_id uuid, p_actor_id uuid)
RETURNS TABLE(work_order_id uuid, vehicle_id uuid, subject_roles text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  WITH actors AS (
    SELECT p_actor_id AS actor_id WHERE p_actor_id IS NOT NULL
    UNION
    SELECT jsonb_array_elements_text(public.viewer_identity_bridge(p_user_id)->'evidenced_actor_ids')::uuid WHERE p_user_id IS NOT NULL
  ), j AS (
    SELECT w.id, w.vehicle_id, 'shop_owner'::text AS role FROM public.work_orders w
    WHERE p_user_id IS NOT NULL AND w.organization_id IN (SELECT bo.business_id FROM public.business_ownership bo
      WHERE bo.owner_id = p_user_id AND bo.status = 'active')
    UNION
    SELECT w.id, w.vehicle_id, 'performer' FROM public.work_order_line_items li JOIN public.work_orders w ON w.id = li.work_order_id
    WHERE li.actor_id IN (SELECT actor_id FROM actors)
  )
  SELECT id, vehicle_id, array_agg(DISTINCT role ORDER BY role) FROM j GROUP BY id, vehicle_id
$$;
REVOKE ALL ON FUNCTION public.provider_job_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_job_ids(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.provider_job_ids(uuid, uuid) IS 'Internal: work orders where a subject acts as provider: shop owner (active business_ownership of the work order organization) or performer (operation actor, directly or through an evidenced identity bridge). Customer and access slots are not provider work.';

CREATE FUNCTION public.provider_profile_read(p_user_id uuid DEFAULT NULL, p_actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  self boolean := false;
  p record;
  a record;
  bridge jsonb;
  actor_ids uuid[] := '{}';
  subject jsonb;
  claims jsonb;
  caps jsonb;
  seen jsonb;
  owned jsonb;
  cosigned integer;
  facilities jsonb := '[]'::jsonb;
  idb jsonb;
  sessions jsonb;
  jobs jsonb;
  ladder constant text[] := ARRAY['unknown','self_claim','work_evidence','co_sign','authenticated_sign'];
BEGIN
  IF num_nonnulls(p_user_id, p_actor_id) <> 1 THEN
    RAISE EXCEPTION 'Exactly one of user id or actor id is required' USING ERRCODE = '22023';
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT pr.id, pr.username, pr.is_public, pr.city, pr.state, COALESCE(pr.member_since, pr.created_at) AS member_since,
      pr.role, pr.user_type, pr.profession, pr.expertise_areas INTO p FROM public.profiles pr WHERE pr.id = p_user_id;
    self := uid IS NOT NULL AND uid = p_user_id;
    IF NOT FOUND OR (p.is_public IS NOT TRUE AND NOT self) THEN RAISE EXCEPTION 'Profile unavailable'; END IF;
    bridge := public.viewer_identity_bridge(p_user_id);
    actor_ids := ARRAY(SELECT jsonb_array_elements_text(bridge->'evidenced_actor_ids')::uuid);
    subject := jsonb_build_object('kind', 'user', 'profile_id', p.id, 'handle', NULLIF(btrim(p.username), ''),
      'label', CASE WHEN NULLIF(btrim(p.username), '') IS NULL THEN 'unnamed party' END, 'actor_type', NULL,
      'city', p.city, 'state', p.state, 'place_basis', 'published on the public profile; no street address',
      'member_since', p.member_since);
    claims := jsonb_build_object('basis', 'stated_by_account',
      'account', jsonb_build_object('role', p.role, 'user_type', p.user_type, 'profession', p.profession,
        'expertise_areas', p.expertise_areas),
      'actor_records', COALESCE((SELECT jsonb_agg(jsonb_build_object('actor_id', x.id, 'basis', 'stated_on_actor_record',
          'actor_type', x.actor_type, 'specialties', x.specialties, 'certifications', x.certifications, 'licenses', x.licenses,
          'training', x.training, 'specialty_makes', x.specialty_makes, 'specialty_eras', x.specialty_eras,
          'years_experience', x.years_experience) ORDER BY x.id)
        FROM public.actors x WHERE x.id = ANY (actor_ids)), '[]'::jsonb));
  ELSE
    SELECT x.id, x.actor_type, x.specialties, x.certifications, x.licenses, x.training, x.specialty_makes,
      x.specialty_eras, x.years_experience, x.created_at INTO a FROM public.actors x WHERE x.id = p_actor_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Provider unavailable'; END IF;
    actor_ids := ARRAY[p_actor_id];
    subject := jsonb_build_object('kind', 'actor', 'actor_id', a.id, 'actor_type', a.actor_type,
      'display', public.platform_actor_label(a.id), 'city', NULL, 'state', NULL,
      'place_basis', 'not published by the subject', 'member_since', NULL, 'record_created_at', a.created_at);
    claims := jsonb_build_object('basis', 'stated_on_actor_record', 'account', NULL,
      'actor_records', jsonb_build_array(jsonb_build_object('actor_id', a.id, 'basis', 'stated_on_actor_record',
        'actor_type', a.actor_type, 'specialties', a.specialties, 'certifications', a.certifications, 'licenses', a.licenses,
        'training', a.training, 'specialty_makes', a.specialty_makes, 'specialty_eras', a.specialty_eras,
        'years_experience', a.years_experience)));
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('actor_id', c.actor_id, 'capability_type', c.capability_type,
      'complexity_tier', c.complexity_tier, 'evidence_count', c.evidence_count, 'first_demonstrated', c.first_demonstrated,
      'last_demonstrated', c.last_demonstrated, 'basis_ids_recorded', 0) ORDER BY c.evidence_count DESC NULLS LAST, c.capability_type), '[]'::jsonb)
    INTO caps FROM public.actor_capabilities c WHERE c.actor_id = ANY (actor_ids);

  IF p_user_id IS NOT NULL THEN
    WITH eligible AS (
      SELECT vi.id, vi.taken_at FROM public.vehicle_images vi JOIN public.vehicles v ON v.id = vi.vehicle_id
      WHERE vi.user_id = p_user_id AND vi.is_external IS FALSE AND vi.vision_gate_status = 'approved'
        AND (self OR v.is_public IS TRUE)
    ), scanned AS (SELECT id FROM eligible ORDER BY taken_at DESC NULLS LAST, id LIMIT 1000),
    frames AS (
      SELECT o.structured_data#>'{workshop_signals,tools_visible}' AS tv FROM scanned s
      JOIN public.vehicle_observations o ON (o.structured_data->>'image_id') = s.id::text
        AND (o.structured_data->>'analysis_kind') = 'image_deep_byok'
      WHERE o.kind::text = 'condition' AND o.is_superseded IS FALSE AND o.source_id IS NOT NULL
    ), sightings AS (
      SELECT lower(btrim(CASE jsonb_typeof(e) WHEN 'string' THEN e#>>'{}' ELSE COALESCE(e->>'label', e->>'name', e->>'tool') END)) AS label
      FROM frames f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.tv) = 'array' THEN f.tv ELSE '[]'::jsonb END) e
    )
    SELECT jsonb_build_object('occurrences', (SELECT count(*) FROM sightings),
      'frames_analyzed', (SELECT count(*) FROM frames),
      'frames_with_tools', (SELECT count(*) FROM frames WHERE jsonb_typeof(tv) = 'array' AND jsonb_array_length(tv) > 0),
      'top_labels', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', label, 'occurrences', n) ORDER BY n DESC, label)
        FROM (SELECT label, count(*) n FROM sightings WHERE NULLIF(label, '') IS NOT NULL GROUP BY label ORDER BY count(*) DESC, label LIMIT 10) t), '[]'::jsonb),
      'images_scanned', (SELECT count(*) FROM scanned), 'images_eligible', (SELECT count(*) FROM eligible), 'scan_cap', 1000,
      'basis', 'tool sightings in analysed frames of the subject''s own approved photos; occurrences, not distinct objects')
      INTO seen;
    SELECT jsonb_build_object('user_tools', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', category, 'records', n, 'units', units) ORDER BY n DESC, category)
          FROM (SELECT COALESCE(NULLIF(btrim(t.category), ''), 'uncategorized') category, count(*) n, sum(COALESCE(t.total_quantity, 1)) units
            FROM public.user_tools t WHERE t.user_id = p_user_id GROUP BY 1) x), '[]'::jsonb),
        'tool_inventory', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', category, 'records', n) ORDER BY n DESC, category)
          FROM (SELECT COALESCE(NULLIF(btrim(t.category), ''), 'uncategorized') category, count(*) n
            FROM public.tool_inventory t WHERE t.owner_id = p_user_id GROUP BY 1) x), '[]'::jsonb),
        'basis', 'claimed ownership from receipts and inventory records; not physical verification',
        'values', 'not reported here (purchase cost, computed depreciation and market value are separate measures)')
      INTO owned;
    SELECT count(*) INTO cosigned FROM public.work_order_resource_attestations at
      JOIN public.vehicle_observations so ON so.id = at.id AND so.is_superseded IS FALSE
      JOIN public.work_order_resource_fulfillments f ON f.id = at.fulfillment_id
      WHERE at.verdict = 'supports' AND at.attestor_user_id IS DISTINCT FROM p_user_id
        AND (f.supplier_user_id = p_user_id OR f.user_tool_id IN (SELECT t.id FROM public.user_tools t WHERE t.user_id = p_user_id)
          OR f.performer_actor_id = ANY (actor_ids));
  ELSE
    seen := jsonb_build_object('state', 'not_assessed', 'basis', 'a work actor has no photo account');
    owned := jsonb_build_object('state', 'not_assessed', 'basis', 'a work actor has no tool records');
    SELECT count(*) INTO cosigned FROM public.work_order_resource_attestations at
      JOIN public.vehicle_observations so ON so.id = at.id AND so.is_superseded IS FALSE
      JOIN public.work_order_resource_fulfillments f ON f.id = at.fulfillment_id
      WHERE at.verdict = 'supports' AND f.performer_actor_id = p_actor_id;
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(m ORDER BY (m#>>'{relation,weight}')::numeric DESC NULLS LAST, m->>'organization_id'), '[]'::jsonb) INTO facilities FROM (
      SELECT jsonb_build_object('relation_kind', 'member', 'organization_id', r->>'organization_id',
          'name', COALESCE(o.business_name, o.name, r->>'name'), 'type', r->>'type', 'role', r->>'role',
          'membership_status', r->>'membership_status',
          'city', CASE WHEN o.is_public IS TRUE THEN o.city END, 'state', CASE WHEN o.is_public IS TRUE THEN o.state END,
          'relation', jsonb_build_object('weight', r#>'{relation,weight}', 'state', r#>'{relation,state}',
            'last_contribution_at', r#>'{relation,last_contribution_at}'),
          'actor_profile', CASE WHEN o.is_public IS TRUE THEN jsonb_build_object('reader', 'actor_profile_read', 'kind', 'organization', 'id', o.id) END) AS m
      FROM jsonb_array_elements(public.user_org_relations(p_user_id)->'relations') r
      LEFT JOIN public.organizations o ON o.id = (r->>'organization_id')::uuid
      UNION ALL
      SELECT jsonb_build_object('relation_kind', 'ownership', 'organization_id', bo.business_id,
          'name', COALESCE(o.business_name, o.name), 'type', o.business_type, 'role', bo.ownership_type, 'membership_status', bo.status,
          'city', CASE WHEN o.is_public IS TRUE THEN o.city END, 'state', CASE WHEN o.is_public IS TRUE THEN o.state END,
          'relation', NULL,
          'actor_profile', CASE WHEN o.is_public IS TRUE THEN jsonb_build_object('reader', 'actor_profile_read', 'kind', 'organization', 'id', o.id) END)
      FROM public.business_ownership bo LEFT JOIN public.organizations o ON o.id = bo.business_id
      WHERE bo.owner_id = p_user_id) x;
    idb := jsonb_build_object('state', bridge->>'state',
      'rung', (SELECT c.verification_method FROM public.account_link_claims c WHERE c.user_id = p_user_id AND c.actor_id IS NOT NULL
        AND c.status IN ('pending','approved') ORDER BY array_position(ladder, c.verification_method) DESC LIMIT 1),
      'evidenced_actors', jsonb_array_length(bridge->'evidenced_actor_ids'),
      'basis', 'account_link_claims actor claims; never matched by name, phone or email');
    SELECT jsonb_build_object('signed_work_days', count(DISTINCT s.session_date) FILTER (WHERE s.owner_confirmed_at IS NOT NULL),
        'days_with_capture', count(DISTINCT s.session_date),
        'capture_span_hours', jsonb_build_object('value', round(COALESCE(sum(s.duration_minutes), 0) / 60.0, 1),
          'label', 'capture span from photo timestamps; not labor time'),
        'first_day', min(s.session_date), 'last_day', max(s.session_date),
        'signature_basis', 'self-confirmation of a photo-derived day (confirm_work_session); not counterparty acceptance')
      INTO sessions FROM public.work_sessions s JOIN public.vehicles v ON v.id = s.vehicle_id
      WHERE s.user_id = p_user_id AND (self OR v.is_public IS TRUE);
  ELSE
    idb := jsonb_build_object('state', CASE
        WHEN EXISTS (SELECT 1 FROM public.account_link_claims c WHERE c.actor_id = p_actor_id AND c.status = 'approved'
          AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign')) THEN 'evidenced'
        WHEN EXISTS (SELECT 1 FROM public.account_link_claims c WHERE c.actor_id = p_actor_id AND c.status = 'pending') THEN 'claimed'
        ELSE 'none' END,
      'rung', (SELECT c.verification_method FROM public.account_link_claims c WHERE c.actor_id = p_actor_id
        AND c.status IN ('pending','approved') ORDER BY array_position(ladder, c.verification_method) DESC LIMIT 1),
      'display', public.platform_actor_label(p_actor_id),
      'basis', 'account_link_claims actor claims; never matched by name, phone or email');
    sessions := jsonb_build_object('state', 'not_assessed', 'basis', 'work days belong to accounts; a work actor has none');
  END IF;

  WITH visible AS (
    SELECT j.work_order_id, j.subject_roles FROM public.provider_job_ids(p_user_id, p_actor_id) j
    WHERE public.work_order_vehicle_open(j.vehicle_id) OR self
      OR cardinality(COALESCE((SELECT s.slots FROM public.work_order_viewer_slots(uid, j.work_order_id) s), '{}'::text[])) > 0
  ), paths AS (SELECT v.*, public.read_work_order_job_path(v.work_order_id) AS jp FROM visible v)
  SELECT jsonb_build_object('jobs', count(*),
      'by_role', COALESCE((SELECT jsonb_object_agg(role, n) FROM (SELECT unnest(subject_roles) role, count(*) n FROM visible GROUP BY 1) r), '{}'::jsonb),
      'completion', jsonb_build_object('recorded', count(*) FILTER (WHERE jp#>>'{stages,completion,state}' = 'recorded'),
        'status_only', count(*) FILTER (WHERE jp#>>'{stages,completion,state}' = 'status_only'),
        'absent', count(*) FILTER (WHERE jp#>>'{stages,completion,state}' = 'absent')),
      'in_progress', count(*) FILTER (WHERE jp#>>'{stages,execution,state}' = 'recorded' AND jp#>>'{stages,completion,state}' = 'absent'),
      'inconsistencies', COALESCE(sum((SELECT count(*) FROM jsonb_each(jp->'stages') st, jsonb_array_elements(st.value->'inconsistencies')
        WHERE st.key <> 'accounting')), 0),
      'basis', 'provider jobs (shop owner or evidenced performer); completion recorded means a completion clock exists, not client acceptance',
      'detail_reader', 'provider_job_record_read')
    INTO jobs FROM paths;

  RETURN jsonb_build_object(
    'viewer', public.job_reader_viewer(CASE WHEN self THEN 'self' ELSE 'visitor' END, '{}', public.viewer_identity_bridge(uid), false),
    'as_of', statement_timestamp(), 'subject', subject, 'claims', claims,
    'capabilities', jsonb_build_object('items', caps,
      'basis', 'evidence-derived capability records of the subject''s actor(s); self-claims are never counted here'),
    'tools', jsonb_build_object('seen_in_frame', seen, 'claimed_owned', owned,
      'co_signed', jsonb_build_object('supporting_attestations', cosigned,
        'basis', 'supporting statements by someone other than the subject about resources the subject supplies or performs; attributed by source testimony')),
    'facilities', facilities, 'identity_bridge', idb,
    'work_record', jsonb_build_object('days', sessions, 'jobs', jobs),
    'contact', jsonb_build_object('action', 'contact_via_nuke', 'available', false,
      'basis', 'contact between users is brokered by Nuke; contact fields are never exposed'),
    'coverage', jsonb_build_object(
      'claims', 'what the account or actor record states; not verified',
      'capabilities', jsonb_build_object('population', 'actor_capabilities rows of the subject''s actor(s)', 'rows', jsonb_array_length(caps),
        'not_assessed', jsonb_build_array('qualification', 'licensing currency', 'basis ids for existing rows')),
      'tools', jsonb_build_object('seen_in_frame', 'most recent 1,000 approved own photos on public vehicles',
        'not_assessed', jsonb_build_array('distinct physical tools', 'measured usage', 'tool value')),
      'facilities', CASE WHEN p_user_id IS NULL THEN 'not_assessed for a work actor' ELSE 'organization memberships and ownership of the account' END,
      'work_record', jsonb_build_object('days', 'work sessions on public vehicles (all vehicles for the subject themself)',
        'jobs', 'provider jobs on public vehicles, or where the viewer holds a slot',
        'not_assessed', jsonb_build_array('client acceptance', 'quality of outcome', 'labor time', 'payment'))),
    'money', 'not_reported');
END $$;
REVOKE ALL ON FUNCTION public.provider_profile_read(uuid, uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.provider_profile_read(uuid, uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.provider_profile_read(uuid, uuid) IS 'Open provider profile ("is this tech any good"): subject by handle/profile id or actor role, self-claims apart from evidence-derived capabilities, tools by rung, facilities, identity bridge, work days (capture span labelled) and provider jobs by completion state. No contact fields, no money; contact_via_nuke placeholder.';
NOTIFY pgrst, 'reload schema';
COMMIT;
