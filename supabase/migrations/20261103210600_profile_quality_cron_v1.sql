-- hourly scorecard run for the owner's vehicles (unkept hourly runs are pruned after 7 days inside the function)
select cron.unschedule('profile-quality-scorecard-hourly') where exists (select 1 from cron.job where jobname = 'profile-quality-scorecard-hourly');
select cron.schedule('profile-quality-scorecard-hourly', '11 * * * *',
  $$select public.profile_quality_snapshot_v1('0b9f107a-d124-49de-9ded-94698f63c1c4'::uuid, null, 'hourly', 'hourly', false)$$);
