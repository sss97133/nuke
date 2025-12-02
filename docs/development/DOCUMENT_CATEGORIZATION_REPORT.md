# Document Categorization Report - November 22, 2025

**Status:** ✅ COMPLETE  
**Total Images Scanned:** 2,812  
**Documents Found:** 2  
**Script:** `scripts/categorize-documents.mjs`

---

## Summary

Scanned all 2,812 vehicle images in the database and classified documents vs photos.

### Documents Found

**SPID Sheets (Service Parts Identification):** 2
- These are factory build sheets showing RPO codes, options, paint codes
- Properly categorized as `service_parts_id`
- Should be in reference library, not image gallery

### Receipt Events (No Images Found)

**2 timeline events for "Purchase receipt" but NO images linked:**
1. **1932 Ford Roadster** - Nov 1, 2025
   - Event: "Purchase receipt" 
   - Status: ❌ No image found (upload likely failed)
   
2. **1974 Ford Bronco** - Nov 1, 2025
   - Event: "Purchase receipt"
   - Status: ❌ No image found (upload likely failed)

**Conclusion:** Receipt uploads created timeline events but didn't save the actual image files.

---

## Database Changes

### New Columns Added to `vehicle_images`:
- `is_document` (boolean) - True if document, false if photo
- `document_category` (text) - Category: receipt, invoice, title, spid, etc.
- `document_classification` (jsonb) - Full classification metadata

### Categories Supported:
- `receipt` - Purchase receipts, work receipts
- `invoice` - Invoices, bills
- `title` - Vehicle title documents
- `registration` - Registration documents
- `insurance` - Insurance documents
- `service_parts_id` - SPID sheets (RPO codes)
- `vin_plate` - VIN plate photos
- `window_sticker` - Monroney/window stickers
- `build_sheet` - Factory build sheets
- `manual` - Service/owner manuals
- `other_document` - Generic documents

---

## Detection Logic

The categorization script uses multiple signals:

1. **AI Metadata Flags**
   - `is_spid_sheet = true` → SPID sheet
   - `raw_text` with RPO codes → SPID sheet
   - `extracted_data` with structured data → Document

2. **URL Patterns**
   - Filenames containing "receipt", "invoice", "title", etc.

3. **Text Content Analysis**
   - Heavy text (>500 chars) → Likely document
   - Keywords in text → Specific category
   - Dollar signs, totals → Receipt/invoice

4. **Timeline Event Context**
   - Images uploaded near receipt events → Receipt

---

## Next Steps

### Immediate Actions Needed:
1. **Re-upload Receipts** - The 2 receipt events have no images
2. **Filter Documents from Gallery** - Hide documents from image gallery
3. **Create Document Viewer** - Show documents in financial section

### Future Improvements:
1. **Better Receipt Detection** - OCR for dollar amounts, vendor names
2. **Auto-extract Receipt Data** - Parse totals, dates, vendors
3. **Document Routing** - Auto-route uploads to correct table
4. **Reference Library Integration** - Move SPID sheets to reference library

---

## Files Created

- `scripts/categorize-documents.mjs` - Categorization script
- `nuke_frontend/src/services/documentTypeDetector.ts` - Detection service
- Database migration: `add_document_classification_to_images`

---

**All documents have been categorized and flagged in the database.**

