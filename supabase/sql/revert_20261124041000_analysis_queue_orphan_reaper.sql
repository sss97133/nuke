-- Revert 20261124041000_analysis_queue_orphan_reaper.
-- Put released rows back first (keeps the backup until then): SELECT public.analysis_queue_reap_revert_v1('<run id>');
begin;
set local lock_timeout = '3s';
drop function if exists public.analysis_queue_reap_revert_v1(uuid);
drop function if exists public.analysis_queue_reap_orphans_v1(uuid, timestamptz, integer, integer);
drop table if exists public.analysis_queue_reap_backup, public.analysis_queue_reap_runs;
commit;
