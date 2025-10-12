-- Timeline Events Schema Enhancement
-- Run this directly in the Supabase SQL Editor

-- Add essential columns needed for the enhanced timeline events
ALTER TABLE timeline_events 
ADD COLUMN IF NOT EXISTS mileage_at_event INTEGER,
ADD COLUMN IF NOT EXISTS cost_amount DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS cost_currency TEXT DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS location_name TEXT,
ADD COLUMN IF NOT EXISTS location_address TEXT,
ADD COLUMN IF NOT EXISTS service_provider_name TEXT,
ADD COLUMN IF NOT EXISTS service_provider_type TEXT CHECK (service_provider_type IN ('dealer', 'independent_shop', 'mobile_mechanic', 'diy', 'specialty_shop', 'tire_shop', 'body_shop', 'detailer', 'other')),
ADD COLUMN IF NOT EXISTS invoice_number TEXT,
ADD COLUMN IF NOT EXISTS warranty_info JSONB,
ADD COLUMN IF NOT EXISTS parts_used JSONB[], 
ADD COLUMN IF NOT EXISTS verification_documents JSONB[],
ADD COLUMN IF NOT EXISTS is_insurance_claim BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS insurance_claim_number TEXT,
ADD COLUMN IF NOT EXISTS next_service_due_date DATE,
ADD COLUMN IF NOT EXISTS next_service_due_mileage INTEGER;
