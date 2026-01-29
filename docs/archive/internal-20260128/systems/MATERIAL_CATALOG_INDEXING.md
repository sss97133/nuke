# Material Catalog & TDS Sheet Indexing System

## Overview

Indexes material manuals and Technical Data Sheets (TDS) from body work supply brands to create a searchable knowledge base of:
- Paint products (basecoats, clears, primers)
- Body fillers and repair materials
- Mixing ratios and application instructions
- Product codes, color codes, brand information
- Safety data and compatibility information

## Supported Document Types

1. **`material_manual`** - Product catalogs from manufacturers (PPG, BASF, 3M, etc.)
2. **`tds`** - Technical Data Sheets for specific products (paint, chemicals, etc.)

## Database Schema

### `document_chunks` Table (Unified)

Stores indexed chunks from all document types:

**Common Fields:**
- `document_id` - Links to `library_documents`
- `document_type` - 'service_manual', 'material_manual', 'tds'
- `page_number`, `section_name`, `section_heading`
- `content`, `content_type`, `key_topics[]`

**TDS-Specific Fields:**
- `product_name` - "Basecoat Red", "Clear Coat"
- `product_code` - SKU/part number
- `brand` - Manufacturer (PPG, BASF, etc.)
- `color_code` - Paint color code
- `mixing_ratio` - JSONB: `{"base": 4, "activator": 1, "reducer": 1}`
- `application_method` - "Spray", "Brush"
- `dry_time` - "15 min flash, 24 hr cure"
- `coverage` - "300 sq ft per gallon"
- `safety_notes[]` - Array of safety warnings

**Material Manual Fields:**
- `product_name`, `product_code`, `brand`
- `material_category` - 'paint', 'primer', 'filler', 'adhesive'
- `compatibility[]` - Compatible products
- `usage_instructions` - Usage text

## Indexing Process

### 1. Upload Documents

Upload via Reference Library UI or insert into `library_documents`:

```sql
INSERT INTO library_documents (
  library_id,
  document_type,
  title,
  file_url,
  uploaded_by
) VALUES (
  'library-uuid',
  'tds',  -- or 'material_manual'
  'PPG Deltron Basecoat TDS',
  'https://...pdf',
  'user-uuid'
);
```

### 2. Index Documents

Run indexing script:

```bash
node scripts/index-all-catalogs.js
```

Or manually via edge function:

```javascript
await supabase.functions.invoke('index-service-manual', {
  body: { 
    document_id: 'doc-uuid',
    mode: 'full'  // 'structure', 'chunk', or 'full'
  }
});
```

### 3. Query Indexed Data

```sql
-- Search for paint products
SELECT * FROM document_chunks
WHERE document_type = 'tds'
  AND product_name ILIKE '%basecoat%'
  AND brand = 'PPG';

-- Find mixing ratios
SELECT product_name, mixing_ratio, application_method
FROM document_chunks
WHERE document_type = 'tds'
  AND mixing_ratio IS NOT NULL;

-- Search by color code
SELECT product_name, brand, color_code, content
FROM document_chunks
WHERE document_type = 'tds'
  AND color_code = 'R123';
```

## Top Brands to Index

### Paint Brands
- **PPG** (Deltron, Omni, Shop-Line)
- **BASF** (Glasurit, R-M, Limco)
- **Sherwin-Williams** (Automotive Finishes)
- **Axalta** (Spies Hecker, Standox, Cromax)
- **Sikkens** (AkzoNobel)
- **House of Kolor**

### Body Work Materials
- **3M** (Adhesives, tapes, abrasives)
- **Evercoat** (Fillers, glazes)
- **USC** (Fillers, primers)
- **SEM** (Adhesives, sealers)
- **Fusor** (Structural adhesives)

## AI Integration

When analyzing images, AI can now query:

```sql
-- Find matching paint products
SELECT * FROM document_chunks
WHERE document_type = 'tds'
  AND (
    to_tsvector('english', content) @@ plainto_tsquery('english', 'red basecoat')
    OR key_topics && ARRAY['basecoat', 'red']
  )
ORDER BY relevance_score DESC;
```

AI responses can cite: "Per PPG Deltron TDS, mixing ratio is 4:1:1 (base:activator:reducer)"

## Next Steps

1. **Bulk Upload**: Create script to fetch TDS sheets from manufacturer websites
2. **Brand Matching**: Auto-detect brand from document title/content
3. **Product Linking**: Link indexed products to work orders and receipts
4. **Price Integration**: Connect product codes to pricing databases
5. **Compatibility Engine**: Build compatibility matrix from indexed data

