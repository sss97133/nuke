# Reference Library - Upload Guide

## ✅ Backend Ready!

Tables created:
- `reference_libraries` - One per YMM (auto-created)
- `library_documents` - Your documents with attribution
- `vehicle_library_links` - Auto-links to matching vehicles

---

## How to Upload Your 1973 Brochure

### Option 1: SQL Insert (Quick)

```sql
-- 1. Find or create library for 1973 Chevrolet K5
INSERT INTO reference_libraries (year, make, series, body_style)
VALUES (1973, 'Chevrolet', 'K5', 'Blazer')
ON CONFLICT (year, make, series, body_style) DO NOTHING
RETURNING id;

-- 2. Upload file to Supabase Storage first
-- Go to: Supabase Dashboard → Storage → reference-docs
-- Upload: 1973-chevrolet-trucks-blazer.pdf
-- Copy URL

-- 3. Insert document record
INSERT INTO library_documents (
  library_id,
  document_type,
  title,
  file_url,
  uploaded_by,
  page_count,
  year_published,
  is_factory_original
) VALUES (
  '[library-id from step 1]',
  'brochure',
  '1973 Chevrolet Trucks - Blazer',
  'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/reference-docs/1973-chevrolet-trucks-blazer.pdf',
  '[your-user-id]',
  24,
  1973,
  true
);
```

### Option 2: UI (Coming Soon)

Once UI is ready:
1. Go to vehicle profile
2. Scroll to "Reference Library" section
3. Click "+ Upload document"
4. Drag & drop your PDF
5. System auto-tags with vehicle's YMM
6. Done!

---

## What Happens When You Upload

### Your 1973 K5 Brochure:

**Shared with**: All 1973 Chevrolet K5 Blazers (currently 2 vehicles)

**Attribution**: Shows "Contributed by skylar williams"

**Access**: 
- Anyone viewing a 1973 K5 Blazer sees it
- Your name appears as contributor
- Builds your reputation as K5 expert

**Like a shop**:
- Viva! Las Vegas uploads K5 service bulletins
- Shows they specialize in K5s
- Builds shop credibility
- Others benefit from their expertise

---

## Document Types Supported

```
brochure          - Sales brochures
owners_manual     - Owner's manual
service_manual    - Factory service manual
parts_catalog     - Parts diagrams/catalog
spec_sheet        - Technical specifications
paint_codes       - Paint/color chart
rpo_codes         - RPO option codes list
wiring_diagram    - Electrical diagrams
build_sheet       - Factory build sheets
recall_notice     - Safety recalls
tsb               - Technical service bulletins
other             - Misc documentation
```

---

## Upload via Supabase Dashboard (Right Now!)

### Step 1: Upload File
1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/storage/buckets/reference-docs
2. Create folder: `1973-chevrolet-k5/`
3. Upload your brochure PDF
4. Copy the public URL

### Step 2: Create Library (if needed)
```sql
INSERT INTO reference_libraries (year, make, series, body_style)
VALUES (1973, 'Chevrolet', 'K5', 'Blazer')
ON CONFLICT DO NOTHING
RETURNING id;
```

### Step 3: Insert Document Record
```sql
INSERT INTO library_documents (
  library_id,
  document_type,
  title,
  file_url,
  uploaded_by,
  page_count,
  year_published,
  is_factory_original
)
SELECT 
  rl.id,
  'brochure',
  '1973 Chevrolet Trucks - Blazer',
  '[paste URL from step 1]',
  '[your user id]',
  24,
  1973,
  true
FROM reference_libraries rl
WHERE rl.year = 1973
  AND rl.make = 'Chevrolet'
  AND rl.series = 'K5';
```

---

## Your User ID

Run this to get it:
```sql
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';
```

---

## Verification

After upload, check it worked:
```sql
-- See your document
SELECT 
  ld.title,
  ld.document_type,
  rl.year,
  rl.make,
  rl.series,
  COUNT(vll.vehicle_id) as vehicles_using
FROM library_documents ld
JOIN reference_libraries rl ON rl.id = ld.library_id
LEFT JOIN vehicle_library_links vll ON vll.library_id = rl.id
WHERE ld.uploaded_by = '[your-user-id]'
GROUP BY ld.id, rl.year, rl.make, rl.series;
```

**Ready to drop your files!** Just upload to storage bucket and I'll help you create the records. 📚

