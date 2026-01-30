-- Craigslist Archive Import System
-- Tables for importing historical Craigslist listings with historian attribution and unverified contact tracking

-- 1. Unverified Contacts - Store extracted phone numbers for future outreach
CREATE TABLE IF NOT EXISTS public.unverified_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT NOT NULL,           -- E.164 format (+14055551234)
    phone_raw TEXT,                       -- Original text ("405-441--313six")
    phone_hash TEXT UNIQUE,               -- SHA256 hash for deduplication
    location TEXT,                        -- City/region from listing
    verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN (
        'unverified', 'verified', 'invalid', 'disconnected', 'opted_out'
    )),
    outreach_status TEXT DEFAULT 'pending' CHECK (outreach_status IN (
        'pending', 'contacted', 'responded', 'no_response', 'do_not_contact'
    )),
    outreach_attempts INTEGER DEFAULT 0,
    last_outreach_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',          -- Flexible storage for additional info
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_unverified_contacts_phone_hash ON unverified_contacts(phone_hash);
CREATE INDEX IF NOT EXISTS idx_unverified_contacts_verification_status ON unverified_contacts(verification_status);
CREATE INDEX IF NOT EXISTS idx_unverified_contacts_outreach_status ON unverified_contacts(outreach_status);

-- 2. Vehicle Unverified Owners - Link vehicles to potential owners from listings
CREATE TABLE IF NOT EXISTS public.vehicle_unverified_owners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES unverified_contacts(id) ON DELETE CASCADE,
    source_listing_url TEXT,              -- Original Craigslist URL
    source_post_id TEXT,                  -- CL post ID (e.g., "5942526222")
    listing_date DATE,                    -- When the listing was posted
    asking_price NUMERIC,                 -- Listed price at time of posting
    relationship_type TEXT DEFAULT 'seller' CHECK (relationship_type IN (
        'seller', 'owner', 'dealer', 'consigner', 'unknown'
    )),
    confidence_score NUMERIC DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(vehicle_id, contact_id, source_post_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_vehicle_unverified_owners_vehicle ON vehicle_unverified_owners(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_unverified_owners_contact ON vehicle_unverified_owners(contact_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_unverified_owners_listing_date ON vehicle_unverified_owners(listing_date);

-- 3. Archive Imports - Track import batches for audit trail
CREATE TABLE IF NOT EXISTS public.archive_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_name TEXT NOT NULL,            -- Human-readable name (e.g., "Craigslist 2012-2018")
    import_source TEXT DEFAULT 'craigslist_archive',
    historian_user_id UUID REFERENCES auth.users(id),
    source_directory TEXT,                -- Path to source files
    file_count INTEGER DEFAULT 0,
    files_processed INTEGER DEFAULT 0,
    files_failed INTEGER DEFAULT 0,
    vehicles_created INTEGER DEFAULT 0,
    vehicles_updated INTEGER DEFAULT 0,
    contacts_created INTEGER DEFAULT 0,
    timeline_events_created INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'in_progress', 'completed', 'failed', 'cancelled'
    )),
    error_log JSONB DEFAULT '[]',         -- Array of error messages
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archive_imports_status ON archive_imports(status);
CREATE INDEX IF NOT EXISTS idx_archive_imports_historian ON archive_imports(historian_user_id);

-- 4. Add 'discovery' to timeline_events event_type if the constraint allows
-- First, check if we need to alter the constraint
DO $$
BEGIN
    -- Try to add new event types to the timeline_events event_type check constraint
    -- This handles the case where the column exists but needs additional types
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'timeline_events'
        AND column_name = 'event_type'
        AND table_schema = 'public'
    ) THEN
        -- Drop the existing constraint and recreate with new values
        ALTER TABLE timeline_events DROP CONSTRAINT IF EXISTS timeline_events_event_type_check;

        ALTER TABLE timeline_events ADD CONSTRAINT timeline_events_event_type_check
        CHECK (event_type IN (
            'purchase', 'sale', 'registration', 'inspection', 'maintenance',
            'repair', 'modification', 'accident', 'insurance_claim', 'recall',
            'ownership_transfer', 'lien_change', 'title_update', 'mileage_reading',
            'discovery', 'listing', 'auction', 'photo', 'documentation'
        ));
    END IF;
END;
$$;

-- 5. Add 'historian' to vehicle_contributor_roles if not already valid
-- The role column in vehicle_contributor_roles is TEXT with no constraint,
-- so 'historian' is already valid. Just document expected values:
COMMENT ON COLUMN vehicle_contributor_roles.role IS
'Role types: consigner, mechanic, appraiser, photographer, transporter, inspector, dealer, historian';

-- 6. Add columns to vehicles table if needed for archive imports
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS origin_metadata JSONB DEFAULT '{}';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Add constraint for status if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'vehicles_status_check'
    ) THEN
        ALTER TABLE vehicles ADD CONSTRAINT vehicles_status_check
        CHECK (status IN ('active', 'archived', 'pending', 'draft', 'sold', 'deleted'));
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

-- 7. Row Level Security for new tables
ALTER TABLE unverified_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_unverified_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_imports ENABLE ROW LEVEL SECURITY;

-- Unverified Contacts: Only admins and authenticated users can view (restricted data)
DROP POLICY IF EXISTS unverified_contacts_select ON unverified_contacts;
CREATE POLICY unverified_contacts_select ON unverified_contacts FOR SELECT
USING (
    auth.uid() IS NOT NULL AND (
        EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
        OR
        -- Users can see contacts linked to their vehicles
        EXISTS (
            SELECT 1 FROM vehicle_unverified_owners vuo
            JOIN vehicles v ON v.id = vuo.vehicle_id
            WHERE vuo.contact_id = unverified_contacts.id
            AND v.user_id = auth.uid()
        )
    )
);

DROP POLICY IF EXISTS unverified_contacts_insert ON unverified_contacts;
CREATE POLICY unverified_contacts_insert ON unverified_contacts FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Vehicle Unverified Owners: Similar to vehicle access
DROP POLICY IF EXISTS vehicle_unverified_owners_select ON vehicle_unverified_owners;
CREATE POLICY vehicle_unverified_owners_select ON vehicle_unverified_owners FOR SELECT
USING (
    auth.uid() IS NOT NULL AND (
        created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
    )
);

DROP POLICY IF EXISTS vehicle_unverified_owners_insert ON vehicle_unverified_owners;
CREATE POLICY vehicle_unverified_owners_insert ON vehicle_unverified_owners FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Archive Imports: Only creator and admins can view
DROP POLICY IF EXISTS archive_imports_select ON archive_imports;
CREATE POLICY archive_imports_select ON archive_imports FOR SELECT
USING (
    historian_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

DROP POLICY IF EXISTS archive_imports_insert ON archive_imports;
CREATE POLICY archive_imports_insert ON archive_imports FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS archive_imports_update ON archive_imports;
CREATE POLICY archive_imports_update ON archive_imports FOR UPDATE
USING (
    historian_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

-- 8. Triggers for updated_at
CREATE OR REPLACE FUNCTION update_unverified_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_unverified_contacts_updated_at ON unverified_contacts;
CREATE TRIGGER update_unverified_contacts_updated_at
    BEFORE UPDATE ON unverified_contacts
    FOR EACH ROW EXECUTE FUNCTION update_unverified_contacts_updated_at();

-- 9. Helper function to normalize phone numbers to E.164
CREATE OR REPLACE FUNCTION normalize_phone_to_e164(raw_phone TEXT)
RETURNS TEXT AS $$
DECLARE
    digits TEXT;
BEGIN
    -- Extract only digits
    digits := regexp_replace(raw_phone, '[^0-9]', '', 'g');

    -- Handle US numbers
    IF length(digits) = 10 THEN
        RETURN '+1' || digits;
    ELSIF length(digits) = 11 AND digits LIKE '1%' THEN
        RETURN '+' || digits;
    ELSE
        RETURN NULL; -- Invalid length
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 10. View for historian attribution
CREATE OR REPLACE VIEW historian_contributions AS
SELECT
    vcr.user_id as historian_id,
    p.full_name as historian_name,
    p.email as historian_email,
    COUNT(DISTINCT vcr.vehicle_id) as vehicles_contributed,
    MIN(vcr.created_at) as first_contribution,
    MAX(vcr.created_at) as last_contribution
FROM vehicle_contributor_roles vcr
JOIN profiles p ON p.id = vcr.user_id
WHERE vcr.role = 'historian'
GROUP BY vcr.user_id, p.full_name, p.email;

-- Grant access to authenticated users
GRANT SELECT ON historian_contributions TO authenticated;
