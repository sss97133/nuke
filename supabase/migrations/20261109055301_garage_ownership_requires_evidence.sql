-- Repair photo-only ownership admission and its existing garage consumer.
-- No testimony rewrite, grant/policy change, or derivation-table dependency.
-- Owner statements remain in the existing attributed correction overlay.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
DO $guard$
DECLARE actual text; target text; expected text;
BEGIN
  FOR target, expected IN SELECT * FROM (VALUES
    ('get_user_garage(uuid)', '48224a341e1b1480c78a0aa3bf0321f02eade15cec594f9b9ac0eef3e65d9caa'),
    ('enforce_user_vehicle_evidence()', 'f5753f64a5242154c20b133f49d7abe316e9309e2feeb88cfe5b7aebeeabca2d'),
    ('auto_grant_owner_on_verification()', '4035ffb29fcb5443bb1276980e2a0d46ef5abe9ddb430340f92f153c080f134e')
  ) AS reviewed(target, expected) LOOP
    SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') INTO actual
    FROM pg_proc WHERE oid=to_regprocedure('public.' || target);
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'ownership repair refuses unreviewed definition: % (%)', target, actual;
    END IF;
  END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.enforce_user_vehicle_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Revocations always allowed: an active row going inactive
  -- doesn't claim anything new, it retracts a prior claim.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_active, true) = true
     AND NEW.is_active = false
     AND (NEW.vehicle_id, NEW.user_id, NEW.role) IS NOT DISTINCT FROM
         (OLD.vehicle_id, OLD.user_id, OLD.role) THEN
    RETURN NEW;
  END IF;

  -- previously_owned: user attestation OK, no evidence required
  IF NEW.role = 'previously_owned' THEN
    RETURN NEW;
  END IF;

  -- Ownership roles require title evidence; photographs establish contribution only.
  IF NEW.role IN ('owner', 'co_owner') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = NEW.vehicle_id
        AND ov.user_id = NEW.user_id
        AND ov.status = 'approved'
        AND ov.title_document_url ~ '^https://'
        AND ov.verification_category = 'title_document'
        AND (ov.expires_at IS NULL OR ov.expires_at > (now() AT TIME ZONE 'UTC'))
    ) THEN
      RAISE EXCEPTION 'Cannot assign ownership without current approved title verification. Vehicle: %, User: %',
        NEW.vehicle_id, NEW.user_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Non-ownership relationships retain their existing contribution admission.
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_images vi
    WHERE vi.vehicle_id = NEW.vehicle_id
    AND (vi.user_id = NEW.user_id OR vi.documented_by_user_id = NEW.user_id)
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = NEW.vehicle_id
        AND ov.user_id = NEW.user_id
        AND ov.status = 'approved'
        AND ov.title_document_url ~ '^https://'
    ) THEN
      RAISE EXCEPTION 'Cannot link user to vehicle without photo contributions or ownership documents. Role: %, Vehicle: %, User: %',
        NEW.role, NEW.vehicle_id, NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_grant_owner_on_verification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only fire when status changes to 'approved'
  IF NEW.status = 'approved' AND (OLD IS NULL OR OLD.status != 'approved')
     AND NEW.verification_category = 'title_document'
     AND NEW.title_document_url ~ '^https://'
     AND (NEW.expires_at IS NULL OR NEW.expires_at > (now() AT TIME ZONE 'UTC')) THEN
    -- Upsert owner permission
    INSERT INTO public.vehicle_user_permissions (
      vehicle_id, user_id, role, granted_by, context, is_active, granted_at, created_at
    )
    VALUES (
      NEW.vehicle_id,
      NEW.user_id,
      'owner',
      NEW.human_reviewer_id,  -- admin who approved
      'Auto-granted via ownership_verification approval #' || NEW.id::text,
      true,
      NOW(),
      NOW()
    )
    ON CONFLICT (vehicle_id, user_id, role) WHERE is_active = true
    DO UPDATE SET
      context = 'Auto-granted via ownership_verification approval #' || NEW.id::text;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric, purchase_price numeric, image_count bigint, relationship text, last_activity_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The owner, or the service role (no user id; the books and attribution scripts), sees everything.
  WITH viewer AS (SELECT coalesce(auth.uid() = p_user_id, false) OR coalesce(auth.role() = 'service_role', false) AS is_own),
  -- prec = precedence when one vehicle is reached by several routes (lower wins).
  --   1 owner | 2 previously_owned | 3 consigned (significant non-owner role) | 4 documenting (own photos / work in last 60d)
  --   5 contributor | 6 profile_record | 7 relationship_review
  valid_titles AS (
    SELECT id, vehicle_id FROM public.ownership_verifications
    WHERE user_id=p_user_id AND status='approved'
      AND verification_category='title_document' AND title_document_url ~ '^https://'
      AND (expires_at IS NULL OR expires_at > (now() AT TIME ZONE 'UTC'))
      -- A title approval does not erase the account's recorded disposal/future period.
      AND (NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships o
          WHERE o.owner_profile_id=p_user_id AND o.vehicle_id=ownership_verifications.vehicle_id
            AND o.role IN ('owner','verified_owner','current_owner','co_owner','co-owner','previous_owner'))
        OR EXISTS (SELECT 1 FROM public.vehicle_ownerships o
          WHERE o.owner_profile_id=p_user_id AND o.vehicle_id=ownership_verifications.vehicle_id
            AND o.role IN ('owner','verified_owner','current_owner','co_owner','co-owner')
            AND o.is_current AND o.end_date IS NULL AND (o.start_date IS NULL OR o.start_date <= current_date)))
  ),
  src AS (
    -- A permission is membership, not proof of title. Preserve unsupported rows for own-account review.
    SELECT p.vehicle_id, CASE WHEN EXISTS (SELECT 1 FROM valid_titles t WHERE t.vehicle_id=p.vehicle_id)
        THEN 1 ELSE 7 END prec, NULL::timestamptz act
      FROM public.vehicle_user_permissions p
      WHERE p.user_id=p_user_id AND p.revoked_at IS NULL AND coalesce(p.is_active,true)
        AND p.role IN ('owner','co_owner')
        AND ((SELECT is_own FROM viewer) OR EXISTS (SELECT 1 FROM valid_titles t WHERE t.vehicle_id=p.vehicle_id))
    UNION ALL SELECT ov.vehicle_id, CASE
        WHEN EXISTS (SELECT 1 FROM public.vehicle_ownerships o WHERE o.owner_profile_id=p_user_id
          AND o.vehicle_id=ov.vehicle_id AND (o.role='previous_owner' OR o.end_date <= current_date))
          AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships o WHERE o.owner_profile_id=p_user_id
            AND o.vehicle_id=ov.vehicle_id AND o.is_current AND o.end_date IS NULL
            AND (o.start_date IS NULL OR o.start_date <= current_date)) THEN 2
        WHEN EXISTS (SELECT 1 FROM valid_titles t WHERE t.id=ov.id) THEN 1 ELSE 7 END, NULL
      FROM public.ownership_verifications ov WHERE ov.user_id=p_user_id AND ov.status='approved'
        AND ((SELECT is_own FROM viewer) OR EXISTS (SELECT 1 FROM valid_titles t WHERE t.id=ov.id))
    UNION ALL SELECT o.vehicle_id, CASE
        WHEN o.role IN ('owner','verified_owner','current_owner','co_owner','co-owner','previous_owner')
          AND (o.start_date IS NULL OR o.start_date <= current_date)
          AND (o.role='previous_owner' OR o.end_date <= current_date) THEN 2
        WHEN o.role IN ('owner','verified_owner','current_owner','co_owner','co-owner')
          AND o.is_current AND o.end_date IS NULL AND (o.start_date IS NULL OR o.start_date <= current_date)
          AND EXISTS (SELECT 1 FROM valid_titles t WHERE t.id=o.verification_id AND t.vehicle_id=o.vehicle_id) THEN 1
        ELSE 7 END, NULL
      FROM public.vehicle_ownerships o WHERE o.owner_profile_id=p_user_id AND (SELECT is_own FROM viewer)
    -- significant non-owner roles carried as their own role
    UNION ALL SELECT vehicle_id, 2, NULL FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role='previously_owned' AND (SELECT is_own FROM viewer)
    UNION ALL SELECT vehicle_id, 2, NULL FROM discovered_vehicles WHERE user_id=p_user_id AND is_active=true AND relationship_type='previously_owned' AND (SELECT is_own FROM viewer)
    UNION ALL SELECT vehicle_id, 3, NULL FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role='consigned' AND (SELECT is_own FROM viewer)
    -- documenting: own photo uploads or work sessions in the last 60 days, ranked by recency
    UNION ALL SELECT vi.vehicle_id, 4, max(vi.created_at) FROM vehicle_images vi
      WHERE vi.user_id=p_user_id AND vi.vehicle_id IS NOT NULL AND vi.created_at >= now() - interval '60 days'
        AND coalesce(vi.is_superseded,false)=false AND (SELECT is_own FROM viewer)
      GROUP BY vi.vehicle_id
    UNION ALL SELECT ws.vehicle_id, 4, max(ws.session_date)::timestamptz FROM work_sessions ws
      WHERE ws.user_id=p_user_id AND ws.vehicle_id IS NOT NULL AND ws.session_date >= current_date - 60 AND (SELECT is_own FROM viewer)
      GROUP BY ws.vehicle_id
    UNION ALL SELECT vehicle_id, 5, NULL FROM vehicle_contributors WHERE user_id=p_user_id AND (SELECT is_own FROM viewer)
    -- Creating a profile relates it to this account; it does not establish ownership.
    UNION ALL SELECT v.id, 6, NULL FROM vehicles v
      WHERE v.user_id=p_user_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL AND (SELECT is_own FROM viewer)
  ),
  -- follow merged_into_vehicle_id (two hops) to the canonical vehicle
  canon AS (
    SELECT coalesce(m2.id, m1.id, sv.id) AS vid, s.prec, s.act
    FROM src s
    JOIN vehicles sv ON sv.id = s.vehicle_id
    LEFT JOIN vehicles m1 ON m1.id = sv.merged_into_vehicle_id
    LEFT JOIN vehicles m2 ON m2.id = m1.merged_into_vehicle_id
  ),
  dedup AS (SELECT vid AS vehicle_id, MIN(prec) pr, max(act) act FROM canon GROUP BY vid)
  SELECT v.id, v.year, v.make, v.model, v.trim,
         COALESCE(v.primary_image_url,
                  (SELECT vi2.image_url FROM vehicle_images vi2
                     WHERE vi2.vehicle_id = v.id AND vi2.image_url IS NOT NULL
                       -- the definer skips RLS and the vision gate; a stranger gets only an admitted frame
                       AND ((SELECT is_own FROM viewer) OR public.vehicle_image_gallery_eligible(vi2))
                     ORDER BY vi2.created_at LIMIT 1)),
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr NOT IN (6,7) THEN
           (SELECT ne.estimated_value FROM nuke_estimates ne
              WHERE ne.vehicle_id = v.id AND ne.comp_method = 'class_stratified'
              ORDER BY ne.calculated_at DESC NULLS LAST LIMIT 1) END,
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr NOT IN (6,7) THEN v.purchase_price END,
         COALESCE(v.image_count, 0)::bigint,
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' WHEN 3 THEN 'consigned' WHEN 4 THEN 'documenting' WHEN 5 THEN 'contributor' WHEN 6 THEN 'profile_record' ELSE 'relationship_review' END,
         -- genuine activity only (EXIF photos by owner/contributors, real work sessions, genuine timeline events); see vehicle_activity
         va.last_activity_at
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  LEFT JOIN vehicle_activity va ON va.vehicle_id = v.id
  WHERE v.merged_into_vehicle_id IS NULL AND v.deleted_at IS NULL
    AND ((SELECT is_own FROM viewer) OR v.is_public = true)
  -- display order: relationship group (owner, documenting, previously_owned, consigned, contributor, profile_record),
  -- then most recent GENUINE activity first (was: upload created_at of filed photos only)
  ORDER BY CASE d.pr WHEN 1 THEN 1 WHEN 4 THEN 2 WHEN 2 THEN 3 WHEN 3 THEN 4 WHEN 5 THEN 5 ELSE 6 END,
           va.last_activity_at DESC NULLS LAST, v.year;
$function$;

COMMIT;
