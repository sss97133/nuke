-- Disposable PG17 only. Proves 20261020183000_requirement_keyword_excluded_operation.sql as the job-loop replay applies
-- it (chained on the 20261020130000 contract, which adds the "Replace corroded header bolts (stainless kit)", "Rust repair"
-- and "Idler arm replacement" operations): the rust_body template requirements wrongly attached to the header-bolt
-- operation get no keys at all (not exhaust_system); the same texts on a real rust-repair operation keep their template
-- keys; a requirement that is the bolt job itself still keys exhaust_system; other keys are unchanged.
\set ON_ERROR_STOP on
\ir test_requirement_key_exclusions_trim_steering.sql

SELECT t_assert(pg_temp.ck('Rust repair and panel welding', '51000000-0000-0000-0000-000000000001') = '[]'
  AND pg_temp.ck('MIG welder', '51000000-0000-0000-0000-000000000001') = '[]'
  AND pg_temp.ck('Body shop bay', '51000000-0000-0000-0000-000000000001') = '[]'
  AND pg_temp.tk('MIG welder', '51000000-0000-0000-0000-000000000001') = '[]'
  AND pg_temp.tk('Body shop bay', '51000000-0000-0000-0000-000000000001') = '[]',
  'welder / bay / rust-repair on the corroded-header-bolt operation: no capability or tool keys, not exhaust_system');
SELECT t_assert(pg_temp.ck('Rust repair and panel welding', '51000000-0000-0000-0000-000000000002') @> '[{"key":"rust_repair","from":"reviewed_template"}]'
  AND NOT pg_temp.ck('Rust repair and panel welding', '51000000-0000-0000-0000-000000000002') @> '[{"key":"exhaust_system"}]'
  AND pg_temp.tk('MIG welder', '51000000-0000-0000-0000-000000000002') = '[{"key":"welding.mig","from":"reviewed_template"}]',
  'the same texts on a real rust-repair operation keep their template keys');
SELECT t_assert(pg_temp.ck('Replace corroded header bolts (stainless kit)', '51000000-0000-0000-0000-000000000001') @> '[{"key":"exhaust_system","from":"reviewed_keyword"}]'
  AND pg_temp.ck('Header collector gasket (3-bolt)', NULL) @> '[{"key":"exhaust_system"}]'
  AND pg_temp.ck('Idler arm replacement', '51000000-0000-0000-0000-000000000003') @> '[{"key":"steering_suspension_alignment","from":"reviewed_keyword"}]'
  AND pg_temp.ck('Front end alignment', NULL) = '[{"key":"steering_suspension_alignment","from":"reviewed_keyword"}]',
  'a requirement that is the bolt job keeps exhaust_system; other keywords and operations key as before');
SELECT t_assert(NOT has_function_privilege('anon', 'requirement_template_excluded(jsonb)', 'EXECUTE')
  AND obj_description('public.requirement_template_exclusions'::regclass) ~ '20261020183000',
  'helper stays internal; the exclusion data documents the wider scope');
