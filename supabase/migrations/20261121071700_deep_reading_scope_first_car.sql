-- Deep reading and keyed values on for one car, one open item a stage; a thin reading is not a tool frame.
--
-- Why. 20261120130000 and 20261120140000 put the two reading stages on the stage ledger with their scope row
-- (platform_config 'image_stage_deep_reading') off, so no photo has been read automatically past its first read.
-- image_stage_coverage on production, 2026-11-20 21:07 PST, for the canary car: 65 photos, 65 first-read, 0 deep
-- readings, 0 keyed values; 60 wait only on the scope ("out_of_scope"), 5 are not eligible (2 gate, 3 sensitive).
-- This turns the scope on for that car alone.
--
-- 1. Two readers count "frames analysed" from current image_deep_byok readings and list the tools seen in them:
--    user_tool_action_shots_read (the newest current reading of each photo) and provider_profile_read (every current
--    reading). The intake holds every reading whose tier is not a reviewed one to the thin shape, and the thin shape
--    must post workshop_signals.tools_visible = [] (guard_reviewed_image_analysis rule 1, image_reading_thin_violation):
--    that means "tools not read", not "no tools in the frame". Counted as a frame it would raise frames_analyzed with
--    nothing behind it, and where it is the newest reading of a photo it would hide the tools an older reading saw.
--    Both laterals now keep only a reading the intake let state its tools: image_reading_tier_is_reviewed(tier, true),
--    the function the guard itself uses (a reading with no tier is a legacy reading and counts; a missing
--    'image_reading_tiers' row changes nothing, as before this migration).
--    Each reader is written here in full: production's body of 2026-11-20 with that one line added to its frames
--    lateral (marked 20261121071700), so the repository's latest definition is the one production runs
--    (scripts/ci/function-drift-check.mjs). The migration refuses unless each live body is the one it was written
--    against (md5 of prosrc 9489f6d398c44dfe5d35e122e1b3eb42 and 1631cb05c272ca13f282100ae15c7e69) or already this one
--    (ac064c62d65f81c3b041b107b55a6941 and 9532ff0e15b8b434ec92014cc9b64da8), so nothing written to either reader in
--    between is overwritten. A refusal takes the scope switch with it.
--    Measured on production before this migration, 2026-11-20 21:15 to 22:02 PST:
--      * frames_analyzed for the owner's profile, logged-out view (q.sh, no caller identity): 647 and 582. The canary car
--        is not public, so that view cannot move from its readings. The signed-in owner's view is the one that would:
--        511 and 470 (each reader's frames lateral replicated in one SELECT with the public-vehicle test dropped).
--      * The same replicas with this predicate added return the same four numbers (647 and 511; 582 and 470), and
--        every current image_deep_byok reading on the owner's vehicles (22,752 readings, 5 tiers including none) is a
--        reviewed tier, so neither view moves at deploy.
--      * The check costs about 15 microseconds a reading: the 463 readings whose source_identifier begins
--        'reviewed_image_analysis_v1:' take 6.8 to 6.9 ms with it and 2.4 to 2.5 ms without (clock_timestamp inside one
--        statement, three runs).
-- 2. The scope row becomes: enabled true, the canary car alone in vehicle_ids (the proof vehicle leaves the list until
--    the follow-up named in the pull request lands), the same owner and excluded cars, and max_open 1, so each reading
--    stage holds one open item at a time (image_stage_stage_room). It is replaced only when it is exactly the row
--    20261120130000 inserted. A row that is already on is left as it is; a row that is off and different is refused.
-- 3. One item is queued through the ledger's own enqueue (enqueue_image_stage_work: the scope, the photo eligibility
--    rule, the stage room and the daily cap all apply). The migration refuses unless exactly one item was queued: a
--    switch that turned on and queued nothing is not a deploy. Run read-only on production with this row substituted
--    (2026-11-20 21:30 PST): 60 deep_reading gaps, 0 keyed_values gaps, 0 open items in the queue, daily cap left 150.
--
-- What this does not do. It does not stop after the first photo: with one open item a stage, the reconciler's
-- backfill lane offers the next photo of the car when its cursor crosses the car's photos (about three more within
-- about seven hours at the cursor's 2026-11-20 position, then about one pass a day). The first reading is read back by
-- hand before the follow-up raises max_open; the revert switches the scope off in its own transaction.
-- No photo of another car comes into scope: image_stage_scope_ok, called on production with this exact row before it
-- was written (2026-11-20 22:01 PST), answers true for the canary car and false for the proof vehicle, for a third car
-- of the same owner, for an unfiled photo, for both excluded cars and for another user. The admitted values
-- (image_reading_tiers) are untouched: an automatic reading keys a value only where both passes agree on surface rust.
-- The reader on the Mac needs no change (its full fire already passes a deep and a keyed limit).
-- Known readers of the same readings that still take a thin reading (none shows anything for a car that is not public,
-- has no work order and no acts; each is named in the pull request for the change that widens the scope):
-- get_user_day_receipt (the owner's own day view), actor_link_evidence_items, actor_link_claim_evidence_read,
-- read_work_order_image_objects, compute_auction_readiness, vehicles.observation_count.
-- Contract: supabase/sql/test_deep_reading_scope_first_car.sql
-- Revert: supabase/sql/revert_20261121071700_deep_reading_scope_first_car.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ===== 1. a thin reading is not a tool frame
do $do$
declare
  r record;
  v_md5 text;
begin
  if to_regprocedure('public.image_reading_tier_is_reviewed(text,boolean)') is null then
    raise exception 'image_reading_tier_is_reviewed(text,boolean) is not live (20261120140000 must be applied first)';
  end if;
  for r in select * from (values
      ('public.user_tool_action_shots_read(uuid,text,integer)', '9489f6d398c44dfe5d35e122e1b3eb42', 'ac064c62d65f81c3b041b107b55a6941'),
      ('public.provider_profile_read(uuid,uuid)', '1631cb05c272ca13f282100ae15c7e69', '9532ff0e15b8b434ec92014cc9b64da8')
    ) as t(fn, was, becomes)
  loop
    select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.fn);
    if v_md5 is null then raise exception '% is not live', r.fn; end if;
    if v_md5 not in (r.was, r.becomes) then
      raise exception '% is not the body this migration was written against (md5 %); refusing to replace it', r.fn, v_md5;
    end if;
  end loop;
end $do$;

CREATE OR REPLACE FUNCTION public.user_tool_action_shots_read(p_user_id uuid, p_label text DEFAULT NULL::text, p_per_label integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  self boolean := (auth.uid() IS NOT NULL AND auth.uid() = p_user_id) OR coalesce(auth.role(), '') = 'service_role';
  per_label integer := LEAST(GREATEST(COALESCE(p_per_label, 6), 1), 48);
  want text := NULLIF(regexp_replace(lower(btrim(p_label)), '^2-post\M', 'two-post'), '');
  result jsonb;
BEGIN
  WITH recent AS MATERIALIZED (
    SELECT vi.id, vi.taken_at, vi.vehicle_id, vi.image_url, vi.thumbnail_url, vi.medium_url,
      (vi.is_external IS NOT TRUE AND vi.vision_gate_status::text = 'approved' AND COALESCE(vi.is_sensitive, false) = false
        AND public.vehicle_image_gallery_eligible(vi)
        AND (self OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vi.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL))) AS eligible
    FROM public.vehicle_images vi
    WHERE vi.user_id = p_user_id AND vi.taken_at IS NOT NULL
    ORDER BY vi.taken_at DESC LIMIT 5000
  ), scanned AS MATERIALIZED (
    SELECT * FROM recent WHERE eligible ORDER BY taken_at DESC, id LIMIT 1000
  ), frames AS MATERIALIZED (
    SELECT s.*, o.tv FROM scanned s CROSS JOIN LATERAL (
      SELECT ob.structured_data#>'{workshop_signals,tools_visible}' AS tv FROM public.vehicle_observations ob
      WHERE (ob.structured_data->>'image_id') = s.id::text AND (ob.structured_data->>'analysis_kind') = 'image_deep_byok'
        AND ob.kind::text = 'condition' AND ob.is_superseded IS FALSE AND ob.source_id IS NOT NULL
        AND public.image_reading_tier_is_reviewed(ob.agent_tier, true)  -- (20261121071700) a thin reading's tools were not read
      ORDER BY ob.observed_at DESC NULLS LAST, ob.id LIMIT 1) o
  ), sightings AS (
    SELECT DISTINCT f.id AS image_id, f.taken_at, f.vehicle_id, f.image_url, f.thumbnail_url, f.medium_url,
      regexp_replace(lower(btrim(CASE jsonb_typeof(e) WHEN 'string' THEN e#>>'{}' ELSE COALESCE(e->>'label', e->>'name', e->>'tool') END)),
        '^2-post\M', 'two-post') AS label
    FROM frames f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.tv) = 'array' THEN f.tv ELSE '[]'::jsonb END) e
  ), kept AS (
    SELECT s.*, row_number() OVER (PARTITION BY s.label ORDER BY s.taken_at DESC, s.image_id) AS rn,
      count(*) OVER (PARTITION BY s.label) AS photos
    FROM sightings s WHERE NULLIF(s.label, '') IS NOT NULL AND (want IS NULL OR s.label = want)
  ), groups AS (
    SELECT k.label, max(k.photos) AS photos,
      jsonb_agg(jsonb_build_object('image_id', k.image_id, 'image_url', COALESCE(k.medium_url, k.image_url),
          'thumbnail_url', COALESCE(k.thumbnail_url, k.medium_url, k.image_url), 'taken_at', k.taken_at,
          'vehicle', (SELECT jsonb_build_object('label', NULLIF(concat_ws(' ', v.year, v.make, v.model), ''))
              || CASE WHEN self OR v.is_public IS TRUE THEN jsonb_build_object('vehicle_id', v.id) ELSE '{}'::jsonb END
            FROM public.vehicles v WHERE v.id = k.vehicle_id))
        ORDER BY k.taken_at DESC, k.image_id) FILTER (WHERE k.rn <= per_label) AS shots
    FROM kept k GROUP BY k.label
  )
  SELECT jsonb_build_object('user_id', p_user_id, 'as_of', statement_timestamp(), 'viewer', jsonb_build_object('self', self),
    'label_filter', want,
    'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', g.label, 'photos', g.photos, 'shots', g.shots)
      ORDER BY g.photos DESC, g.label) FROM groups g), '[]'::jsonb),
    'coverage', jsonb_build_object('recent_photos', (SELECT count(*) FROM recent), 'images_scanned', (SELECT count(*) FROM scanned),
      'frames_analyzed', (SELECT count(*) FROM frames),
      'photos_with_tools', (SELECT count(DISTINCT image_id) FROM sightings WHERE NULLIF(label, '') IS NOT NULL),
      'scan_cap', 1000, 'recent_cap', 5000, 'per_label', per_label),
    'basis', jsonb_build_object(
      'label', 'a tool type the image analysis saw in the frame (image_deep_byok workshop_signals); not an identified tool from the toolbox',
      'photos', 'distinct photos per label among the scanned photos; not distinct objects',
      'eligibility', 'approved, non-external, non-sensitive gallery photos; public vehicles only unless the viewer is the person'))
  INTO result;
  RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.provider_profile_read(p_user_id uuid DEFAULT NULL::uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
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

  caps := public.provider_capability_items(actor_ids);

  IF p_user_id IS NOT NULL THEN
    -- Walks idx_vehicle_images_user_taken_at backwards over the subject's most recent 5,000 timed photos; the
    -- LIMIT inside the lateral keeps one index probe per scanned photo (a flattened join scanned the observation index).
    WITH recent AS MATERIALIZED (
      SELECT vi.id, vi.taken_at, (vi.is_external IS FALSE AND vi.vision_gate_status = 'approved'
          AND (self OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vi.vehicle_id AND v.is_public IS TRUE))) AS eligible
      FROM public.vehicle_images vi
      WHERE vi.user_id = p_user_id AND vi.taken_at IS NOT NULL
      ORDER BY vi.taken_at DESC LIMIT 5000
    ), scanned AS MATERIALIZED (SELECT id FROM recent WHERE eligible ORDER BY taken_at DESC, id LIMIT 1000),
    frames AS MATERIALIZED (
      SELECT o.tv FROM scanned s CROSS JOIN LATERAL (
        SELECT ob.structured_data#>'{workshop_signals,tools_visible}' AS tv FROM public.vehicle_observations ob
        WHERE (ob.structured_data->>'image_id') = s.id::text AND (ob.structured_data->>'analysis_kind') = 'image_deep_byok'
          AND ob.kind::text = 'condition' AND ob.is_superseded IS FALSE AND ob.source_id IS NOT NULL
          AND public.image_reading_tier_is_reviewed(ob.agent_tier, true)  -- (20261121071700) a thin reading's tools were not read
        LIMIT 50) o
    ), sightings AS (
      SELECT lower(btrim(CASE jsonb_typeof(e) WHEN 'string' THEN e#>>'{}' ELSE COALESCE(e->>'label', e->>'name', e->>'tool') END)) AS label
      FROM frames f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.tv) = 'array' THEN f.tv ELSE '[]'::jsonb END) e
    )
    SELECT jsonb_build_object('occurrences', (SELECT count(*) FROM sightings),
      'frames_analyzed', (SELECT count(*) FROM frames),
      'frames_with_tools', (SELECT count(*) FROM frames WHERE jsonb_typeof(tv) = 'array' AND jsonb_array_length(tv) > 0),
      'top_labels', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', label, 'occurrences', n) ORDER BY n DESC, label)
        FROM (SELECT label, count(*) n FROM sightings WHERE NULLIF(label, '') IS NOT NULL GROUP BY label ORDER BY count(*) DESC, label LIMIT 10) t), '[]'::jsonb),
      'images_scanned', (SELECT count(*) FROM scanned), 'images_eligible', (SELECT count(*) FROM recent WHERE eligible), 'scan_cap', 1000,
      'eligible_window', jsonb_build_object('recent_photos', (SELECT count(*) FROM recent), 'cap', 5000,
        'basis', 'images_eligible counts eligible photos among the subject''s most recent 5,000 photos with a capture time'),
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
      SELECT jsonb_build_object('relation_kind', 'member', 'organization_id', oc.organization_id,
          'name', COALESCE(o.business_name, o.name), 'type', o.business_type, 'role', oc.role,
          'membership_status', oc.status,
          'city', CASE WHEN o.is_public IS TRUE THEN o.city END, 'state', CASE WHEN o.is_public IS TRUE THEN o.state END,
          'relation', jsonb_build_object('weight', public.relation_weight(ev.last_at, now()),
            'state', public.relation_state(public.relation_weight(ev.last_at, now())),
            'last_contribution_at', ev.last_at, 'window_days', 14),
          'actor_profile', CASE WHEN o.is_public IS TRUE THEN jsonb_build_object('reader', 'actor_profile_read', 'kind', 'organization', 'id', o.id) END) AS m
      FROM public.organization_contributors oc
      LEFT JOIN public.organizations o ON o.id = oc.organization_id
      -- The user_org_relations sources over 14 days: relation weight is exactly 0 after 50 half-lives (12.5 days).
      LEFT JOIN LATERAL (SELECT max(at) AS last_at FROM (
          SELECT sp.taken_at AS at FROM public.org_site_photos(oc.organization_id, p_user_id, now() - interval '14 days', now()) sp
            WHERE sp.shared_with = 0 OR sp.vehicle_linked OR sp.vehicle_id IS NULL
          UNION ALL SELECT COALESCE(oi.taken_at, oi.created_at) FROM public.organization_images oi
            WHERE oi.organization_id = oc.organization_id AND oi.user_id = p_user_id
              AND COALESCE(oi.taken_at, oi.created_at) > now() - interval '14 days' AND COALESCE(oi.taken_at, oi.created_at) <= now()
          UNION ALL SELECT (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' FROM public.timeline_events te
            WHERE te.organization_id = oc.organization_id AND te.user_id = p_user_id
              AND te.event_date >= (now() - interval '14 days')::date AND (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' <= now()
          UNION ALL SELECT (cw.work_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' FROM public.contractor_work_contributions cw
            WHERE cw.organization_id = oc.organization_id AND cw.contractor_user_id = p_user_id
              AND cw.work_date >= (now() - interval '14 days')::date AND (cw.work_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' <= now()) s) ev ON true
      WHERE oc.user_id = p_user_id
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
      'co_signed', jsonb_build_object('supporting_attestations', cosigned, 'authenticated_attestations', public.provider_authenticated_cosigns(p_user_id, actor_ids), 'authenticated_basis', 'of these, statements signed by the attestor or an owner/member of the attesting organization (cosign_provider)',
        'basis', 'supporting statements by someone other than the subject about resources the subject supplies or performs; attributed by source testimony')),
    'facilities', facilities, 'vouched_for_by', public.provider_vouches_for_viewer(public.provider_vouched_for_by(p_user_id, actor_ids), uid), 'identity_bridge', idb,
    'availability', public.provider_availability_summary(p_user_id), 'service_area', public.provider_service_area_band(p_user_id),
    'work_record', jsonb_build_object('days', sessions, 'jobs', jobs),
    'contact', jsonb_build_object('action', 'contact_via_nuke',
      'available', uid IS NOT NULL AND NOT self AND cardinality(public.contact_recipient_users(p_user_id, p_actor_id, NULL)) > 0
        AND NOT (uid = ANY (public.contact_recipient_users(p_user_id, p_actor_id, NULL))),
      'request', jsonb_build_object('writer', 'request_contact', 'context_kind', 'profile', 'context_id', COALESCE(p_user_id, p_actor_id),
        'recipient_user_id', p_user_id, 'recipient_actor_id', p_actor_id),
      'basis', 'contact between users is brokered by Nuke; contact fields are never exposed'),
    'coverage', jsonb_build_object(
      'claims', 'what the account or actor record states; not verified',
      'capabilities', jsonb_build_object('population', 'actor_capabilities rows of the subject''s actor(s)', 'rows', jsonb_array_length(caps),
        'not_assessed', jsonb_build_array('qualification', 'licensing currency', 'basis ids for legacy hand-entered rows'),
        'derived', jsonb_build_object('rows', (SELECT count(*) FROM jsonb_array_elements(caps) x WHERE x->>'derivation' = 'evidence_fold'),
          'strengths', 'direct: customer-accepted provider completion, accepted-inspector findings or a performer-signed report; corroborating: attributed records',
          'never_counted', jsonb_build_array('self-claims', 'profile expertise', 'vouches', 'co-signs', 'offers'))),
      'tools', jsonb_build_object('seen_in_frame', 'most recent 1,000 approved own photos on public vehicles, among the most recent 5,000 timed photos',
        'not_assessed', jsonb_build_array('distinct physical tools', 'measured usage', 'tool value')),
      'facilities', CASE WHEN p_user_id IS NULL THEN 'not_assessed for a work actor' ELSE 'organization memberships and ownership of the account; relation from contributions in the last 14 days' END,
      'work_record', jsonb_build_object('days', 'work sessions on public vehicles (all vehicles for the subject themself)',
        'jobs', 'provider jobs on public vehicles, or where the viewer holds a slot',
        'not_assessed', jsonb_build_array('client acceptance', 'quality of outcome', 'labor time', 'payment'))),
    'money', 'not_reported');
END $function$;

-- The bodies above are the ones this file names, byte for byte (an editor that touched their whitespace stops here).
do $do$
declare
  r record;
  v_md5 text;
begin
  for r in select * from (values
      ('public.user_tool_action_shots_read(uuid,text,integer)', 'ac064c62d65f81c3b041b107b55a6941'),
      ('public.provider_profile_read(uuid,uuid)', '9532ff0e15b8b434ec92014cc9b64da8')
    ) as t(fn, becomes)
  loop
    select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.fn);
    if v_md5 is distinct from r.becomes then
      raise exception '% did not become the body this migration names (md5 %)', r.fn, coalesce(v_md5, 'null');
    end if;
  end loop;
end $do$;

-- ===== 2 and 3. the scope, on for one car with one open item a stage, and its first item
do $do$
declare
  v_old jsonb;
  v_n int;
  v_car constant uuid := '67127bcb-1f2b-4472-ae4f-a2b86825027b';
  v_off constant jsonb := '{"enabled": false,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b", "20d21fb0-4651-4469-a0ba-e751309a1e54"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}';
  v_on constant jsonb := '{"enabled": true, "max_open": 1,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}';
begin
  if to_regprocedure('public.enqueue_image_stage_work(uuid[],text)') is null then
    raise exception 'enqueue_image_stage_work(uuid[],text) is not live (20261120130000 must be applied first)';
  end if;
  select config_value into v_old from public.platform_config where config_key = 'image_stage_deep_reading' for update;
  if not found then
    raise exception 'platform_config image_stage_deep_reading is missing (20261120130000 must be applied first)';
  end if;
  if v_old -> 'enabled' = 'true'::jsonb then
    raise notice 'the reading scope is already on; left as it is and nothing queued here: %', v_old;
  elsif v_old is distinct from v_off then
    raise exception 'platform_config image_stage_deep_reading is off but is not the row 20261120130000 inserted; refusing to replace it: %', v_old;
  else
    update public.platform_config set config_value = v_on, updated_at = now() where config_key = 'image_stage_deep_reading';
    select public.enqueue_image_stage_work(array(select v.id from public.vehicle_images v where v.vehicle_id = v_car), 'backfill') into v_n;
    if v_n is distinct from 1 then
      raise exception 'the switch queued % reading-stage item(s) for the first car, not exactly 1; refusing it', coalesce(v_n::text, 'null');
    end if;
    raise notice 'reading scope on for one car; % item queued', v_n;
  end if;
end $do$;

commit;
