-- Business Team/Employee Data (Private)
-- Stores scraped employee/technician data from dealer websites
-- This is private data - not shown publicly, used for internal records and future email outreach

CREATE TABLE IF NOT EXISTS business_team_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to business
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Employee/Team Member Information
  name TEXT NOT NULL, -- Full name
  job_title TEXT, -- "President", "Service Manager", "Buyer", etc.
  department TEXT, -- "Sales", "Service", "Parts", "Admin", etc.
  role_type TEXT, -- "Owner", "Manager", "Technician", "Administrative", etc.
  
  -- Source Information
  source_url TEXT, -- URL where this data was scraped from
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Data Quality
  confidence_score DECIMAL(3,2), -- 0.0-1.0 confidence in accuracy
  is_verified BOOLEAN DEFAULT false, -- Manually verified
  
  -- Privacy & Usage
  is_public BOOLEAN DEFAULT false, -- Never show publicly (always false for scraped data)
  can_email BOOLEAN DEFAULT true, -- Can be used for email outreach
  email_address TEXT, -- If found/verified (usually not on public pages)
  
  -- Metadata
  raw_data JSONB DEFAULT '{}', -- Store original scraped data
  notes TEXT, -- Internal notes
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_business_team_data_business_id ON business_team_data(business_id);
CREATE INDEX IF NOT EXISTS idx_business_team_data_can_email ON business_team_data(can_email) WHERE can_email = true;
CREATE INDEX IF NOT EXISTS idx_business_team_data_is_public ON business_team_data(is_public) WHERE is_public = false;
CREATE INDEX IF NOT EXISTS idx_business_team_data_source_url ON business_team_data(source_url);

-- Ensure unique name+title per business (same person, different titles allowed over time)
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_team_data_unique 
  ON business_team_data(business_id, LOWER(name), COALESCE(job_title, ''));

-- RLS Policy: Private data - only service role can access
ALTER TABLE business_team_data ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can read/write (no public access)
CREATE POLICY "business_team_data_service_role_only"
  ON business_team_data
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE business_team_data IS 'Private scraped employee/technician data from dealer websites. Not shown publicly. Used for internal records and future email outreach.';
COMMENT ON COLUMN business_team_data.is_public IS 'Always false for scraped data. This table is private-only.';
COMMENT ON COLUMN business_team_data.can_email IS 'Whether this contact can be used for email outreach when program launches.';
COMMENT ON COLUMN business_team_data.raw_data IS 'Original scraped HTML/data for reference and future processing.';

-- Add column to businesses table to track if team data exists
ALTER TABLE businesses 
  ADD COLUMN IF NOT EXISTS has_team_data BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_businesses_has_team_data ON businesses(has_team_data) WHERE has_team_data = true;

COMMENT ON COLUMN businesses.has_team_data IS 'Indicates if team/employee data has been scraped for this business (but data is private in business_team_data table).';

