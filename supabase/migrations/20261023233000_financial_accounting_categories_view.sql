BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- The classifications a book already uses, with how many current records carry each, so the Accounting screen can
-- offer them when a reviewer classifies a record (most used first) instead of free text drifting into near-duplicate
-- names. Built on v_financial_accounting_records and running as the caller (security_invoker): the same owner and
-- delegate row policies decide what each reader sees. Measured live 2026-10-23 as the reviewer of the owner book
-- (7,686 classified records, 174 pairs): 260 ms. It writes nothing.
CREATE OR REPLACE VIEW public.v_financial_accounting_categories WITH (security_invoker = true) AS
SELECT owner_id, section, coalesce(category, '') AS category, count(*)::integer AS records
FROM public.v_financial_accounting_records
WHERE section IS NOT NULL
GROUP BY owner_id, section, coalesce(category, '');

COMMENT ON VIEW public.v_financial_accounting_categories IS
  'Section/category pairs in use per book with their current record counts; runs as the caller under the financial_* row policies.';

-- Default privileges grant new relations ALL to authenticated and service_role (see 20261023201000); readers get SELECT.
REVOKE ALL ON public.v_financial_accounting_categories FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_financial_accounting_categories TO authenticated, service_role;

COMMIT;
