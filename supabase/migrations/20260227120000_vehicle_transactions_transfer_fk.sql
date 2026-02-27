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
