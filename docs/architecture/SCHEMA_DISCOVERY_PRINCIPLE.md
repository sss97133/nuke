# Schema Discovery Principle

## CRITICAL: Read This Before Building ANY Extractor

**Never pre-define a schema before seeing the actual data.**

This is the #1 cause of extraction re-work and data loss.

---

## The Problem

Traditional extraction approach:
```
1. Define database schema based on assumptions
2. Build extractor targeting those fields
3. Run extraction
4. Discover you missed important fields
5. Modify schema
6. Re-extract everything 😞
```

This wastes compute, time, and often loses data that was visible but not captured.

---

## The Solution: Discovery-First Extraction

```
1. DISCOVERY PHASE: Sample documents, enumerate ALL fields
2. AGGREGATE: Combine field catalogs, note frequencies
3. SCHEMA DESIGN: Build tables based on what actually exists
4. EXTRACTION: Extract once with complete schema ✓
```

---

## Implementation Pattern

### Phase 1: Field Discovery

Run a discovery prompt on a sample (20-50 documents):

```
"List EVERY distinct field, section, or piece of information visible in this document.
Don't extract values - just enumerate what EXISTS.

Output as a flat list:
- field_name: description of what it contains
- field_name: description
..."
```

Store results in `discovery_field_catalog`:
```sql
CREATE TABLE discovery_field_catalog (
  id UUID PRIMARY KEY,
  document_type TEXT,           -- 'receipt', 'invoice', 'title', etc.
  field_name TEXT,
  field_description TEXT,
  sample_values TEXT[],
  frequency_pct NUMERIC,        -- How often this field appears
  source_documents UUID[],      -- Which docs had this field
  discovered_at TIMESTAMPTZ
);
```

### Phase 2: Aggregate & Analyze

After sampling, you'll have a catalog like:
```
| Field              | Frequency | Description                    |
|--------------------|-----------|--------------------------------|
| vendor_name        | 98%       | Business name                  |
| date               | 95%       | Transaction date               |
| total_amount       | 93%       | Final cost                     |
| line_items         | 89%       | Individual items/services      |
| tax_amount         | 67%       | Sales tax                      |
| invoice_number     | 62%       | Reference number               |
| payment_method     | 45%       | Cash/card/check                |
| labor_hours        | 23%       | Time billed (service receipts) |
| warranty_terms     | 12%       | Warranty info                  |
| vin                | 8%        | Vehicle identification         |
| technician_name    | 5%        | Who did the work               |
```

### Phase 3: Design Schema

Now design your table with ALL discovered fields:
- 90%+ frequency → Required column
- 50-90% → Optional column
- 10-50% → JSONB metadata field
- <10% → Consider if valuable enough

### Phase 4: Extract With Complete Schema

Build extractor that captures everything. No re-runs needed.

---

## When to Use Schema Discovery

**ALWAYS use for:**
- New document types (receipts, invoices, titles, etc.)
- New data sources (new auction platform, new forum)
- User-uploaded content (you don't control the format)
- Any extraction where format varies

**Can skip for:**
- Well-documented APIs with fixed schemas
- Standardized formats (e.g., VIN always has 17 chars)
- Re-extracting from a source you've fully analyzed

---

## Database Tables for Discovery

### discovery_field_catalog
Stores discovered fields per document type.

### discovery_extraction_runs
Tracks which documents have been through discovery vs full extraction.

### discovery_schema_versions
Tracks schema evolution as new fields are discovered.

---

## Example: Receipt Discovery

**Before Discovery (assumed schema):**
```sql
-- We assumed these fields
service_date, shop_name, cost, work_performed
```

**After Discovery (actual fields found):**
```sql
-- We found 23 distinct fields across 137 receipts
service_date, shop_name, shop_address, shop_phone, shop_email,
invoice_number, work_order_number, customer_name,
vehicle_year, vehicle_make, vehicle_model, vin, license_plate,
odometer_in, odometer_out, labor_hours, labor_rate,
parts_list, parts_cost, labor_cost, tax_rate, tax_amount,
subtotal, total, payment_method, payment_date,
technician_name, service_advisor, warranty_terms,
next_service_due, next_service_mileage, notes
```

**27 fields we would have missed without discovery.**

---

## Integration with Extraction Pipeline

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  New Document   │────▶│  Has Discovery?  │────▶│  Full Extract   │
│     Type        │     │    (check DB)    │     │  (with schema)  │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │ No
                                 ▼
                        ┌──────────────────┐
                        │  Run Discovery   │
                        │  on 20-50 docs   │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ Aggregate Fields │
                        │ Design Schema    │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ Create/Update    │
                        │ Database Tables  │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  Full Extract    │
                        │  (complete)      │
                        └──────────────────┘
```

---

## Key Principle

> "The data knows what it contains. Ask it before you assume."

This is detective work. You observe first, then build your case file structure based on what you observed - not the other way around.

---

## Related Documents

- [CONTENT_EXTRACTION_ARCHITECTURE.md](./CONTENT_EXTRACTION_ARCHITECTURE.md)
- [DATA_INGESTION_AND_REPAIR_SYSTEM.md](./DATA_INGESTION_AND_REPAIR_SYSTEM.md)
- [vehicle-observation-model.md](./vehicle-observation-model.md)

---

## Changelog

- 2026-01-31: Initial document created. Schema Discovery established as core principle.
