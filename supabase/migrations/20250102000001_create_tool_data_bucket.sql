-- Create tool-data storage bucket for user tool receipts and documentation
-- This is properly aligned with the data model

-- First, let's fix the receipts bucket by dropping and recreating it properly
DELETE FROM storage.buckets WHERE id = 'receipts';

-- Create a properly named tool-data bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at, avif_autodetection)
VALUES (
    'tool-data',
    'tool-data', 
    true,
    52428800, -- 50MB
    ARRAY[
        'image/jpeg',
        'image/png', 
        'image/webp',
        'image/gif',
        'image/heic',
        'application/pdf',
        'text/plain',
        'application/json' -- For structured data exports
    ],
    NOW(),
    NOW(),
    false
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
        'text/plain',
        'application/json'
    ],
    updated_at = NOW();

-- Also create a user-documents bucket for other user files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at, avif_autodetection)
VALUES (
    'user-documents',
    'user-documents', 
    true,
    52428800, -- 50MB
    ARRAY[
        'image/jpeg',
        'image/png', 
        'image/webp',
        'image/gif',
        'image/heic',
        'application/pdf',
        'text/plain',
        'application/json',
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ],
    NOW(),
    NOW(),
    false
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
        'text/plain',
        'application/json',
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ],
    updated_at = NOW();

DO $$
BEGIN
    RAISE NOTICE 'Storage buckets properly aligned with data model:';
    RAISE NOTICE '- tool-data: For tool receipts, invoices, warranties';
    RAISE NOTICE '- user-documents: For general user documents';
    RAISE NOTICE '- vehicle-data: For vehicle-specific documents (existing)';
    RAISE NOTICE '- vehicle-images: For vehicle photos (existing)';
END $$;
