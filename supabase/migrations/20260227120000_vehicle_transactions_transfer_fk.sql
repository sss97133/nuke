-- =============================================================================
-- Link vehicle_transactions to ownership_transfers
-- =============================================================================
-- Implements the CTO architectural decision from VP_DEAL_FLOW_TRANSFER_BRIEF.md:
-- "vehicle_transactions should become the fee/payment record that gets created
--  at the payment_confirmed milestone — not a parallel flow."
--
-- After this migration:
-- 1. vehicle_transactions.ownership_transfer_id FK links the fee record to the
--    parent transfer.
-- 2. stripe-webhook can advance the payment_confirmed milestone on payment success
--    by looking up the transfer via this FK.
-- 3. stripe-checkout can accept transfer_id in session metadata so the webhook
--    knows which transfer to advance without a DB lookup.
-- =============================================================================

-- Add FK column
ALTER TABLE public.vehicle_transactions
  ADD COLUMN IF NOT EXISTS ownership_transfer_id uuid
    REFERENCES public.ownership_transfers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_transfer
  ON public.vehicle_transactions(ownership_transfer_id)
  WHERE ownership_transfer_id IS NOT NULL;

COMMENT ON COLUMN public.vehicle_transactions.ownership_transfer_id IS
  'FK to ownership_transfers. Set when the facilitation fee checkout session is created. '
  'Enables stripe-webhook to advance the payment_confirmed milestone after payment.';

-- pipeline_registry entry
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
  ('vehicle_transactions', 'ownership_transfer_id', 'stripe-checkout', 'FK to ownership_transfers. Set at Stripe checkout session creation. Links fee record to parent transfer.', false, 'stripe-checkout when creating vehicle_transaction checkout session')
ON CONFLICT (table_name, column_name) DO UPDATE
  SET owned_by = EXCLUDED.owned_by,
      description = EXCLUDED.description;

-- Also update backfill_transfers_for_sold_auctions to pass suppress_notifications:true
-- This prevents historical backfill (crons 223-227) from sending 150K emails
-- NOTE: This function body is also managed via Management API. See session notes 2026-02-27.
CREATE OR REPLACE FUNCTION public.backfill_transfers_for_sold_auctions(
  batch_size integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row record;
  v_key text;
  v_url text := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-automator';
  v_count integer := 0;
BEGIN
  v_key := COALESCE(
    (SELECT value FROM public._app_secrets WHERE key = 'service_role_key' LIMIT 1),
    current_setting('app.settings.service_role_key', true),
    current_setting('app.service_role_key', true)
  );

  FOR v_row IN
    SELECT ae.id, ae.vehicle_id
    FROM public.auction_events ae
    WHERE ae.outcome = 'sold'
      AND NOT EXISTS (
        SELECT 1 FROM public.ownership_transfers ot
        WHERE ot.trigger_id = ae.id
          AND ot.trigger_table = 'auction_events'
      )
    ORDER BY ae.auction_end_date DESC
    LIMIT batch_size
  LOOP
    BEGIN
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(v_key, '')
        ),
        body := jsonb_build_object(
          'action', 'seed_from_auction',
          'auction_event_id', v_row.id::text,
          'suppress_notifications', true   -- CRITICAL: prevents 150K email blast on backfill
        ),
        timeout_milliseconds := 30000
      );
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[backfill_transfers] pg_net call failed for %: %', v_row.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'queued', v_count,
    'ran_at', NOW(),
    'suppress_notifications', true
  );
END;
$$;
