-- Disposable PG17 only. Proves 20261020012000_ownership_review_audit_log.sql. First reproduces the live break of
-- 2026-10-19: approve_ownership_verification and admin_reject_ownership_verification fail because verification_audit_log
-- and verification_queue were dropped, leaving the verification unchanged. After the migration the sanctioned review
-- path approves (reviewer, clocks, notes, audit row) and rejects through the admin wrapper; grants are unchanged; the
-- audit log is service-only and append-only.
-- Fixture: ownership_verifications (columns these writers touch), admin_users, admin_notifications, and the live
-- approve_ownership_verification / admin_approve_ownership_verification / admin_reject_ownership_verification
-- definitions and grants read on 2026-10-19, trg_recompute_value_on_ov with the live recompute_value_from_ov, and a
-- service-only SECURITY DEFINER compute_vehicle_value stand-in that counts its calls.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.ownership_verifications') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.ownership_verifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','documents_uploaded','ai_processing','human_review','approved','rejected','expired'])),
  title_document_url text, human_reviewer_id uuid, human_review_notes text, rejection_reason text,
  human_reviewed_at timestamp, approved_at timestamp, rejected_at timestamp, expires_at timestamp DEFAULT (now() + '90 days'::interval),
  created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
CREATE TABLE public.admin_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, admin_level text, permissions text[], is_active boolean);
CREATE TABLE public.admin_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notification_type text, ownership_verification_id uuid,
  vehicle_verification_id uuid, user_id uuid, vehicle_id uuid, title text, message text, priority integer, action_required text, status text,
  reviewed_by_admin_id uuid, admin_notes text, admin_decision text, reviewed_at timestamp, metadata jsonb, created_at timestamp, updated_at timestamp,
  expires_at timestamp);
GRANT ALL ON public.ownership_verifications, public.admin_users, public.admin_notifications TO service_role;

CREATE OR REPLACE FUNCTION public.approve_ownership_verification(p_verification_id uuid, p_reviewer_id uuid, p_review_notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  verification_record ownership_verifications%ROWTYPE;
BEGIN
  -- Get verification record
  SELECT * INTO verification_record
  FROM ownership_verifications
  WHERE id = p_verification_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;

  -- Update verification status only - DO NOT modify vehicles table
  UPDATE ownership_verifications
  SET
    status = 'approved',
    human_reviewer_id = p_reviewer_id,
    human_review_notes = p_review_notes,
    human_reviewed_at = NOW(),
    approved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_verification_id;

  -- Log the approval
  INSERT INTO verification_audit_log (
    verification_id, action, actor_id, actor_type, details
  ) VALUES (
    p_verification_id, 'approved', p_reviewer_id, 'reviewer',
    jsonb_build_object('review_notes', p_review_notes)
  );

  -- Update queue status
  UPDATE verification_queue
  SET queue_status = 'completed', completed_at = NOW()
  WHERE verification_id = p_verification_id;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_approve_ownership_verification(p_notification_id uuid, p_admin_user_id uuid, p_admin_notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  notification_record admin_notifications%ROWTYPE;
  verification_id UUID;
BEGIN
  -- Verify admin permissions
  IF NOT EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = p_admin_user_id AND is_active = true 
    AND 'approve_ownership' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'User does not have admin permissions for ownership approval';
  END IF;
  
  -- Get notification
  SELECT * INTO notification_record 
  FROM admin_notifications 
  WHERE id = p_notification_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin notification not found';
  END IF;
  
  verification_id := notification_record.ownership_verification_id;
  
  -- Approve the ownership verification using existing function
  PERFORM approve_ownership_verification(verification_id, p_admin_user_id, p_admin_notes);
  
  -- Update admin notification
  UPDATE admin_notifications 
  SET 
    status = 'approved',
    reviewed_by_admin_id = p_admin_user_id,
    admin_notes = p_admin_notes,
    admin_decision = 'approved',
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_notification_id;
  
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reject_ownership_verification(p_notification_id uuid, p_admin_user_id uuid, p_rejection_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  notification_record admin_notifications%ROWTYPE;
  verification_id UUID;
BEGIN
  -- Verify admin permissions
  IF NOT EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = p_admin_user_id AND is_active = true 
    AND 'approve_ownership' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'User does not have admin permissions for ownership approval';
  END IF;
  
  -- Get notification
  SELECT * INTO notification_record 
  FROM admin_notifications 
  WHERE id = p_notification_id;
  
  verification_id := notification_record.ownership_verification_id;
  
  -- Reject the ownership verification
  UPDATE ownership_verifications 
  SET 
    status = 'rejected',
    human_reviewer_id = p_admin_user_id,
    rejection_reason = p_rejection_reason,
    human_reviewed_at = NOW(),
    rejected_at = NOW(),
    updated_at = NOW()
  WHERE id = verification_id;
  
  -- Log the rejection
  INSERT INTO verification_audit_log (
    verification_id, action, actor_id, actor_type, details
  ) VALUES (
    verification_id, 'rejected', p_admin_user_id, 'admin',
    jsonb_build_object('rejection_reason', p_rejection_reason)
  );
  
  -- Update admin notification
  UPDATE admin_notifications 
  SET 
    status = 'rejected',
    reviewed_by_admin_id = p_admin_user_id,
    admin_notes = p_rejection_reason,
    admin_decision = 'rejected',
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_notification_id;
  
  RETURN true;
END;
$function$;

CREATE TABLE public.value_calls(vehicle_id uuid, at timestamptz DEFAULT clock_timestamp());
GRANT SELECT ON public.value_calls TO PUBLIC;
CREATE FUNCTION public.compute_vehicle_value(p_vehicle_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN INSERT INTO value_calls(vehicle_id) VALUES (p_vehicle_id); END $$;
REVOKE ALL ON FUNCTION public.compute_vehicle_value(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_vehicle_value(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.recompute_value_from_ov()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  perform public.compute_vehicle_value(coalesce(NEW.vehicle_id, OLD.vehicle_id));
  return coalesce(NEW, OLD);
end $function$;
CREATE TRIGGER trg_recompute_value_on_ov AFTER INSERT OR DELETE OR UPDATE ON public.ownership_verifications FOR EACH ROW EXECUTE FUNCTION recompute_value_from_ov();
GRANT SELECT, INSERT, UPDATE ON public.ownership_verifications TO authenticated;
REVOKE ALL ON FUNCTION public.approve_ownership_verification(uuid,uuid,text), public.admin_approve_ownership_verification(uuid,uuid,text),
  public.admin_reject_ownership_verification(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_ownership_verification(uuid,uuid,text), public.admin_approve_ownership_verification(uuid,uuid,text),
  public.admin_reject_ownership_verification(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused_with(q text, needle text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN strpos(SQLERRM, needle) > 0; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused_with(text,text) TO anon, authenticated, service_role;

-- U owner of the claims, R active admin with approve_ownership.
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000ad');
INSERT INTO admin_users(user_id, admin_level, permissions, is_active) VALUES ('00000000-0000-0000-0000-0000000000ad', 'super', ARRAY['approve_ownership'], true);
INSERT INTO ownership_verifications(id, user_id, vehicle_id, title_document_url) VALUES
 ('0e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000001', 'https://example.invalid/t1.jpg'),
 ('0e000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000002', 'https://example.invalid/t2.jpg'),
 ('0e000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000003', 'https://example.invalid/t3.jpg');
INSERT INTO admin_notifications(id, notification_type, ownership_verification_id, status) VALUES
 ('0f000000-0000-0000-0000-000000000002', 'ownership_verification', '0e000000-0000-0000-0000-000000000002', 'pending'),
 ('0f000000-0000-0000-0000-000000000003', 'ownership_verification', '0e000000-0000-0000-0000-000000000003', 'pending');

-- 1. The live breaks: a user's own pending submission fails on the revoked recompute; every review writer fails.
SET ROLE authenticated;
SELECT t_assert(t_refused_with($q$INSERT INTO ownership_verifications(user_id, vehicle_id, title_document_url) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000009', 'https://example.invalid/t9.jpg')$q$, 'compute_vehicle_value'),
  'before: a signed-in user''s own pending submission fails (compute_vehicle_value is service-only)');
RESET ROLE;
TRUNCATE value_calls;
SET ROLE service_role;
SELECT t_assert(t_refused_with($q$SELECT approve_ownership_verification('0e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ad', 'title ok')$q$,
  'verification_audit_log'), 'before: approve_ownership_verification fails on the dropped audit log');
SELECT t_assert(t_refused_with($q$SELECT admin_approve_ownership_verification('0f000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000ad', 'ok')$q$,
  'verification_audit_log'), 'before: admin_approve_ownership_verification fails the same way');
SELECT t_assert(t_refused_with($q$SELECT admin_reject_ownership_verification('0f000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000ad', 'blurry')$q$,
  'verification_audit_log'), 'before: admin_reject_ownership_verification fails on the dropped audit log');
SELECT t_assert((SELECT bool_and(status = 'pending' AND human_reviewer_id IS NULL) FROM ownership_verifications), 'before: nothing was reviewed');
RESET ROLE;

\ir ../migrations/20261020012000_ownership_review_audit_log.sql

SELECT t_assert(NOT has_function_privilege('anon', 'public.approve_ownership_verification(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.approve_ownership_verification(uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.approve_ownership_verification(uuid,uuid,text)', 'EXECUTE'), 'grants unchanged: service-only');
SELECT t_assert(NOT has_table_privilege('anon', 'public.verification_audit_log', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.verification_audit_log', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.verification_audit_log', 'INSERT') AND has_table_privilege('service_role', 'public.verification_audit_log', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.verification_audit_log', 'DELETE'), 'audit log: service reads and appends; nobody else');
SELECT t_assert((SELECT prosrc !~ 'verification_queue' FROM pg_proc WHERE proname = 'approve_ownership_verification'), 'the dropped queue is no longer touched');
TRUNCATE value_calls;
SET ROLE authenticated;
INSERT INTO ownership_verifications(id, user_id, vehicle_id, title_document_url) VALUES
  ('0e000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000009', 'https://example.invalid/t9.jpg');
UPDATE ownership_verifications SET title_document_url = 'https://example.invalid/t9b.jpg' WHERE id = '0e000000-0000-0000-0000-000000000009';
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM ownership_verifications WHERE id = '0e000000-0000-0000-0000-000000000009' AND status = 'pending') = 1
  AND (SELECT count(*) FROM value_calls) = 0, 'after: the user''s pending submission and document edit land; no recompute (value unaffected)');

-- 2. The sanctioned review path works.
SET ROLE service_role;
SELECT t_assert(approve_ownership_verification('0e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ad', 'title ok'),
  'approve_ownership_verification returns true');
SELECT t_assert((SELECT status = 'approved' AND human_reviewer_id = '00000000-0000-0000-0000-0000000000ad' AND human_review_notes = 'title ok'
  AND human_reviewed_at IS NOT NULL AND approved_at IS NOT NULL FROM ownership_verifications WHERE id = '0e000000-0000-0000-0000-000000000001'),
  'approval records reviewer, notes and clocks');
SELECT t_assert((SELECT count(*) FROM verification_audit_log WHERE verification_id = '0e000000-0000-0000-0000-000000000001' AND action = 'approved'
  AND actor_type = 'reviewer' AND details = '{"review_notes":"title ok"}') = 1, 'approval appends one audit row');
SELECT t_assert((SELECT count(*) FROM value_calls WHERE vehicle_id = '40000000-0000-0000-0000-000000000001') = 1, 'entering approved recomputes the vehicle value once');
SELECT t_assert(t_refused_with($q$SELECT approve_ownership_verification('0e000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-0000000000ad')$q$,
  'Verification not found'), 'an unknown verification is still refused');
SELECT t_assert(admin_approve_ownership_verification('0f000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000ad', 'ok'),
  'admin_approve_ownership_verification works through it');
SELECT t_assert((SELECT v.status = 'approved' AND n.status = 'approved' AND n.admin_decision = 'approved' FROM ownership_verifications v
  JOIN admin_notifications n ON n.ownership_verification_id = v.id WHERE v.id = '0e000000-0000-0000-0000-000000000002'), 'admin approval closes the notification');
SELECT t_assert(admin_reject_ownership_verification('0f000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000ad', 'blurry'),
  'admin_reject_ownership_verification works');
SELECT t_assert((SELECT v.status = 'rejected' AND v.rejection_reason = 'blurry' FROM ownership_verifications v WHERE v.id = '0e000000-0000-0000-0000-000000000003')
  AND (SELECT count(*) FROM verification_audit_log WHERE verification_id = '0e000000-0000-0000-0000-000000000003' AND action = 'rejected' AND actor_type = 'admin') = 1,
  'rejection recorded with its audit row');
SELECT t_assert((SELECT count(*) FROM value_calls WHERE vehicle_id = '40000000-0000-0000-0000-000000000003') = 0, 'pending to rejected does not recompute');
RESET ROLE;

-- 3. Append-only.
SELECT t_assert(t_refused_with($q$UPDATE verification_audit_log SET details = '{}'$q$, 'append-only'), 'audit rows cannot be edited');
SELECT t_assert(t_refused_with($q$DELETE FROM verification_audit_log$q$, 'append-only'), 'audit rows cannot be deleted');
SELECT t_assert(t_refused_with($q$INSERT INTO verification_audit_log(verification_id, action, actor_type) VALUES (NULL, 'renamed', 'system')$q$, 'check'),
  'the action vocabulary is enforced');
SELECT t_assert((SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE proname = 'recompute_value_from_ov')
  AND NOT has_function_privilege('authenticated', 'public.compute_vehicle_value(uuid)', 'EXECUTE'), 'recompute runs as owner; compute_vehicle_value stays service-only');
