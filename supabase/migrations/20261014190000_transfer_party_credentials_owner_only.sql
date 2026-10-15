-- A transfer's party access tokens and the parties' email and phone stop being readable by anon and authenticated.
--
-- Live on 2026-10-14: ownership_transfers has "Public can view non-hidden transfers" (SELECT TO anon,
-- USING public_visibility <> 'hidden'), which admits all 145,780 rows, and anon/authenticated hold the table-wide
-- SELECT, so buyer_access_token and seller_access_token were readable logged out on every row. Those tokens are the
-- party credential: transfer-advance accepts one for advance_manual, ingest_signal and get_next_milestone (the /t/
-- party page). So a logged-out visitor could read either token and act as that transfer's buyer or seller. The same
-- read returned inbox_email, buyer_email, seller_email, buyer_phone and seller_phone.
--
-- After (the #1175 column-grant shape): anon and authenticated lose the table-wide SELECT and keep SELECT on the 20
-- non-sensitive columns; the 7 sensitive columns (the two tokens, inbox_email, the two emails, the two phones) are
-- granted to no API role. INSERT/UPDATE/DELETE and the row policies are unchanged. The service role keeps everything.
-- Two SECURITY DEFINER readers replace the dropped reads:
--   * transfer_party_role(transfer_id, token) -> 'buyer' | 'seller' | 'observer': the /t/ page learns its role
--     without the browser ever holding a token (anon-callable; it compares server-side).
--   * transfer_admin_links(ids[]) -> (id, inbox_email, buyer_access_token, seller_access_token): the admin
--     transfers dashboard reads the links for its page of rows; active admins and the service role only.
-- The web stops selecting these columns and '*' in #<web> (must be live first). A sensitive column added later stays
-- unreadable until a migration grants it.
-- Live policies and ACL: supabase/sql/helpers/ownership_transfers_live_20261014.sql.
-- Contract: supabase/sql/test_transfer_party_credentials_owner_only.sql (CI job transfer-party-credentials-contract).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- transfer_party_role: the caller proves which party they are by holding that party's token; the browser never reads
-- the token back. A missing row, a null token or a mismatch is 'observer'.
CREATE OR REPLACE FUNCTION public.transfer_party_role(p_transfer_id uuid, p_token text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_token IS NULL THEN 'observer'
    WHEN t.buyer_access_token::text = p_token THEN 'buyer'
    WHEN t.seller_access_token::text = p_token THEN 'seller'
    ELSE 'observer'
  END
  FROM public.ownership_transfers t
  WHERE t.id = p_transfer_id
  UNION ALL
  SELECT 'observer'
  WHERE NOT EXISTS (SELECT 1 FROM public.ownership_transfers t WHERE t.id = p_transfer_id)
  LIMIT 1;
$function$;
REVOKE EXECUTE ON FUNCTION public.transfer_party_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_party_role(uuid, text) TO anon, authenticated, service_role;

-- transfer_admin_links: the sensitive link fields for a page of transfers, for active admins and the service role
-- only. Everyone else gets no rows.
CREATE OR REPLACE FUNCTION public.transfer_admin_links(p_ids uuid[])
 RETURNS TABLE(id uuid, inbox_email text, buyer_access_token uuid, seller_access_token uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (coalesce(auth.jwt() ->> 'role', '') = 'service_role'
          OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid() AND au.is_active)) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT t.id, t.inbox_email, t.buyer_access_token, t.seller_access_token
    FROM public.ownership_transfers t
    WHERE t.id = ANY (p_ids[1:1000]);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.transfer_admin_links(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_admin_links(uuid[]) TO authenticated, service_role;

-- The column regrant: revoke the table-wide SELECT, grant SELECT back on the non-sensitive columns only. A
-- column-only revoke would be a no-op while the table grant stands, so the table grant must be dropped first.
DO $grants$
DECLARE
  v_open text;
  v_private text;
  v_found int;
  v_private_cols text[] := ARRAY['inbox_email', 'buyer_phone', 'seller_phone', 'buyer_email', 'seller_email',
    'buyer_access_token', 'seller_access_token'];
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) FILTER (WHERE a.attname <> ALL (v_private_cols)),
         string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) FILTER (WHERE a.attname = ANY (v_private_cols)),
         count(*) FILTER (WHERE a.attname = ANY (v_private_cols))
    INTO v_open, v_private, v_found
  FROM pg_attribute a
  WHERE a.attrelid = 'public.ownership_transfers'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_found <> cardinality(v_private_cols) THEN
    RAISE EXCEPTION 'ownership_transfers: expected the sensitive columns %, found %', v_private_cols, v_found;
  END IF;
  EXECUTE format('REVOKE SELECT ON public.ownership_transfers FROM anon, authenticated');
  EXECUTE format('REVOKE SELECT (%s) ON public.ownership_transfers FROM anon, authenticated', v_private);
  EXECUTE format('GRANT SELECT (%s) ON public.ownership_transfers TO anon, authenticated', v_open);
END $grants$;

DO $check$
BEGIN
  IF has_column_privilege('anon', 'public.ownership_transfers', 'buyer_access_token', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ownership_transfers', 'seller_access_token', 'SELECT')
     OR has_column_privilege('anon', 'public.ownership_transfers', 'buyer_email', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ownership_transfers', 'seller_phone', 'SELECT')
     OR has_column_privilege('anon', 'public.ownership_transfers', 'inbox_email', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.ownership_transfers', 'status', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.ownership_transfers', 'vehicle_id', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.ownership_transfers', 'buyer_access_token', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.ownership_transfers', 'UPDATE')
     OR (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = 'public.ownership_transfers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
           AND NOT has_column_privilege('anon', 'public.ownership_transfers', a.attname, 'SELECT')) <> 7 THEN
    RAISE EXCEPTION 'transfer credential column grants did not land as written';
  END IF;
END $check$;

COMMIT;
