-- Disposable PG17 only. Proves 20261019230000_provider_jobs_accepted_offers.sql: a provider the customer accepted through
-- accept_offer appears on provider_job_record_read and provider_profile_read (role accepted_provider), and drops out when
-- the acceptance is withheld (a later co-sign change). Fixture and prior state: the provider-vouches chain (fixture_tech 6
-- offered on the open skill requirement of work order 0d; the shop owner 4 co-signed it).
\set ON_ERROR_STOP on
\ir test_provider_vouches.sql
\ir ../migrations/20261019230000_provider_jobs_accepted_offers.sql

CREATE FUNCTION public.t_jobs() RETURNS jsonb LANGUAGE sql AS $$ SELECT provider_job_record_read('00000000-0000-0000-0000-000000000006') $$;
GRANT EXECUTE ON FUNCTION public.t_jobs() TO anon, authenticated;
SELECT (SELECT provider_profile_read('00000000-0000-0000-0000-000000000006')#>>'{work_record,jobs,jobs}')::int AS jobs0 \gset
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t_jobs()->'rows') r WHERE r->>'work_order_id'='30000000-0000-0000-0000-00000000000d'),
  'before acceptance: the offered job is not a provider job');
RESET ROLE;

SELECT (SELECT j->>'offer_id' FROM ofx) AS fx \gset
SELECT work_order_offer_terms_hash(:'fx') AS thx \gset
SELECT customer_id AS cust FROM work_orders WHERE id='30000000-0000-0000-0000-00000000000d' \gset
SET ROLE authenticated;
SELECT t_as(:'cust');
SELECT accept_offer(:'fx',:'thx');
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(t_jobs()->'rows') r WHERE r->>'work_order_id'='30000000-0000-0000-0000-00000000000d'
  AND r->'subject_roles' @> '["accepted_provider"]'),'after accept_offer: the job is listed with role accepted_provider');
SELECT t_assert((provider_profile_read('00000000-0000-0000-0000-000000000006')#>>'{work_record,jobs,jobs}')::int=(:'jobs0')::int+1
  AND provider_profile_read('00000000-0000-0000-0000-000000000006')#>'{work_record,jobs,by_role}' ? 'accepted_provider','profile: job count and role include it');
RESET ROLE;

-- The co-signer changes its statement: the acceptance is withheld and the job leaves the provider's list.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000004');
SELECT cosign_provider('30000000-0000-0000-0000-00000000000d',:'fx',ARRAY['supervision'],'Supervised in Fixture Shop bay 3',NULL);
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t_jobs()->'rows') r WHERE r->>'work_order_id'='30000000-0000-0000-0000-00000000000d')
  AND (provider_profile_read('00000000-0000-0000-0000-000000000006')#>>'{work_record,jobs,jobs}')::int=(:'jobs0')::int,'withheld acceptance: the job drops out');
RESET ROLE;
SELECT t_assert(NOT has_function_privilege('anon','provider_job_ids(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','provider_job_ids(uuid,uuid)','EXECUTE'),
  'provider_job_ids stays internal');
SELECT md5(pg_get_functiondef('public.provider_job_ids(uuid,uuid)'::regprocedure)) AS implementation_hash;
