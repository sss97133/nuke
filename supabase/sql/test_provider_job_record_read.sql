-- Disposable PG17 only. Proves 20261019151500_provider_job_record_read.sql: a visitor reads a provider's public jobs
-- with stages, operation kinds, dates and attributed counterparty statements, never money or personal information;
-- private-vehicle jobs only for the subject and slot holders. Fixture and prior state: the provider profile contract.
\set ON_ERROR_STOP on
\ir test_provider_profile_read.sql

ALTER TABLE public.work_order_line_items ADD COLUMN IF NOT EXISTS task_type text;
UPDATE public.work_order_line_items SET task_type = 'fabrication' WHERE id = '50000000-0000-0000-0000-000000000003';

\ir ../migrations/20261019151500_provider_job_record_read.sql

SELECT t_assert(has_function_privilege('anon','public.provider_job_record_read(uuid,uuid,uuid,integer)','EXECUTE')
  AND has_function_privilege('authenticated','public.provider_job_record_read(uuid,uuid,uuid,integer)','EXECUTE')
  AND (SELECT prosecdef AND 'search_path=pg_catalog, public' = ANY (proconfig) FROM pg_proc WHERE proname='provider_job_record_read'),
  'provider_job_record_read: definer, pinned search_path, anon and authenticated');

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
CREATE TEMP TABLE jr AS SELECT provider_job_record_read('00000000-0000-0000-0000-000000000006') j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"visitor","money_visible":false},"subject":{"kind":"user","handle":"fixture_tech"},
  "coverage":{"returned":1,"total_for_subject":1},"next_after":null,"money":"not_reported",
  "rows":[{"work_order_id":"30000000-0000-0000-0000-00000000000c","display_title":"Exhaust","vehicle_label":{"text":"1985 Ford F-150"},
    "subject_roles":["performer"],"stage_states":{"completion":"recorded","accounting":"withheld"},"operation_kinds":{"fabrication":1},
    "dates":{"start_clock":"2026-01-03T00:00:00+00:00","completion_clock":"2026-01-04T00:00:00+00:00"},"counterparty_attestations":[]}]}'
  AND (SELECT count(*) FROM jsonb_object_keys(j->'rows'->0->'stage_states')) = 7 FROM jr), 'visitor: public provider job with stages, kinds and dates');
SELECT t_assert((SELECT NOT t_provider_pii(j) AND j::text !~ '(payment_records|payouts_recorded|Bronco tune)' FROM jr), 'visitor: no PII, money or private-vehicle job');
SELECT t_assert((SELECT j @> '{"subject":{"display":{"handle":"fixture_tech"}},"rows":[{"work_order_id":"30000000-0000-0000-0000-00000000000c"}]}'
  FROM (SELECT provider_job_record_read(NULL, 'a0000000-0000-0000-0000-0000000000f1') j) x), 'visitor: the same record by actor');
SELECT t_assert((SELECT j @> '{"rows":[{"subject_roles":["shop_owner"],"work_order_id":"30000000-0000-0000-0000-00000000000c"}]}'
  FROM (SELECT provider_job_record_read('00000000-0000-0000-0000-000000000004') j) x), 'visitor: shop owner record');
SELECT t_assert((SELECT provider_job_record_read(NULL, 'a0000000-0000-0000-0000-0000000000f2') @> '{"rows":[],"coverage":{"total_for_subject":0}}'), 'visitor: actor without jobs');
SELECT t_assert(t_refused($q$SELECT provider_job_record_read('00000000-0000-0000-0000-000000000002')$q$), 'visitor: private profile refused');
SELECT t_assert(t_refused('SELECT provider_job_record_read()'), 'exactly one subject');
RESET ROLE;

SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000006');
CREATE TEMP TABLE js AS SELECT provider_job_record_read('00000000-0000-0000-0000-000000000006') j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"self"},"coverage":{"total_for_subject":2}}'
  AND j->'rows' @> '[{"work_order_id":"30000000-0000-0000-0000-00000000000e","display_title":"Bronco tune","stage_states":{"accounting":"withheld"}}]' FROM js),
  'self: private-vehicle job included, still no money');
SELECT t_assert((SELECT jsonb_array_length(j->'rows') = 1 AND j->>'next_after' = '30000000-0000-0000-0000-00000000000c'
  FROM (SELECT provider_job_record_read('00000000-0000-0000-0000-000000000006', NULL, NULL, 1) j) x), 'self: paginates');
SELECT t_as('00000000-0000-0000-0000-000000000007');
SELECT t_assert((SELECT provider_job_record_read('00000000-0000-0000-0000-000000000006') @> '{"coverage":{"total_for_subject":2}}'), 'slot holder: private-vehicle job visible');
SELECT t_as('00000000-0000-0000-0000-000000000003');
SELECT t_assert((SELECT provider_job_record_read('00000000-0000-0000-0000-000000000006') @> '{"coverage":{"total_for_subject":1}}'), 'stranger signed in: private-vehicle job hidden');
RESET ROLE;
