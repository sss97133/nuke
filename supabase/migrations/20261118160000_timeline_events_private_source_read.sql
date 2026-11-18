-- timeline_events_private_source_read: keep account-private source rows out of API reads of timeline_events.
--
-- Why: a one-off load on 2026-04-11 wrote rows from five non-vehicle sources into public.timeline_events
-- (whatsapp_ingest, call_history, call_history_lead_pattern, imessage_thread, apple_health_export; 3,470 rows on
-- 2026-11-18, none attached to a vehicle; described in 20261006233000_describe_timeline_events.sql). The table is
-- read publicly through the permissive policy "Public can view all timeline events" (USING true), so anon and
-- authenticated could read them through the API. They are account records, not vehicle history.
--
-- What this adds: one RESTRICTIVE select policy, in the form of owner_statement_private_read (20261117150000). A row
-- from one of those sources is readable through the API only by the account on the row (user_id). For anon, and for
-- rows with no user_id, the test is NULL and the row is not returned.
--   * No row is written, moved or deleted. No grant, column, index or other policy changes.
--   * service_role and owner-run (SECURITY DEFINER) readers are unaffected.
--
-- Consumers checked 2026-11-18 (AGENTS.md "Grants, policies and public reads"):
--   * Every index on timeline_events is a btree over uuid, date, timestamptz, text, integer or boolean columns, so
--     the added qual cannot demote an index condition.
--   * No file in the repository outside supabase/migrations names these sources or event_type daily_movement.
--   * Readers that run as their owner: feed_items_view and sold_vehicle_proof join timeline_events on vehicle_id,
--     so a row with no vehicle never enters them; enhanced_tag_context and labor_rate_comparison join through
--     image_tags and work_order_labor, and 0 rows of either point at these events.
--   * vw_user_day_summary and feed_items_view are not granted to anon or authenticated. api/og/journal reads
--     vehicle_images and vehicles with the service key.
--
-- Verify after the deploy run (was 3,470 / 135 before):
--   SET LOCAL ROLE anon;
--   SELECT count(*) FROM public.timeline_events WHERE vehicle_id IS NULL AND source IN
--     ('whatsapp_ingest','call_history','call_history_lead_pattern','imessage_thread','apple_health_export');  -- 0
--   Signed in as the account on the whatsapp_ingest rows, the same count is 135.
--   node scripts/ci/logged-out-live.mjs
--
-- Revert: supabase/sql/revert_20261118160000_timeline_events_private_source_read.sql

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DROP POLICY IF EXISTS timeline_events_private_source_read ON public.timeline_events;
CREATE POLICY timeline_events_private_source_read ON public.timeline_events AS RESTRICTIVE
FOR SELECT TO anon, authenticated USING (
  source IS NULL
  OR source NOT IN ('whatsapp_ingest', 'call_history', 'call_history_lead_pattern', 'imessage_thread',
                    'apple_health_export')
  OR user_id = (SELECT auth.uid()));

COMMENT ON POLICY timeline_events_private_source_read ON public.timeline_events IS
'Restrictive: rows from the account-private sources (whatsapp_ingest, call_history, call_history_lead_pattern, imessage_thread, apple_health_export) are readable through the API only by the account on the row. Containment for the 2026-04-11 one-off load; the rows are not vehicle history and belong in a private store. Migration 20261118160000.';

COMMIT;
