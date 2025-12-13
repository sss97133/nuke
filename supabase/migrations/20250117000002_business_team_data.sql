-- Business Team/Employee Data (Private)
-- Stores scraped employee/technician data from dealer websites
-- This is private data - not shown publicly, used for internal records and future email outreach

DO $$
BEGIN
  IF to_regclass('public.businesses') IS NULL THEN
    RAISE NOTICE 'Skipping 20250117000002_business_team_data.sql because public.businesses does not exist yet';
  ELSE
    EXECUTE $sql$
      CREATE TABLE IF NOT EXISTS public.business_team_data (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Link to business
        business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

        -- Employee/Team Member Information
        name TEXT NOT NULL,
        job_title TEXT,
        department TEXT,
        role_type TEXT,

        -- Source Information
        source_url TEXT,
        scraped_at TIMESTAMPTZ DEFAULT NOW(),

        -- Data Quality
        confidence_score DECIMAL(3,2),
        is_verified BOOLEAN DEFAULT false,

        -- Privacy & Usage
        is_public BOOLEAN DEFAULT false,
        can_email BOOLEAN DEFAULT true,
        email_address TEXT,

        -- Metadata
        raw_data JSONB DEFAULT '{}',
        notes TEXT,

        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    $sql$;

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_business_team_data_business_id ON public.business_team_data(business_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_business_team_data_can_email ON public.business_team_data(can_email) WHERE can_email = true';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_business_team_data_is_public ON public.business_team_data(is_public) WHERE is_public = false';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_business_team_data_source_url ON public.business_team_data(source_url)';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_business_team_data_unique ON public.business_team_data(business_id, LOWER(name), COALESCE(job_title, ''''))';

    EXECUTE 'ALTER TABLE public.business_team_data ENABLE ROW LEVEL SECURITY';

    -- Policy: Only service role can read/write (no public access)
    EXECUTE $sql$
      CREATE POLICY "business_team_data_service_role_only"
        ON public.business_team_data
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    $sql$;

    EXECUTE 'COMMENT ON TABLE public.business_team_data IS ''Private scraped employee/technician data from dealer websites. Not shown publicly. Used for internal records and future email outreach.''';
    EXECUTE 'COMMENT ON COLUMN public.business_team_data.is_public IS ''Always false for scraped data. This table is private-only.''';
    EXECUTE 'COMMENT ON COLUMN public.business_team_data.can_email IS ''Whether this contact can be used for email outreach when program launches.''';
    EXECUTE 'COMMENT ON COLUMN public.business_team_data.raw_data IS ''Original scraped HTML/data for reference and future processing.''';

    EXECUTE 'ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS has_team_data BOOLEAN DEFAULT false';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_businesses_has_team_data ON public.businesses(has_team_data) WHERE has_team_data = true';
    EXECUTE 'COMMENT ON COLUMN public.businesses.has_team_data IS ''Indicates if team/employee data has been scraped for this business (but data is private in business_team_data table).''';
  END IF;
END $$;


