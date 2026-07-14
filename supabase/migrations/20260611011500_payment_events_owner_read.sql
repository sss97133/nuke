-- ============================================================================
-- payment_events: owner-read RLS policy. Filed 2026-06-11.
--
-- RLS was ENABLED with ZERO policies — every client SELECT returned nothing,
-- including the owner's. The profile MONEY FLOW widget (reads as the
-- signed-in user) silently rendered null even for user 0. Money is the most
-- private substrate: exactly one policy — you read your own rows. Writes
-- remain service-role-only (no INSERT/UPDATE/DELETE policies).
-- ============================================================================

DROP POLICY IF EXISTS payment_events_owner_read ON payment_events;
CREATE POLICY payment_events_owner_read ON payment_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
