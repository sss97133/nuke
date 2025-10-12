-- Create receipts storage bucket if it doesn't exist
-- Note: This uses Supabase's storage schema

-- First check if storage schema and buckets table exist
DO $$
BEGIN
    -- Check if the storage schema exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        RAISE NOTICE 'Storage schema does not exist. Buckets must be created via Supabase dashboard or API.';
    ELSE
        -- Insert bucket configuration if it doesn't exist
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at)
        VALUES (
            'receipts',
            'receipts', 
            true,
            52428800, -- 50MB
            ARRAY[
                'image/jpeg',
                'image/png', 
                'image/webp',
                'image/gif',
                'image/heic',
                'application/pdf',
                'text/plain'
            ],
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET 
            public = true,
            file_size_limit = 52428800,
            allowed_mime_types = ARRAY[
                'image/jpeg',
                'image/png',
                'image/webp', 
                'image/gif',
                'image/heic',
                'application/pdf',
                'text/plain'
            ],
            updated_at = NOW();

        RAISE NOTICE 'Receipts bucket created/updated successfully';
    END IF;
END $$;
