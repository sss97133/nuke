-- Scale YONO vision workers from 2 to 4 workers
-- Adds jobs 250+251 staggered 30s apart from 247+248
-- All 4 workers run every 2 minutes (*/2 * * * *)
-- Stagger: 0s, 30s, 60s, 90s offsets

-- Worker 3 — staggered 60s after worker 1
SELECT cron.schedule(
  'yono-vision-worker-3',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/yono-vision-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || get_service_role_key_for_cron(),
      'Content-Type', 'application/json'
    ),
    body := '{"batch_size": 10, "worker_offset_ms": 60000}'::jsonb
  ) AS request_id;
  $$
);

-- Worker 4 — staggered 90s after worker 1
SELECT cron.schedule(
  'yono-vision-worker-4',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/yono-vision-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || get_service_role_key_for_cron(),
      'Content-Type', 'application/json'
    ),
    body := '{"batch_size": 10, "worker_offset_ms": 90000}'::jsonb
  ) AS request_id;
  $$
);
