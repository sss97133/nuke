-- Add missing columns to timeline_events table for proper image tracking

-- Add confidence_score column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'timeline_events' AND column_name = 'confidence_score') THEN
        ALTER TABLE timeline_events ADD COLUMN confidence_score INTEGER DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100);
        RAISE NOTICE 'Added confidence_score column to timeline_events';
    ELSE
        RAISE NOTICE 'confidence_score column already exists in timeline_events';
    END IF;
END $$;

-- Add source_type column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'timeline_events' AND column_name = 'source_type') THEN
        ALTER TABLE timeline_events ADD COLUMN source_type TEXT NOT NULL DEFAULT 'user_input' CHECK (source_type IN (
            'user_input', 'service_record', 'government_record', 'insurance_record',
            'dealer_record', 'manufacturer_recall', 'inspection_report', 'receipt'
        ));
        RAISE NOTICE 'Added source_type column to timeline_events';
    ELSE
        RAISE NOTICE 'source_type column already exists in timeline_events';
    END IF;
END $$;

-- Add event_category column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'timeline_events' AND column_name = 'event_category') THEN
        ALTER TABLE timeline_events ADD COLUMN event_category TEXT CHECK (event_category IN (
            'ownership', 'maintenance', 'legal', 'performance', 'cosmetic', 'safety'
        ));
        RAISE NOTICE 'Added event_category column to timeline_events';
    ELSE
        RAISE NOTICE 'event_category column already exists in timeline_events';
    END IF;
END $$;

-- Add verification_status column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'timeline_events' AND column_name = 'verification_status') THEN
        ALTER TABLE timeline_events ADD COLUMN verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN (
            'unverified', 'user_verified', 'professional_verified', 'multi_verified', 'disputed'
        ));
        RAISE NOTICE 'Added verification_status column to timeline_events';
    ELSE
        RAISE NOTICE 'verification_status column already exists in timeline_events';
    END IF;
END $$;

-- Create index on confidence_score for performance
CREATE INDEX IF NOT EXISTS idx_timeline_events_confidence_score ON timeline_events(confidence_score DESC);

-- Create index on source_type for filtering
CREATE INDEX IF NOT EXISTS idx_timeline_events_source_type ON timeline_events(source_type);

-- Report on the current schema
DO $$
BEGIN
    RAISE NOTICE 'Timeline events table schema updated successfully';
    RAISE NOTICE 'Available columns: %', (
        SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
        FROM information_schema.columns 
        WHERE table_name = 'timeline_events'
    );
END $$;
