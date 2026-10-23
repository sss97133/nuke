BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- The four delegate-read policies call can_read_accounting_owner(owner_id) for every candidate row, and that
-- SECURITY DEFINER function runs three auth/grant lookups each time. Measured live 2026-10-23 as the reviewer of the
-- owner book (893 documents, 3,589 candidate lines, 21k extraction rows): one filtered page of the records view took
-- 1,507 ms; with the readable owners computed once per statement it takes 98 ms (same plan otherwise).
--
-- accounting_readable_owners() returns the owner ids the caller may read under exactly the tests
-- can_read_accounting_owner applies (authenticated role, confirmed non-anonymous active caller, active grant, owner
-- not deleted or banned); the policies use it as a hashed subplan. can_read_accounting_owner stays for other callers.
CREATE OR REPLACE FUNCTION public.accounting_readable_owners() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT g.owner_id FROM accounting_access_grants g JOIN auth.users o ON o.id=g.owner_id
 WHERE auth.role()='authenticated' AND g.member_id=auth.uid() AND g.active
   AND o.deleted_at IS NULL AND (o.banned_until IS NULL OR o.banned_until<=now())
   AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL
              AND u.is_anonymous IS NOT TRUE AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()))
$$;
REVOKE ALL ON FUNCTION public.accounting_readable_owners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_readable_owners() TO authenticated;

ALTER POLICY financial_documents_delegate_read ON public.financial_documents USING (owner_id IN (SELECT public.accounting_readable_owners()));
ALTER POLICY financial_lines_delegate_read ON public.financial_document_lines USING (owner_id IN (SELECT public.accounting_readable_owners()));
ALTER POLICY financial_extractions_delegate_read ON public.financial_document_extractions USING (owner_id IN (SELECT public.accounting_readable_owners()));
ALTER POLICY financial_concerns_delegate_read ON public.financial_review_queue USING (owner_id IN (SELECT public.accounting_readable_owners()));

COMMIT;
