-- Revert of 20261122011000_presence_bounds: removes the readers vehicle_presence_bounds and user_presence_blocks.
-- Neither holds testimony; both read vehicle_images and user_sites and store nothing.
-- Run as the owner, e.g. psql -X -v ON_ERROR_STOP=1 -f supabase/sql/revert_20261122011000_presence_bounds.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
DROP FUNCTION IF EXISTS public.vehicle_presence_bounds(uuid, date, date, text, uuid);
DROP FUNCTION IF EXISTS public.user_presence_blocks(uuid, date, date, text);
commit;
