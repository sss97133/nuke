-- Re-derive stored ownership roles from title evidence (builds on 20261109055301_garage_ownership_requires_evidence).
--
-- 20261109055301 closes the write path (owner/co_owner need a current approved title_document verification) and makes
-- get_user_garage qualify old rows at read time. The rows themselves still say co_owner / legal_title, and other readers
-- (RLS policies, receipt_user_vehicle_tie, apply_sale_evidence_relationships, vehicle access) keep treating them as
-- ownership. This producer re-runs the admission rule over the stored rows and demotes what the rule does not support:
--   * vehicle_user_permissions owner/co_owner without current title -> contributor when the account photographed the
--     vehicle (contribution is what the photos evidence), otherwise retracted (is_active=false). granted_by is kept.
--   * vehicle_ownerships profile rows claiming legal_title without a title verification or completed transfer ->
--     ownership_type 'claimed_unverified' (the period and its dates stay; only the title claim is withdrawn).
-- Every decision is backed up (before/after) and signed in garage_derivation_evidence (kind relationship_role) with the
-- run id and the producer version (commit sha). rollback_ownership_role_rederivation(run_id) restores the exact rows.
-- Ownership testimony, source custody and contribution stay separate: nothing here reads statements, file custody,
-- consignment/seller associations or receipts as title, and nothing deletes a row or a vehicle.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.ownership_role_rederivation_backup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  producer_version text NOT NULL,
  table_name text NOT NULL CHECK (table_name IN ('vehicle_user_permissions','vehicle_ownerships')),
  row_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  user_id uuid NOT NULL,
  decision text NOT NULL,
  before jsonb NOT NULL,
  after jsonb,
  evidence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  rolled_back_reason text,
  UNIQUE (run_id, table_name, row_id)
);
ALTER TABLE public.ownership_role_rederivation_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ownership_role_rederivation_backup FROM PUBLIC;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.ownership_role_rederivation_backup FROM anon, authenticated'; END IF;
END $r$;

-- The admission rule of 20261109055301, as one predicate the producer and future readers can share.
CREATE OR REPLACE FUNCTION public.current_title_verification_ids(p_vehicle_id uuid, p_user_id uuid)
 RETURNS uuid[]
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(ov.id ORDER BY ov.id), '{}'::uuid[]) FROM public.ownership_verifications ov
   WHERE ov.vehicle_id = p_vehicle_id AND ov.user_id = p_user_id AND ov.status = 'approved'
     AND ov.title_document_url ~ '^https://' AND ov.verification_category = 'title_document'
     AND (ov.expires_at IS NULL OR ov.expires_at > (now() AT TIME ZONE 'UTC'))
$function$;

CREATE OR REPLACE FUNCTION public.rederive_vehicle_ownership_roles(
  p_run_id uuid, p_producer_version text, p_user_id uuid DEFAULT NULL, p_dry_run boolean DEFAULT true)
 RETURNS TABLE(table_name text, row_id uuid, vehicle_id uuid, user_id uuid, before_role text, decision text, evidence jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  r record; v_ids uuid[]; v_id uuid; v_photos bigint; v_titles uuid[]; v_decision text; v_ev jsonb; v_before jsonb; v_after jsonb;
  v_eid uuid; v_hash text; v_script constant text := 'supabase/migrations/20261109070000_rederive_ownership_roles.sql#rederive_vehicle_ownership_roles';
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR nullif(btrim(coalesce(p_producer_version, '')), '') IS NULL THEN
    RAISE EXCEPTION 'run id and producer version required' USING ERRCODE = '22023';
  END IF;

  -- 1) permission rows that claim ownership
  FOR r IN SELECT p.* FROM vehicle_user_permissions p
            WHERE p.role IN ('owner','co_owner') AND coalesce(p.is_active, true) AND p.revoked_at IS NULL
              AND (p_user_id IS NULL OR p.user_id = p_user_id)
            ORDER BY p.user_id, p.vehicle_id LOOP
    v_titles := current_title_verification_ids(r.vehicle_id, r.user_id);
    CONTINUE WHEN cardinality(v_titles) > 0;
    SELECT count(*) INTO v_photos FROM vehicle_images vi
     WHERE vi.vehicle_id = r.vehicle_id AND (vi.user_id = r.user_id OR vi.documented_by_user_id = r.user_id);
    v_decision := CASE WHEN v_photos > 0 THEN 'contributor' ELSE 'retracted' END;
    v_before := to_jsonb(r);
    v_ev := jsonb_build_object(
      'rule', 'owner and co_owner require a current approved title_document verification (20261109055301); photographs evidence contribution only',
      'before_role', r.role, 'granted_by', r.granted_by, 'context', r.context,
      'current_title_verification_ids', to_jsonb(v_titles), 'photo_count', v_photos,
      'other_verifications', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', ov.id, 'status', ov.status, 'category', ov.verification_category,
          'title_document_https', ov.title_document_url ~ '^https://', 'expires_at', ov.expires_at) ORDER BY ov.id), '[]'::jsonb)
         FROM ownership_verifications ov WHERE ov.vehicle_id = r.vehicle_id AND ov.user_id = r.user_id));
    table_name := 'vehicle_user_permissions'; row_id := r.id; vehicle_id := r.vehicle_id; user_id := r.user_id;
    before_role := r.role; decision := v_decision; evidence := v_ev;
    RETURN NEXT;
    CONTINUE WHEN p_dry_run;

    IF v_decision = 'contributor' THEN
      UPDATE vehicle_user_permissions p SET role = 'contributor',
             context = coalesce(p.context, '') || ' | re-derived ' || p_run_id || ' (' || p_producer_version || '): ' || r.role
                       || ' -> contributor, no current approved title verification'
       WHERE p.id = r.id;
    ELSE
      UPDATE vehicle_user_permissions p SET is_active = false, revoked_at = now(),
             context = coalesce(p.context, '') || ' | re-derived ' || p_run_id || ' (' || p_producer_version || '): retracted, no title and no photos'
       WHERE p.id = r.id;
    END IF;
    SELECT to_jsonb(p) INTO v_after FROM vehicle_user_permissions p WHERE p.id = r.id;
    v_hash := encode(sha256(convert_to(jsonb_build_object('kind','relationship_role','conclusion',v_decision,'evidence',v_ev,
                'vehicle_id',r.vehicle_id,'user_id',r.user_id,'subject_key','vehicle_user_permissions:' || r.id)::text, 'UTF8')), 'hex');
    INSERT INTO garage_derivation_evidence(kind, vehicle_id, user_id, subject_key, conclusion, conclusion_detail, confidence, rationale,
        evidence, producer_agent, producer_script, producer_version, run_id, content_hash, dedupe_key, observed_at)
    VALUES ('relationship_role', r.vehicle_id, r.user_id, 'vehicle_user_permissions:' || r.id, v_decision,
        jsonb_build_object('table', 'vehicle_user_permissions', 'row_id', r.id, 'from_role', r.role, 'to_role', v_after->>'role',
                           'is_active', v_after->'is_active'),
        1, 'Deterministic admission rule: no current approved title verification for this account and vehicle.',
        v_ev, 'injestion', v_script, p_producer_version, p_run_id, v_hash,
        encode(sha256(convert_to(p_run_id::text || '|' || v_hash, 'UTF8')), 'hex'), now())
    RETURNING id INTO v_eid;
    INSERT INTO ownership_role_rederivation_backup(run_id, producer_version, table_name, row_id, vehicle_id, user_id, decision, before, after, evidence_id)
    VALUES (p_run_id, p_producer_version, 'vehicle_user_permissions', r.id, r.vehicle_id, r.user_id, v_decision, v_before, v_after, v_eid);
  END LOOP;

  -- 2) ownership periods that claim legal title without a title verification or a completed transfer
  -- Materialized first: the trigger switch below cannot run while a cursor on the table is open.
  SELECT coalesce(array_agg(o.id ORDER BY o.owner_profile_id, o.vehicle_id, o.id), '{}') INTO v_ids FROM vehicle_ownerships o
   WHERE o.owner_profile_id IS NOT NULL AND o.is_current AND o.ownership_type = 'legal_title'
     AND (p_user_id IS NULL OR o.owner_profile_id = p_user_id);
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT o.* INTO r FROM vehicle_ownerships o WHERE o.id = v_id;
    v_titles := current_title_verification_ids(r.vehicle_id, r.owner_profile_id);
    CONTINUE WHEN r.verification_id IS NOT NULL AND r.verification_id = ANY (v_titles);
    CONTINUE WHEN r.proof_event_id IS NOT NULL;
    CONTINUE WHEN EXISTS (SELECT 1 FROM ownership_transfers x WHERE x.vehicle_id = r.vehicle_id AND x.to_user_id = r.owner_profile_id
                           AND x.status::text = 'completed' AND x.completed_at IS NOT NULL AND x.cancelled_at IS NULL);
    v_before := to_jsonb(r);
    v_ev := jsonb_build_object(
      'rule', 'a legal_title period must cite a current approved title_document verification, a proof event, or a completed transfer',
      'before_ownership_type', r.ownership_type, 'role', r.role, 'verification_id', r.verification_id,
      'current_title_verification_ids', to_jsonb(v_titles), 'start_date', r.start_date);
    table_name := 'vehicle_ownerships'; row_id := r.id; vehicle_id := r.vehicle_id; user_id := r.owner_profile_id;
    before_role := r.role || '/' || r.ownership_type; decision := 'claimed_unverified'; evidence := v_ev;
    RETURN NEXT;
    CONTINUE WHEN p_dry_run;

    -- set_single_current_owner would end other open periods on any update of a current row; this changes no currentness.
    ALTER TABLE public.vehicle_ownerships DISABLE TRIGGER trg_single_current_owner;
    UPDATE vehicle_ownerships o SET ownership_type = 'claimed_unverified', updated_at = now() WHERE o.id = r.id;
    ALTER TABLE public.vehicle_ownerships ENABLE TRIGGER trg_single_current_owner;
    SELECT to_jsonb(o) INTO v_after FROM vehicle_ownerships o WHERE o.id = r.id;
    v_hash := encode(sha256(convert_to(jsonb_build_object('kind','relationship_role','conclusion','claimed_unverified','evidence',v_ev,
                'vehicle_id',r.vehicle_id,'user_id',r.owner_profile_id,'subject_key','vehicle_ownerships:' || r.id)::text, 'UTF8')), 'hex');
    INSERT INTO garage_derivation_evidence(kind, vehicle_id, user_id, subject_key, conclusion, conclusion_detail, confidence, rationale,
        evidence, producer_agent, producer_script, producer_version, run_id, content_hash, dedupe_key, observed_at)
    VALUES ('relationship_role', r.vehicle_id, r.owner_profile_id, 'vehicle_ownerships:' || r.id, 'claimed_unverified',
        jsonb_build_object('table', 'vehicle_ownerships', 'row_id', r.id, 'from_ownership_type', 'legal_title', 'to_ownership_type', 'claimed_unverified'),
        1, 'Deterministic admission rule: the period claims legal title but cites no title verification, proof event or completed transfer.',
        v_ev, 'injestion', v_script, p_producer_version, p_run_id, v_hash,
        encode(sha256(convert_to(p_run_id::text || '|' || v_hash, 'UTF8')), 'hex'), now())
    RETURNING id INTO v_eid;
    INSERT INTO ownership_role_rederivation_backup(run_id, producer_version, table_name, row_id, vehicle_id, user_id, decision, before, after, evidence_id)
    VALUES (p_run_id, p_producer_version, 'vehicle_ownerships', r.id, r.vehicle_id, r.owner_profile_id, 'claimed_unverified', v_before, v_after, v_eid);
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.rollback_ownership_role_rederivation(p_run_id uuid, p_reason text, p_dry_run boolean DEFAULT true)
 RETURNS TABLE(table_name text, row_id uuid, decision text, restored jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE b record;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'run id and reason required' USING ERRCODE = '22023';
  END IF;
  IF NOT p_dry_run THEN
    -- Restoring the pre-run rows re-creates exactly what the admission guard now refuses; the guard is lifted only
    -- inside this transaction and only for rows recorded by this run.
    ALTER TABLE public.vehicle_user_permissions DISABLE TRIGGER trg_enforce_user_vehicle_evidence;
    ALTER TABLE public.vehicle_ownerships DISABLE TRIGGER trg_single_current_owner;
  END IF;
  FOR b IN SELECT * FROM ownership_role_rederivation_backup k WHERE k.run_id = p_run_id AND k.rolled_back_at IS NULL ORDER BY k.created_at, k.id LOOP
    table_name := b.table_name; row_id := b.row_id; decision := b.decision;
    IF b.table_name = 'vehicle_user_permissions' THEN
      restored := jsonb_build_object('role', b.before->>'role', 'is_active', b.before->'is_active', 'revoked_at', b.before->'revoked_at', 'context', b.before->>'context');
      IF NOT p_dry_run THEN
        UPDATE vehicle_user_permissions p SET role = b.before->>'role', is_active = (b.before->>'is_active')::boolean,
               revoked_at = (b.before->>'revoked_at')::timestamptz, revoked_by = (b.before->>'revoked_by')::uuid,
               context = b.before->>'context', granted_by = (b.before->>'granted_by')::uuid, granted_at = (b.before->>'granted_at')::timestamptz
         WHERE p.id = b.row_id;
      END IF;
    ELSE
      restored := jsonb_build_object('ownership_type', b.before->>'ownership_type');
      IF NOT p_dry_run THEN
        UPDATE vehicle_ownerships o SET ownership_type = b.before->>'ownership_type', updated_at = (b.before->>'updated_at')::timestamptz WHERE o.id = b.row_id;
      END IF;
    END IF;
    IF NOT p_dry_run THEN
      UPDATE ownership_role_rederivation_backup k SET rolled_back_at = now(), rolled_back_reason = p_reason WHERE k.id = b.id;
      UPDATE garage_derivation_evidence e SET superseded_at = now(), superseded_reason = 'rollback run ' || p_run_id || ': ' || p_reason
       WHERE e.id = b.evidence_id AND e.superseded_at IS NULL;
    END IF;
    RETURN NEXT;
  END LOOP;
  IF NOT p_dry_run THEN
    ALTER TABLE public.vehicle_user_permissions ENABLE TRIGGER trg_enforce_user_vehicle_evidence;
    ALTER TABLE public.vehicle_ownerships ENABLE TRIGGER trg_single_current_owner;
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.rederive_vehicle_ownership_roles(uuid, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rollback_ownership_role_rederivation(uuid, text, boolean) FROM PUBLIC;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rederive_vehicle_ownership_roles(uuid, text, uuid, boolean) FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.rollback_ownership_role_rederivation(uuid, text, boolean) FROM anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rederive_vehicle_ownership_roles(uuid, text, uuid, boolean) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rollback_ownership_role_rederivation(uuid, text, boolean) TO service_role';
  END IF;
END $g$;
COMMIT;
