-- cars-and-bids-targets-landing: pause (active := false).
--
-- Owner rule 2026-10-15: Firecrawl spend stays at $100 a month at most, spent only on the best targets ranked from data.
-- At 7 lots per 5 minutes this job could spend about 2,000 credits a day, so it is paused until the targeting ranking exists.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'cars-and-bids-targets-landing';

COMMIT;
