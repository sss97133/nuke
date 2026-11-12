alter function public.profile_quality_snapshot_v1(uuid,uuid,text,text,boolean) reset enable_seqscan;
select cron.alter_job((select jobid from cron.job where jobname='profile-quality-scorecard-hourly'),
  command := $c$set statement_timeout='600s'; select public.profile_quality_snapshot_v1('0b9f107a-d124-49de-9ded-94698f63c1c4'::uuid, null, 'hourly', 'hourly', false);$c$);
select cron.schedule('pq-after-enrich-oneoff','*/5 * * * *',
 $c$set statement_timeout='600s'; select case when not exists(select 1 from public.vehicle_profile_quality_run where label='after_enrich_20261103') then public.profile_quality_snapshot_v1('0b9f107a-d124-49de-9ded-94698f63c1c4'::uuid, null, 'after_enrich_20261103', 'manual', true) end;$c$);
