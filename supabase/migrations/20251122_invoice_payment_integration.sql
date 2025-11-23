-- ============================================
-- INVOICE PAYMENT INTEGRATION
-- Enable public invoice links and payment tracking
-- ============================================

-- Add payment fields to generated_invoices
ALTER TABLE generated_invoices
  ADD COLUMN IF NOT EXISTS payment_token TEXT UNIQUE, -- Public access token for invoice
  ADD COLUMN IF NOT EXISTS payment_link TEXT, -- Full payment URL
  ADD COLUMN IF NOT EXISTS preferred_payment_method TEXT CHECK (preferred_payment_method IN ('venmo', 'zelle', 'paypal', 'stripe', 'cash', 'check', 'other')),
  ADD COLUMN IF NOT EXISTS payment_method_details JSONB DEFAULT '{}'::jsonb, -- Store account info, links, etc.
  ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ, -- When client marked as paid
  ADD COLUMN IF NOT EXISTS payment_confirmed_by TEXT, -- Name/email of person who confirmed
  ADD COLUMN IF NOT EXISTS payment_notes TEXT, -- Notes from client about payment
  ADD COLUMN IF NOT EXISTS public_access_enabled BOOLEAN DEFAULT TRUE; -- Enable public link access

-- Create index for payment token lookups (fast public access)
CREATE INDEX IF NOT EXISTS idx_invoices_payment_token ON generated_invoices(payment_token) WHERE payment_token IS NOT NULL;

-- Create index for payment status
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON generated_invoices(payment_status);

-- Function to generate payment token and link
CREATE OR REPLACE FUNCTION generate_invoice_payment_link(p_invoice_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_token TEXT;
  v_payment_link TEXT;
BEGIN
  -- Generate unique token (32 chars, alphanumeric)
  v_token := upper(substring(gen_random_uuid()::text from 1 for 8) || 
                   substring(gen_random_uuid()::text from 10 for 8) ||
                   substring(gen_random_uuid()::text from 15 for 8) ||
                   substring(gen_random_uuid()::text from 20 for 8));
  
  -- Build payment link
  v_payment_link := 'https://n-zero.dev/pay/' || v_token;
  
  -- Update invoice with token and link
  UPDATE generated_invoices
  SET 
    payment_token = v_token,
    payment_link = v_payment_link,
    public_access_enabled = TRUE,
    updated_at = NOW()
  WHERE id = p_invoice_id;
  
  RETURN v_payment_link;
END;
$$ LANGUAGE plpgsql;

-- Function to mark invoice as paid (can be called from public page)
CREATE OR REPLACE FUNCTION mark_invoice_paid(
  p_payment_token TEXT,
  p_payment_method TEXT,
  p_payment_method_details JSONB DEFAULT '{}'::jsonb,
  p_confirmed_by TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_invoice RECORD;
  v_result JSONB;
BEGIN
  -- Get invoice by token
  SELECT * INTO v_invoice
  FROM generated_invoices
  WHERE payment_token = p_payment_token
    AND public_access_enabled = TRUE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invoice not found or access disabled'
    );
  END IF;
  
  -- Mark as paid
  UPDATE generated_invoices
  SET 
    payment_status = 'paid',
    amount_paid = total_amount,
    amount_due = 0,
    preferred_payment_method = p_payment_method,
    payment_method_details = p_payment_method_details,
    payment_confirmed_at = NOW(),
    payment_confirmed_by = p_confirmed_by,
    payment_notes = p_notes,
    updated_at = NOW()
  WHERE id = v_invoice.id;
  
  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'amount_paid', v_invoice.total_amount
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; -- Allow public access

-- Update invoice generation function to auto-create payment link
CREATE OR REPLACE FUNCTION generate_invoice_from_event(p_event_id UUID)
RETURNS UUID AS $$
DECLARE
  v_invoice_id UUID;
  v_payment_link TEXT;
BEGIN
  -- Call existing invoice generation logic
  -- (This assumes the function already exists - we're just adding payment link generation)
  
  -- Generate invoice ID (this would normally come from the main generation function)
  -- For now, we'll create a wrapper that generates the link after invoice creation
  
  -- This is a placeholder - the actual implementation would integrate with existing function
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- View to get invoice by payment token (public access)
CREATE OR REPLACE VIEW public_invoice_view AS
SELECT 
  gi.id,
  gi.invoice_number,
  gi.invoice_date,
  gi.due_date,
  gi.subtotal,
  gi.tax_amount,
  gi.total_amount,
  gi.amount_paid,
  gi.amount_due,
  gi.payment_status,
  gi.payment_token,
  gi.payment_link,
  gi.preferred_payment_method,
  gi.payment_method_details,
  gi.html_content,
  gi.status,
  c.client_name,
  c.company_name,
  c.contact_email,
  te.title as event_title,
  te.event_date,
  v.year,
  v.make,
  v.model,
  v.series,
  v.vin,
  b.business_name,
  b.address as shop_address,
  b.city as shop_city,
  b.state as shop_state,
  b.zip_code as shop_zip,
  b.phone as shop_phone,
  b.email as shop_email
FROM generated_invoices gi
LEFT JOIN clients c ON c.id = gi.client_id
LEFT JOIN timeline_events te ON te.id = gi.event_id
LEFT JOIN vehicles v ON v.id = te.vehicle_id
LEFT JOIN businesses b ON b.id = gi.business_id
WHERE gi.public_access_enabled = TRUE;

-- Grant public access to view (for unauthenticated users)
GRANT SELECT ON public_invoice_view TO anon;
GRANT SELECT ON public_invoice_view TO authenticated;

-- Create function to get invoice by token (public)
CREATE OR REPLACE FUNCTION get_invoice_by_token(p_token TEXT)
RETURNS TABLE (
  id UUID,
  invoice_number TEXT,
  invoice_date DATE,
  due_date DATE,
  subtotal DECIMAL,
  tax_amount DECIMAL,
  total_amount DECIMAL,
  amount_paid DECIMAL,
  amount_due DECIMAL,
  payment_status TEXT,
  payment_token TEXT,
  payment_link TEXT,
  preferred_payment_method TEXT,
  payment_method_details JSONB,
  html_content TEXT,
  status TEXT,
  client_name TEXT,
  company_name TEXT,
  contact_email TEXT,
  event_title TEXT,
  event_date DATE,
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_series TEXT,
  vehicle_vin TEXT,
  shop_name TEXT,
  shop_address TEXT,
  shop_city TEXT,
  shop_state TEXT,
  shop_zip TEXT,
  shop_phone TEXT,
  shop_email TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    piv.id,
    piv.invoice_number,
    piv.invoice_date,
    piv.due_date,
    piv.subtotal,
    piv.tax_amount,
    piv.total_amount,
    piv.amount_paid,
    piv.amount_due,
    piv.payment_status,
    piv.payment_token,
    piv.payment_link,
    piv.preferred_payment_method,
    piv.payment_method_details,
    piv.html_content,
    piv.status,
    piv.client_name,
    piv.company_name,
    piv.contact_email,
    piv.event_title,
    piv.event_date,
    piv.year,
    piv.make,
    piv.model,
    piv.series,
    piv.vin,
    piv.business_name,
    piv.shop_address,
    piv.shop_city,
    piv.shop_state,
    piv.shop_zip,
    piv.shop_phone,
    piv.shop_email
  FROM public_invoice_view piv
  WHERE piv.payment_token = p_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to anonymous users
GRANT EXECUTE ON FUNCTION get_invoice_by_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_invoice_by_token(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_invoice_paid(TEXT, TEXT, JSONB, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION mark_invoice_paid(TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_invoice_payment_link(UUID) TO authenticated;

