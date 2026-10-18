-- P3.7 — identity inside the writers any signed-in account could run (2026-09-27)
--
-- P0.4 left 35 writing functions executable by `authenticated` that never looked at who was calling.
-- This migration puts the check inside each live one and revokes the dead or service-only ones.
-- A service_role caller (edge functions) or a postgres session (cron, CI) is exempt from every check.
-- Rehearsed on prod in a rolled-back transaction: stranger refused with the message below, legitimate
-- caller unchanged, service_role unchanged.
--
-- GUARDED (14 signatures) — rule / who calls it:
--   add_dynamic_vehicle_field(p_vehicle_id uuid, p_field_name text, p_field_value text, p_): an editor of the vehicle (user_can_edit_vehicle) or an admin — web dynamicFieldService (FieldAuditTrail)
--   approve_pending_assignment(p_assignment_id uuid, p_user_id uuid, p_notes text): the caller acts as themself (p_user_id = auth.uid()) and is an active contributor of the assignment's organization, or an admin — web NotificationCenter (p_user_id = user.id)
--   award_achievement(user_uuid uuid, achievement_type_param text, achievement_tit): the user themself (user_uuid = auth.uid()); stays SECURITY INVOKER so RLS on profile_achievements still applies — web eventPipeline (imageTrackingService → ImageTrackingBackfill), user_uuid = current user — stays SECURITY INVOKER
--   ensure_field_evidence(p_vehicle_id uuid): any signed-in user (the write is a derived backfill of the vehicle's own fields, capped at 5 rows; no caller data lands) — web useFieldEvidence on vehicle pages
--   generate_invite_code(p_business_id uuid, p_created_by uuid, p_role_type text, p_m): the caller acts as themself (p_created_by = auth.uid()) and is an active owner/manager of the business, or an admin; stays SECURITY INVOKER — web RestorationIntake (p_created_by = session.user.id) — stays SECURITY INVOKER
--   increment_document_stat(p_document_id uuid, p_stat_type text): any signed-in user (view/download/bookmark counters); stays SECURITY INVOKER — web Library / referenceDocumentService — stays SECURITY INVOKER
--   log_contribution(user_uuid uuid, contribution_type_param text, related_vehicl): the user themself (user_uuid = auth.uid()); stays SECURITY INVOKER (RLS on user_contributions) — web eventPipeline, user_uuid = current user — stays SECURITY INVOKER
--   log_vehicle_edit(p_vehicle_id uuid, p_field_name text, p_old_value text, p_ne): the editor is the caller (p_user_id = auth.uid()) — web UniversalFieldEditor (p_user_id = user.id)
--   mark_all_notifications_read(p_user_id uuid): the user themself — web NotificationCenter (p_user_id = user.id)
--   mark_notification_read(p_user_id uuid, p_notification_id uuid): the user themself — web NotificationCenter (p_user_id = user.id)
--   merge_duplicate_vehicles(p_primary_id uuid, p_duplicate_id uuid, p_user_id uuid): the caller acts as themself and is an admin, or can edit BOTH vehicles (user_can_edit_vehicle) — web VehicleMergeInterface (Profile / UserWorkspaceContent), p_user_id = userId
--   reject_pending_assignment(p_assignment_id uuid, p_user_id uuid, p_notes text): same as approve_pending_assignment — web NotificationCenter (p_user_id = user.id)
--   relink_testimony(p_observation_type text, p_observation_id uuid, p_target_veh): the actor is the caller (p_actor_user_id = auth.uid()) and can edit the target vehicle; stays SECURITY INVOKER so RLS still governs the source rows — iOS SupabaseService (p_actor_user_id = uid); edge agent-chat as the user — stays SECURITY INVOKER
--   unmerge_vehicle(p_proposal_id uuid): an admin, or an editor of the proposal's primary vehicle; stays SECURITY INVOKER — web MergeHistoryBanner (imported nowhere today) — stays SECURITY INVOKER
--
-- REVOKED from PUBLIC, anon, authenticated (22 signatures) — service_role / postgres keep EXECUTE:
--   add_activity_feed_item(p_user_id uuid, p_activity_type text, p_title text, p_descri): dead: user_activity_feed dropped; web wrapper addActivityFeedItem has no callers
--   add_chat_message(stream_id_param uuid, user_id_param uuid, message_param text): dead: live_streams / stream_chat dropped; LiveStreamViewer is imported nowhere
--   admin_approve_ownership_verification(p_notification_id uuid, p_admin_user_id uuid, p_admin_notes ): dead: calls approve_ownership_verification (dropped tables); also bound p_admin_user_id to nothing
--   admin_reject_ownership_verification(p_notification_id uuid, p_admin_user_id uuid, p_rejection_re): dead: verification_audit_log dropped
--   approve_ownership_verification(p_verification_id uuid, p_reviewer_id uuid, p_review_notes t): dead: verification_queue / verification_audit_log dropped
--   backfill_user_profile_stats(p_user_id uuid): dead: success_stories dropped (extract-bat-profile-vehicles calls it as service_role and already gets that error)
--   backfill_work_sessions_from_photos(p_vehicle_id uuid, p_owner_id uuid): service-only: no web/iOS/edge caller; migrations-era backfill run as postgres
--   create_notification(p_user_id uuid, p_type text, p_title text, p_message text, p): dead: the 8-arg overload writes user_notifications (dropped); the 10-arg overload inserts a recipient_id column that notifications no longer has (rehearsal 42703)
--   create_notification(recipient_id_param uuid, sender_id_param uuid, type_param no): dead: the 8-arg overload writes user_notifications (dropped); the 10-arg overload inserts a recipient_id column that notifications no longer has (rehearsal 42703)
--   create_user_request(p_requester_id uuid, p_target_user_id uuid, p_request_type t): dead: user_requests dropped; wrapper createUserRequest has no callers
--   deduct_cash_from_user(p_user_id uuid, p_amount_cents bigint, p_transaction_type te): kept dark on the lead's call: its callers are buy_bond / stake_on_vehicle / purchase_* / send_content_action, the deleted trading, betting and vault features (.claude/rules/platform-hygiene.md 'Deleted Features'); it has been throwing 42P01 since an earlier search_path='' pass, and un-breaking a money path is Skylar's decision, not a side effect of a security fix — definition left exactly as prod has it
--   derive_work_sessions(p_vehicle_id uuid): service-only: no web/iOS/edge caller; one script runs it with the service key
--   finalize_work_session(session_id uuid): service-only: no web/iOS/edge caller
--   generate_spending_analytics(target_user_id uuid, target_vehicle_id uuid, start_date time): dead: spending_analytics dropped; SpendingDashboard is imported nowhere
--   increment_device_image_count(fingerprint text): service-only: no web/iOS/edge caller
--   join_stream(stream_id_param uuid, viewer_id_param uuid, viewer_ip_param ): dead: live_streams / stream_viewers dropped
--   log_quick_action(p_user_id uuid, p_action_type text, p_action_data jsonb, p_v): dead: user_quick_actions dropped; wrapper logQuickAction has no callers
--   update_follow_roi_tracking(p_subscription_id uuid): dead: user_subscriptions / follow_roi_tracking / calculate_follow_roi dropped
--   update_organization_profile_stats(p_org_id uuid): dead: auction_bids / bat_comments / success_stories dropped; wrapper has no callers
--   update_user_profile_stats(p_user_id uuid): dead: auction_bids / bat_comments / success_stories dropped; wrapper has no callers
--   update_vehicle_relationship(p_vehicle_id uuid, p_user_id uuid, p_relationship_type text): dead: its UPSERT sets discovered_vehicles.updated_at, a column the table no longer has (rehearsal 42703)
--   verify_shop(p_shop_id uuid): dead: shops dropped; the AdminVerifications button already fails
--   What this changes for users: the web call sites of the dead ones already fail (missing tables); they now
--   fail with 42501 instead. The four work-session helpers had no caller outside migrations/scripts.
--   deduct_cash_from_user is revoked, not repaired: see its line above.
--
-- FOLLOW-UP (not fixed here): a catalog scan (pg_proc, schema public) finds 77 function signatures (75 names) with
--   search_path='' whose bodies reference a public relation unqualified — each throws 42P01 on every call.
--   The two helpers below are the only ones repaired in this file (get_user_cash_balance is a read).
--
-- REPAIRED helper (search_path only): get_user_cash_balance: same earlier pass: search_path='' over an unqualified body (user_cash_balances) — every call, including deduct_cash_from_user's, raised 42P01; re-pinned to public, pg_tempuser_can_edit_vehicle: an earlier hardening pass set search_path='' on a body that references vehicles/vehicle_contributors unqualified, so every call raised 'relation vehicles does not exist'; re-pinned to public, pg_temp — semantics unchanged
--
-- Conventions: SECURITY DEFINER where the check fully decides authorization (self-scoped or admin/editor
--   checks); SECURITY INVOKER kept where RLS on the written rows is still doing part of the job
--   (relink_testimony source rows, notifications, achievements, invite codes, document counters, unmerge).
--   search_path pinned on every rewritten function ('' kept where it already was, else public, pg_temp).
-- Reversal: previous definitions are in git history (supabase/migrations) and pg_get_functiondef before
--   17:00Z 2026-09-27 in the P3.7 session notes; GRANT EXECUTE … TO authenticated restores the revoked ones.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_user_cash_balance(p_user_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  available BIGINT;
BEGIN
  SELECT COALESCE(available_cents, 0) INTO available
  FROM user_cash_balances
  WHERE user_id = p_user_id;
  
  RETURN COALESCE(available, 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.user_can_edit_vehicle(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_can_edit BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = p_vehicle_id
      AND (
        v.uploaded_by = p_user_id
        OR v.user_id = p_user_id
        OR v.owner_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v.id
            AND vc.user_id = p_user_id
            AND vc.status = 'active'
            AND vc.can_edit = true
        )
        OR EXISTS (
          SELECT 1 FROM vehicle_contributor_roles vcr
          WHERE vcr.vehicle_id = v.id
            AND vcr.user_id = p_user_id
            AND vcr.role IN ('owner', 'restorer', 'contributor', 'moderator')
            AND (vcr.end_date IS NULL OR vcr.end_date > CURRENT_DATE)
        )
        OR EXISTS (
          SELECT 1 FROM organization_vehicles ov
          WHERE ov.vehicle_id = v.id
            AND EXISTS (
              SELECT 1 FROM organization_contributors oc
              WHERE oc.organization_id = ov.organization_id
                AND oc.user_id = p_user_id
                AND oc.status = 'active'
                AND oc.role IN ('owner', 'manager', 'employee')
            )
        )
      )
  ) INTO v_can_edit;
  
  RETURN COALESCE(v_can_edit, false);
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.add_activity_feed_item(p_user_id uuid, p_activity_type text, p_title text, p_description text, p_vehicle_id uuid, p_metadata jsonb) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.add_chat_message(stream_id_param uuid, user_id_param uuid, message_param text, timestamp_offset_param integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.add_dynamic_vehicle_field(p_vehicle_id uuid, p_field_name text, p_field_value text, p_field_type text DEFAULT 'text'::text, p_field_category text DEFAULT 'other'::text, p_source_type text DEFAULT 'ai_extraction'::text, p_source_url text DEFAULT NULL::text, p_source_image_id uuid DEFAULT NULL::uuid, p_extraction_method text DEFAULT NULL::text, p_raw_text text DEFAULT NULL::text, p_ai_reasoning text DEFAULT NULL::text, p_confidence numeric DEFAULT 0.8, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    field_source_id UUID;
BEGIN
  -- P3.7 identity check (2026-09-27): an editor of the vehicle (user_can_edit_vehicle) or an admin. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR NOT (public.user_can_edit_vehicle(p_vehicle_id, auth.uid()) OR public.is_admin_or_moderator()) THEN
      RAISE EXCEPTION 'add_dynamic_vehicle_field: only an editor of this vehicle can add a field' USING ERRCODE = '42501';
    END IF;
  END IF;
    -- Insert or update dynamic field
    INSERT INTO vehicle_dynamic_data (
        vehicle_id, field_name, field_value, field_type, field_category
    ) VALUES (
        p_vehicle_id, p_field_name, p_field_value, p_field_type, p_field_category
    )
    ON CONFLICT (vehicle_id, field_name) 
    DO UPDATE SET 
        field_value = EXCLUDED.field_value,
        field_type = EXCLUDED.field_type,
        field_category = EXCLUDED.field_category,
        updated_at = NOW();

    -- Track the source
    INSERT INTO vehicle_field_sources (
        vehicle_id, field_name, source_type, confidence_score,
        source_url, source_image_id, extraction_method,
        raw_extracted_text, ai_reasoning, user_id
    ) VALUES (
        p_vehicle_id, p_field_name, p_source_type, p_confidence,
        p_source_url, p_source_image_id, p_extraction_method,
        p_raw_text, p_ai_reasoning, p_user_id
    )
    RETURNING id INTO field_source_id;

    RETURN field_source_id;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.admin_approve_ownership_verification(p_notification_id uuid, p_admin_user_id uuid, p_admin_notes text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_reject_ownership_verification(p_notification_id uuid, p_admin_user_id uuid, p_rejection_reason text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_ownership_verification(p_verification_id uuid, p_reviewer_id uuid, p_review_notes text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_pending_assignment(p_assignment_id uuid, p_user_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_assignment RECORD;
BEGIN
  -- P3.7 identity check (2026-09-27): the caller acts as themself (p_user_id = auth.uid()) and is an active contributor of the assignment's organization, or an admin. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() OR NOT (public.is_admin_or_moderator() OR EXISTS (SELECT 1 FROM public.pending_vehicle_assignments pa JOIN public.organization_contributors oc ON oc.organization_id = pa.organization_id WHERE pa.id = p_assignment_id AND oc.user_id = auth.uid() AND coalesce(oc.status, 'active') = 'active')) THEN
      RAISE EXCEPTION 'approve_pending_assignment: only a contributor of that organization (acting as themself) can approve' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Get assignment
  SELECT * INTO v_assignment
  FROM pending_vehicle_assignments
  WHERE id = p_assignment_id
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found or already processed';
  END IF;
  
  -- Create organization_vehicles record
  INSERT INTO organization_vehicles (
    organization_id,
    vehicle_id,
    relationship_type,
    auto_tagged,
    gps_match_confidence,
    linked_by_user_id,
    status
  )
  VALUES (
    v_assignment.organization_id,
    v_assignment.vehicle_id,
    v_assignment.suggested_relationship_type,
    true,
    v_assignment.overall_confidence,
    p_user_id,
    'active'
  )
  ON CONFLICT (organization_id, vehicle_id, relationship_type)
  DO UPDATE SET
    gps_match_confidence = GREATEST(
      organization_vehicles.gps_match_confidence,
      v_assignment.overall_confidence
    ),
    auto_tagged = true,
    status = 'active',
    updated_at = NOW();
  
  -- Update assignment status
  UPDATE pending_vehicle_assignments
  SET 
    status = 'approved',
    reviewed_by_user_id = p_user_id,
    reviewed_at = NOW(),
    review_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_assignment_id;
  
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.award_achievement(user_uuid uuid, achievement_type_param text, achievement_title_param text DEFAULT NULL::text, achievement_description_param text DEFAULT NULL::text, points_param integer DEFAULT 0)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  default_title TEXT;
  default_description TEXT;
  default_points INTEGER;
BEGIN
  -- P3.7 identity check (2026-09-27): the user themself (user_uuid = auth.uid()); stays SECURITY INVOKER so RLS on profile_achievements still applies. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR user_uuid IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'award_achievement: you can only record achievements for yourself' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Set defaults based on achievement type
  CASE achievement_type_param
    WHEN 'first_vehicle' THEN
      default_title := 'First Vehicle';
      default_description := 'Added your first vehicle to the platform';
      default_points := 10;
    WHEN 'profile_complete' THEN
      default_title := 'Profile Complete';
      default_description := 'Completed your profile information';
      default_points := 25;
    WHEN 'first_image' THEN
      default_title := 'First Image';
      default_description := 'Uploaded your first vehicle image';
      default_points := 5;
    WHEN 'contributor' THEN
      default_title := 'Contributor';
      default_description := 'Made your first contribution to the platform';
      default_points := 15;
    WHEN 'vehicle_collector' THEN
      default_title := 'Vehicle Collector';
      default_description := 'Added 5 or more vehicles';
      default_points := 20;
    WHEN 'image_enthusiast' THEN
      default_title := 'Image Enthusiast';
      default_description := 'Uploaded 25 or more images';
      default_points := 15;
    WHEN 'community_member' THEN
      default_title := 'Community Member';
      default_description := 'Active community participant';
      default_points := 10;
    WHEN 'verified_user' THEN
      default_title := 'Verified User';
      default_description := 'Completed ownership verification';
      default_points := 5;
    ELSE
      default_title := 'Achievement';
      default_description := 'Earned an achievement';
      default_points := 0;
  END CASE;
  
  -- Insert achievement (will fail silently if duplicate due to UNIQUE constraint)
  INSERT INTO profile_achievements (
    user_id, achievement_type, achievement_title, achievement_description, points_awarded
  ) VALUES (
    user_uuid, 
    achievement_type_param,
    COALESCE(achievement_title_param, default_title),
    COALESCE(achievement_description_param, default_description),
    COALESCE(points_param, default_points)
  ) ON CONFLICT (user_id, achievement_type) DO NOTHING;
  
  -- Log activity
  INSERT INTO profile_activity (
    user_id, activity_type, activity_title, activity_description
  ) VALUES (
    user_uuid, 'achievement_earned', 
    'Earned: ' || COALESCE(achievement_title_param, default_title),
    COALESCE(achievement_description_param, default_description)
  );
  
  RETURN true;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.backfill_user_profile_stats(p_user_id uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.backfill_work_sessions_from_photos(p_vehicle_id uuid, p_owner_id uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_notification(p_user_id uuid, p_type text, p_title text, p_message text, p_vehicle_id uuid, p_related_user_id uuid, p_metadata jsonb, p_priority integer) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_notification(recipient_id_param uuid, sender_id_param uuid, type_param notification_type, title_param text, body_param text, action_url_param text, entity_type_param text, entity_id_param uuid, group_key_param text, priority_param notification_priority) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_user_request(p_requester_id uuid, p_target_user_id uuid, p_request_type text, p_title text, p_description text, p_vehicle_id uuid, p_request_data jsonb) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.deduct_cash_from_user(p_user_id uuid, p_amount_cents bigint, p_transaction_type text, p_reference_id uuid, p_stripe_payout_id text, p_metadata jsonb) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.derive_work_sessions(p_vehicle_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_field_evidence(p_vehicle_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vin TEXT;
  v_row RECORD;
  v_existing_count INT;
  v_inserted INT := 0;
  v_batch INT;
  v_source_type TEXT;
BEGIN
  -- P3.7 identity check (2026-09-27): any signed-in user (the write is a derived backfill of the vehicle's own fields, capped at 5 rows; no caller data lands). Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'ensure_field_evidence: sign in first' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT count(*) INTO v_existing_count
  FROM field_evidence WHERE vehicle_id = p_vehicle_id;
  
  IF v_existing_count >= 5 THEN
    RETURN v_existing_count;
  END IF;

  SELECT * INTO v_row FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  v_vin := v_row.vin;

  v_source_type := CASE
    WHEN v_row.bat_auction_url IS NOT NULL THEN 'bat_listing'
    WHEN v_row.discovery_source ILIKE '%craigslist%' THEN 'craigslist'
    WHEN v_row.listing_source IS NOT NULL THEN v_row.listing_source
    ELSE 'vehicle_record'
  END;

  -- 1. Populate from vehicles table current values
  WITH vehicle_fields(fn, fv) AS (
    VALUES
      ('vin', v_row.vin::TEXT),
      ('year', v_row.year::TEXT),
      ('make', v_row.make::TEXT),
      ('model', v_row.model::TEXT),
      ('engine_type', v_row.engine_type::TEXT),
      ('engine_size', v_row.engine_size::TEXT),
      ('transmission', v_row.transmission::TEXT),
      ('drivetrain', v_row.drivetrain::TEXT),
      ('fuel_type', v_row.fuel_type::TEXT),
      ('fuel_system_type', v_row.fuel_system_type::TEXT),
      ('color', v_row.color::TEXT),
      ('interior_color', v_row.interior_color::TEXT),
      ('mileage', v_row.mileage::TEXT),
      ('body_style', v_row.body_style::TEXT),
      ('sale_price', v_row.sale_price::TEXT),
      ('trim', v_row.trim::TEXT)
  )
  INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, extracted_at)
  SELECT
    p_vehicle_id, vf.fn, vf.fv, v_source_type, 75,
    'Vehicle record: ' || v_source_type, v_row.created_at
  FROM vehicle_fields vf
  WHERE vf.fv IS NOT NULL AND length(trim(vf.fv)) > 0 AND vf.fv != '0'
    AND NOT EXISTS (
      SELECT 1 FROM field_evidence fe
      WHERE fe.vehicle_id = p_vehicle_id AND fe.field_name = vf.fn
    );
  GET DIAGNOSTICS v_batch = ROW_COUNT;
  v_inserted := v_inserted + v_batch;

  -- 2. Populate from vin_decoded_data (NHTSA, highest confidence)
  IF v_vin IS NOT NULL AND length(v_vin) >= 10 THEN
    WITH vin_fields AS (
      SELECT fn, fv FROM (
        SELECT 'year' AS fn, vd.year::TEXT AS fv FROM vin_decoded_data vd WHERE vd.vin = v_vin
        UNION ALL SELECT 'make', vd.make FROM vin_decoded_data vd WHERE vd.vin = v_vin AND vd.make IS NOT NULL
        UNION ALL SELECT 'model', vd.model FROM vin_decoded_data vd WHERE vd.vin = v_vin AND vd.model IS NOT NULL
        UNION ALL SELECT 'trim', vd.trim FROM vin_decoded_data vd WHERE vd.vin = v_vin AND vd.trim IS NOT NULL
        UNION ALL SELECT 'body_style', vd.body_type FROM vin_decoded_data vd WHERE vd.vin = v_vin AND vd.body_type IS NOT NULL
        UNION ALL SELECT 'engine_size', vd.engine_size FROM vin_decoded_data vd WHERE vd.vin = v_vin AND vd.engine_size IS NOT NULL
        UNION ALL SELECT 'fuel_type', vd.fuel_type FROM vin_decoded_data vd WHERE vd.vin = v_vin AND vd.fuel_type IS NOT NULL
        UNION ALL SELECT 'transmission', vd.transmission FROM vin_decoded_data vd WHERE vd.vin = v_vin AND vd.transmission IS NOT NULL
        UNION ALL SELECT 'drivetrain', vd.drivetrain FROM vin_decoded_data vd WHERE vd.vin = v_vin AND vd.drivetrain IS NOT NULL
      ) sub WHERE fv IS NOT NULL AND length(trim(fv)) > 0
    )
    INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, extracted_at)
    SELECT
      p_vehicle_id, vf.fn, vf.fv, 'nhtsa_vin_decode', 100,
      'VIN decode: ' || v_vin,
      (SELECT decoded_at FROM vin_decoded_data WHERE vin = v_vin LIMIT 1)
    FROM vin_fields vf
    WHERE NOT EXISTS (
      SELECT 1 FROM field_evidence fe
      WHERE fe.vehicle_id = p_vehicle_id AND fe.field_name = vf.fn AND fe.source_type = 'nhtsa_vin_decode'
    );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_inserted := v_inserted + v_batch;
  END IF;

  -- 3. Populate from vehicle_field_sources (legacy provenance)
  INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, extracted_at)
  SELECT
    vfs.vehicle_id, vfs.field_name, vfs.field_value, vfs.source_type,
    LEAST(vfs.confidence_score, 100),
    COALESCE(vfs.extraction_method, 'Legacy field source'),
    vfs.created_at
  FROM vehicle_field_sources vfs
  WHERE vfs.vehicle_id = p_vehicle_id
    AND vfs.field_value IS NOT NULL AND length(trim(vfs.field_value)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM field_evidence fe
      WHERE fe.vehicle_id = p_vehicle_id AND fe.field_name = vfs.field_name AND fe.source_type = vfs.source_type
    );
  GET DIAGNOSTICS v_batch = ROW_COUNT;
  v_inserted := v_inserted + v_batch;

  RETURN v_inserted;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.finalize_work_session(session_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_invite_code(p_business_id uuid, p_created_by uuid DEFAULT NULL::uuid, p_role_type text DEFAULT 'technician'::text, p_max_uses integer DEFAULT 10, p_expires_days integer DEFAULT 30)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_code text;
    v_codes_last_24h int;
    v_rate_limit int := 20;
BEGIN
  -- P3.7 identity check (2026-09-27): the caller acts as themself (p_created_by = auth.uid()) and is an active owner/manager of the business, or an admin; stays SECURITY INVOKER. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_created_by IS DISTINCT FROM auth.uid() OR NOT (public.is_admin_or_moderator() OR EXISTS (SELECT 1 FROM public.organization_contributors oc WHERE oc.organization_id = p_business_id AND oc.user_id = auth.uid() AND coalesce(oc.status, 'active') = 'active' AND oc.role IN ('owner', 'manager'))) THEN
      RAISE EXCEPTION 'generate_invite_code: only an owner or manager of this business can create invite codes' USING ERRCODE = '42501';
    END IF;
  END IF;
    -- Check rate limit: max 20 codes per business per 24 hours
    SELECT COUNT(*) INTO v_codes_last_24h
    FROM business_invite_codes
    WHERE business_id = p_business_id
      AND created_at > now() - interval '24 hours';

    IF v_codes_last_24h >= v_rate_limit THEN
        RAISE EXCEPTION 'Rate limit exceeded: You can only generate % invite codes per 24 hours. Please try again later.', v_rate_limit;
    END IF;

    -- Generate 8-char uppercase code
    v_code := upper(substr(md5(random()::text), 1, 8));

    INSERT INTO business_invite_codes (
        business_id, code, created_by, role_type, max_uses, expires_at
    ) VALUES (
        p_business_id, v_code, p_created_by, p_role_type, p_max_uses,
        now() + (p_expires_days || ' days')::interval
    );

    RETURN v_code;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.generate_spending_analytics(target_user_id uuid, target_vehicle_id uuid, start_date timestamp with time zone, end_date timestamp with time zone) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_device_image_count(fingerprint text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_document_stat(p_document_id uuid, p_stat_type text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- P3.7 identity check (2026-09-27): any signed-in user (view/download/bookmark counters); stays SECURITY INVOKER. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'increment_document_stat: sign in first' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_stat_type = 'view' THEN
    UPDATE library_documents SET view_count = view_count + 1 WHERE id = p_document_id;
  ELSIF p_stat_type = 'download' THEN
    UPDATE library_documents SET download_count = download_count + 1 WHERE id = p_document_id;
  ELSIF p_stat_type = 'bookmark' THEN
    UPDATE library_documents SET bookmark_count = bookmark_count + 1 WHERE id = p_document_id;
  END IF;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.join_stream(stream_id_param uuid, viewer_id_param uuid, viewer_ip_param inet, user_agent_param text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_contribution(user_uuid uuid, contribution_type_param text, related_vehicle_uuid uuid DEFAULT NULL::uuid, contribution_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- P3.7 identity check (2026-09-27): the user themself (user_uuid = auth.uid()); stays SECURITY INVOKER (RLS on user_contributions). Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR user_uuid IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'log_contribution: you can only log contributions as yourself' USING ERRCODE = '42501';
    END IF;
  END IF;
  INSERT INTO user_contributions (
    user_id, contribution_date, contribution_type, 
    related_vehicle_id, metadata
  ) VALUES (
    user_uuid, CURRENT_DATE, contribution_type_param,
    related_vehicle_uuid, contribution_metadata
  ) ON CONFLICT (user_id, contribution_date, contribution_type, related_vehicle_id) 
  DO UPDATE SET 
    contribution_count = user_contributions.contribution_count + 1,
    metadata = contribution_metadata;
  
  RETURN true;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.log_quick_action(p_user_id uuid, p_action_type text, p_action_data jsonb, p_vehicle_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_vehicle_edit(p_vehicle_id uuid, p_field_name text, p_old_value text, p_new_value text, p_user_id uuid, p_source text DEFAULT 'inline_edit'::text, p_change_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_edit_id UUID;
  v_associations JSONB;
  v_confidence_data JSONB;
  v_confidence_score INTEGER;
  v_confidence_factors JSONB;
BEGIN
  -- P3.7 identity check (2026-09-27): the editor is the caller (p_user_id = auth.uid()). Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'log_vehicle_edit: p_user_id must be the signed-in user' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Get user associations at time of modification
  SELECT get_user_associations(p_user_id, p_vehicle_id) INTO v_associations;

  -- Calculate confidence score
  SELECT calculate_edit_confidence(p_user_id, p_vehicle_id, p_field_name, p_source) INTO v_confidence_data;
  
  v_confidence_score := (v_confidence_data->>'confidence_score')::INTEGER;
  v_confidence_factors := v_confidence_data->'factors';

  -- Insert into edit audit table (underlying table) with associations and confidence
  INSERT INTO vehicle_edit_audit (
    vehicle_id,
    editor_id,
    field_name,
    old_value,
    new_value,
    change_type,
    edit_reason,
    source,
    user_associations,
    confidence_score,
    confidence_factors
  ) VALUES (
    p_vehicle_id,
    p_user_id,
    p_field_name,
    p_old_value,
    p_new_value,
    'update',
    p_change_reason,
    p_source,
    v_associations,
    v_confidence_score,
    v_confidence_factors
  )
  RETURNING id INTO v_edit_id;
  
  RETURN v_edit_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  -- P3.7 identity check (2026-09-27): the user themself. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'mark_all_notifications_read: you can only mark your own notifications' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE public.user_notifications
  SET
    is_read = true,
    read_at = NOW()
  WHERE user_id = p_user_id
    AND is_read = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_user_id uuid, p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- P3.7 identity check (2026-09-27): the user themself. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'mark_notification_read: you can only mark your own notifications' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE public.user_notifications
  SET
    is_read = true,
    read_at = NOW()
  WHERE id = p_notification_id
    AND user_id = p_user_id;

  RETURN FOUND;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.merge_duplicate_vehicles(p_primary_id uuid, p_duplicate_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_primary record;
  v_duplicate record;

  v_primary_vin text;
  v_dup_vin text;
  v_primary_norm text;
  v_dup_norm text;

  v_images_moved integer := 0;
  v_events_moved integer := 0;
  v_documents_moved integer := 0;
  v_orgs_moved integer := 0;
begin
  -- P3.7 identity check (2026-09-27): the caller acts as themself and is an admin, or can edit BOTH vehicles (user_can_edit_vehicle). Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() OR NOT (public.is_admin_or_moderator() OR (public.user_can_edit_vehicle(p_primary_id, auth.uid()) AND public.user_can_edit_vehicle(p_duplicate_id, auth.uid()))) THEN
      RAISE EXCEPTION 'merge_duplicate_vehicles: you must be able to edit both vehicles (or be an admin)' USING ERRCODE = '42501';
    END IF;
  END IF;
  if p_primary_id is null or p_duplicate_id is null then
    raise exception 'primary and duplicate ids are required';
  end if;
  if p_primary_id = p_duplicate_id then
    raise exception 'primary and duplicate cannot be the same';
  end if;
  if p_user_id is null then
    raise exception 'user is required';
  end if;

  -- Require access to BOTH vehicles (canonical permission model when available; fall back to legacy ownership)
  if to_regprocedure('public.vehicle_user_has_access(uuid,uuid)') is not null then
    if public.vehicle_user_has_access(p_primary_id, p_user_id) is not true
       or public.vehicle_user_has_access(p_duplicate_id, p_user_id) is not true then
      raise exception 'You do not have permission to merge these vehicles';
    end if;
  else
    if not exists (
      select 1
      from public.vehicles
      where id in (p_primary_id, p_duplicate_id)
        and (user_id = p_user_id or uploaded_by = p_user_id)
    ) then
      raise exception 'You do not have permission to merge these vehicles';
    end if;
  end if;

  select id, year, make, model, vin into v_primary
  from public.vehicles
  where id = p_primary_id;
  if not found then
    raise exception 'Primary vehicle not found';
  end if;

  select id, year, make, model, vin into v_duplicate
  from public.vehicles
  where id = p_duplicate_id;
  if not found then
    raise exception 'Duplicate vehicle not found';
  end if;

  v_primary_vin := coalesce(v_primary.vin, '');
  v_dup_vin := coalesce(v_duplicate.vin, '');

  v_primary_norm := upper(btrim(replace(replace(v_primary_vin, ' ', ''), '-', '')));
  v_dup_norm := upper(btrim(replace(replace(v_dup_vin, ' ', ''), '-', '')));

  if v_primary_norm = '' or v_primary_norm like 'VIVA-%' then
    raise exception 'Merge blocked: primary VIN is missing/placeholder. Add/verify VIN first.';
  end if;
  if v_dup_norm = '' or v_dup_norm like 'VIVA-%' then
    raise exception 'Merge blocked: duplicate VIN is missing/placeholder. Add/verify VIN first.';
  end if;

  if v_primary_norm <> v_dup_norm then
    raise exception 'Merge blocked: VINs do not match (% vs %).', v_primary_norm, v_dup_norm;
  end if;

  perform set_config('app.is_merging_vehicles', 'TRUE', false);

  update public.vehicle_images
  set vehicle_id = p_primary_id,
      updated_at = now()
  where vehicle_id = p_duplicate_id;
  get diagnostics v_images_moved = row_count;

  update public.timeline_events
  set vehicle_id = p_primary_id,
      updated_at = now()
  where vehicle_id = p_duplicate_id;
  get diagnostics v_events_moved = row_count;

  if to_regclass('public.vehicle_documents') is not null then
    update public.vehicle_documents
    set vehicle_id = p_primary_id,
        updated_at = now()
    where vehicle_id = p_duplicate_id;
    get diagnostics v_documents_moved = row_count;
  end if;

  if to_regclass('public.organization_vehicles') is not null then
    with moved_orgs as (
      update public.organization_vehicles
      set vehicle_id = p_primary_id,
          updated_at = now()
      where vehicle_id = p_duplicate_id
        and not exists (
          select 1
          from public.organization_vehicles ov2
          where ov2.vehicle_id = p_primary_id
            and ov2.organization_id = public.organization_vehicles.organization_id
            and ov2.relationship_type = public.organization_vehicles.relationship_type
        )
      returning 1
    )
    select count(*) into v_orgs_moved from moved_orgs;

    delete from public.organization_vehicles
    where vehicle_id = p_duplicate_id;
  end if;

  update public.vehicles
  set status = 'merged',
      merged_into_vehicle_id = p_primary_id,
      updated_at = now()
  where id = p_duplicate_id;

  perform set_config('app.is_merging_vehicles', 'FALSE', false);

  return jsonb_build_object(
    'success', true,
    'primary_vehicle_id', p_primary_id,
    'duplicate_vehicle_id', p_duplicate_id,
    'images_moved', v_images_moved,
    'events_moved', v_events_moved,
    'documents_moved', v_documents_moved,
    'organization_relationships_moved', v_orgs_moved
  );
exception when others then
  perform set_config('app.is_merging_vehicles', 'FALSE', false);
  raise;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_pending_assignment(p_assignment_id uuid, p_user_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- P3.7 identity check (2026-09-27): same as approve_pending_assignment. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() OR NOT (public.is_admin_or_moderator() OR EXISTS (SELECT 1 FROM public.pending_vehicle_assignments pa JOIN public.organization_contributors oc ON oc.organization_id = pa.organization_id WHERE pa.id = p_assignment_id AND oc.user_id = auth.uid() AND coalesce(oc.status, 'active') = 'active')) THEN
      RAISE EXCEPTION 'reject_pending_assignment: only a contributor of that organization (acting as themself) can reject' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE pending_vehicle_assignments
  SET 
    status = 'rejected',
    reviewed_by_user_id = p_user_id,
    reviewed_at = NOW(),
    review_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_assignment_id
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found or already processed';
  END IF;
  
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.relink_testimony(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_vehicle_id uuid;
  v_is_primary boolean;
  v_file_hash text;
  v_demoted boolean := false;
BEGIN
  -- P3.7 identity check (2026-09-27): the actor is the caller (p_actor_user_id = auth.uid()) and can edit the target vehicle; stays SECURITY INVOKER so RLS still governs the source rows. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() OR NOT public.user_can_edit_vehicle(p_target_vehicle_id, auth.uid()) THEN
      RAISE EXCEPTION 'relink_testimony: you can only relink as yourself onto a vehicle you can edit' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_observation_type NOT IN ('image', 'observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id) THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary, false), file_hash
      INTO v_old_vehicle_id, v_is_primary, v_file_hash
      FROM vehicle_images WHERE id = p_observation_id;

    IF v_old_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'image % not found (or vehicle_id is null)', p_observation_id;
    END IF;

    IF v_old_vehicle_id = p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'target_same_as_current',
                                'observation_id', p_observation_id);
    END IF;

    -- Guard: (vehicle_id, file_hash) unique — content already on target.
    IF v_file_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.file_hash = v_file_hash
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
                                'observation_id', p_observation_id);
    END IF;

    -- Guard: one-primary-per-vehicle unique index. Demote the MOVED row, never
    -- the target's existing primary (workflow state, not testimony content).
    IF v_is_primary AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id
        AND b.is_primary = true
        AND COALESCE(b.is_document, false) = false
        AND COALESCE(b.is_duplicate, false) = false
    ) THEN
      v_demoted := true;
    END IF;

    UPDATE vehicle_images
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = v_old_vehicle_id,
           is_primary = CASE WHEN v_demoted THEN false ELSE is_primary END,
           updated_at = NOW()
     WHERE id = p_observation_id;

  ELSE
    SELECT vehicle_id INTO v_old_vehicle_id
      FROM vehicle_observations WHERE id = p_observation_id;

    IF v_old_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'observation % not found (or vehicle_id is null)', p_observation_id;
    END IF;

    IF v_old_vehicle_id = p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'target_same_as_current',
                                'observation_id', p_observation_id);
    END IF;

    UPDATE vehicle_observations
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = v_old_vehicle_id
     WHERE id = p_observation_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, v_old_vehicle_id,
    p_observation_id, p_target_vehicle_id,
    p_reason || CASE WHEN v_demoted THEN ' [is_primary demoted: target already has a primary]' ELSE '' END,
    p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'relink_in_place',
    'observation_type', p_observation_type,
    'observation_id', p_observation_id,
    'old_vehicle_id', v_old_vehicle_id,
    'new_vehicle_id', p_target_vehicle_id,
    'merged_from_vehicle_id', v_old_vehicle_id,
    'demoted_primary', v_demoted);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.unmerge_vehicle(p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_proposal RECORD;
  v_primary_id UUID;
  v_dup_id UUID;
  v_images_returned INT := 0;
  v_comments_returned INT := 0;
  v_observations_returned INT := 0;
  v_events_returned INT := 0;
  v_obs_disc_returned INT := 0;
  v_archived_restored INT := 0;
  v_row RECORD;
BEGIN
  -- P3.7 identity check (2026-09-27): an admin, or an editor of the proposal's primary vehicle; stays SECURITY INVOKER. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR NOT (public.is_admin_or_moderator() OR EXISTS (SELECT 1 FROM public.vehicle_merge_proposals mp WHERE mp.id = p_proposal_id AND public.user_can_edit_vehicle(mp.primary_vehicle_id, auth.uid()))) THEN
      RAISE EXCEPTION 'unmerge_vehicle: only an editor of the primary vehicle (or an admin) can unmerge' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Load proposal
  SELECT * INTO v_proposal
  FROM vehicle_merge_proposals
  WHERE id = p_proposal_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'proposal_not_found');
  END IF;

  IF v_proposal.status <> 'merged' THEN
    RETURN jsonb_build_object('error', 'not_merged', 'current_status', v_proposal.status);
  END IF;

  IF v_proposal.merge_journal IS NULL THEN
    RETURN jsonb_build_object('error', 'no_journal',
      'message', 'This merge predates the journal system and cannot be automatically reversed.');
  END IF;

  v_primary_id := v_proposal.primary_vehicle_id;
  v_dup_id := v_proposal.duplicate_vehicle_id;

  -- -----------------------------------------------------------------------
  -- 1. Move back rows from child tables WHERE merged_from_vehicle_id = dup_id
  --    (Post-merge additions have merged_from_vehicle_id IS NULL → untouched)
  -- -----------------------------------------------------------------------

  UPDATE vehicle_images
  SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL
  WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_images_returned = ROW_COUNT;

  UPDATE vehicle_observations
  SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL
  WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_observations_returned = ROW_COUNT;

  UPDATE auction_events
  SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL
  WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_events_returned = ROW_COUNT;

  UPDATE auction_comments
  SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL
  WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_comments_returned = ROW_COUNT;

  UPDATE observation_discoveries
  SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL
  WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_obs_disc_returned = ROW_COUNT;

  -- -----------------------------------------------------------------------
  -- 2. Restore archived deleted rows from merge_deleted_rows
  -- -----------------------------------------------------------------------
  FOR v_row IN
    SELECT * FROM merge_deleted_rows
    WHERE proposal_id = p_proposal_id AND restored_at IS NULL
    ORDER BY source_table
  LOOP
    BEGIN
      CASE v_row.source_table
        WHEN 'vehicle_observations' THEN
          INSERT INTO vehicle_observations
          SELECT * FROM jsonb_populate_record(NULL::vehicle_observations, v_row.row_data)
          ON CONFLICT DO NOTHING;
        WHEN 'auction_comments' THEN
          INSERT INTO auction_comments
          SELECT * FROM jsonb_populate_record(NULL::auction_comments, v_row.row_data)
          ON CONFLICT DO NOTHING;
        WHEN 'bat_listings' THEN
          INSERT INTO bat_listings
          SELECT * FROM jsonb_populate_record(NULL::bat_listings, v_row.row_data)
          ON CONFLICT DO NOTHING;
        WHEN 'comment_discoveries' THEN
          INSERT INTO comment_discoveries
          SELECT * FROM jsonb_populate_record(NULL::comment_discoveries, v_row.row_data)
          ON CONFLICT DO NOTHING;
        WHEN 'description_discoveries' THEN
          INSERT INTO description_discoveries
          SELECT * FROM jsonb_populate_record(NULL::description_discoveries, v_row.row_data)
          ON CONFLICT DO NOTHING;
        ELSE
          -- Unknown table — skip (safety net)
          NULL;
      END CASE;

      UPDATE merge_deleted_rows SET restored_at = NOW() WHERE id = v_row.id;
      v_archived_restored := v_archived_restored + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Log but don't fail the whole unmerge for one row
      RAISE WARNING 'Failed to restore archived row % from %: %', v_row.row_id, v_row.source_table, SQLERRM;
    END;
  END LOOP;

  -- -----------------------------------------------------------------------
  -- 3. Restore the duplicate vehicle
  -- -----------------------------------------------------------------------
  UPDATE vehicles
  SET status = COALESCE(v_proposal.pre_merge_dup_status, 'active'),
      merged_into_vehicle_id = NULL,
      deleted_at = NULL
  WHERE id = v_dup_id;

  -- -----------------------------------------------------------------------
  -- 4. Update proposal status
  -- -----------------------------------------------------------------------
  UPDATE vehicle_merge_proposals
  SET status = 'unmerged',
      unmerged_at = NOW()
  WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'success', true,
    'dup_vehicle_id', v_dup_id,
    'primary_vehicle_id', v_primary_id,
    'images_returned', v_images_returned,
    'comments_returned', v_comments_returned,
    'observations_returned', v_observations_returned,
    'events_returned', v_events_returned,
    'obs_disc_returned', v_obs_disc_returned,
    'archived_restored', v_archived_restored
  );
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.update_follow_roi_tracking(p_subscription_id uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.update_organization_profile_stats(p_org_id uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.update_user_profile_stats(p_user_id uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.update_vehicle_relationship(p_vehicle_id uuid, p_user_id uuid, p_relationship_type text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.verify_shop(p_shop_id uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
