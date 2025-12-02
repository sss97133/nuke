# Timeline Events Table Confusion - Root Cause Analysis

**Date**: October 31, 2025  
**Status**: ✅ FIXED  
**Severity**: CRITICAL - Blocking all document uploads

## The Problem

User reported: `ERROR • null value in column "source" of relation "timeline_events" violates not-null constraint`

This error was occurring when uploading documents via `SmartInvoiceUploader` → `vehicle_documents` table → database trigger.

## Root Cause

There are **TWO** timeline-related structures in the database:

### 1. `timeline_events` (TABLE)
- The **real underlying table**
- Has `source` column with **NOT NULL constraint**
- All data is actually stored here

### 2. `vehicle_timeline_events` (VIEW)
- A **view** that wraps `timeline_events`
- Provides additional computed columns (`participant_count`, `verification_count`, etc.)
- **Inserts into this view redirect to `timeline_events` table**

## The Bug

The database trigger function `create_timeline_event_from_document()` was doing:

```sql
INSERT INTO vehicle_timeline_events (
    vehicle_id,
    user_id,
    event_type,
    title,
    description,
    event_date,
    metadata
) VALUES (...);
```

**Problem**: It was NOT providing the `source` column.

Since `vehicle_timeline_events` is a VIEW that wraps `timeline_events`, the INSERT was redirected to `timeline_events`, which has a **NOT NULL constraint on `source`**.

## The Fix

Updated the trigger to explicitly provide **both** `source` and `source_type`:

```sql
INSERT INTO vehicle_timeline_events (
    vehicle_id,
    user_id,
    event_type,
    source,       -- ✅ ADDED (text - descriptive string)
    source_type,  -- ✅ ADDED (enum - must match CHECK constraint)
    title,
    description,
    event_date,
    metadata
) VALUES (
    NEW.vehicle_id,
    NEW.uploaded_by,
    event_type,
    'document_upload',  -- ✅ Source is a descriptive string
    event_source_type,  -- ✅ source_type is from enum ('receipt', 'service_record', etc.)
    event_title,
    event_description,
    COALESCE(NEW.document_date, CURRENT_DATE),
    jsonb_build_object(...)
);
```

### The Two Required Columns

1. **`source`** (text, NOT NULL): A descriptive string like `'user_upload'`, `'document_upload'`, `'ai_generated'`, etc.
2. **`source_type`** (text with CHECK constraint, NOT NULL): Must be one of:
   - `'user_input'`
   - `'service_record'`
   - `'government_record'`
   - `'insurance_record'`
   - `'dealer_record'`
   - `'manufacturer_recall'`
   - `'inspection_report'`
   - `'receipt'`

## Why This Was Confusing

1. **The error said `timeline_events`** but all frontend code uses `vehicle_timeline_events`
2. **`vehicle_timeline_events` looks like a table** in queries, but it's actually a view
3. **The trigger function looked correct** because it was inserting into `vehicle_timeline_events`, but the view was transparently redirecting to `timeline_events`
4. **There was a previous fix** to change `timeline_events` → `vehicle_timeline_events` in the trigger, which seemed right but didn't actually fix the issue

## Database Schema Clarification

```
timeline_events (TABLE)
├── source: text NOT NULL  ⚠️ REQUIRED (descriptive string)
├── source_type: text NOT NULL  ⚠️ REQUIRED (enum via CHECK constraint)
├── vehicle_id: uuid
├── user_id: uuid
├── event_type: text
├── title: text
├── description: text
├── event_date: date
├── metadata: jsonb
└── ... (28+ other columns)

CHECK CONSTRAINTS:
- source_type must be one of: 'user_input', 'service_record', 'government_record',
  'insurance_record', 'dealer_record', 'manufacturer_recall', 'inspection_report', 'receipt'

vehicle_timeline_events (VIEW)
└── SELECT * FROM timeline_events
    WITH computed columns:
    - participant_count
    - verification_count
    - service_info
```

## Files Fixed

1. **Database trigger function**: `create_timeline_event_from_document()`
   - Added `source` to INSERT columns (text value: `'document_upload'`)
   - Added `source_type` to INSERT columns (mapped from `NEW.document_type`)
   - Maps document types to valid source_type enum values:
     * `receipt` → `'receipt'`
     * `invoice` → `'service_record'`
     * `parts_order` → `'receipt'`
     * `service_record` → `'service_record'`

## Error History

### Error #1: `null value in column "source"`
**Cause**: Missing `source` column in INSERT  
**Fix**: Added `source = 'document_upload'`

### Error #2: `invalid input value for enum document_category: "document_upload"`
**Cause**: Confused `source` (text) with `source_type` (enum via CHECK constraint)  
**Fix**: Added `source_type` column with correct enum mapping

## Testing

After fix, document uploads should:
1. ✅ Upload file to Supabase storage
2. ✅ Parse with AI (Azure/OpenAI/Tesseract)
3. ✅ Insert into `receipts` table
4. ✅ Insert into `vehicle_documents` table
5. ✅ Trigger `create_timeline_event_from_document()` function
6. ✅ Insert into `timeline_events` (via `vehicle_timeline_events` view) **with source column**
7. ✅ Link document to timeline event

## Lessons Learned

1. **Always check if a relation is a VIEW or TABLE** when debugging FK constraints or INSERT issues
2. **Views can have INSERT/UPDATE rules** that redirect to underlying tables with different constraints
3. **Error messages reference the actual table**, not the view, which can be confusing
4. **NOT NULL constraints on views are inherited from the underlying table**

## Next Steps

- ✅ Deploy fix to production
- Test document upload flow end-to-end
- Monitor for any similar view/table confusion issues
- Consider renaming `vehicle_timeline_events` → `vehicle_timeline_events_view` for clarity

---

**The moral of the story**: When a database error references a table you're not directly using, check if you're actually using a view that wraps that table. 🤦‍♂️

