-- eBay Marketplace Account Deletion notifications (required for production Browse API keys).
-- eBay tells us a user asked eBay to delete their account; we must stop holding that user's personal data.
--
-- New-table justification (checked 2026-10-15): account_deletion_requests is the in-app queue keyed to auth.users and
-- instagram_deletion_requests is Meta's completed-purge receipt; neither can hold a third party's eBay identity.
-- This table is the receipt-and-queue: one row per eBay notification, written only by the ebay-account-deletion
-- function, through record_ebay_deletion(). Honouring a request anonymizes the seller identity on retained listings
-- (testimony is superseded, never deleted) and stamps honoured_at; that worker is separate and not built here.
--
-- seller_username / ebay_user_id are personal data, so the table is service-role only (RLS on, no policy).

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.ebay_deletion_requests (
  notification_id   text PRIMARY KEY,
  ebay_username     text,
  ebay_user_id      text,
  event_date        timestamptz,
  publish_date      timestamptz,
  received_at       timestamptz NOT NULL DEFAULT now(),
  signature_checked boolean     NOT NULL,
  held_listing_events integer,
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'honoured', 'no_data')),
  honoured_at       timestamptz
);

COMMENT ON TABLE public.ebay_deletion_requests IS
  'eBay Marketplace Account Deletion notifications, one row per notification_id (written by ebay-account-deletion via record_ebay_deletion). held_listing_events = vehicle_events we hold for that seller at receipt (null when the count timed out). status pending = personal data still to be anonymized; no_data = we held none. signature_checked false = the X-EBAY-SIGNATURE could not be verified when received (no app keys yet); re-verify before honouring. Service role only: usernames are personal data.';

ALTER TABLE public.ebay_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ebay_deletion_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_ebay_deletion(
  p_notification_id text, p_username text, p_user_id text,
  p_event_date timestamptz, p_publish_date timestamptz, p_signature_checked boolean
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '5s'
AS $$
DECLARE n integer;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM vehicle_events
     WHERE source_platform IN ('ebay', 'ebay_motors', 'ebay-motors')
       AND (metadata->>'seller_username' IN (p_username, p_user_id));
  EXCEPTION WHEN query_canceled THEN
    n := NULL;
  END;
  INSERT INTO ebay_deletion_requests AS r
    (notification_id, ebay_username, ebay_user_id, event_date, publish_date, signature_checked, held_listing_events, status)
  VALUES (p_notification_id, p_username, p_user_id, p_event_date, p_publish_date, p_signature_checked, n,
          CASE WHEN n = 0 THEN 'no_data' ELSE 'pending' END)
  ON CONFLICT (notification_id) DO UPDATE
    SET signature_checked = r.signature_checked OR EXCLUDED.signature_checked;
  RETURN CASE WHEN n = 0 THEN 'no_data' ELSE 'pending' END;
END $$;

REVOKE ALL ON FUNCTION public.record_ebay_deletion(text, text, text, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ebay_deletion(text, text, text, timestamptz, timestamptz, boolean) TO service_role;
