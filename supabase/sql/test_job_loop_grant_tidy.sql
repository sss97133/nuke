-- Disposable PG17 only. Proves 20261019231500_job_loop_grant_tidy.sql: on the job-loop tables service_role keeps SELECT
-- only and anon/authenticated keep nothing, even after Supabase-style default privileges granted more; the Signs still
-- write through their definer functions. Fixture and prior state: the provider-vouches chain.
\set ON_ERROR_STOP on
\ir test_provider_vouches.sql

-- The live leftovers: default privileges gave service_role every table privilege.
GRANT ALL ON public.provider_vouches, public.contact_requests, public.contact_messages, public.work_order_quotes TO service_role;
SELECT t_assert(has_table_privilege('service_role','public.provider_vouches','INSERT') AND has_table_privilege('service_role','public.contact_requests','DELETE'),
  'fixture: service_role write grants as left by default privileges');
\ir ../migrations/20261019231500_job_loop_grant_tidy.sql

SELECT t_assert((SELECT bool_and(has_table_privilege('service_role', 'public.'||t, 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.'||t, 'INSERT') AND NOT has_table_privilege('service_role', 'public.'||t, 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.'||t, 'DELETE') AND NOT has_table_privilege('service_role', 'public.'||t, 'TRUNCATE')
    AND NOT has_table_privilege('anon', 'public.'||t, 'SELECT') AND NOT has_table_privilege('authenticated', 'public.'||t, 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.'||t, 'INSERT'))
  FROM unnest(ARRAY['provider_vouches','contact_requests','contact_messages','work_order_quotes','work_order_quote_acceptances',
    'work_order_resource_requirements','work_order_resource_fulfillments','work_order_resource_attestations','work_order_resource_specifications']) t),
  'job-loop tables: service_role SELECT only; anon and authenticated nothing');

-- The Signs still write.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000004');
SELECT t_assert((vouch_for_provider('00000000-0000-0000-0000-000000000006',NULL,ARRAY['availability'],'Bay 1 on weekends')->>'duplicate')::boolean IS FALSE,
  'vouch_for_provider still records through its definer function');
SELECT t_as('00000000-0000-0000-0000-000000000002');
SELECT t_assert((request_contact('profile','00000000-0000-0000-0000-000000000006','Grant tidy check',
  '00000000-0000-0000-0000-000000000006')->>'status')='pending','request_contact still records through its definer function');
RESET ROLE;
SET ROLE service_role;
SELECT t_assert(t_refused($q$INSERT INTO public.provider_vouches(signer_user_id,voucher_user_id,subject_user_id,kinds,scope,request_key)
  VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000006',ARRAY['supervision'],'x','k')$q$)
  AND t_refused($q$DELETE FROM public.contact_requests$q$) AND (SELECT count(*) FROM public.provider_vouches) > 0,
  'service_role: reads, but direct writes are refused by privilege');
RESET ROLE;
