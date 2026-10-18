-- Enable the live BaT pull created paused by 20260930000000_bat_live_pull.sql (jobs bat-live-pull, bat-live-pull-check).
-- The reader's preconditions are live and verified:
--   #453: running lots write 'live' and keep the full end timestamp; the SL500 and 14 lots were re-read 2026-09-30.
--   #448: the comment resolver finds live rows by listing_url and skips comments already held by BaT id.
-- Owner go: 2026-09-30, in the lead window ("i say yes to all u want to do").
-- Stop at any time: select cron.alter_job(jobid, active := false) from cron.job where jobname like 'bat-live-pull%';
set lock_timeout = '5s';
set statement_timeout = '30s';

select cron.alter_job(jobid, active := true) from cron.job where jobname in ('bat-live-pull', 'bat-live-pull-check');
