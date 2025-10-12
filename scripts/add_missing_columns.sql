-- Add missing columns to shops table

-- Add org_type if it doesn't exist
ALTER TABLE shops 
ADD COLUMN IF NOT EXISTS org_type TEXT DEFAULT 'shop';

-- Add legal entity fields if they don't exist  
ALTER TABLE shops
ADD COLUMN IF NOT EXISTS legal_entity_name TEXT,
ADD COLUMN IF NOT EXISTS dba_name TEXT,
ADD COLUMN IF NOT EXISTS ein TEXT,
ADD COLUMN IF NOT EXISTS business_type TEXT;

-- Add verification fields if missing
ALTER TABLE shops
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified';

COMMENT ON COLUMN shops.org_type IS 'Type of organization: dealer, shop, garage, builder, transporter';
COMMENT ON COLUMN shops.legal_entity_name IS 'Legal registered business name';
COMMENT ON COLUMN shops.dba_name IS 'Doing Business As name';
COMMENT ON COLUMN shops.ein IS 'Employer Identification Number';
COMMENT ON COLUMN shops.business_type IS 'Business structure: LLC, Corporation, Partnership, Sole Proprietorship';
