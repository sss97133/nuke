-- Purchase Agreement System SQL Schema
-- This creates the database structure for automated vehicle purchase agreements

-- Create purchase agreements table
CREATE TABLE IF NOT EXISTS public.purchase_agreements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    seller_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    buyer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Agreement status
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_buyer', 'pending_signatures', 'completed', 'cancelled')),

    -- Seller information (auto-filled from profile)
    seller_name TEXT NOT NULL,
    seller_address TEXT,
    seller_city TEXT,
    seller_state TEXT,
    seller_zip TEXT,
    seller_phone TEXT,
    seller_fax TEXT,

    -- Buyer information (filled when buyer is selected)
    buyer_name TEXT,
    buyer_address TEXT,
    buyer_city TEXT,
    buyer_state TEXT,
    buyer_zip TEXT,
    buyer_phone TEXT,
    buyer_cell TEXT,

    -- Vehicle information (auto-filled from vehicle record)
    vehicle_stock_number TEXT,
    vehicle_source TEXT,
    salesman_name TEXT,
    agreement_date DATE DEFAULT CURRENT_DATE,
    delivery_date DATE,
    vehicle_condition TEXT DEFAULT 'used' CHECK (vehicle_condition IN ('new', 'used')),

    -- Trade-in vehicle information
    tradein_year INTEGER,
    tradein_make TEXT,
    tradein_model TEXT,
    tradein_vin TEXT,
    tradein_license TEXT,
    tradein_odometer INTEGER,
    tradein_balance_owed_to TEXT,
    tradein_payoff_amount DECIMAL(10,2),
    tradein_lender_address TEXT,

    -- Warranty information
    warranty_declined BOOLEAN DEFAULT false,
    warranty_provider TEXT,
    warranty_contract_number TEXT,
    warranty_term TEXT,
    warranty_deductible TEXT,

    -- Price breakdown
    accessories_price DECIMAL(10,2) DEFAULT 0,
    vehicle_sales_price DECIMAL(10,2) NOT NULL,
    document_fee DECIMAL(10,2) DEFAULT 0,
    dealer_handling_fee DECIMAL(10,2) DEFAULT 0,
    warranty_contract_price DECIMAL(10,2) DEFAULT 0,
    smog_fee DECIMAL(10,2) DEFAULT 0,
    sales_tax_rate DECIMAL(5,4) DEFAULT 0,
    sales_tax_amount DECIMAL(10,2) DEFAULT 0,
    tradein_credit_value DECIMAL(10,2) DEFAULT 0,
    tradein_payoff_amount_actual DECIMAL(10,2) DEFAULT 0,
    tradein_net_value DECIMAL(10,2) DEFAULT 0,
    sales_tax_credit_rate DECIMAL(5,4) DEFAULT 0,
    sales_tax_credit_amount DECIMAL(10,2) DEFAULT 0,
    title_fee DECIMAL(10,2) DEFAULT 0,
    drive_permit_fee DECIMAL(10,2) DEFAULT 0,
    shipping_service_fee DECIMAL(10,2) DEFAULT 0,
    total_gross_proceeds DECIMAL(10,2) DEFAULT 0,
    partial_payment_amount DECIMAL(10,2) DEFAULT 0,
    partial_payment_date DATE,
    balance_due DECIMAL(10,2) DEFAULT 0,
    balance_due_date DATE,

    -- Financing terms
    loan_from TEXT,
    loan_amount DECIMAL(10,2) DEFAULT 0,
    finance_charge DECIMAL(10,2) DEFAULT 0,
    total_loan_amount DECIMAL(10,2) DEFAULT 0,
    annual_percentage_rate DECIMAL(5,4) DEFAULT 0,
    installment_amount DECIMAL(10,2) DEFAULT 0,
    total_of_payments DECIMAL(10,2) DEFAULT 0,
    deferred_down_payment DECIMAL(10,2) DEFAULT 0,
    payment_frequency TEXT DEFAULT 'monthly' CHECK (payment_frequency IN ('weekly', 'monthly')),
    first_payment_date DATE,

    -- Digital signatures
    buyer_signature_data JSONB,
    buyer_signature_date TIMESTAMP WITH TIME ZONE,
    co_buyer_signature_data JSONB,
    co_buyer_signature_date TIMESTAMP WITH TIME ZONE,
    seller_signature_data JSONB,
    seller_signature_date TIMESTAMP WITH TIME ZONE,

    -- Agreement generation and completion
    agreement_html TEXT, -- Store the filled HTML template
    pdf_file_path TEXT, -- Path to generated PDF
    email_sent BOOLEAN DEFAULT false,
    email_sent_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create buyer candidates table (for tracking interested buyers)
CREATE TABLE IF NOT EXISTS public.purchase_agreement_buyer_candidates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    seller_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Buyer information (for users not yet in the system)
    buyer_email TEXT,
    buyer_name TEXT,
    buyer_phone TEXT,
    buyer_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Invitation status
    status TEXT DEFAULT 'invited' CHECK (status IN ('invited', 'registered', 'declined')),
    invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    responded_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create signature verification table
CREATE TABLE IF NOT EXISTS public.purchase_agreement_signatures (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agreement_id UUID NOT NULL REFERENCES public.purchase_agreements(id) ON DELETE CASCADE,
    signer_role TEXT NOT NULL CHECK (signer_role IN ('buyer', 'co_buyer', 'seller')),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Signature data
    signature_data JSONB NOT NULL, -- Contains signature image data, timestamp, IP, etc.
    signed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,

    -- Verification
    verified BOOLEAN DEFAULT false,
    verification_method TEXT, -- 'email', 'sms', 'face_id', etc.

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_purchase_agreements_vehicle_id ON public.purchase_agreements(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_purchase_agreements_seller_user_id ON public.purchase_agreements(seller_user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_agreements_buyer_user_id ON public.purchase_agreements(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_agreements_status ON public.purchase_agreements(status);
CREATE INDEX IF NOT EXISTS idx_purchase_agreements_created_at ON public.purchase_agreements(created_at);

CREATE INDEX IF NOT EXISTS idx_buyer_candidates_vehicle_id ON public.purchase_agreement_buyer_candidates(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_buyer_candidates_seller_user_id ON public.purchase_agreement_buyer_candidates(seller_user_id);
CREATE INDEX IF NOT EXISTS idx_buyer_candidates_buyer_user_id ON public.purchase_agreement_buyer_candidates(buyer_user_id);

CREATE INDEX IF NOT EXISTS idx_signatures_agreement_id ON public.purchase_agreement_signatures(agreement_id);
CREATE INDEX IF NOT EXISTS idx_signatures_user_id ON public.purchase_agreement_signatures(user_id);

-- Function to auto-calculate totals
CREATE OR REPLACE FUNCTION calculate_purchase_agreement_totals(agreement_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    agreement_record purchase_agreements%ROWTYPE;
    taxable_proceeds DECIMAL(10,2);
    gross_proceeds DECIMAL(10,2);
    balance_amount DECIMAL(10,2);
BEGIN
    -- Get the agreement record
    SELECT * INTO agreement_record FROM purchase_agreements WHERE id = agreement_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Calculate taxable sales proceeds
    taxable_proceeds :=
        COALESCE(agreement_record.accessories_price, 0) +
        COALESCE(agreement_record.vehicle_sales_price, 0) +
        COALESCE(agreement_record.document_fee, 0) +
        COALESCE(agreement_record.dealer_handling_fee, 0) +
        COALESCE(agreement_record.warranty_contract_price, 0) +
        COALESCE(agreement_record.smog_fee, 0);

    -- Calculate sales tax
    UPDATE purchase_agreements
    SET sales_tax_amount = taxable_proceeds * COALESCE(sales_tax_rate, 0)
    WHERE id = agreement_id;

    -- Calculate tradein net value
    UPDATE purchase_agreements
    SET tradein_net_value = COALESCE(tradein_credit_value, 0) - COALESCE(tradein_payoff_amount_actual, 0)
    WHERE id = agreement_id;

    -- Calculate sales tax credit
    UPDATE purchase_agreements
    SET sales_tax_credit_amount = COALESCE(tradein_credit_value, 0) * COALESCE(sales_tax_credit_rate, 0)
    WHERE id = agreement_id;

    -- Calculate total gross proceeds
    gross_proceeds :=
        taxable_proceeds +
        COALESCE(agreement_record.sales_tax_amount, 0) +
        COALESCE(agreement_record.title_fee, 0) +
        COALESCE(agreement_record.drive_permit_fee, 0) +
        COALESCE(agreement_record.shipping_service_fee, 0) -
        COALESCE(agreement_record.sales_tax_credit_amount, 0);

    -- Calculate balance due
    balance_amount := gross_proceeds - COALESCE(agreement_record.partial_payment_amount, 0);

    -- Update calculated fields
    UPDATE purchase_agreements
    SET
        total_gross_proceeds = gross_proceeds,
        balance_due = balance_amount,
        updated_at = NOW()
    WHERE id = agreement_id;

    RETURN TRUE;
END;
$$;

-- Function to generate purchase agreement from vehicle data
CREATE OR REPLACE FUNCTION create_purchase_agreement_from_vehicle(
    p_vehicle_id UUID,
    p_seller_user_id UUID,
    p_vehicle_sales_price DECIMAL(10,2)
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    vehicle_record vehicles%ROWTYPE;
    seller_profile profiles%ROWTYPE;
    new_agreement_id UUID;
BEGIN
    -- Get vehicle record
    SELECT * INTO vehicle_record FROM vehicles WHERE id = p_vehicle_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Vehicle not found';
    END IF;

    -- Get seller profile
    SELECT * INTO seller_profile FROM profiles WHERE id = p_seller_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller profile not found';
    END IF;

    -- Create new purchase agreement
    INSERT INTO purchase_agreements (
        vehicle_id,
        seller_user_id,
        seller_name,
        vehicle_sales_price,
        vehicle_condition,
        agreement_date
    ) VALUES (
        p_vehicle_id,
        p_seller_user_id,
        COALESCE(seller_profile.full_name, seller_profile.email),
        p_vehicle_sales_price,
        CASE WHEN vehicle_record.year >= EXTRACT(YEAR FROM CURRENT_DATE) THEN 'new' ELSE 'used' END,
        CURRENT_DATE
    ) RETURNING id INTO new_agreement_id;

    -- Calculate totals
    PERFORM calculate_purchase_agreement_totals(new_agreement_id);

    RETURN new_agreement_id;
END;
$$;

-- RLS Policies
ALTER TABLE public.purchase_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_agreement_buyer_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_agreement_signatures ENABLE ROW LEVEL SECURITY;

-- Sellers can view and edit their own purchase agreements
CREATE POLICY "Sellers can manage own purchase agreements"
ON public.purchase_agreements
FOR ALL
USING (seller_user_id = auth.uid());

-- Buyers can view purchase agreements they're involved in
CREATE POLICY "Buyers can view assigned purchase agreements"
ON public.purchase_agreements
FOR SELECT
USING (buyer_user_id = auth.uid());

-- Buyers can update their signature data
CREATE POLICY "Buyers can sign purchase agreements"
ON public.purchase_agreements
FOR UPDATE
USING (buyer_user_id = auth.uid());

-- Similar policies for buyer candidates and signatures
CREATE POLICY "Sellers can manage buyer candidates"
ON public.purchase_agreement_buyer_candidates
FOR ALL
USING (seller_user_id = auth.uid());

CREATE POLICY "Users can view own signatures"
ON public.purchase_agreement_signatures
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can create own signatures"
ON public.purchase_agreement_signatures
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Grant permissions
GRANT ALL ON TABLE public.purchase_agreements TO authenticated;
GRANT ALL ON TABLE public.purchase_agreement_buyer_candidates TO authenticated;
GRANT ALL ON TABLE public.purchase_agreement_signatures TO authenticated;

GRANT EXECUTE ON FUNCTION calculate_purchase_agreement_totals(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_purchase_agreement_from_vehicle(UUID, UUID, DECIMAL) TO authenticated;

-- Comments for documentation
COMMENT ON TABLE public.purchase_agreements IS 'Vehicle purchase agreements with auto-filled seller data and digital signature support';
COMMENT ON TABLE public.purchase_agreement_buyer_candidates IS 'Track potential buyers before they join the system or complete agreements';
COMMENT ON TABLE public.purchase_agreement_signatures IS 'Digital signature verification and audit trail';

COMMENT ON FUNCTION calculate_purchase_agreement_totals(UUID) IS 'Auto-calculate price totals, taxes, and balance due for purchase agreement';
COMMENT ON FUNCTION create_purchase_agreement_from_vehicle(UUID, UUID, DECIMAL) IS 'Initialize purchase agreement with vehicle and seller data';