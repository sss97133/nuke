-- Revert of 20261123180000_data_set_membership: drops the readers, the producer and the four tables.
-- First revert each producer run, newest first, with data_set_membership_revert_v1('<run uuid>'); this file refuses
-- to run while any member row is left. Run as the function owner, e.g.
--   psql -X -v ON_ERROR_STOP=1 -f supabase/sql/revert_20261123180000_data_set_membership.sql
begin;
set local lock_timeout = '3s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.data_set_members) THEN
    RAISE EXCEPTION 'revert_20261123180000: data_set_members still has rows; revert each run with data_set_membership_revert_v1 first';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.data_set_comps(uuid, uuid, price_basis_t);
DROP FUNCTION IF EXISTS public.data_set_comps_one(uuid, uuid, price_basis_t);
DROP FUNCTION IF EXISTS public.vehicle_data_sets(uuid);
DROP FUNCTION IF EXISTS public.data_set_can_read_vehicle(uuid);
DROP FUNCTION IF EXISTS public.data_set_membership_revert_v1(uuid);
DROP FUNCTION IF EXISTS public.data_set_membership_apply_v1(uuid, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.data_set_membership_plan_v1(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.data_set_scope_vehicles(text, uuid);
DROP FUNCTION IF EXISTS public.data_set_basis_live(text, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.data_set_candidates_v1(uuid[]);
DROP FUNCTION IF EXISTS public.data_set_comment_themes_v1(text);
DROP FUNCTION IF EXISTS public.data_set_rule_label(text, text, text, integer);
DROP TABLE IF EXISTS public.data_set_member_plan;
DROP TABLE IF EXISTS public.data_set_runs;
DROP TABLE IF EXISTS public.data_set_members;
DROP TABLE IF EXISTS public.data_sets;
commit;
