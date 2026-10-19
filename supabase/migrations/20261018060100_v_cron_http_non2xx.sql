-- v_cron_http_non2xx: the HTTP answers to pg_cron's net.http_post calls that were not 2xx.
--
-- A cron job that posts to an edge function "succeeds" in cron.job_run_details as soon as pg_net queues the request; the function's
-- answer lands in net._http_response (status, body) and nowhere else. On 2026-10-16 broad-arrow-targets-landing posted an action the
-- deployed function did not have for 14 hours: 86 runs "succeeded", 36 retained answers were HTTP 400 "Provide url or action". This
-- view groups the retained non-2xx answers by hour, status and the first 80 characters of the body, so a cron/function mismatch is one
-- query: select * from v_cron_http_non2xx. pg_net keeps its answers for a short window only (hours), so it reads recent failures,
-- not history. service_role only.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE VIEW public.v_cron_http_non2xx WITH (security_invoker = true) AS
SELECT date_trunc('hour', r.created) AS hour,
       r.status_code,
       left(regexp_replace(coalesce(r.content::text, r.error_msg, ''), '\s+', ' ', 'g'), 80) AS answer_head,
       count(*) AS responses,
       min(r.created) AS first_seen,
       max(r.created) AS last_seen
FROM net._http_response r
WHERE r.status_code IS NULL OR r.status_code NOT BETWEEN 200 AND 299
GROUP BY 1, 2, 3;

REVOKE ALL ON public.v_cron_http_non2xx FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_cron_http_non2xx TO service_role;
COMMENT ON VIEW public.v_cron_http_non2xx IS 'Non-2xx answers retained by pg_net for pg_cron http_post calls, grouped by hour, status and the first 80 characters of the body. Shows a cron/function mismatch that job_run_details reports as success. Recent window only. service_role only.';

COMMIT;
