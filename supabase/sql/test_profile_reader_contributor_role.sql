-- Reuse the complete invoker/RLS profile contract before exercising creator roles.
\ir test_vehicle_profile_read.sql
ALTER TABLE public.vehicles ADD COLUMN entry_type text;
\ir ../migrations/20261019021500_profile_reader_contributor_role.sql
\ir ../migrations/20261019021500_profile_reader_contributor_role.sql

-- Synthetic fixtures only: generated creator/user alias must not assert ownership.
UPDATE public.vehicles SET user_id = '20000000-0000-0000-0000-000000000002',
  owner_id = NULL, entry_type = 'contributor_data'
  WHERE id = '10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT set_config('test.auth_role', 'authenticated', false);
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000002', false);
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000001')->>'viewer' = 'contributor', 'contributed creator is contributor');
RESET ROLE;
UPDATE public.vehicles SET entry_type = 'owner_claim' WHERE id = '10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000001')->>'viewer' = 'owner', 'legacy owner claim retained');
RESET ROLE;
UPDATE public.vehicles SET entry_type = 'contributor_data', owner_id = user_id WHERE id = '10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000001')->>'viewer' = 'owner', 'explicit owner retained');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000099', false);
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000001')->>'viewer' = 'anon', 'unrelated viewer unchanged');
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000004') IS NULL, 'private profile stays inaccessible');
RESET ROLE;
SELECT public.t_assert((SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.vehicle_profile_read(uuid)'::regprocedure), 'invoker and stable preserved');
SELECT public.t_assert(NOT has_function_privilege('public', 'public.vehicle_profile_read(uuid)', 'EXECUTE'), 'public execute remains denied');
SELECT 'profile_reader_contributor_role contract: PASS' AS result;
