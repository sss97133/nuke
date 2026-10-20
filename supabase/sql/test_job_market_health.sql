-- Disposable PG17 only. Proves 20261020160000_job_market_health.sql as the job-loop replay applies it (chained on the
-- claimed-providers contract: an open seat job taken from offer to invoice by AutoZone's verified claimant, an open
-- interior job with skill, tool and facility requirements, supply evidence and a declared lift): job_market_health_read
-- is open to anon, returns aggregates only (no ids, handles, e-mails or amounts), agrees with the tables and readers it
-- summarises, and carries the daily snapshot history written only by record_job_market_health_snapshot.
\set ON_ERROR_STOP on
\ir test_open_requirements_claimed_providers.sql

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT as_user(NULL);
SELECT t_assert(has_function_privilege('anon', 'job_market_health_read()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'job_market_health_compute()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'job_market_health_compute()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'record_job_market_health_snapshot()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'record_job_market_health_snapshot()', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'job_market_health_snapshots', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'job_market_health_snapshots', 'SELECT')
  AND EXISTS (SELECT 1 FROM pipeline_registry WHERE table_name = 'job_market_health_snapshots' AND owned_by = 'record_job_market_health_snapshot'),
  'grants: the reader is open; compute, writer and table are not; the table is registered');

SET ROLE service_role;
SELECT record_job_market_health_snapshot() AS snap \gset
RESET ROLE;
SET ROLE anon;
SELECT job_market_health_read() AS h \gset
SELECT open_requirements_read(NULL, 100, NULL) AS orr \gset
RESET ROLE;

SELECT t_assert((:'h'::jsonb) ?& ARRAY['as_of', 'demand', 'supply', 'matching', 'flow', 'trust', 'history', 'rules']
  AND (:'h'::jsonb)::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  AND (:'h'::jsonb)::text !~ '@' AND (:'h'::jsonb)::text !~ '(az_parts|free_mail|AutoZone|Claim Fixture|Recover)',
  'anon reads every section; no ids, e-mails, handles, organization names or requirement texts');

SELECT t_assert((:'h'::jsonb)#>'{demand,open_requirements}' = to_jsonb(jsonb_array_length((:'orr'::jsonb)->'rows'))
  AND (:'h'::jsonb)#>'{demand,jobs}' = to_jsonb((SELECT count(*) FROM work_orders))
  AND ((:'h'::jsonb)#>>'{demand,open_requirements_by_kind,facility}')::int >= 1
  AND ((:'h'::jsonb)#>>'{demand,open_requirements_by_kind,tool}')::int >= 1
  AND ((:'h'::jsonb)#>>'{demand,published,invite_only}')::int >= 1
  AND ((:'h'::jsonb)#>>'{demand,inspection_orders,total}')::int >= 1
  AND ((:'h'::jsonb)#>>'{demand,new_requests,last_30_days}')::int >= 0,
  'demand agrees with open_requirements_read and the work orders: ' || ((:'h'::jsonb)->'demand')::text);
SELECT t_assert((:'h'::jsonb)#>>'{demand,jobs_by_stage,invoiced}' = '1'
  AND (SELECT sum(v::int) FROM jsonb_each_text((:'h'::jsonb)#>'{demand,jobs_by_stage}') x(k, v)) = (SELECT count(*) FROM work_orders),
  'jobs by furthest stage: the claimant''s seat job is invoiced; stages add up to all jobs');

SELECT t_assert((:'h'::jsonb)#>'{flow,counts}' @> jsonb_build_object(
    'offers', (SELECT count(*) FROM work_order_resource_fulfillments f JOIN vehicle_observations s ON s.id = f.id AND NOT s.is_superseded WHERE f.offer_kind IS NOT NULL),
    'quotes_issued', (SELECT count(*) FROM work_order_quotes), 'starts', (SELECT count(*) FROM work_order_work_starts),
    'completions_accepted', (SELECT count(*) FROM work_order_completion_acceptances), 'invoices', (SELECT count(*) FROM work_order_invoices),
    'payment_witnesses', (SELECT count(*) FROM work_order_payment_witnesses))
  AND ((:'h'::jsonb)#>>'{flow,counts,invoices}')::int >= 1 AND (:'h'::jsonb)#>'{flow,money_moved_by_nuke}' = 'false'::jsonb,
  'flow counts agree with the signed tables: ' || ((:'h'::jsonb)#>'{flow,counts}')::text);
SELECT t_assert(NOT EXISTS (SELECT 1 FROM jsonb_each((:'h'::jsonb)#>'{flow,step_hours}') s
    WHERE (s.value->>'samples')::int < 2 AND s.value->>'median_hours' IS NOT NULL)
  AND ((:'h'::jsonb)#>>'{flow,step_hours,completion_to_acceptance,samples}')::int >= 1
  AND job_market_health_median(ARRAY[1, 3, 10]::double precision[]) = '{"samples":3,"median_hours":3.0}'::jsonb
  AND job_market_health_median(ARRAY[2]::double precision[]) = '{"samples":1,"median_hours":null}'::jsonb,
  'step medians only with at least 2 samples: ' || ((:'h'::jsonb)#>'{flow,step_hours}')::text);

SELECT t_assert((:'h'::jsonb)->'supply' @> jsonb_build_object(
    'verified_claimant_organizations', (SELECT count(DISTINCT organization_id) FROM organization_verified_claimants),
    'organizations_with_supply_evidence', (SELECT count(DISTINCT organization_id) FROM organization_supply_evidence),
    'declared_facility_assets', 1, 'declared_facility_assets_by_kind', jsonb_build_object('lift', 1), 'organizations_with_declared_assets', 1,
    'provider_population_capped', false)
  AND ((:'h'::jsonb)#>>'{supply,provider_population}')::int >= 2,
  'supply agrees with the claimant register, supply evidence and declared assets: ' || ((:'h'::jsonb)->'supply')::text);

SELECT t_assert(((:'h'::jsonb)#>>'{matching,with_evidenced_candidate}')::int >= 1
  AND ((:'h'::jsonb)#>>'{matching,with_plan_b_supplier}')::int >= 1
  AND ((:'h'::jsonb)#>>'{matching,with_reachable_plan_b_supplier}')::int >= 1
  AND ((:'h'::jsonb)#>>'{matching,open_requirements}')::int = ((:'h'::jsonb)#>>'{demand,open_requirements}')::int
  AND (:'h'::jsonb)#>'{matching,skill_key_coverage}' ?& ARRAY['requirements', 'with_keys', 'percent']
  AND (:'h'::jsonb)#>'{matching,unknown_for_all}' ? 'evidence_rung',
  'matching: the claimant is an evidenced candidate (upholstery records), Plan-B reachable via the claimed org, coverage and unknown-for-all reported: '
  || ((:'h'::jsonb)->'matching')::text);

SELECT t_assert((:'h'::jsonb)->'trust' @> jsonb_build_object('open_exposures_known', 0,
    'owner_delegated_signs', (SELECT count(*) FROM owner_delegated_signs WHERE rolled_back IS NOT TRUE)),
  'trust: no tracked exposure open in the fixture; owner-delegated signs counted');

SELECT t_assert(jsonb_array_length((:'h'::jsonb)->'history') = (SELECT count(*) FROM job_market_health_snapshots)
  AND ((:'h'::jsonb)->'history'->-1) @> jsonb_build_object('date', current_date, 'invoices', ((:'h'::jsonb)#>'{flow,counts,invoices}'))
  AND (SELECT count(*) FROM job_market_health_snapshots WHERE snapshot_date = current_date) = 1,
  'history: one row per day (re-running the writer updates today''s row), newest last');
