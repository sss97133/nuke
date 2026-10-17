-- Describe receipts: the 49 columns with no COMMENT ON COLUMN (0 of 49 described before, v_schema_atlas on prod,
-- 2026-10-09 08:32Z) and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-09 08:30-08:45Z UTC):
--   Columns, types, defaults, constraints and triggers from information_schema, pg_constraint and pg_trigger; fill
--   from count(col) over the whole table (2,430 rows); n_distinct from pg_stats. Writers from code at origin/main
--   1572f9267: supabase/migrations/20250102000004_universal_receipt_system.sql (first shape: upload, OCR fields),
--   20251006043000_receipts_schema.sql (document-scoped shape: scope, source document, receipt_date, total, tax),
--   20251229000001_tier_system_missing_infrastructure.sql (timeline_event_id, part_number),
--   20260507180000_supersede_income_receipts_to_payment_events.sql (supersession columns);
--   nuke_frontend/src/services/receiptService.ts (upload writer), receiptPersistService.ts (vehicle and shop
--   document writers), supabase/functions/ingest-receipts-as-observations (submitted_observation_id, submitted_at),
--   scripts/receipt-attribution-ingest.mjs (scope, vehicle_id, confidence_score, learned_insights.attribution_v1).
--   Rows by creation day and writer shape: 1,876 on 2026-04-27 carry raw_extraction.engine =
--   'macos_vision_ocr+regex' (a local OCR batch whose code is not in this repo); 242 on 2025-10-06 .. 2026-01-23 from
--   vehicle_documents; 116 + 24 + 2 on 2026-05-03 and 124 on 2026-05-02 from writers not identified in the repo;
--   18 on 2026-04-12 from gmail; 13 on 2026-04-13 from vehicle_images; 5 on 2026-03-28; 10 on 2026-05-07.
--   pipeline_registry has no row for the table (2026-10-09).
-- LIMITS:
--   Two writer generations left parallel columns (transaction_date / receipt_date / purchase_date; total_amount /
--   total; tax_amount / tax; raw_extraction / raw_json). They are described as they are; no column is merged here.
--   Quoted values are status codes and writer labels: no names, vendors, card digits, ids or amounts.
-- CHANGED EXISTING COMMENTS:
--   Table comment: it said "Receipt uploads and parsed data for parts and tools"; most rows are a 2026-04-27 OCR batch
--   of personal and business receipts. It now names the grain, the writers, the clocks and the supersession rule.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.receipts IS
'Purchase receipts read from documents: one row per receipt document (grain: one receipt; outflows only, since 2026-05-07 income rows are superseded to payment_events). 2,430 rows (2026-10-09), all under one account: 1,876 from a local OCR batch on 2026-04-27 (raw_extraction.engine = macos_vision_ocr+regex), 242 from vehicle_documents uploads (2025-10 .. 2026-01), the rest from gmail, vehicle_images and hand batches in 2026-03 .. 2026-05. 327 rows name a vehicle (22 vehicles). Each row is an extraction of a document, so every field is the document''s claim as read by OCR or an LLM, with confidence_score where the writer gave one. Event time = transaction_date / receipt_date / purchase_date (the purchase day printed on the receipt); ingest time = created_at. Lines are in receipt_items (receipt_id). 783 rows were re-landed as vehicle_observations (submitted_observation_id). No pipeline_registry owner (2026-10-09).';

-- ── Identity, owner and scope ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.receipts.id IS
'Surrogate key of the receipt. Unit: none (uuid). Source: uuid_generate_v4() default. receipt_items.receipt_id and vehicle_observations (via submitted_observation_id on this row) point at it. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.user_id IS
'Account that owns the receipt, foreign key to auth.users.id; set by every writer to the signed-in user (receiptService, receiptPersistService) or the batch owner. One distinct value on all 2,430 rows (2026-10-09). RLS policies read it. Unit: none (uuid). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.created_by IS
'Account that created the row, from the 2025-10-06 document-scoped shape (receiptPersistService sets it to the signed-in user). Filled on 144 of 2,430 rows; one distinct value; the other writers leave it NULL, so read user_id for ownership. Unit: none (uuid, no foreign key). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.scope_type IS
'What the purchase was for, as a label: vehicle (253), org (114), personal (1,623), unknown (439), income_1099_NEC (1) on 2026-10-09. Default user. Set at insert by the document writers (vehicle, org) and by the OCR batch; set or kept by scripts/receipt-attribution-ingest.mjs from an LLM attribution (learned_insights.attribution_v1). Triggers read it: vehicle rows enqueue vehicle_stats_recompute_queue (receipts_stats_trigger) and org rows refresh the org focus (auto_update_primary_focus_on_receipts). A label, not verified spend classification. Unit: none (text code). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.scope_id IS
'Target of scope_type, as text: for vehicle rows the vehicle uuid (equal to vehicle_id on all 253 vehicle rows, 2026-10-09); for org rows the shop or organization uuid; for non-vehicle scopes set by receipt-attribution-ingest.mjs it mirrors the scope_type label. 17 distinct values on 1,991 filled rows. No foreign key; triggers cast it to uuid when scope_type = vehicle. Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.vehicle_id IS
'Vehicle the receipt is attributed to (vehicles.id), without a foreign key on prod. Set by receiptPersistService for vehicle documents, by receipt-attribution-ingest.mjs from an LLM attribution at or above its confidence floor, and repointed by scripts/merge-vehicles.js. Filled on 327 of 2,430 rows, 22 distinct vehicles (2026-10-09). Read by the vehicle investment ledger, valuation services and forensic-deal-jacket. Unit: none (uuid). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.is_active IS
'Soft visibility flag for the professional tools view (professionalToolsService toggles it). Default true; true on all 2,430 rows (2026-10-09). Not the supersession flag (see is_superseded). Unit: boolean. Grain: one receipt. Clock: n/a.';

-- ── Source document ─────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.receipts.file_url IS
'Storage URL of the receipt image or document that was read (NOT NULL). Set at insert by every writer: the upload path in receiptService, the vehicle_documents or shop_documents file_url in receiptPersistService, a local file reference for the OCR batch. Not necessarily public. Unit: none (URL text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.file_name IS
'Original file name or document title of the source file, from the upload (receiptService: File.name) or the document row (title). Filled on 2,418 of 2,430 rows. Descriptive only; not a key. Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.file_type IS
'MIME type or source kind of the file: image/jpeg (505), email (18), text/html (5), application/pdf (4); NULL on 1,898 rows, including the 2026-04-27 OCR batch (2026-10-09). Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.source_document_table IS
'Table holding the document this receipt was read from: vehicle_documents (242), gmail (18), vehicle_images (13); NULL on 2,157 rows, including the OCR batch (2026-10-09). The 2025-10-06 shape also allowed shop_documents (no rows). Read with source_document_id; receiptPersistService uses the pair for idempotency. Unit: none (text code). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.source_document_id IS
'Id of the source row in source_document_table (no foreign key, the target table varies). Filled on 255 of 2,430 rows. With source_document_table it is the idempotency key of the document writers: a second parse of the same document returns the existing receipt. Unit: none (uuid). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.upload_date IS
'When the file was uploaded, from the 2025-01-02 shape: default now() at insert and no writer passes it, so it equals created_at on 2,320 of 2,430 rows (2026-10-09). Not the purchase day. Unit: timestamptz. Grain: one receipt. Clock: ingest time.';

-- ── Extraction run ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.receipts.processing_status IS
'Extraction state of the row: extracted (2,022), completed (245), processed (142), pending (20), processing (1) on 2026-10-09. Default pending. receiptService writes completed or failed; receiptPersistService now writes parsed (no rows yet); the OCR batch wrote extracted. The trigger recompute_value_from_receipts only enqueues a vehicle value recompute for validated or saved, which no row carries, so that trigger has not fired on any current row. Unit: none (text code). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.status IS
'Second status column from the 2025-10-06 document-scoped shape: extracted (1,948), processed (343), active (124), stub (15) on 2026-10-09. Default processed. stub rows are the gmail placeholders with processing_status pending. Read together with processing_status; neither is a review or approval state. Unit: none (text code). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.processed_at IS
'When the row was processed: default now() at insert, so it is the insert time for every writer; latest value 2026-05-08 (2026-10-09). Unit: timestamptz. Grain: one receipt. Clock: ingest time.';
COMMENT ON COLUMN public.receipts.raw_extraction IS
'Full extraction payload from the 2025-01-02 shape. On the 1,876 rows of the 2026-04-27 OCR batch it holds engine, ocr, data, source_file, extracted_at, attribution and redate_applied_at / redate_old_date (a same-day re-dating pass kept the old date); on about 196 rows it holds an LLM who / what / when / where / why / vehicle / financials reading. Filled on 2,128 rows. Kept as written; the typed columns are derived from it. Unit: none (jsonb). Grain: one receipt. Clock: n/a (the payload carries its own extracted_at).';
COMMENT ON COLUMN public.receipts.raw_json IS
'Parser output stored by the 2025-10-06 document writers (receiptPersistService: parsed.raw_json or the whole parse) and by later batches. Filled on 2,225 rows (2026-10-09). Parallel to raw_extraction; a row can carry both. Unit: none (jsonb). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.confidence_score IS
'Writer confidence, 0.00 to 1.00 (DECIMAL(3,2) in the 2025-01-02 shape): the parser confidence from receiptService, or the attribution confidence written by receipt-attribution-ingest.mjs (which replaces the earlier value). Filled on 2,013 rows, range 0.00 .. 1.00 (2026-10-09). Which writer set it is not recorded on the row; learned_insights.attribution_v1.confidence is present when the attribution script did. Unit: fraction 0..1. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.extraction_errors IS
'Parser error messages from receiptService (parseResult.errors). UNUSED in practice: NULL on all 2,430 rows (2026-10-09). Unit: none (text[]). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.learned_insights IS
'Annotations added after extraction. attribution_v1 (143 rows): the LLM attribution written by scripts/receipt-attribution-ingest.mjs (scope_type, vehicle_id, confidence, reasoning, signals_used, ingested_at); 10 rows carry source_observation_id / source_url / agent_session from a hand batch. Default {}; non-empty on 153 rows (2026-10-09). Claims about the receipt, not facts. Unit: none (jsonb). Grain: one receipt. Clock: n/a (attribution_v1.ingested_at is its own ingest time).';
COMMENT ON COLUMN public.receipts.vendor_pattern_id IS
'Intended link to a learned vendor pattern; no foreign key and no writer in the repo (2026-10-09). Filled on 1 of 2,430 rows. Unknown target table. Unit: none (uuid). Grain: one receipt. Clock: n/a.';

-- ── Vendor and document identifiers (document claims) ───────────────────────────────────────────────────────────

COMMENT ON COLUMN public.receipts.vendor_name IS
'Seller name printed on the receipt as read by the extractor (OCR or LLM); free text, not keyed to organizations. Filled on 2,350 of 2,430 rows. Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.vendor_address IS
'Seller address printed on the receipt as read by the extractor; free text, not keyed to a place. Filled on 1,985 rows (2026-10-09). Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.transaction_number IS
'Transaction or register number printed on the receipt, from receiptService. Filled on 24 of 2,430 rows. Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.invoice_number IS
'Invoice number printed on the document, from the document writers. Filled on 43 rows (2026-10-09). Read by the vehicle investment ledger. Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.purchase_order IS
'Purchase order number from the document writers. UNUSED: NULL on all 2,430 rows (2026-10-09). Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.part_number IS
'Part number when the receipt is for one part, added by 20251229000001 (back-filled there from a metadata part_number key). Filled on 198 rows (2026-10-09). Line-level part numbers live in receipt_items.part_number. Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.payment_method IS
'Payment method printed on the receipt as read by the extractor (card network, cash and similar), free text with 21 distinct values; filled on 1,379 rows (2026-10-09). Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.card_last4 IS
'Last four card digits printed on the receipt, as read by the extractor. Private: payment data, never shown publicly. Filled on 793 rows (2026-10-09). Used by scripts/receipts/reconcile.mjs to match receipts to statements. Unit: none (text). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.card_holder IS
'Card holder name printed on the receipt, as read by the extractor. Private. Filled on 2 of 2,430 rows (2026-10-09). Unit: none (text). Grain: one receipt. Clock: n/a.';

-- ── Dates (event time, as printed on the document) ──────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.receipts.transaction_date IS
'Purchase day printed on the receipt, from the 2025-01-02 shape (receiptService) and the OCR batch; receiptPersistService writes the same parsed day here and to receipt_date. Filled on 1,992 rows; differs from receipt_date on 33 rows where both are filled (2026-10-09). The 2026-04-27 batch re-dated some rows the same day (raw_extraction.redate_old_date keeps the earlier reading). Unit: date. Grain: one receipt. Clock: event time (the purchase, as printed).';
COMMENT ON COLUMN public.receipts.receipt_date IS
'Purchase day printed on the receipt, from the 2025-10-06 document-scoped shape (receiptPersistService). Filled on 806 rows (2026-10-09). The parallel of transaction_date; readers coalesce purchase_date, transaction_date, receipt_date in that order (20260507180000). Unit: date. Grain: one receipt. Clock: event time (the purchase, as printed).';
COMMENT ON COLUMN public.receipts.purchase_date IS
'Purchase day, third date column; 20251229000001 defined a sync trigger with receipt_date that is not live on prod (2026-10-09). Filled on 82 rows. First in the readers'' coalesce order. Unit: date. Grain: one receipt. Clock: event time (the purchase).';

-- ── Amounts (document claims; currency in currency) ─────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.receipts.currency IS
'ISO currency code of the amounts: USD (284), EUR (1), NULL (2,145) on 2026-10-09. receiptPersistService defaults it to USD; the OCR batch left it NULL, so NULL means not recorded, not USD by rule. Unit: none (ISO 4217 code). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.total_amount IS
'Receipt total as read from the document, from the 2025-01-02 shape (receiptService, OCR batch); receiptPersistService writes the same parse here and to total. Filled on 2,113 rows; differs from total on 22 rows where both are filled (2026-10-09). Unit: money in currency (NULL currency: not recorded). Grain: one receipt. Clock: n/a (amount as of transaction_date).';
COMMENT ON COLUMN public.receipts.total IS
'Receipt total from the 2025-10-06 document-scoped shape; parallel to total_amount. Filled on 1,930 rows (2026-10-09). Read by the vehicle investment ledger, vehicleValuationService and forensic-deal-jacket. Unit: money in currency. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.subtotal IS
'Pre-tax subtotal as read from the document (both shapes write it). Filled on 1,051 rows (2026-10-09). Unit: money in currency. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.tax_amount IS
'Tax as read from the document, from the 2025-01-02 shape (receiptService); receiptPersistService writes the same value here and to tax. Filled on 1,049 rows (2026-10-09). Unit: money in currency. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.tax IS
'Tax from the 2025-10-06 document-scoped shape; parallel to tax_amount. Filled on 900 rows (2026-10-09). Unit: money in currency. Grain: one receipt. Clock: n/a.';

-- ── Links and supersession ──────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.receipts.timeline_event_id IS
'Timeline event the receipt documents, added by 20251229000001 (declared there with a foreign key to vehicle_timeline_events; no foreign key on prod, 2026-10-09). Filled on 5 rows. Unit: none (uuid). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.submitted_observation_id IS
'vehicle_observations row this receipt was landed as, written by the edge function ingest-receipts-as-observations (through ingest-observation) and scripts/receipt-attribution-cleanup.mjs; NULL means not yet landed. Filled on 783 of 2,430 rows (2026-10-09). No foreign key. Unit: none (uuid). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.submitted_at IS
'When the row was landed as an observation, set with submitted_observation_id by ingest-receipts-as-observations. Filled on 783 rows (2026-10-09). Unit: timestamptz. Grain: one receipt. Clock: ingest time (of the observation copy).';
COMMENT ON COLUMN public.receipts.is_superseded IS
'True when the receipt has been superseded and kept (never deleted): set by 20260507180000 for income rows whose canonical home is payment_events. True on 5 of 2,430 rows (2026-10-09). Readers such as scripts/receipts/reconcile.mjs skip true rows. Default false. Unit: boolean. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.superseded_by IS
'payment_events row that replaces this receipt, foreign key to payment_events.id (ON DELETE SET NULL). Filled on the 5 superseded rows (2026-10-09). Unit: none (uuid). Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.receipts.superseded_at IS
'When the row was superseded, set by 20260507180000. Filled on 5 rows (one distinct time, 2026-10-09). Unit: timestamptz. Grain: one receipt. Clock: ingest time (of the supersession).';
COMMENT ON COLUMN public.receipts.superseded_reason IS
'Why the row was superseded, as text; the 5 rows carry the 20260507180000 reason (income event, canonical home payment_events; receipts is for outflows). Unit: none (text). Grain: one receipt. Clock: n/a.';

-- ── Row clocks ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.receipts.created_at IS
'When the row was inserted: default now(); by month 2025-10 (100), 2026-01 (142), 2026-03 (5), 2026-04 (1,907), 2026-05 (276); latest 2026-05-07 (2026-10-09). Unit: timestamptz. Grain: one receipt. Clock: ingest time.';
COMMENT ON COLUMN public.receipts.updated_at IS
'When the row last changed: default now() and stamped by the trigger update_receipts_updated_at on every UPDATE (attribution, observation landing, supersession); latest 2026-09-28 (2026-10-09). Unit: timestamptz. Grain: one receipt. Clock: ingest time (last edit).';

-- A column added between this PR and its deploy must not block the deploy: report, never raise.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.receipts'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'receipts: every column has a comment';
  ELSE
    RAISE NOTICE 'receipts columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
