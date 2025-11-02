# Smart Receipt Processing System - Complete

**Date**: November 1, 2025  
**Status**: ✅ DEPLOYED TO PRODUCTION

## Problem Solved

**Before**: Receipt uploads showed "$0.00 Total Cost" - useless data, no extraction, no value.

**After**: AI automatically extracts every line item, links parts to images, creates valuation citations, and displays everything in a professional work order format.

---

## Complete Flow

### 1. User uploads receipt

Frontend uploads document to `vehicle_documents` table.

### 2. User clicks timeline event (receipt)

`TimelineEventReceipt` modal opens, showing:
- ⚠️ Incomplete Work Order
- "🤖 AI extraction pending"
- Button: "🤖 Extract Receipt Data Now"

### 3. User clicks extract button (or automatic in future)

Calls `smart-receipt-linker` edge function:

```typescript
await supabase.functions.invoke('smart-receipt-linker', {
  body: {
    documentId: 'uuid',
    vehicleId: 'uuid',
    documentUrl: 'https://...'
  }
});
```

### 4. AI extracts receipt data

**smart-receipt-linker does:**

1. **Extract data using OpenAI Vision**
   - Vendor, date, totals
   - Line items (part number, description, qty, unit price, total)
   - Categories (part, labor, tax, fee)
   - Labor hours estimation
   - Confidence scoring

2. **Match to vehicle images**
   - Find images ±7 days from receipt date
   - AI matches parts to photos (score 0.5-1.0)
   - Match reasons: "Master cylinder visible in engine bay"

3. **Link everything**
   - Inserts `receipt_items` with extracted data
   - Creates `valuation_citations` for parts
   - Creates `image_tags` linking receipt → images
   - Updates `vehicle_documents.ai_processing_status` = 'completed'

4. **Returns results**
   - Extracted items count
   - Linked images count
   - Confidence score
   - Match details

### 5. Modal reloads (3 seconds later)

Now displays:
- ✅ AI extraction complete (92% confidence)
- **PARTS & MATERIALS**: 🤖 AI-extracted badge
  - Master Cylinder #MC123, Qty: 1, $100.00
  - Brake Lines, Qty: 2, $25.00
  - Parts Subtotal: $125.00
- **LABOR**:
  - Installation Labor, $95.00
  - Labor Subtotal: $95.00
- **TOTAL COST: $220.00**
- Linked images (4 photos showing install)

---

## Database Schema

### receipt_items (extended)

```sql
ALTER TABLE receipt_items
  ADD COLUMN vehicle_id UUID,
  ADD COLUMN category TEXT CHECK (category IN ('part', 'labor', 'tax', 'fee', 'other')),
  ADD COLUMN extracted_by_ai BOOLEAN DEFAULT false,
  ADD COLUMN confidence_score NUMERIC(4,2),
  ADD COLUMN linked_image_ids UUID[];
```

### vehicle_documents (extended)

```sql
ALTER TABLE vehicle_documents
  ADD COLUMN ai_processing_status TEXT DEFAULT 'pending',
  ADD COLUMN ai_processing_started_at TIMESTAMPTZ,
  ADD COLUMN ai_processing_completed_at TIMESTAMPTZ,
  ADD COLUMN ai_extraction_confidence NUMERIC(4,2);
```

---

## Edge Function: smart-receipt-linker

**Deployed**: ✅ Production  
**Endpoint**: `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/smart-receipt-linker`

**AI Model**: `gpt-4o-mini` (fallback to `gpt-4o` if 403)

**Input**:
```json
{
  "documentId": "uuid",
  "vehicleId": "uuid",
  "documentUrl": "https://..."
}
```

**Output**:
```json
{
  "success": true,
  "receiptData": {
    "vendor": "AutoZone",
    "date": "2025-09-11",
    "totalAmount": 220.00,
    "lineItems": [...],
    "laborHours": 1.2,
    "confidence": 0.92
  },
  "linkedImages": 4,
  "extractedItems": 5,
  "confidence": 0.92,
  "matches": [...]
}
```

---

## Frontend Component: TimelineEventReceipt

**Updated**: ✅ Deployed

**Features**:
- Fetches `receipt_items` from database
- Displays AI processing status (pending/processing/completed)
- Shows "🤖 AI-extracted" badge when applicable
- Manual trigger button if extraction pending
- Falls back to manual data if no extraction
- Professional work order format

**State management**:
```typescript
const [receiptItems, setReceiptItems] = useState<any[]>([]);
const [documentId, setDocumentId] = useState<string | null>(null);
const [processingStatus, setProcessingStatus] = useState<string>('pending');
const [extractionConfidence, setExtractionConfidence] = useState<number | null>(null);
```

**Data loading**:
```typescript
// Load extracted receipt items via receipts table
const { data: receipt } = await supabase
  .from('receipts')
  .select('id')
  .eq('document_id', docId)
  .maybeSingle();

if (receipt) {
  const { data: items } = await supabase
    .from('receipt_items')
    .select('*')
    .eq('receipt_id', receipt.id)
    .order('created_at', { ascending: true });
  
  if (items && items.length > 0) {
    setReceiptItems(items);
  }
}
```

**Display logic**:
```typescript
// Calculate totals from extracted receipt items OR fallback to event data
const extractedPartsTotal = receiptItems
  .filter(item => item.category === 'part')
  .reduce((sum, item) => sum + (item.line_total || item.total_price || 0), 0);

const totalCost = receiptItems.length > 0 
  ? extractedTotal 
  : (event.cost_amount || manualPartsTotal + manualLaborCost);
```

---

## Valuation Citations Integration

When `smart-receipt-linker` processes a receipt, it automatically creates valuation citations:

```typescript
const citationsToInsert = insertedItems
  .filter(item => item.category === 'part')
  .map(item => ({
    vehicle_id: vehicleId,
    component_type: 'part_purchase',
    component_name: item.description,
    value_usd: item.total_price,
    value_type: 'cost',
    submitted_by: uploaderId,
    submitter_role: 'uploader',
    effective_date: receiptData.date,
    evidence_type: 'receipt',
    source_document_id: documentId,
    confidence_score: Math.round(receiptData.confidence * 100),
    verification_status: 'receipt_confirmed',
    metadata: {
      vendor: receiptData.vendor,
      receipt_date: receiptData.date,
      extracted_by_ai: true
    }
  }));

await supabase.from('valuation_citations').insert(citationsToInsert);
```

**Result**: Every part on the receipt becomes a clickable citation in the valuation breakdown.

---

## Image Tag Integration

When AI matches receipt items to images:

```typescript
const tagData = {
  vehicle_id: vehicleId,
  image_id: match.imageId,
  tag_name: item.description,
  tag_type: item.category === 'part' ? 'part' : 'work',
  estimated_cost_cents: Math.round(item.total_price * 100),
  confidence: match.matchScore,
  receipt_line_item_id: item.id,
  ai_generated: true,
  ai_model: 'gpt-4o-mini',
  ai_reasoning: match.matchReason,
  metadata: {
    linked_by: 'smart-receipt-linker',
    match_score: match.matchScore,
    suggested_tags: match.suggestedTags
  }
};

await supabase.from('image_tags').insert(tagData);
```

**Result**: Images now show tags like "Master Cylinder $100" with receipt link.

---

## AI Prompt (Extraction)

```text
You are an expert automotive receipt analyzer. Extract all data from this receipt with extreme precision.

Return JSON with this exact structure:
{
  "vendor": "Shop/vendor name",
  "date": "YYYY-MM-DD",
  "totalAmount": 0.00,
  "lineItems": [
    {
      "description": "Exact part/service description",
      "partNumber": "Part # if visible",
      "quantity": 1,
      "unitPrice": 0.00,
      "totalPrice": 0.00,
      "category": "part|labor|tax|fee|other"
    }
  ],
  "laborHours": 0.0,
  "taxAmount": 0.00,
  "confidence": 0.95
}

Rules:
- Extract every line item
- Categorize accurately: parts are physical items, labor is service/installation
- Parse part numbers (format: ABC-123, 12345, etc.)
- Calculate labor hours from labor charges
- Sum all taxes into taxAmount
- Set confidence 0-1 based on image clarity
```

---

## AI Prompt (Image Matching)

```text
You are an automotive expert. Match receipt line items to vehicle images.

RECEIPT DATA:
{...}

CANDIDATE IMAGES (10 total):
1. ID: uuid, Taken: 2025-09-11, Description: "Engine bay"
2. ID: uuid, Taken: 2025-09-12, Description: "Master cylinder install"
...

For each receipt line item, identify which images (by ID) show that part or the work being done. Return JSON:
{
  "matches": [
    {
      "imageId": "uuid",
      "matchedItems": ["Master Cylinder", "Brake Lines"],
      "matchScore": 0.85,
      "matchReason": "Image shows new master cylinder installed with brake lines visible",
      "suggestedTags": ["master_cylinder", "brake_system", "new_part"]
    }
  ]
}

Match criteria:
- Visual evidence of the part in the image
- Installation work in progress or completed
- Score 0.9-1.0: Definite match (part clearly visible)
- Score 0.7-0.89: Probable match (related work visible)
- Score 0.5-0.69: Possible match (context suggests)
- Below 0.5: Don't include
```

---

## User Experience

### Before
1. User uploads receipt
2. Timeline shows event with no data
3. User clicks event → modal shows "$0.00 Total Cost"
4. User thinks: "This is useless"

### After
1. User uploads receipt
2. Timeline shows event
3. User clicks event → modal shows:
   - "🤖 AI extraction pending"
   - Button: "🤖 Extract Receipt Data Now"
4. User clicks button
5. Modal shows: "🤖 AI is extracting receipt data..."
6. 3 seconds later, modal reloads:
   - ✅ AI extraction complete (92% confidence)
   - Parts: Master Cylinder $100, Brake Lines $25
   - Labor: $95
   - **Total: $220.00**
   - 4 linked images
7. User thinks: "This is amazing"

---

## Future Enhancements

### 1. Automatic Triggering

Currently user must click "Extract Receipt Data Now". Future: trigger automatically on upload.

**Implementation**:
- Frontend calls `smart-receipt-linker` immediately after document upload
- Or: Database trigger using `pg_net` extension (requires setup)

### 2. Batch Processing

Process all pending receipts at once.

**Implementation**:
```typescript
const { data: pendingDocs } = await supabase
  .from('vehicle_documents')
  .select('id, vehicle_id, document_url')
  .eq('document_type', 'receipt')
  .eq('ai_processing_status', 'pending');

for (const doc of pendingDocs) {
  await supabase.functions.invoke('smart-receipt-linker', {
    body: {
      documentId: doc.id,
      vehicleId: doc.vehicle_id,
      documentUrl: doc.document_url
    }
  });
}
```

### 3. User Corrections

Allow users to edit extracted data, track accuracy.

**Implementation**:
- Add "Edit" button next to each line item
- Modal to correct description/part number/price
- Log correction in `user_valuation_inputs`
- Update user accuracy score

### 4. Vendor Recognition

Build database of common vendors, auto-fill shop info.

**Implementation**:
- `vendor_catalog` table (name, address, shop_rate, specialty)
- Fuzzy match vendor name from receipt
- Auto-populate shop info for labor citations

### 5. Duplicate Detection

Prevent same receipt from being uploaded multiple times.

**Implementation**:
- Hash receipt image
- Check for existing documents with same hash
- Alert user: "This receipt was already uploaded on [date]"

---

## Deployment Status

### Database
✅ Migration applied: `20251101_auto_process_receipts.sql`

**Tables extended**:
- `receipt_items` (vehicle_id, extracted_by_ai, confidence_score, linked_image_ids)
- `vehicle_documents` (ai_processing_status, ai_extraction_confidence)

### Edge Functions
✅ Deployed: `smart-receipt-linker` (156kB)

### Frontend
✅ Deployed: `TimelineEventReceipt.tsx` updated

**Deployment URL**: https://nuke-h9i08qovl-nzero.vercel.app  
**Production URL**: https://n-zero.dev

---

## Summary

The Smart Receipt Processing System transforms receipt uploads from "$0.00 useless data" into fully-extracted, AI-powered work orders with:
- Every line item extracted (parts, labor, tax)
- Parts matched to vehicle images
- Valuation citations created automatically
- Professional receipt format
- Confidence scoring
- Manual trigger option

**Core Innovation:**
> Receipt Upload → AI Vision → Extracted Data → Image Matching → Valuation Citations → Work Order

**Status:** ✅ LIVE IN PRODUCTION

**Date:** November 1, 2025

