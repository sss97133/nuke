-- Migration: Add title_transfer_date field to vehicles table
-- Purpose: Separate legal ownership transfer date (from title) from actual purchase date
-- Date: 2025-10-02

-- Add title_transfer_date column to vehicles table
-- This represents the official date on the title document when ownership legally changed
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS title_transfer_date date;

-- Add comment to explain the field
COMMENT ON COLUMN public.vehicles.title_transfer_date IS 
'Official date on the title document when ownership legally changed. Extracted from title scan. This may differ from purchase_date which represents the actual transaction date.';

-- Add comment to purchase_date for clarity
COMMENT ON COLUMN public.vehicles.purchase_date IS 
'Actual date when the vehicle was purchased. Provided manually by user or from bill of sale. May differ from title_transfer_date which is the legal ownership change date.';

-- Optional: Create an index for querying by title transfer date
CREATE INDEX IF NOT EXISTS idx_vehicles_title_transfer_date 
ON public.vehicles(title_transfer_date) 
WHERE title_transfer_date IS NOT NULL;
