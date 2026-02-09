# Receipts and Timeline: One Source of Truth, No Backfilling

## Principle

1. **Receipts are only true to one thing: the date they occurred.** That date is the universal invariant. Everything else (vendor, total, line items, payment method) is detail about something that happened on that day.

2. **Timeline is where we measure daily events.** So every receipt belongs on the timeline. The timeline row is the anchor: `event_date` + who (org/user) + what (event_type). The receipt is the structured expansion of “what” for spend/document events.

3. **We must have database tables for every single point of data of every single receipt.** No “we’ll parse it later from JSON.” No backfilling from `raw_extraction` or `metadata`. If we store it, it goes in a column. That way we never have to re-extract or backfill—we query what we have.

---

## Current state (audit)

### Where receipt-like data lives today

| Concept | Table(s) | Structured columns | Trapped in JSON / blob |
|--------|----------|--------------------|-------------------------|
| **Org daily event** | `business_timeline_events` | id, business_id, created_by, event_type, event_category, title, description, **event_date**, cost_amount, cost_currency, ... | metadata JSONB |
| **User receipt (file upload)** | `receipts` (50102000004) | user_id, file_url, vendor_name, transaction_date, total_amount, subtotal, tax_amount, ... | raw_extraction JSONB |
| **Line items (user receipts)** | `line_items` | receipt_id, part_number, description, quantity, unit_price, total_price, brand, category, line_type | additional_data JSONB |
| **Payments (user receipts)** | `payment_records` | receipt_id, payment_date, payment_type, amount, transaction_number | additional_data JSONB |
| **Scope-aware receipts** | `receipts` (5106043000) | scope_type, scope_id, source_document_*, vendor_name, **receipt_date**, subtotal, tax, total, ... | raw_json JSONB |
| **Receipt line items (scope)** | `receipt_items` | receipt_id, line_number, description, part_number, quantity, unit_price, total_price, category | — |
| **Link receipt → timeline** | `receipt_links` | receipt_id, linked_type ('vehicle','org','work_session','**timeline_event**'), linked_id | — |
| **Work order parts** | `work_order_parts` | timeline_event_id, part_name, brand, quantity, unit_price, total_price, supplier | — (references timeline_events) |
| **Work order labor** | `work_order_labor` | timeline_event_id, task_name, hours, hourly_rate, total_cost | — (references timeline_events) |
| **Work order materials** | `work_order_materials` | timeline_event_id, material_name, quantity, unit_cost, total_cost | — |
| **Work order overhead** | `work_order_overhead` | timeline_event_id, facility_hours, facility_rate, ... | — |

### Gaps and problems

- **Two “receipts” notions:** (a) user file receipts → `receipts` + `line_items` (user_id, no timeline_event_id); (b) scope receipts → `receipts` (scope_type/scope_id) + `receipt_items` + `receipt_links`. They don’t share one header table or one timeline anchor.
- **Timeline split:** `business_timeline_events` (org, date) vs `timeline_events` (vehicle, date). Work order detail (parts, labor) points at `timeline_events`. Org timeline UI uses `business_timeline_events`. So “receipt for something that happened at an org on a day” doesn’t have a single obvious timeline row.
- **Critical data still in JSON:** Vendor address, transaction number, payment method, line-level notes, etc. often live in `raw_extraction` / `raw_json` / `metadata`. That’s what forces future backfills. Any query or report that needs “every vendor” or “every payment method” has to parse JSON.
- **Date is not always the join key:** Receipts have `transaction_date` or `receipt_date`; timeline has `event_date`. They should be the same fact. Ideally one row on the timeline has `event_date`, and the receipt is “the structured content of that event,” so no separate date column on the receipt header—it’s the timeline’s `event_date`.

---

## Target model: Receipt = timeline event + full structured tables

### 1. One anchor: “Something happened on this date”

- **Org (or user) timeline:** One table that represents “an event on a day.” For orgs that’s `business_timeline_events` (business_id + event_date + event_type + title + …). For vehicles it’s `timeline_events`. For a unified “daily event” you could have a single view or a single table; minimally, we treat **event_date** as the universal date and one of these as the parent row.
- **Rule:** Every receipt is attached to exactly one timeline event row. That row provides **event_date**. So the receipt never “has its own” date that could drift—the date is the timeline’s date.

### 2. Receipt header: one table, every field a column

One canonical **receipt** (or **receipt_header**) table:

- **Anchor:** `business_timeline_event_id` (or a generic `timeline_event_id` + event_type if we unify vehicle/org). Not optional for new receipts.
- **Identity:** id, source (upload, manual, api, ocr), source_document_id if from a file.
- **Vendor (all columns, no JSON):** vendor_name, vendor_address_line1, vendor_address_line2, vendor_city, vendor_region, vendor_postal_code, vendor_country, vendor_tax_id, vendor_phone, vendor_email.
- **Document:** invoice_number, receipt_number, purchase_order_number, quote_number.
- **Date:** No `receipt_date`—use parent timeline event’s `event_date`. Optionally `transaction_date` if it differs (e.g. invoice date vs service date), but the canonical “when did this happen” is the timeline event.
- **Amounts:** subtotal, tax_amount, discount_amount, total_amount, currency, exchange_rate (if different from base).
- **Payment:** payment_method (enum or text), card_last4, card_brand, card_holder, payment_reference.
- **Status:** status (pending, processed, failed), confidence_score (for OCR), processed_at.
- **Audit:** created_by, created_at, updated_at. Optional: raw_extraction JSONB for audit only—never used as source of truth for reporting or UI.

Every field above is a column. Nothing that we ever query or report on should live only in JSON.

### 3. Line items: one table, every field a column

One **receipt_line_items** (or keep name **receipt_items** / **line_items** and standardize):

- receipt_id, line_number (or sequence).
- description, part_number, vendor_sku, category, brand.
- quantity, unit, unit_price, discount_amount, total_price.
- line_type (sale, warranty, return, payment, fee, shipping, tax, other).
- Optional: serial_number, warranty_info, tax_code.

Again: no “additional_data” or “extra” JSON for anything we might filter or aggregate on. Use columns.

### 4. Payments (if multiple per receipt)

**receipt_payments** (or **payment_records**):

- receipt_id, payment_date, payment_type, amount, currency, transaction_number, card_last4, card_brand, etc. All as columns.

### 5. Link to timeline

- **Strict:** Receipt header has `business_timeline_event_id` NOT NULL (for org timeline). So when we show “Feb 8” we join business_timeline_events → receipt → receipt_line_items. No backfill: the date is always from the timeline.
- **Optional:** If we also support vehicle-scoped receipts, add `timeline_event_id` (vehicle) and a convention: either one or the other is set, and the “date” for the receipt is that event’s event_date.

---

## Migration path (high level)

1. **Decide the single timeline anchor for “receipts from all over the place”:** e.g. “every spend receipt creates or links to a `business_timeline_events` row (org + event_date).” So first we ensure there’s a timeline event for that day/org (or user); then we attach the receipt to it.
2. **Introduce the canonical receipt header table** with every point of data as columns (and optional raw_extraction for audit). Backfill or map from existing `receipts` / `receipt_items` / `line_items` into the new schema; going forward, all new receipts write there.
3. **Migrate existing JSON:** For every receipt that has raw_extraction or raw_json, run a one-time job that **writes** extracted values into the new columns (and optionally keeps the blob). After that, no app logic reads receipt structure from JSON.
4. **Unify “receipt” and “work order” where it makes sense:** Work order parts/labor are already in tables. For shop work, the “receipt” might be the business_timeline_event + work_order_parts + work_order_labor. For an uploaded vendor invoice, the “receipt” is the new receipt header + receipt_line_items. Same timeline, same event_date; different detail tables depending on event_type.
5. **UI and ingestion:** All ingestion paths (upload, API, manual entry) write into the same tables. Timeline views (org heatmap, daily detail) join timeline → receipt → line items. No second “receipt date”—we use event_date everywhere.

---

## Summary

- **Receipts are extremely important; we don’t want to backfill later.** So every queryable fact is in a column.
- **Receipts come from everywhere.** One pipeline, one schema: one receipt header + line items + payments, all tied to a timeline event.
- **The only thing that’s true about every receipt is the date.** That date is the timeline event’s `event_date`; the receipt is the structured expansion of that event.
- **Database tables for every single point of data:** header table (vendor, amounts, payment, doc numbers), line items table, payments table. No “metadata” or “raw_json” as source of truth for reporting or product behavior.

This doc is the design target. Next step is a concrete migration (new tables + columns, and a single timeline anchor choice) and then moving ingestion and UI to write/read only from those tables.
