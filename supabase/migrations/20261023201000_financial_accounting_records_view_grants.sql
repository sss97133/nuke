BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- 20261023200000 granted SELECT, but the project's default privileges had already handed the new view ALL table
-- privileges to authenticated and service_role at creation (verified live after the deploy). The view runs as the
-- caller and is not updatable (join + EXISTS), so nothing could be written through it; the grants are still wrong.
-- Readers keep SELECT only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_financial_accounting_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_financial_accounting_records TO authenticated, service_role;

COMMIT;
