-- Personal contact and location data readable by any signed-in account (or anyone) now reaches only its parties.
--
-- Live on 2026-10-19 23:40Z, rolled-back probes as a fresh signed-in account (and as anon) read:
--   1. agent_messages (the inter-agent mail inbox: from_email, to_email, subjects, bodies; 97 rows, 7 with outside
--      addresses): every row, for any signed-in account, through allow_authenticated_read_agent_messages (USING true).
--      Readers: the admin pages AdminAgentInbox and AdminHome and TeamInbox, which also read contact_inbox, already
--      limited to active admin_users.
--   2. device_attributions (photo EXIF: GPS, altitude, camera serial, raw EXIF, device fingerprint, uploader; 11,046
--      rows): every row, for anyone, through device_attributions_public_read (USING true). No web, iOS or edge reader;
--      the writers are scripts on the service role. #2293 separately withholds its location and device columns from anon.
--   3. vault_active_sms_sessions (phone numbers and account names of SMS document sessions): every row, for any
--      signed-in account, because the view runs as its owner (postgres) past vault_sms_sessions' own-row policy.
--      No reader in the repo.
--   4. v_inbox_summary (contact_inbox recipient addresses with counts): every row, for any signed-in account, the same
--      way past contact_inbox's admin-only policy. Readers: AdminInbox and TeamInbox.
--   5. get_shop_org_chart(uuid) (department heads' auth.users e-mail for any shop): executable by anon. It fails today
--      (shop_members does not exist) and has no reader; it would leak if that table returned.
--
-- After: agent_messages is read by active admin_users; device_attributions by the account that uploaded or contributed
-- the photo; both views run as the caller (security_invoker), so their tables' policies apply; get_shop_org_chart is
-- executable by the service role only. No rows or other grants change.
-- Contract: supabase/sql/test_pii_reads_admin_or_own.sql.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- The state this file was reviewed against (read 2026-10-19 23:40Z), or this file's own result.
DO $guard$
DECLARE
  v_agent text;
  v_device text;
BEGIN
  SELECT string_agg(polname || ':' || polcmd::text || ':' || coalesce(pg_get_expr(polqual, polrelid), ''), ';' ORDER BY polname)
    INTO v_agent FROM pg_policy WHERE polrelid = 'public.agent_messages'::regclass;
  SELECT string_agg(polname || ':' || polcmd::text || ':' || coalesce(pg_get_expr(polqual, polrelid), ''), ';' ORDER BY polname)
    INTO v_device FROM pg_policy WHERE polrelid = 'public.device_attributions'::regclass;
  IF v_agent IS DISTINCT FROM 'allow_authenticated_read_agent_messages:r:true'
     AND v_agent NOT LIKE 'agent_messages_admin_read:r:%' THEN
    RAISE EXCEPTION 'agent_messages policies drifted from the 2026-10-19 read: %', v_agent;
  END IF;
  IF v_device IS DISTINCT FROM 'device_attributions_public_read:r:true'
     AND v_device NOT LIKE 'device_attributions_own_read:r:%' THEN
    RAISE EXCEPTION 'device_attributions policies drifted from the 2026-10-19 read: %', v_device;
  END IF;
END $guard$;

DROP POLICY IF EXISTS allow_authenticated_read_agent_messages ON public.agent_messages;
DROP POLICY IF EXISTS agent_messages_admin_read ON public.agent_messages;
CREATE POLICY agent_messages_admin_read ON public.agent_messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active));

DROP POLICY IF EXISTS device_attributions_public_read ON public.device_attributions;
DROP POLICY IF EXISTS device_attributions_own_read ON public.device_attributions;
CREATE POLICY device_attributions_own_read ON public.device_attributions
  FOR SELECT TO authenticated
  USING (uploaded_by_user_id = (SELECT auth.uid()) OR actual_contributor_id = (SELECT auth.uid()));

ALTER VIEW public.vault_active_sms_sessions SET (security_invoker = true);
ALTER VIEW public.v_inbox_summary SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION public.get_shop_org_chart(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
