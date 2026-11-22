-- Revert of 20261122190000_capture_exif_complete: drops capture_exif_complete_v1 and its revert helper.
-- Rows are not touched here: first revert each live run with capture_exif_complete_revert_v1(user, run), which removes
-- exactly the keys that run added and its exif_completeness marker.
-- Run as the function owner, e.g. psql -X -v ON_ERROR_STOP=1 -f supabase/sql/revert_20261122190000_capture_exif_complete.sql
begin;
set local lock_timeout = '3s';
drop function if exists public.capture_exif_complete_v1(uuid, uuid, uuid, jsonb, boolean);
drop function if exists public.capture_exif_complete_revert_v1(uuid, uuid);
commit;
