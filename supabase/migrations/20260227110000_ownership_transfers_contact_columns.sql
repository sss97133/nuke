-- =============================================================================
-- Add missing contact + access columns to ownership_transfers
-- =============================================================================
-- The deployed edge functions (transfer-automator, notify-transfer-parties,
-- transfer-email-webhook, transfer-status-api) all reference these columns,
-- but the original 20260226200000_ownership_transfers.sql migration never
-- included them. This migration adds them safely with IF NOT EXISTS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Inbox email — unique per-transfer address for inbound parsing
--    Format: t-{shortid}@nuke.ag
--    Set by: transfer-automator on seed
--    Read by: transfer-email-webhook, notify-transfer-parties
-- ---------------------------------------------------------------------------
ALTER TABLE public.ownership_transfers
  ADD COLUMN IF NOT EXISTS inbox_email text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfers_inbox_email
  ON public.ownership_transfers(inbox_email)
  WHERE inbox_email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Access tokens — tokenized URLs for buyer/seller transfer page
--    No auth required — these UUIDs ARE the auth credential for /t/{token}
--    Set by: migration default (below) — generated at insert time
--    Read by: notify-transfer-parties (builds buyer/seller links)
-- ---------------------------------------------------------------------------
ALTER TABLE public.ownership_transfers
  ADD COLUMN IF NOT EXISTS buyer_access_token  uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS seller_access_token uuid DEFAULT gen_random_uuid();

-- Backfill existing rows that got NULL (pre-default)
UPDATE public.ownership_transfers
  SET buyer_access_token  = gen_random_uuid()
  WHERE buyer_access_token IS NULL;

UPDATE public.ownership_transfers
  SET seller_access_token = gen_random_uuid()
  WHERE seller_access_token IS NULL;

-- Unique indexes so token-based lookups are fast and collisions are caught
CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfers_buyer_token
  ON public.ownership_transfers(buyer_access_token)
  WHERE buyer_access_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfers_seller_token
  ON public.ownership_transfers(seller_access_token)
  WHERE seller_access_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Contact info — direct phone/email for SMS + email outreach
--    Populated via transfer-automator update_contacts action
--    or when identity is claimed (upgrade_transfers_on_identity_claim trigger)
-- ---------------------------------------------------------------------------
ALTER TABLE public.ownership_transfers
  ADD COLUMN IF NOT EXISTS buyer_phone  text,   -- normalized 10-digit US, no dashes
  ADD COLUMN IF NOT EXISTS buyer_email  text,
  ADD COLUMN IF NOT EXISTS seller_phone text,
  ADD COLUMN IF NOT EXISTS seller_email text;

-- ---------------------------------------------------------------------------
-- 4. stalled status — used by staleness_sweep + transfer_status_changed trigger
--    The transfer_status enum in the original migration lacks 'stalled'.
--    Add it if not present.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'transfer_status'
      AND e.enumlabel = 'stalled'
  ) THEN
    ALTER TYPE transfer_status ADD VALUE 'stalled';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 5. pipeline_registry — document new columns
-- ---------------------------------------------------------------------------
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
  ('ownership_transfers', 'inbox_email',          'transfer-automator',      'Unique inbound email address t-{shortid}@nuke.ag. Set at transfer seed. Used by transfer-email-webhook.', true, 'transfer-automator seed_from_auction / seed_from_listing'),
  ('ownership_transfers', 'buyer_access_token',   'ownership-transfer-system', 'UUID token for token-gated buyer transfer page /t/{token}. Generated at insert.', true, 'auto-generated on insert — do not overwrite'),
  ('ownership_transfers', 'seller_access_token',  'ownership-transfer-system', 'UUID token for token-gated seller transfer page /t/{token}. Generated at insert.', true, 'auto-generated on insert — do not overwrite'),
  ('ownership_transfers', 'buyer_phone',           'transfer-automator',      '10-digit US phone, no dashes/country code. Set via update_contacts action.', false, 'transfer-automator update_contacts'),
  ('ownership_transfers', 'buyer_email',           'transfer-automator',      'Buyer contact email. Set via update_contacts action.', false, 'transfer-automator update_contacts'),
  ('ownership_transfers', 'seller_phone',          'transfer-automator',      '10-digit US phone, no dashes/country code. Set via update_contacts action.', false, 'transfer-automator update_contacts'),
  ('ownership_transfers', 'seller_email',          'transfer-automator',      'Seller contact email. Set via update_contacts action.', false, 'transfer-automator update_contacts')
ON CONFLICT (table_name, column_name) DO UPDATE
  SET owned_by = EXCLUDED.owned_by,
      description = EXCLUDED.description,
      do_not_write_directly = EXCLUDED.do_not_write_directly,
      write_via = EXCLUDED.write_via;

-- ---------------------------------------------------------------------------
-- 6. Comments
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.ownership_transfers.inbox_email         IS 'Unique inbound email address (t-{shortid}@nuke.ag). Parsed by transfer-email-webhook to route messages to the correct transfer thread.';
COMMENT ON COLUMN public.ownership_transfers.buyer_access_token  IS 'UUID used as auth credential for buyer transfer page /t/{token}. No login required — possessing this token grants buyer-view access.';
COMMENT ON COLUMN public.ownership_transfers.seller_access_token IS 'UUID used as auth credential for seller transfer page /t/{token}. No login required — possessing this token grants seller-view access.';
COMMENT ON COLUMN public.ownership_transfers.buyer_phone         IS 'Buyer contact phone (10-digit US). Used for outbound SMS via notify-transfer-parties. Set via transfer-automator update_contacts.';
COMMENT ON COLUMN public.ownership_transfers.buyer_email         IS 'Buyer contact email. Used for outbound email via notify-transfer-parties. Set via transfer-automator update_contacts.';
COMMENT ON COLUMN public.ownership_transfers.seller_phone        IS 'Seller contact phone (10-digit US). Used for outbound SMS via notify-transfer-parties. Set via transfer-automator update_contacts.';
COMMENT ON COLUMN public.ownership_transfers.seller_email        IS 'Seller contact email. Used for outbound email via notify-transfer-parties. Set via transfer-automator update_contacts.';
