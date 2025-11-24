-- Add relationship_type column to discovered_vehicles table
-- This column is required for the Vehicles page to properly categorize vehicle relationships

-- Add relationship_type column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'discovered_vehicles' 
        AND column_name = 'relationship_type'
    ) THEN
        ALTER TABLE discovered_vehicles 
        ADD COLUMN relationship_type TEXT DEFAULT 'interested';
        
        -- Add constraint for valid relationship types
        ALTER TABLE discovered_vehicles 
        DROP CONSTRAINT IF EXISTS discovered_vehicles_relationship_type_check;
        
        ALTER TABLE discovered_vehicles 
        ADD CONSTRAINT discovered_vehicles_relationship_type_check
        CHECK (relationship_type IN ('interested', 'discovered', 'curated', 'consigned', 'previously_owned', 'contributing'));
        
        -- Update existing rows to have a default relationship_type
        UPDATE discovered_vehicles 
        SET relationship_type = 'interested' 
        WHERE relationship_type IS NULL;
    END IF;
END $$;

COMMENT ON COLUMN discovered_vehicles.relationship_type IS 'Type of relationship: interested, discovered, curated, consigned, previously_owned, or contributing';

