-- Quick fix for timeline_events table to add essential columns for the Add Event button
ALTER TABLE timeline_events 
ADD COLUMN IF NOT EXISTS mileage_at_event INTEGER,
ADD COLUMN IF NOT EXISTS cost_amount DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS cost_currency TEXT DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS location_name TEXT,
ADD COLUMN IF NOT EXISTS location_address TEXT,
ADD COLUMN IF NOT EXISTS service_provider_name TEXT,
ADD COLUMN IF NOT EXISTS service_provider_type TEXT,
ADD COLUMN IF NOT EXISTS invoice_number TEXT,
ADD COLUMN IF NOT EXISTS parts_used JSONB[],
ADD COLUMN IF NOT EXISTS is_insurance_claim BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS insurance_claim_number TEXT,
ADD COLUMN IF NOT EXISTS next_service_due_date DATE,
ADD COLUMN IF NOT EXISTS next_service_due_mileage INTEGER;
