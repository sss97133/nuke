-- ============================================
-- ADD X402 PAYMENT METHOD
-- Adds x402 as a valid payment method option
-- ============================================

-- Drop the existing CHECK constraint
ALTER TABLE generated_invoices
  DROP CONSTRAINT IF EXISTS generated_invoices_preferred_payment_method_check;

-- Recreate the constraint with x402 included
ALTER TABLE generated_invoices
  ADD CONSTRAINT generated_invoices_preferred_payment_method_check 
  CHECK (preferred_payment_method IN ('venmo', 'zelle', 'paypal', 'stripe', 'cash', 'check', 'x402', 'other'));

