-- Add supporting_documents column to ownership_verifications table
-- This allows users to upload proof of ownership (title, bill of sale, registration, insurance)

ALTER TABLE public.ownership_verifications 
ADD COLUMN IF NOT EXISTS supporting_documents JSONB DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN public.ownership_verifications.supporting_documents IS 
'Array of document references for ownership proof. Each document contains:
- type: "title" | "bill_of_sale" | "registration" | "insurance"
- url: storage URL of the uploaded document
- uploaded_at: timestamp of upload
- file_name: original filename
- file_size: size in bytes
- mime_type: file MIME type';

-- Example structure:
-- [
--   {
--     "type": "title",
--     "url": "https://storage.url/documents/abc123.pdf",
--     "uploaded_at": "2025-09-28T19:54:00Z",
--     "file_name": "vehicle_title.pdf",
--     "file_size": 2048576,
--     "mime_type": "application/pdf"
--   }
-- ]

-- Create index for faster queries on document types
CREATE INDEX IF NOT EXISTS idx_ownership_verifications_doc_types 
ON public.ownership_verifications 
USING gin ((supporting_documents -> 'type'));

-- Update RLS policies to ensure users can only update their own verification documents
DROP POLICY IF EXISTS "Users can update their own verification documents"
ON public.ownership_verifications;

CREATE POLICY "Users can update their own verification documents"
ON public.ownership_verifications
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Create storage bucket for ownership documents if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ownership-documents',
  'ownership-documents', 
  false, -- Private bucket
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for the storage bucket
DROP POLICY IF EXISTS "Users can upload their own ownership documents" ON storage.objects;
CREATE POLICY "Users can upload their own ownership documents"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'ownership-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can view their own ownership documents" ON storage.objects;
CREATE POLICY "Users can view their own ownership documents"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'ownership-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can delete their own ownership documents" ON storage.objects;
CREATE POLICY "Users can delete their own ownership documents"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'ownership-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);
