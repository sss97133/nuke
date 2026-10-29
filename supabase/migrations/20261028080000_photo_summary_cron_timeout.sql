-- The drain job failed every minute: pg_cron sessions run with a 10s statement_timeout, and a 50-vehicle chunk
-- of busy BaT vehicles can take longer, so the whole call was cancelled (cron.job_run_details: "canceling statement
-- due to statement timeout"). Same job name, so cron.schedule replaces the command: the session timeout is raised
-- to the 55s cap and chunks are smaller (20 vehicles, 40s budget). No data or other job is changed.
-- Revert: select cron.schedule('drain-listing-photo-summary-queue', '* * * * *', $c$select public.drain_listing_photo_summary_queue(50, 40)$c$);
select cron.schedule('drain-listing-photo-summary-queue', '* * * * *',
  $c$set statement_timeout = '55s'; select public.drain_listing_photo_summary_queue(20, 40)$c$);
