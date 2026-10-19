-- Consolidate twelve queued schema-description proposals (dated 2026-10-09..14).
-- Comments only: preserve their dated evidence and Unknown qualifications.
-- No testimony, columns, constraints, privileges, jobs or source activation change.
-- Production metadata deployment requires separate authorization.
BEGIN;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '2s';

-- Queued documentation source: PR #907
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

-- Queued documentation source: PR #908
-- Describe acquisition_pipeline: the 55 columns with no COMMENT ON COLUMN (0 of 55 described before, v_schema_atlas
-- on prod, 2026-10-09 08:32Z) and a table comment (there was none). Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-09 08:35-08:40Z UTC):
--   Columns, types, defaults, constraints, indexes and triggers from information_schema, pg_constraint, pg_indexes and
--   pg_trigger; fill from count(col) over the whole table (864 rows); categorical counts by group by. Writers from code
--   at origin/main 1572f9267 and git history: supabase/migrations/20260219220000_acquisition_pipeline.sql (table,
--   enums, triggers, advance_acquisition_stage), 20260225000010 (six pg_cron jobs calling discover-cl-muscle-cars and
--   batch-market-proof; none is scheduled on prod, 2026-10-09), 20260226000001 (dedup by discovery_url),
--   20260226000002 (seller_id, cross_post_id), 20260226000003 (seller back-fill); the edge functions
--   discover-cl-muscle-cars and batch-market-proof (deleted 2026-03-09 in 5741560ae; read at 5741560ae^) and
--   market-proof (deleted 2026-03-29 in f39c14bc6; read at 5741560ae^); the live edge functions acquire-vehicle (stage
--   steps), process-cl-queue (vehicle_id, seller_id, seller_contact) and pipeline-dashboard (reader).
--   pipeline_registry has no row for the table (2026-10-09).
-- LIMITS:
--   Rows were inserted on 2026-02-19 (768), 2026-02-25 (94) and 2026-02-26 (2); the last write was 2026-02-27. No
--   scheduled writer remains. The comments state what the writers computed, not whether the estimates were right.
--   Quoted values are stage, priority and writer codes: no names, contacts, URLs, ids or amounts.

COMMENT ON TABLE public.acquisition_pipeline IS
'Buy-side deal funnel for collector cars found on Craigslist: one row per discovered listing (grain: one listing URL; discovery_url is distinct on all rows after the 2026-02-26 dedup). 864 rows (2026-10-09), inserted 2026-02-19 .. 2026-02-26 by the discovery function discover-cl-muscle-cars and an agent batch, scored by market-proof (comparable sales → deal_score, estimated_value, estimated_profit, market_proof_data), advanced through acquisition_stage by acquire-vehicle and advance_acquisition_stage. Stages on 2026-10-09: market_proofed 820, target 34, contacted 8, inspecting 1, discovered 1; no row reached an offer, a purchase or a sale, so every acquisition, shop, resale and money column after offer_amount is empty. The discovery and scoring functions were deleted in 2026-03 and no cron feeds the table; last write 2026-02-27. Stage changes are logged in acquisition_stage_log (trigger trg_acquisition_stage_log). Event time = discovery_date (when our crawler found the listing; the listing''s own post time is not kept); ingest time = created_at. No pipeline_registry owner (2026-10-09).';

-- ── Identity and links ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.id IS
'Surrogate key of the pipeline row. Unit: none (uuid). Source: gen_random_uuid() default. acquisition_stage_log.pipeline_id, market_proof_reports.pipeline_id and pipeline_cross_posts point at it. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.vehicle_id IS
'Vehicle created from the same listing, foreign key to vehicles.id (ON DELETE CASCADE: deleting the vehicle deletes this row). Set after the fact by process-cl-queue, which matches discovery_url to the queue item''s listing_url when vehicle_id is NULL. Filled on 187 of 864 rows (2026-10-09). Unit: none (uuid). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.organization_id IS
'Organization pursuing the deal, foreign key to organizations.id. UNUSED: NULL on all 864 rows (2026-10-09); no writer sets it. Unit: none (uuid). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.seller_id IS
'Seller profile, foreign key to pipeline_sellers.id (ON DELETE SET NULL), from 20260226000002 / 20260226000003 and process-cl-queue (matched on a phone number extracted from the listing). Filled on 9 rows (2026-10-09). Not keyed to external_identities. Unit: none (uuid). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.cross_post_id IS
'Cross-post group, foreign key to pipeline_cross_posts.id (ON DELETE SET NULL): the same car posted in several Craigslist regions, matched by a year:make:model:price fingerprint in 20260226000002. Filled on 156 rows, 47 distinct groups (2026-10-09). A fingerprint match, not a VIN match. Unit: none (uuid). Grain: one listing. Clock: n/a.';

-- ── Discovery (the listing as found) ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.discovery_source IS
'Platform the listing was found on; default craigslist and craigslist on all 864 rows (2026-10-09). Unit: none (text code). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.discovery_url IS
'URL of the listing as discovered; the working natural key: the discovery function skipped URLs already present, 20260226000001 removed duplicates, and every row is distinct (2026-10-09). Partial btree index idx_pipeline_discovery_url (not unique). process-cl-queue joins on it. Craigslist listings expire, so the URL may no longer resolve. Unit: none (URL text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.discovery_date IS
'When the crawler found the listing: default now(), and discover-cl-muscle-cars passed the run time. Not the listing''s post time, which is not kept. Unit: timestamptz. Grain: one listing. Clock: ingest time (discovery run), the closest this table has to an event time.';
COMMENT ON COLUMN public.acquisition_pipeline.discovered_by IS
'Writer label of the discovering run: discover-cl-muscle-cars (198), claude_agent (117), NULL (549, writer not recorded) on 2026-10-09. Unit: none (text code). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.year IS
'Model year as parsed from the listing title by the discovery writer; range 1958 .. 1991 on all 864 rows (2026-10-09), the window priority encodes. A seller claim, not a decoded VIN. Unit: calendar year. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.make IS
'Make as recorded by the discovery writer (for example Chevrolet, Dodge, Plymouth, Pontiac, Ford; discover-cl-muscle-cars took it from its search term table, not from the vehicle); 11 distinct values (2026-10-09). Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.model IS
'Model as a hint from the search term or the listing title (for example Camaro, Chevelle, GTO); filled on 829 rows, 74 distinct values (2026-10-09). Not keyed to a model catalog. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.engine IS
'Engine as stated in the listing, when the writer read one. Filled on 13 of 864 rows (2026-10-09). A seller claim. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.transmission IS
'Transmission as stated in the listing. UNUSED: NULL on all 864 rows (2026-10-09). Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.asking_price IS
'Seller''s asking price from the listing at discovery (discover-cl-muscle-cars: the listing price). Filled on 771 rows (2026-10-09). An ask, never a sale price; not refreshed after discovery. Unit: USD. Grain: one listing. Clock: as of discovery_date.';
COMMENT ON COLUMN public.acquisition_pipeline.location_city IS
'Listing city as read from the listing; discover-cl-muscle-cars left it NULL and other writers filled it. Filled on 666 rows (2026-10-09). Free text, not keyed to a place. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.location_state IS
'Listing state (US state code as written); filled on 666 rows, 30 distinct values (2026-10-09). Not keyed to a place. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.seller_name IS
'Seller name as stated in the listing. UNUSED: NULL on all 864 rows (2026-10-09). Would hold a person''s name. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.seller_contact IS
'Seller contact: a phone number extracted from the listing by process-cl-queue, or the contact method recorded by acquire-vehicle at the contacted step. Private: a person''s contact detail, never shown publicly. Filled on 19 rows (2026-10-09). Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.notes IS
'Free-text notes: on most rows the listing title as discovered (year and model), with dated lines appended by acquire-vehicle at each stage step. Filled on 589 rows (2026-10-09). Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.tags IS
'Free-form labels on the row. Filled on 36 rows (2026-10-09); no writer in the repo sets them. Unit: none (text[]). Grain: one listing. Clock: n/a.';

-- ── Pipeline state ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.stage IS
'Funnel position, enum acquisition_stage (discovered → market_proofed → target → contacted → inspecting → offer_made → under_contract → payment_pending → acquired → in_transport → at_shop → validated → reconditioning → photography → listing_prep → listed → under_offer → sold → closed). Default discovered. market-proof set market_proofed; batch-market-proof set target when deal_score met its threshold; acquire-vehicle and advance_acquisition_stage set the later steps. Counts on 2026-10-09: market_proofed 820, target 34, contacted 8, inspecting 1, discovered 1. Each change writes acquisition_stage_log. Unit: none (enum). Grain: one listing. Clock: n/a (see stage_updated_at).';
COMMENT ON COLUMN public.acquisition_pipeline.priority IS
'Buy priority, enum acquisition_priority: primary (1958-1973 muscle and sports cars), secondary (1973-1991), opportunistic (any era, exceptional deal), from the discovery writer''s search term table. Default primary; primary 705, secondary 159 (2026-10-09). Unit: none (enum). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.stage_updated_at IS
'When stage last changed: default now(); the BEFORE UPDATE trigger trg_acquisition_pipeline_updated_at keeps the old value unless stage changes, and acquire-vehicle also sets it. Later than created_at on 863 of 864 rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the stage change).';

-- ── Market proof (computed by market-proof from comparable sales) ───────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.deal_score IS
'Deal score 0-100 computed by market-proof (deleted 2026-03-29) from estimated net profit, ROI and comparable count (40 when profit or ROI was unknown, penalized for few comps). 20 on 453 rows, 40 on 190, 50 on 97, 60 on 60, 70 on 36, 80 on 10, 90 on 5 (2026-10-09). A heuristic of that function, not a calibrated probability. Unit: score 0-100. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.market_proof_data IS
'Full market-proof result: analyzed_at, comp_min, comp_max, comp_p25, comp_p75, comp_sample, condition_tier, cost_to_ready, cost_breakdown, cost_notes, discount_to_market, match_strategy, net_profit, roi_pct, target_sale_price, total_investment, recommendation, risk_factors (859 rows; 4 rows carry an earlier, shorter shape; 1 NULL, 2026-10-09). The typed columns comp_*, estimated_value and estimated_profit are copies of fields in it. Unit: none (jsonb; amounts in USD). Grain: one listing. Clock: analyzed_at inside is the computation time.';
COMMENT ON COLUMN public.acquisition_pipeline.comp_count IS
'Number of comparable sold vehicles market-proof matched (match_strategy in market_proof_data); filled on 863 rows, range 0 .. 200 (2026-10-09). Unit: count of comparables. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.comp_median IS
'Median sale price of the comparables market-proof matched. Filled on 860 rows (2026-10-09). Unit: USD. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.comp_avg IS
'Mean sale price of the comparables market-proof matched. Filled on 860 rows (2026-10-09). Unit: USD. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.estimated_value IS
'market-proof target resale price for the car after reconditioning (market_proof_data.target_sale_price; equal on all 669 rows where both are filled). Filled on 673 rows (2026-10-09). An estimate, not an appraisal. Unit: USD. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.estimated_profit IS
'market-proof estimated net profit: target resale price minus asking price and estimated cost to ready (market_proof_data.net_profit; equal on all 669 rows where both are filled). Filled on 673 rows (2026-10-09). An estimate. Unit: USD. Grain: one listing. Clock: as of market_proof_data.analyzed_at.';
COMMENT ON COLUMN public.acquisition_pipeline.confidence_score IS
'Confidence of the market proof, set by market-proof from comp_count only: 85 for 10 or more comparables, 70 for 5-9, 55 for 3-4, 30 below. 85 on 841 rows, 70 on 17, 55 on 2, 30 on 3, NULL on 1 (2026-10-09). Unit: score 0-100 (four levels). Grain: one listing. Clock: as of market_proof_data.analyzed_at.';

-- ── Acquisition, shop and validation (acquire-vehicle steps; empty on every row) ─────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.offer_amount IS
'Offer made to the seller, set by acquire-vehicle at offer_made. UNUSED so far: NULL on all 864 rows (2026-10-09). Unit: USD. Grain: one listing. Clock: as of offer_date.';
COMMENT ON COLUMN public.acquisition_pipeline.offer_date IS
'When the offer was recorded (acquire-vehicle writes the call time at offer_made). NULL on all rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the step), standing in for the offer event.';
COMMENT ON COLUMN public.acquisition_pipeline.purchase_price IS
'Agreed purchase price, set by acquire-vehicle at under_contract. NULL on all rows (2026-10-09). Input to the generated total_investment and gross_profit. Unit: USD. Grain: one listing. Clock: as of purchase_date.';
COMMENT ON COLUMN public.acquisition_pipeline.purchase_date IS
'When the contract was recorded (acquire-vehicle writes the call time at under_contract). NULL on all rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the step), standing in for the purchase event.';
COMMENT ON COLUMN public.acquisition_pipeline.title_status IS
'Title status stated at under_contract (free text from the acquire-vehicle caller). NULL on all rows (2026-10-09). Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.partner_shop_id IS
'Partner shop the car goes to, set by acquire-vehicle at inspecting or at_shop (a partner_shops id looked up by shop name; no foreign key). NULL on all rows (2026-10-09). Unit: none (uuid). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.shop_arrival_date IS
'When arrival at the shop was recorded (acquire-vehicle writes the call time at at_shop). NULL on all rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the step).';
COMMENT ON COLUMN public.acquisition_pipeline.inspection_report IS
'Inspection findings passed to acquire-vehicle at validated. NULL on all rows (2026-10-09). Unit: none (jsonb). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.repair_estimate IS
'Estimated repair cost passed to acquire-vehicle at validated. NULL on all rows (2026-10-09). Input to total_investment and gross_profit. Unit: USD. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.authentication_result IS
'Authentication or provenance check result passed to acquire-vehicle at validated. NULL on all rows (2026-10-09). Unit: none (jsonb). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.numbers_matching_verified IS
'Whether numbers-matching was verified at validated (acquire-vehicle numbers_matching). NULL on all rows (2026-10-09). Unit: boolean. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.reconditioning_cost IS
'Reconditioning spend; acquire-vehicle at acquired adds any total_cost above purchase price and repair estimate here. NULL on all rows (2026-10-09). Input to total_investment and gross_profit. Unit: USD. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.reconditioning_items IS
'Reconditioning line items, shape [{item, cost, vendor, status}] per 20260219220000. UNUSED: NULL on all rows, no writer in the repo (2026-10-09). Unit: none (jsonb). Grain: one listing. Clock: n/a.';

-- ── Resale (acquire-vehicle steps; empty on every row) ──────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.listing_platform IS
'Platform the car was relisted on for resale (for example bat, cab), set by acquire-vehicle at listed. NULL on all rows (2026-10-09). Unit: none (text code). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.listing_url_resale IS
'URL of the resale listing, set by acquire-vehicle at listed. NULL on all rows (2026-10-09). Unit: none (URL text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.acquisition_pipeline.listing_date IS
'When the resale listing was recorded (acquire-vehicle writes the call time at listed). NULL on all rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the step).';
COMMENT ON COLUMN public.acquisition_pipeline.sale_price IS
'Resale price, set by acquire-vehicle at sold. NULL on all rows (2026-10-09). Input to gross_profit. Unit: USD. Grain: one listing. Clock: as of sale_date.';
COMMENT ON COLUMN public.acquisition_pipeline.sale_date IS
'When the resale was recorded (acquire-vehicle writes the call time at sold). NULL on all rows (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (of the step), standing in for the sale event.';
COMMENT ON COLUMN public.acquisition_pipeline.buyer_info IS
'Buyer details passed to acquire-vehicle at sold. Private: would hold a person''s details. NULL on all rows (2026-10-09). Unit: none (jsonb). Grain: one listing. Clock: n/a.';

-- ── Generated financials ────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.total_investment IS
'GENERATED ALWAYS (stored): coalesce(purchase_price, 0) + coalesce(reconditioning_cost, 0) + coalesce(repair_estimate, 0). 0 on all 864 rows because no row has those inputs (2026-10-09); 0 means no inputs, not a zero-cost car. market_proof_data.total_investment is a separate estimate. Unit: USD. Grain: one listing. Clock: n/a (recomputed on every write).';
COMMENT ON COLUMN public.acquisition_pipeline.gross_profit IS
'GENERATED ALWAYS (stored): coalesce(sale_price, 0) - coalesce(purchase_price, 0) - coalesce(reconditioning_cost, 0) - coalesce(repair_estimate, 0). 0 on all 864 rows (2026-10-09) because no row has a sale or purchase; 0 means no inputs. The view acquisition_pipeline_stats sums it for sold rows only. Unit: USD. Grain: one listing. Clock: n/a (recomputed on every write).';

-- ── Row clocks ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.acquisition_pipeline.created_at IS
'When the row was inserted: default now(); 2026-02-19 (768), 2026-02-25 (94), 2026-02-26 (2) (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time.';
COMMENT ON COLUMN public.acquisition_pipeline.updated_at IS
'When the row last changed: default now() and set by the BEFORE UPDATE trigger trg_acquisition_pipeline_updated_at; latest 2026-02-27 (2026-10-09). Unit: timestamptz. Grain: one listing. Clock: ingest time (last edit).';

-- A column added between this PR and its deploy must not block the deploy: report, never raise.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.acquisition_pipeline'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'acquisition_pipeline: every column has a comment';
  ELSE
    RAISE NOTICE 'acquisition_pipeline columns still without a comment: %', missing;
  END IF;
END
$$;

-- Queued documentation source: PR #919
-- Describe publishing_contacts: the 38 columns with no COMMENT ON COLUMN (0 of 38 described before, v_schema_atlas on
-- prod, 2026-10-10 08:30Z) and a table comment (it had none). Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-10 08:31-08:34Z UTC):
--   Columns, defaults, constraints, indexes, policies and grants from information_schema, pg_constraint, pg_indexes and
--   pg_policy; fill, ranges and categorical counts counted on the whole table (17,006 rows); JSONB key sets by
--   jsonb_object_keys. No column value is quoted here: the table holds people's names and addresses.
--   Writers from code at origin/main 483775947: tools/publishing/publishing_migration.py (the CREATE TABLE, run by
--   hand; there is no file for it in supabase/migrations), tools/publishing/ingest_publishing_data.py (ingest_contacts:
--   one INSERT pass from the local SQLite table person_profiles in an email-archive database, skipped when the owner
--   already has rows), and the local scorers that filled person_profiles before the copy:
--   tools/publishing/universal_email_extraction.py (counts, first/last seen, active months, phase, warmth,
--   trajectory, language), tools/publishing/compute_reliability.py (reliability, ghost status and risk, iMessage
--   match, cross-channel), tools/publishing/compute_role_spectrum.py (role_spectrum).
--   Readers: none in supabase/functions or nuke_frontend names the table (grep at 483775947).
--   nuke_frontend/src/pages/publishing/PersonProfile.tsx shows the same field names, served by
--   tools/publishing/serve_data.py from the local SQLite file, not from this table.
-- LIMITS:
--   One hand load: every row was created between 2026-04-14 00:28:56Z and 00:29:51Z and none was updated after.
--   The scores are the local scripts' outputs as of their run (their "today" is 2026-04-08 in
--   universal_email_extraction.py), frozen at the copy; nothing recomputes them. The code that set years_active,
--   credit_count, credit_roles, publications_worked, primary_publication, professional_title, org_name and org_role in
--   person_profiles is not in this repo (no assignment found under tools/publishing); their meaning below comes from
--   the column names, the ingest mapping and the measured fill, and says so.
--   owner_id is one placeholder uuid on all 17,006 rows, not a row of auth.users (0 matches), so the owner policies
--   admit no signed-in user; only service_role reads the rows.
--   publishing_communications (17,006 rows) has a foreign key to this table, but contact_id is NULL on every row
--   (0 distinct values, 2026-10-10 08:33Z): the key is declared and unfilled.

COMMENT ON TABLE public.publishing_contacts IS
'Correspondent profiles from a publishing operator''s email archive: one row per distinct email address (17,006 rows, 17,006 distinct addresses, 2026-10-10), copied once on 2026-04-14 by tools/publishing/ingest_publishing_data.py from the local SQLite table person_profiles (addresses the extractor flagged as noise were excluded at the copy). Counts, dates and scores were computed by local scripts over the archive (and, for 12 rows, an iMessage export) before the copy and are frozen as of that run. Private by policy: privacy_tier is private on every row, RLS admits only owner_id = auth.uid(), and owner_id is a placeholder uuid with no auth user, so only service_role reads it. No foreign key out; publishing_communications.contact_id points in but is unfilled. Not keyed to external_identities or organizations. Clocks: first_seen/last_seen are event times from message dates; created_at is ingest time.';

-- ── Identity ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.id IS
'Surrogate key of the row. Unit: none (uuid). Source: gen_random_uuid() default at the copy. Referenced by publishing_communications.contact_id (foreign key), which is NULL on all 17,006 of its rows (2026-10-10). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.owner_id IS
'The operator whose archive the row came from. Unit: none (uuid). Source: the OWNER_ID constant of ingest_publishing_data.py, a deterministic placeholder (pattern 00000000-0000-4000-a000-...) the script says will be linked to an auth account later; one value on all 17,006 rows and not present in auth.users (2026-10-10). No foreign key. The RLS policies compare it to auth.uid(). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.name IS
'Display name of the correspondent, private. Unit: text. Source: the most common sender/recipient display name seen for the address in the archive (universal_email_extraction.py); when none was seen the ingest writes the email address instead, which is the case on 8,073 of 17,006 rows (2026-10-10). Not verified against any identity record. Grain: one correspondent address. Clock: n/a (as of the extraction run).';
COMMENT ON COLUMN public.publishing_contacts.email IS
'The correspondent''s email address, private; the natural key of the row (17,006 distinct of 17,006, though no UNIQUE constraint enforces it). Unit: text. Source: message headers in the archive. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.domain IS
'Domain of the address. Unit: text (host name). Source: the most common domain seen for the address, else the part after @; equals the part after @ on 17,005 of 17,006 rows (2026-10-10). Text, not a key to organizations. Grain: one correspondent address. Clock: n/a.';

-- ── Professional (filled on 1,050 rows that carry production credits) ──────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.professional_title IS
'Job title for the person as recorded in person_profiles; filled on 1,024 of 17,006 rows (2026-10-10). Unit: text. Source: copied from person_profiles.professional_title; the code that set it is not in this repo, so whether it was parsed from signatures, mastheads or entered by hand is Unknown. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.org_name IS
'Current organization name as recorded in person_profiles (copied from its current_org column); filled on 1,050 rows, the same rows that have a credit_count above 0 (2026-10-10). Unit: text, not a key to organizations. Source: person_profiles.current_org; the code that set it is not in this repo (Unknown method). Grain: one correspondent address. Clock: n/a; "current" means as of the local run, not as of today.';
COMMENT ON COLUMN public.publishing_contacts.org_role IS
'Role at org_name as recorded in person_profiles (copied from current_role); filled on the same 1,050 rows as org_name. Unit: text. Source: person_profiles.current_role; setting code not in this repo (Unknown method). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.publications_worked IS
'The publications the person is credited on, as one text value; filled on the same 1,050 rows as org_name. Unit: text (a list serialized as text; the separator is not documented). Source: person_profiles.publications_worked; setting code not in this repo, presumably the production-credit rebuild (tools/publishing/rebuild_production_credits.py counts credits per person) but that link is Unknown. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.credit_count IS
'Number of production credits (masthead or page credits) attributed to the person. Unit: count. Default 0; above 0 on 1,050 of 17,006 rows, maximum 3,651 (2026-10-10). Source: person_profiles.credit_count, NULL copied as 0; setting code not in this repo (Unknown which credit table and match rule). Grain: one correspondent address. Clock: n/a (as of the local run).';
COMMENT ON COLUMN public.publishing_contacts.credit_roles IS
'The roles named in those credits, as one text value; filled on the same 1,050 rows. Unit: text (serialized list; format not documented). Source: person_profiles.credit_roles; setting code not in this repo. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.primary_publication IS
'The publication the person is most associated with; filled on 352 of 17,006 rows (2026-10-10). Unit: text, not a key. Source: person_profiles.primary_publication; the selection rule is not in this repo (Unknown). Grain: one correspondent address. Clock: n/a.';

-- ── Activity ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.first_seen IS
'Date of the earliest message in the archive that involves the address. Unit: timestamptz (from ISO message dates). Source: universal_email_extraction.py, minimum of the message dates seen for the address. Filled on 17,000 of 17,006 rows; range 2012-01-12 .. 2026-04-08 (2026-10-10). Grain: one correspondent address. Clock: event time (message date).';
COMMENT ON COLUMN public.publishing_contacts.last_seen IS
'Date of the latest message in the archive that involves the address; never before first_seen (0 rows). Unit: timestamptz. Source: universal_email_extraction.py, maximum message date. Filled on 17,000 rows; range 2012-01-13 .. 2026-04-09 (2026-10-10). The archive''s cut-off, not the end of the relationship. Grain: one correspondent address. Clock: event time (message date).';
COMMENT ON COLUMN public.publishing_contacts.active_months IS
'Number of distinct calendar months (YYYY-MM) with at least one message involving the address. Unit: count of months, maximum 169 (2026-10-10). Source: universal_email_extraction.py (len of the set of message months). Default 0. Grain: one correspondent address. Clock: n/a (derived from event times).';
COMMENT ON COLUMN public.publishing_contacts.years_active IS
'Span of years between first_seen and last_seen. Unit: years, maximum 13 (2026-10-10). Source: person_profiles.years_active; the code is not in this repo. Measured: equals year(last_seen) - year(first_seen) on 12,779 of 17,006 rows and that difference + 1 on 302, so the exact rule is Unknown. Default 0. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.is_cross_publication IS
'True when the person is credited on more than one publication; true on 52 rows, all with publications_worked filled (2026-10-10). Unit: boolean. Source: person_profiles.is_cross_publication, copied with bool(); setting code not in this repo (rule Unknown). Grain: one correspondent address. Clock: n/a.';

-- ── Behavioral scores (the operator''s private assessment; filled on the 2,644 addresses with 10 or more messages) ──

COMMENT ON COLUMN public.publishing_contacts.reliability_score IS
'Composite reliability score from compute_reliability.py: 0.25 responsiveness + 0.15 consistency + 0.20 (1 - ghost_risk) + 0.10 cross_channel + 0.15 reciprocity + 0.15 volume_bonus, each part in 0 .. 1 and kept in reliability_factors. Computed only for addresses with 10 or more sent + received emails: filled on 2,644 of 17,006 rows, range 0.228 .. 0.823 (2026-10-10). Unit: score 0 .. 1, uncalibrated heuristic weights. Grain: one correspondent address. Clock: n/a; as of the local run, recency terms measured against the run date.';
COMMENT ON COLUMN public.publishing_contacts.reliability_factors IS
'The parts of reliability_score as a JSON object with 14 keys on all 2,644 filled rows: responsiveness, email_resp_score, email_resp_hours, imsg_resp_score, imsg_resp_hours, consistency (active_months / span months, capped at 1), ghost_risk, ghost_risk_inverse, ghost_status, cross_channel (channels / 2), reciprocity (min(sent, received) / max), volume_bonus (log10(messages) / 3.5, capped at 1), total_messages, channels. Unit: JSONB; hours are hours, scores 0 .. 1. Source: compute_reliability.py. Grain: one correspondent address. Clock: n/a (as of the local run).';
COMMENT ON COLUMN public.publishing_contacts.ghost_status IS
'Silence class from compute_reliability.py, by days since last_seen at the run: low_volume (fewer than 20 messages; 1,108 rows), active (under 30 days; 219), cooling (30-89 days and consistency 0.3 or more; 81), dormant (30-89 days with lower consistency, or 90-364 days; 240), ghosted (365 days or more; 996); NULL on the 14,362 addresses with fewer than 10 messages (2026-10-10). Unit: text class, no CHECK. Grain: one correspondent address. Clock: n/a; relative to the run date, so it ages without being recomputed.';
COMMENT ON COLUMN public.publishing_contacts.ghost_risk IS
'Silence risk paired with ghost_status: days since last_seen at the run / 365, capped at 1 (at 0.95 for the 90-364-day dormant class), 1 for ghosted. Unit: score 0 .. 1; filled on 2,644 rows, range 0 .. 1 (2026-10-10). Source: compute_reliability.py. Grain: one correspondent address. Clock: n/a; relative to the run date.';
COMMENT ON COLUMN public.publishing_contacts.responsiveness_hours IS
'Intended: average hours the contact took to reply (compute_reliability.py writes the email reply average into person_profiles.responsiveness_hours). NULL on all 17,006 rows here (2026-10-10): the value did not reach this table; reliability_factors.email_resp_hours holds it for scored rows. Unit: hours. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.relationship_phase IS
'Relationship phase from universal_email_extraction.py, by months since last_seen at its run (fixed date 2026-04-08) and active_months: new (under 3 months ago, under 3 active months; 471 rows), sustained (under 3 months ago, 3 or more active months; 580), growing (3-11 months ago, 3 or fewer active months; 1,133), fading (3-11 months ago, more than 3 active months; 426), dormant (12 months or more, or no date; 14,396) (2026-10-10). Unit: text class, no CHECK. Grain: one correspondent address. Clock: n/a; relative to 2026-04-08.';
COMMENT ON COLUMN public.publishing_contacts.relationship_warmth IS
'Warmth score from universal_email_extraction.py: min(1, ln(sent + received + 1) / ln(200) x recency x reciprocity), recency 1.0 under 6 months since last_seen, 0.7 under 18, 0.4 under 36, else 0.15 (relative to 2026-04-08); reciprocity 1.5 when mail went both ways, else 1.0. Unit: score 0 .. 1; filled on all rows, range 0 .. 1 (2026-10-10). Grain: one correspondent address. Clock: n/a; relative to 2026-04-08.';
COMMENT ON COLUMN public.publishing_contacts.trajectory IS
'Direction of contact frequency from universal_email_extraction.py: the message dates split in half by count; rising when the second half spans more than 1.2 x the first half''s distinct months, declining under 0.8 x, else stable (also stable with fewer than 4 messages). Values: stable 13,511, rising 2,316, declining 1,179 (2026-10-10). Unit: text class, no CHECK. Grain: one correspondent address. Clock: n/a.';

-- ── Role intelligence and cross-channel ─────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.role_spectrum IS
'Multi-source role profile from compute_role_spectrum.py, for people with production credits or 50 or more emails: a JSON object with total_emails_scanned, observed (roles from keyword matches in email subjects and previews, with counts), cited (masthead and page credit roles) and summary (top 3 observed plus distinct cited roles); 1 row also has platform (a best-effort profile lookup). Filled on 1,263 of 17,006 rows (2026-10-10). Unit: JSONB. Grain: one correspondent address. Clock: n/a (as of the local run).';
COMMENT ON COLUMN public.publishing_contacts.imessage_contact IS
'The iMessage handle matched to this address, private; filled on 12 rows (2026-10-10). Unit: text. Source: compute_reliability.py, matched first by exact email, else by exact lower-cased full name against the iMessage export (a name match can be a different person). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.imessage_volume IS
'Number of iMessage messages with the matched handle. Unit: count; above 0 on the same 12 rows as imessage_contact, default 0 (2026-10-10). Source: compute_reliability.py. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.cross_channel_score IS
'Channels observed / 2: 0.5 for email only, 1.0 for email plus iMessage. Unit: score; filled on the 2,644 scored rows, range 0.5 .. 1 (2026-10-10). Source: compute_reliability.py. Grain: one correspondent address. Clock: n/a.';

-- ── Communication summary ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.total_sent IS
'Messages in the archive sent by this address: universal_email_extraction.py adds 1 when the address is the From of a message. Unit: count, default 0, NULL copied as 0; above 0 on 9,343 rows (2026-10-10). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.total_received IS
'Messages in the archive addressed to this address: universal_email_extraction.py adds 1 for each message with the address in To. Unit: count, default 0; above 0 on 9,182 rows (2026-10-10). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.total_cc IS
'Messages where the address appeared in Cc. Unit: count, default 0; above 0 on 6,558 rows (2026-10-10). Source: universal_email_extraction.py. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.preferred_language IS
'Most common detected language of the address''s messages, default en when none was detected. Values: en 14,668, fr 2,286, mixed 52 (2026-10-10). Unit: text code, no CHECK. Source: universal_email_extraction.py. Grain: one correspondent address. Clock: n/a.';

-- ── Classification and clocks ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.is_noise IS
'Whether the address is noise (lists, automated senders). The ingest copied only person_profiles rows with is_noise = 0 and writes false, so it is false on all 17,006 rows (2026-10-10); noise addresses are absent, not flagged. Unit: boolean, default false. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.privacy_tier IS
'Visibility class: private, published or mutual (CHECK). private on all 17,006 rows, written as a constant by the ingest (2026-10-10). Nothing reads it for access control; the RLS policies use owner_id. Unit: text class. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.source IS
'Provenance label of the row: email_intelligence on all 17,006 rows (column default; the ingest does not set it). Names the local email-archive pipeline, not a source record id. Unit: text. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.created_at IS
'When the row was inserted, default now(): 2026-04-14 00:28:56Z .. 00:29:51Z for every row (one hand run of ingest_publishing_data.py). Not when the person was first seen (first_seen). Unit: timestamptz. Grain: one correspondent address. Clock: ingest time.';
COMMENT ON COLUMN public.publishing_contacts.updated_at IS
'Default now() at insert; no trigger maintains it. Equal to created_at on every row: no row has changed since the load (2026-10-10). Unit: timestamptz. Grain: one correspondent address. Clock: ingest time.';

DO $$
DECLARE
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.publishing_contacts'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF v_missing > 0 THEN
    RAISE NOTICE 'publishing_contacts: % columns still have no comment (a column was added after 2026-10-10)', v_missing;
  END IF;
END $$;

-- Queued documentation source: PR #920
-- Describe wire_termination_specs: the 40 columns with no COMMENT ON COLUMN (4 of 44 described before, v_schema_atlas
-- on prod, 2026-10-10 08:30Z) and a corrected table comment. Comments only; no wiring data or design call changes.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-10 08:32-08:40Z UTC):
--   Columns, defaults, constraints, indexes, triggers and policies from information_schema, pg_constraint, pg_indexes,
--   pg_trigger and pg_policy; fill and categorical counts on the whole table (4,149 rows). Writers from code at
--   origin/main 483775947: supabase/migrations/20260927030100_wiring_map_typed_rows.sql (adds circuit_id, endpoint_id,
--   wire_code, cavity, the DNA columns and supersession; the CREATE TABLE is in no migration file: drift),
--   20260927040100_wiring_map_supersession_keys.sql (wire_number nullable), the wire-end section of
--   docs/wiring/calc-data/load_map_rows.py (REST with the service key; inserts with --with-ends, retires changed or
--   dropped ends by setting is_superseded), and scripts/populate-termination-specs.mjs (the April 2026 backfill,
--   upsert on vehicle_id + wire_number + endpoint_side). pipeline_registry names load_map_rows.py as owner
--   (20261007003007_declare_table_owners_2.sql). Readers: nuke_frontend/src/components/wiring/map/useWiringMap.ts and
--   the map components beside it (read only).
-- Rows by generation (2026-10-10 08:32Z):
--   loader rows (circuit_id set): 4,073, created 2026-09-27 .. 2026-09-29, all method 'registry loader', trust T3;
--   891 live, 3,182 superseded (marked by later loader runs, superseded_by never set).
--   April rows (circuit_id NULL): 76, created 2026-04-12 on a different vehicle id than the loader's (the one
--   hard-coded in populate-termination-specs.mjs; the loader uses its own constant K5). Whether the two ids are one
--   physical vehicle is not established here. These 76 rows carry 76 distinct wire_number values (one end per wire,
--   22 source / 54 device) and the opposite contact genders and other pin counts than the script on main writes, so
--   they came from another version of that writer (Unknown which).
-- LIMITS:
--   Part numbers are design choices from the K5 registry and catalog files (trust T3), not observed installed parts.
--   None of the seven *_catalog_id keys is filled on any row. Inventory columns (in_stock, qty_on_hand) are defaults
--   on every row: no writer sets them.
-- CHANGED EXISTING COMMENTS:
--   Table comment: it said "Each wire has 2 rows (source + device side)"; the loader writes one row per wire end
--   (1 to 6 live ends per wire: 245 wires with 2, 50 with 3, 56 with 4, 2 with 6, 15 with 1), and the April rows hold
--   one end per wire_number. The four existing column comments are kept.

COMMENT ON TABLE public.wire_termination_specs IS
'Wiring design records, one row per wire end: the wire (circuit_id to vehicle_custom_circuits), the node it lands on (endpoint_id to harness_endpoints), the cavity, and the terminal, seal and tool part numbers chosen for it. 4,149 rows (2026-10-10): 4,073 from the wiring map loader docs/wiring/calc-data/load_map_rows.py (2026-09-27 .. 09-29; 891 live, 3,182 superseded) and 76 earlier rows from the April 2026 backfill scripts/populate-termination-specs.mjs (keyed by wire_number + endpoint_side, no circuit). A wire has as many rows as it has ends in the registry (1 to 6 live). Design records at trust T3, not observations of installed parts; corrections supersede (is_superseded), never edit in place. RLS: read policy true, write policy service_role only; the wiring map (useWiringMap.ts) reads live loader rows. Clocks: observed_at is the loader run time, created_at the insert time; there is no event time.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.id IS
'Surrogate key of the row. Unit: none (uuid). Source: gen_random_uuid() default. Referenced only by this table''s own superseded_by (2026-10-10). Grain: one wire end (one design generation). Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.vehicle_id IS
'The vehicle the wiring design is for. Unit: none (uuid, foreign key to vehicles, ON DELETE CASCADE). Source: a constant in each writer; 2 distinct values on prod (2026-10-10): the loader''s K5 constant on all 4,073 loader rows and the id hard-coded in populate-termination-specs.mjs on the 76 April rows. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.circuit_id IS
'The wire this end belongs to. Unit: none (uuid, foreign key to vehicle_custom_circuits, ON DELETE SET NULL). Source: load_map_rows.py, the live v5 registry wire with the same code. Filled on all 4,073 loader rows, NULL on the 76 April rows. With endpoint_id it is the live key: unique index wire_termination_specs_end_live on (circuit_id, endpoint_id) where not superseded. No live end points at a superseded wire (0 rows, 2026-10-10). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.endpoint_id IS
'The map node (plug, device, splice or stud) this end lands on. Unit: none (uuid, foreign key to harness_endpoints, ON DELETE SET NULL). Source: load_map_rows.py, the node whose code is the registry termination''s endpoint. Filled and resolving on all 4,073 loader rows; NULL on the April rows. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.wire_code IS
'The wire''s code in the K5 registry as text (for example a number with a suffix such as g or r, or a named signal), which wire_number (an integer) cannot hold. Unit: text. Source: load_map_rows.py, str(termination.wire); filled on the 4,073 loader rows. Text copy of the circuit''s code, kept with the end; the key is circuit_id. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.cavity IS
'The cavity (pin position) of the connector at the node where this end is inserted. Unit: text, the connector''s own cavity label. Source: load_map_rows.py, termination.cavity from the registry. Filled on 853 of the 891 live loader rows; NULL where the registry termination has no cavity (2026-10-10). Grain: one wire end. Clock: n/a.';

-- ── Connector and terminal ──────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.connector_housing_pn IS
'Part number of the connector housing the end plugs into. Unit: text part number. Source: April rows only, from the termination rule table in populate-termination-specs.mjs (housing pattern with the pin count substituted); filled on 66 of the 76 April rows and on none of the loader rows, which take the housing from the node (harness_endpoints) instead (2026-10-10). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.connector_housing_catalog_id IS
'Intended key of the housing in catalog_parts (foreign key). NULL on all 4,149 rows (2026-10-10): no writer resolves part numbers to the catalog. Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.connector_pin_count IS
'Number of cavities in the connector housing. Unit: count. April rows only: 61 on the 22 source-side rows (the 61-pin D38999 bulkhead) and 2 on the 54 device-side rows; NULL on all loader rows (2026-10-10). The script on main writes 12 for the source side, so these values came from another version of it. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.terminal_contact_pn IS
'Part number of the crimp contact (pin or socket) or terminal on this end. Unit: text part number. Source: load_map_rows.py, the first code of the registry termination''s part field (codes joined by " + "); April rows from the rule table. Filled on 4,139 of 4,149 rows (2026-10-10). A design choice, not an observed installed part. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.terminal_contact_catalog_id IS
'Intended key of the contact in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.contact_gender IS
'Contact gender: male (pin) or female (socket) (CHECK). April rows only: male on the 22 source rows, female on the 54 device rows; NULL on all loader rows (2026-10-10). The script on main writes the opposite (source female, device male). Unit: text class. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.pin_seal_pn IS
'Part number of the single-wire seal fitted with the contact. Unit: text part number. Source: load_map_rows.py, the second code of the registry part field when present; April rows from the rule table. Filled on 444 rows overall, 87 of 891 live loader rows (2026-10-10). NULL means no seal was named, not that none is needed. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.pin_seal_catalog_id IS
'Intended key of the seal in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.wedge_lock_pn IS
'Part number of the connector''s wedge lock (secondary lock). Unit: text part number. April rows only, from the rule table for Deutsch families: filled on 13 rows (2026-10-10); the loader does not set it. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.wedge_lock_catalog_id IS
'Intended key of the wedge lock in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.crimp_tool_pn IS
'Part number (or catalog key) of the crimp tool for this contact. Unit: text. Source: load_map_rows.py, looked up from docs/wiring/calc-data/catalog/tools.yaml by the contact part number (the tool whose "for" list names it); April rows from the rule table. Filled on 1,935 rows overall, 419 of 891 live loader rows (2026-10-10); NULL where tools.yaml names no tool for the contact. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.crimp_tool_catalog_id IS
'Intended key of the crimp tool in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';

-- ── Finish, label and protection (April rows only) ──────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.heat_shrink_pn IS
'Part number of the heat-shrink sleeve at this end. NULL on all 4,149 rows (2026-10-10) although the April script computes one; the April rows hold only heat_shrink_size. Unit: text part number. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.heat_shrink_size IS
'Heat-shrink size for the wire gauge, as text in inches (for example 3/16"). Unit: text (inches). Source: the gauge-to-size table in populate-termination-specs.mjs; filled on the 76 April rows (5 distinct sizes), NULL on loader rows (2026-10-10). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.heat_shrink_catalog_id IS
'Intended key of the heat-shrink part in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.label_text IS
'Text to print on the wire label at this end. Source: populate-termination-specs.mjs, "W<wire number> <device name, 12 characters> <gauge>ga <color>"; filled on the 76 April rows, NULL on loader rows (2026-10-10). Unit: text. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.label_pn IS
'Part number of the label stock. NULL on all rows (2026-10-10): no writer sets it. Unit: text part number. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.label_catalog_id IS
'Intended key of the label stock in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.boot_pn IS
'Part number of the rubber boot over the connector back. NULL on all rows (2026-10-10): the loader does not set it, and no April row carries one although the boot table in populate-termination-specs.mjs on main would give the 2-pin Deutsch rows one (another version of that writer, as above). Unit: text part number. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.boot_catalog_id IS
'Intended key of the boot in catalog_parts (foreign key). NULL on all rows (2026-10-10). Unit: none (uuid). Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.loom_type IS
'Protective covering at the end: convoluted_loom (44 rows), heat_shrink (24) or split_loom (8), no CHECK. April rows only; NULL on loader rows (2026-10-10). The writer of these values is not the script on main, which does not set loom_type (Unknown). Unit: text class. Grain: one wire end. Clock: n/a.';

-- ── Inventory (never filled) ────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.in_stock IS
'Whether the parts for this end are on hand. Default false; false on all 4,149 rows (2026-10-10): no writer sets it, so it is not an inventory reading. Unit: boolean. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.qty_on_hand IS
'Quantity of the parts on hand. Default 0; 0 on all rows (2026-10-10): no writer sets it. Unit: count. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.qty_needed IS
'Quantity of the termination parts needed for this end. Default 1; both writers write 1, and it is 1 on all rows (2026-10-10). Unit: count. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.notes IS
'Free-text note on the end. Loader rows: "doubled over at the terminal (MoTeC C125 p.21)" when the registry marks the wire doubled (79 rows). April rows: a description of the wire or device on all 76 rows, from a writer not in the repo (populate-termination-specs.mjs on main sets no notes; Unknown) (2026-10-10). Unit: text. Grain: one wire end. Clock: n/a.';

-- ── Provenance (DNA columns, loader rows only) ──────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.source IS
'Where the end''s facts come from: "k5_registry v5 @ <git short sha>" (the registry file at the commit the loader ran from; 15 distinct commits), or "k5-wiring:<node code>:#<wire> end" when the node has a dossier in the registry (the loader says the registry''s facts are checked in vehicle_observations under k5-wiring:* sources). Filled on all 4,073 loader rows, NULL on April rows (2026-10-10). Unit: text. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.method IS
'How the row was produced: "registry loader" on all 4,073 loader rows; NULL on the April rows (2026-10-10). Unit: text. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.observed_at IS
'The loader run time (datetime.now in UTC at script start, NOW in load_map_rows.py), not when anything was seen on the vehicle; within 10 minutes of created_at on every loader row; range 2026-09-27 13:50Z .. 2026-09-29 01:40Z; NULL on April rows (2026-10-10). Unit: timestamptz. Grain: one wire end. Clock: ingest time (the writer''s run), despite the name.';
COMMENT ON COLUMN public.wire_termination_specs.trust IS
'Trust tier (CHECK T1, T2, T3): T1 owner or operator confirmed, T2 attributed or relayed, T3 scraped or inferred (vocabulary in 20260927030100_wiring_map_typed_rows.sql). T3 on all 4,073 loader rows, as design records; NULL on April rows (2026-10-10). Unit: text class. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.confidence_score IS
'Confidence in the row, 0 .. 1 (CHECK). NULL on all rows (2026-10-10): no writer sets it. Unit: probability-like score, uncalibrated. Grain: one wire end. Clock: n/a.';
COMMENT ON COLUMN public.wire_termination_specs.is_superseded IS
'True when a later loader run replaced or dropped this end (its wire changed or retired, or the registry no longer has the end); the row is kept. Not null, default false. True on 3,182 of the 4,073 loader rows, false on the 891 live loader rows and the 76 April rows (2026-10-10). Readers take is_superseded = false. Unit: boolean. Grain: one wire end. Clock: n/a; the change time is updated_at.';
COMMENT ON COLUMN public.wire_termination_specs.superseded_by IS
'Intended pointer to the replacing row (foreign key to this table). NULL on all rows, including the 3,182 superseded ones (2026-10-10): the loader marks is_superseded without linking the successor; the successor is the live row with the same (circuit, endpoint) keys or none. Unit: none (uuid). Grain: one wire end. Clock: n/a.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.wire_termination_specs.created_at IS
'When the row was inserted, default now(): 2026-04-12 for the April rows, 2026-09-27 .. 2026-09-29 01:40Z for loader rows (2026-10-10). Unit: timestamptz. Grain: one wire end. Clock: ingest time.';
COMMENT ON COLUMN public.wire_termination_specs.updated_at IS
'Last change to the row, maintained by trigger set_wire_termination_specs_updated_at (digital_twin_set_updated_at). Later than created_at on 3,182 rows, the same count as the superseded rows, so for those it is about when the row was superseded; newest 2026-09-30 17:49Z (2026-10-10). Unit: timestamptz. Grain: one wire end. Clock: ingest time (last write).';

DO $$
DECLARE
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.wire_termination_specs'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF v_missing > 0 THEN
    RAISE NOTICE 'wire_termination_specs: % columns still have no comment (a column was added after 2026-10-10)', v_missing;
  END IF;
END $$;

-- Queued documentation source: PR #965
-- Describe vehicle_custom_circuits: the 38 columns without a comment (4 of 42 had one: build_state, derivation_version,
-- planned_length_ft and checks) and a corrected derivation_version comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Ranked by (n_cols - n_cols_described) * ln(greatest(est_rows,0) + 1) over
-- v_schema_atlas at 2026-10-11 08:30Z: score 296.3, est_rows 2,432; 2,469 rows by exact count at 08:32Z.
--
-- METHOD (read 2026-10-11 08:31-08:36Z UTC, read-only):
--   Columns, types, defaults, NOT NULL, existing comments and pg_stats (null_frac, n_distinct, most common values) from
--   pg_attribute, pg_attrdef, pg_description and pg_stats; constraints from pg_constraint; indexes from pg_indexes;
--   policies from pg_policy; column and table privileges for anon and authenticated (has_column_privilege,
--   has_table_privilege); exact fills of every column grouped by derivation_version, method, design_status,
--   is_superseded and created month over all 2,469 rows.
--   Writers and readers from code at origin/main 3d9c76346: supabase/migrations/20260322200000_wiring_layer_overlay.sql
--   (creates the table), 20260927030100_wiring_map_typed_rows.sql (endpoint keys, cavities, DNA columns, supersession),
--   20260927040100_wiring_map_supersession_keys.sql (live-row unique index), 20260927200000_wiring_rule_checks.sql
--   (checks columns); docs/archive/database/migrations/2026-06-10_wiring_substrate_v2_step1.sql (build_state,
--   derivation_version, planned_length_ft) and 2026-06-11_custom_circuits_build_state_client_write.sql (the browser's
--   build_state grant); the loader docs/wiring/calc-data/load_map_rows.py; scripts/wiring_v2_ingest.py; readers
--   nuke_frontend/src/components/wiring/map/useWiringMap.ts, connector-inspector/useBuildState.ts,
--   pages/ShareWiring.tsx, pages/vehicle-profile/WiringWidgetLink.tsx. No edge function in supabase/functions names it.
-- LIMITS:
--   The 12 rows created 2026-04-13 (derivation_version null) and the 162 'v4-frontend-registry' rows of 2026-06 have no
--   writer in the repo: scripts/wiring_v2_ingest.py writes derivation_version 'v4.1' and no row carries that value. The
--   loader's per-run clock (observed_at) is the run time, not a design or build date. Counts below are as of 08:32Z and
--   go stale as the loader supersedes rows.
-- CHANGED EXISTING COMMENT:
--   derivation_version said "e.g. v4.1 = K5_cut_list_v4_1.txt one-time ingest"; no row holds 'v4.1'. It now lists the
--   four values present and their writers.

comment on column public.vehicle_custom_circuits.id is
  'Row key (uuid, gen_random_uuid()). One row is one version of one wire: a superseding row gets a new id and the old row '
  'keeps its id with is_superseded = true. Referenced by vehicle_custom_circuits.superseded_by, '
  'wire_termination_specs.circuit_id and vehicle_circuit_measurements.custom_circuit_id.';

comment on column public.vehicle_custom_circuits.overlay_id is
  'The wiring overlay (one vehicle''s wiring) this wire belongs to: FK fk_custom_circuits_overlay to '
  'vehicle_wiring_overlays(id) ON DELETE CASCADE; the vehicle is vehicle_wiring_overlays.vehicle_id. NOT NULL. One distinct '
  'value over all 2,469 rows on 2026-10-11. Part of the live-row key (overlay_id, circuit_code) where is_superseded = false '
  '(unique index vehicle_custom_circuits_overlay_code_live).';

comment on column public.vehicle_custom_circuits.circuit_code is
  'The wire''s identifier inside its overlay (text, NOT NULL). Source by derivation_version: the registry wire id '
  '(k5_registry_v5; numbers with letter suffixes such as 30a, 99G, and names such as WIPER_T3), the candidate id '
  '(april_2026_candidate, such as BC-W001), the v4 cut-list wire id (v4-frontend-registry, numbers and names such as '
  'INJ_PWR), or a descriptive code such as PDM15-GND or TRAILER-TAIL (the 12 underived rows). '
  'Unique among live rows of an overlay only; the same code recurs across superseded versions. The loader keys live rows by '
  '(circuit_code, derivation_version).';

comment on column public.vehicle_custom_circuits.circuit_name is
  'Human label of the wire (text, NOT NULL). load_map_rows.py writes the registry''s build-sheet name for k5_registry_v5 '
  'rows and the candidate label for april_2026_candidate rows, cut to 200 characters. Display text, not a key.';

comment on column public.vehicle_custom_circuits.system_category is
  'Subsystem the wire serves (text, NOT NULL, no CHECK; 31 distinct values in pg_stats). Two vocabularies are mixed: the '
  'registry subsystem in upper case for k5_registry_v5 rows (CORE_ENGINE, LIGHTING_EXTERIOR, AUDIO; UNASSIGNED when the '
  'registry has none), the candidate sub in kebab case for april_2026_candidate rows (dash-cabin, body-convenience), and '
  'POWER-DISTRIBUTION, CAN-BUS, TRAILER on the 12 underived rows. harness_section is the normalized grouping.';

comment on column public.vehicle_custom_circuits.wire_color is
  'Insulation colour as the source wrote it (text, no vocabulary): lower-case names with stripes (red, white/violet), GM '
  'abbreviations (BLK, BRN/WHT) and ''cable'' for multi-conductor cable. 142 distinct values; null on 22.5% (pg_stats '
  'null_frac 0.225). From the registry wire colour (k5_registry_v5) or the April plan colour (april_2026_candidate).';

comment on column public.vehicle_custom_circuits.wire_gauge_awg is
  'Conductor size in American Wire Gauge (integer; a smaller number is a thicker conductor; values 0 to 24 present). From '
  'the registry awg when it is an integer, or the April plan awg when it is all digits; otherwise null (1.7% null).';

comment on column public.vehicle_custom_circuits.wire_type is
  'Wire or cable specification as text (30 distinct): military specifications (M22759/32, M22759/16, M27500 2C), SAE '
  'automotive insulation (TXL, GXL) and descriptions (RCA pair, Cat5 pair, kit harness). From the registry spec '
  '(k5_registry_v5) or the April plan insulation (april_2026_candidate). is_shielded is derived from it.';

comment on column public.vehicle_custom_circuits.is_shielded is
  'True when the wire is shielded cable (boolean, default false). Derived, not observed: load_map_rows.py sets it on '
  'k5_registry_v5 rows when wire_type contains ''M27500''; scripts/wiring_v2_ingest.py when the spec contains ''SHIELDED''. '
  'Null on all 360 april_2026_candidate rows: the loader''s bulk insert sends null for keys a row lacks, overriding the '
  'default. Null is unknown, not unshielded.';

comment on column public.vehicle_custom_circuits.from_component is
  'Start end of the wire as text (NOT NULL): the registry''s from string (forms such as PDM30:OUT19 or M130:B16), the April '
  'device name, or ''(not recorded)'' when the source names none; cut to 200 characters. The keyed form of the same end is '
  'from_endpoint_id + from_cavity.';

comment on column public.vehicle_custom_circuits.from_connector is
  'Start-end connector name (text). Unused: null on all 2,469 rows on 2026-10-11 and set by no writer in the repo. '
  'The start plug is now from_endpoint_id and its cavity from_cavity.';

comment on column public.vehicle_custom_circuits.from_pin is
  'Start-end pin as text. Filled on 358 of 360 april_2026_candidate rows (the candidate''s from pin, up to 120 characters) '
  'and 102 of 162 v4-frontend-registry rows; null on every k5_registry_v5 row, which carries from_cavity instead.';

comment on column public.vehicle_custom_circuits.from_location_zone is
  'Body zone of the start end (text, no CHECK). Filled on the 12 underived rows of 2026-04-13 only (rear, dash); null '
  'elsewhere. Zones of plugs are harness_endpoints.location_zone.';

comment on column public.vehicle_custom_circuits.to_component is
  'Far end of the wire as text (NOT NULL): the registry''s to string or device, the April device name, or ''(not recorded)'' '
  'when the source names none; may be a long description such as a ground bank. The keyed form is to_endpoint_id + to_cavity.';

comment on column public.vehicle_custom_circuits.to_connector is
  'Far-end connector name (text). Unused: null on all 2,469 rows on 2026-10-11 and set by no writer in the repo. '
  'The far plug is now to_endpoint_id and its cavity to_cavity.';

comment on column public.vehicle_custom_circuits.to_pin is
  'Far-end pin as text. Filled on all 360 april_2026_candidate rows (the candidate''s to pin, up to 120 characters) and on '
  'no other row; k5_registry_v5 rows carry to_cavity instead.';

comment on column public.vehicle_custom_circuits.to_location_zone is
  'Body zone of the far end (text, no CHECK). Filled on the 12 underived rows of 2026-04-13 only (rear); null elsewhere.';

comment on column public.vehicle_custom_circuits.fuse_type is
  'Fuse or protection device type for the wire (text). Unused: null on all 2,469 rows on 2026-10-11 and set by no writer '
  'in the repo.';

comment on column public.vehicle_custom_circuits.fuse_rating_amps is
  'Fuse rating in amperes (numeric). Unused: null on all 2,469 rows on 2026-10-11 and set by no writer in the repo.';

comment on column public.vehicle_custom_circuits.measured_length_ft is
  'Wire length in feet reserved for a tape measurement (the June 2026 substrate receipt; estimates go in planned_length_ft). '
  'Filled on 12 rows only: the underived rows of 2026-04-13, round values 1.5 to 14.0 ft with no linked measurement record '
  'and no writer in the repo; whether they were measured is Unknown. No loader writes it.';

comment on column public.vehicle_custom_circuits.routing_description is
  'Route of the wire as text through named landmarks (for example R4 cross-frame junction to R6 tailgate centre). Filled on '
  'the 12 underived rows of 2026-04-13 only; no writer in the repo sets it.';

comment on column public.vehicle_custom_circuits.notes is
  'Free text about the wire. k5_registry_v5 rows: the registry note and ''switched by: <control>'' joined by ''; '', cut to '
  '1,000 characters; april_2026_candidate rows: the candidate note; v4-frontend-registry rows: an ingest note naming '
  'k5LandmarkPaths.ts WIRE_REGISTRY and the signal type. 46.7% null (pg_stats). Not a key and not parsed by readers.';

comment on column public.vehicle_custom_circuits.created_at is
  'Ingest clock: when this row was inserted (timestamptz, default now()). Rows span 2026-04-13 to 2026-09-30. Each '
  'superseding version gets its own created_at; no trigger maintains it. Not a design, cut or build date.';

comment on column public.vehicle_custom_circuits.derivation_version is
  'Which loader generation produced the row (text). Values on 2026-10-11: k5_registry_v5 (docs/wiring/calc-data/'
  'load_map_rows.py, 1,935 rows, 390 live), april_2026_candidate (the same loader''s candidate pass, 360 rows, 138 live), '
  'v4-frontend-registry (162 rows of 2026-06, all superseded; the notes name k5LandmarkPaths.ts WIRE_REGISTRY; writer not '
  'in the repo) and null (12 rows of 2026-04-13, all superseded, writer not in the repo). scripts/wiring_v2_ingest.py '
  'would write ''v4.1''; no row holds it. The loader keys live rows by (circuit_code, derivation_version).';

comment on column public.vehicle_custom_circuits.from_endpoint_id is
  'The plug or device at the start end: FK to harness_endpoints(id) ON DELETE SET NULL. Set by load_map_rows.py from the '
  'registry termination or the start code; candidate rows are relinked to the live endpoint when theirs is superseded. Null on 12.1% '
  '(pg_stats), including every v4-frontend-registry and underived row.';

comment on column public.vehicle_custom_circuits.to_endpoint_id is
  'The plug or device at the far end: FK to harness_endpoints(id) ON DELETE SET NULL. Set by load_map_rows.py from the far '
  'termination, else the destination code when it differs from the start. Null on 20.6% (pg_stats).';

comment on column public.vehicle_custom_circuits.from_cavity is
  'Cavity (pin position) in the start plug, as the registry termination names it (text: A24, B16, ''splice 3'', GND). '
  'k5_registry_v5 rows only; 372 of 390 live k5_registry_v5 rows carry it. Pairs with from_endpoint_id.';

comment on column public.vehicle_custom_circuits.to_cavity is
  'Cavity in the far plug, as the registry termination names it (text: 1, 2, ring, ''ring 3'', ''splice 1''). '
  'k5_registry_v5 rows only; 361 of 390 live k5_registry_v5 rows carry it. Pairs with to_endpoint_id.';

comment on column public.vehicle_custom_circuits.design_status is
  'Whether the wire is decided or only on the list (text, NOT NULL, default ''concept''; CHECK concept, decided). '
  'load_map_rows.py writes decided on k5_registry_v5 rows and concept on april_2026_candidate rows; older rows hold the '
  'default.';

comment on column public.vehicle_custom_circuits.harness_section is
  'Harness section the wire belongs to (text; CHECK engine, power_spine, comms, dash_cabin, body_convenience, '
  'lighting_front, lighting_rear, powertrain_chassis). Mapped by load_map_rows.py from the registry subsystem '
  '(SUB2SECTION; exterior lighting split front and rear by label) or the April sub (APRIL2SECTION). 9% null (pg_stats).';

comment on column public.vehicle_custom_circuits.source is
  'Where the row''s content came from (text, NOT NULL in practice: 0% null). ''k5_registry v5 @ <git sha>'' names the '
  'registry commit the loader read; ''April 2026 whole-truck plan (candidate, unreviewed)'' the candidate list. On '
  'superseded rows the loader rewrites it to say why the row left (for example ''retired in k5_registry v5 @ <sha>''). '
  '86 distinct values.';

comment on column public.vehicle_custom_circuits.method is
  'How the row was produced (text): ''registry loader'' or ''registry loader (candidate)'' (load_map_rows.py). Null on the '
  'v4-frontend-registry and underived rows.';

comment on column public.vehicle_custom_circuits.observed_at is
  'Loader run clock: the UTC time load_map_rows.py started the run that wrote the row (one value per run; 25 distinct). '
  'Not when the wire was designed, cut or measured. Null on rows the loader did not write.';

comment on column public.vehicle_custom_circuits.trust is
  'Trust tier (text; CHECK T1 owner or operator confirmed, T2 attributed or relayed, T3 scraped or inferred). Every '
  'loader row is T3: these are design records, and T1/T2 facts arrive through vehicle_observations. Null on rows the '
  'loader did not write.';

comment on column public.vehicle_custom_circuits.confidence_score is
  'Confidence from 0 to 1 (numeric; CHECK between 0 and 1). Unused: null on all 2,469 rows on 2026-10-11 and set by no '
  'writer in the repo.';

comment on column public.vehicle_custom_circuits.is_superseded is
  'True when a newer row replaces this one or the wire left the design (boolean, NOT NULL, default false). Rows are '
  'superseded, never deleted. 1,941 of 2,469 rows superseded and 528 live on 2026-10-11. Readers filter '
  'is_superseded = false for the current wire list.';

comment on column public.vehicle_custom_circuits.superseded_by is
  'The row that replaced this one: FK to vehicle_custom_circuits(id). Set by load_map_rows.py when a changed wire is '
  'reinserted or an April candidate is carried by a v5 wire; null on live rows and on superseded rows that left the '
  'design with no successor (source says why).';

comment on column public.vehicle_custom_circuits.checks_version is
  'Which rule set produced checks (text, for example ''check_plug_ends R8-R14 @ <git sha>''). Written with checks and '
  'checked_at by load_map_rows.py; null where checks is null (57.3%).';

comment on column public.vehicle_custom_circuits.checked_at is
  'Rule-check clock: the loader run time at which checks was computed (timestamptz). Null where checks is null.';

-- Queued documentation source: PR #966
-- Describe production_files: all 22 columns (none had a comment) and a table comment (it had none; the atlas purpose
-- was null). Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Ranked by (n_cols - n_cols_described) * ln(greatest(est_rows,0) + 1) over
-- v_schema_atlas at 2026-10-11 08:30Z: score 253.4, est_rows 100,579; 100,579 rows by exact count at 08:36Z.
--
-- METHOD (read 2026-10-11 08:36-08:40Z UTC, read-only):
--   Columns, types, defaults, NOT NULL and pg_stats (null_frac, n_distinct) from pg_attribute, pg_attrdef and pg_stats;
--   constraints, indexes, triggers, policies, row security and anon/authenticated SELECT privilege from pg_constraint,
--   pg_indexes, pg_trigger, pg_policy, pg_class and has_table_privilege; the v_schema_atlas row; exact counts over all
--   rows by file_type (hashed, role, publication fills, size range) and by source_type and created day (indexed_at
--   range, path form, 64-character hashes).
--   Writers from code at origin/main 3d9c76346: tools/publishing/scan_archive.py (walks two local folders into a local
--   SQLite production_files table: stat, filename parse, optional hash pass) and tools/publishing/ingest_publishing_data.py
--   (ingest_production_files: copies the SQLite rows into this table once, with the home prefix stripped from paths;
--   skips when the table already has rows). tools/publishing/publishing_migration.py adds owner_id if missing. No
--   migration in supabase/migrations creates the table, and no edge function or frontend file in the repo reads it; on
--   prod no public function body and no view names it (pg_proc.prosrc, pg_views, 08:40Z).
-- LIMITS:
--   The CREATE TABLE is not in the repo (drift), so who chose the uuid columns issue_id, story_id, image_identity_id and
--   source_drive, and which tables they were meant to reference, is not recorded. Directory, path, filename and
--   parsed_story values carry private names; no value is quoted here.

comment on table public.production_files is
  'File index of a magazine publishing archive (one row per file found on a local disk scan, grain: file path). Written '
  'once on 2026-04-14 by tools/publishing/ingest_publishing_data.py from the local SQLite index built by '
  'tools/publishing/scan_archive.py on 2026-04-09; no writer since (atlas: read-only, no last_write). Metadata only: '
  'no file bytes are stored. Row security is on with no policy, so only the service role reads it; paths and names are '
  'private. No foreign keys in or out; no reader in the repo.';

comment on column public.production_files.id is
  'Row key (uuid, gen_random_uuid()), minted at insert into Postgres. Not the local SQLite integer id.';

comment on column public.production_files.file_path is
  'Path of the file relative to the scanned home folder (text, NOT NULL): ingest_publishing_data.py strips the local home '
  'prefix (relativize_path); every row starts with Documents/ or DUPLICATES (0 absolute paths, 08:38Z). Distinct per row '
  '(pg_stats n_distinct -1) but no unique constraint. Private: folder names carry people''s and companies'' names.';

comment on column public.production_files.filename is
  'File name with extension, as found on disk (text, NOT NULL). About 40% distinct (pg_stats n_distinct -0.40): the '
  'same name recurs across folders and across the two scanned roots.';

comment on column public.production_files.directory is
  'Containing folder of the file, relative to the home folder like file_path (text). 6,008 distinct folders (pg_stats). '
  'Private for the same reason as file_path.';

comment on column public.production_files.file_extension is
  'File extension including the dot, lower-cased at scan (text: .jpg, .pdf, .emlx, .otf, .indd); the empty string when '
  'the name has none. 76 distinct (pg_stats). file_type is derived from it.';

comment on column public.production_files.file_size_bytes is
  'File size in bytes from os.stat at the scan of 2026-04-09 (bigint). Files under 1,024 bytes were skipped by the '
  'scanner, so the minimum is 1,027. Over 52,428,800 bytes (50 MiB) the file was tagged large and never hashed.';

comment on column public.production_files.content_hash_sha256 is
  'Hex SHA-256 from scan_archive.py --hash (text; UNIQUE production_files_content_hash_sha256_key). Filled on 2,289 of '
  '100,579 rows (2.3%): the hash pass covered few files. Not always a whole-content hash: for files over 10 MiB the '
  'scanner hashes the first MiB, the size and the last MiB. Null when not hashed, timed out (10 s) or large. The ingest '
  'deduplicates on it (ON CONFLICT DO NOTHING), which removes only hashed duplicates.';

comment on column public.production_files.file_type is
  'File class derived from file_extension by scan_archive.py EXT_MAP (text): image_processed, image_raw, pdf, font, '
  'indesign, photoshop, illustrator, document, spreadsheet, video, else other; the suffix '' (large, no hash)'' marks '
  'files over 50 MiB. 19 distinct values (08:37Z). Derived, not read from file contents.';

comment on column public.production_files.production_role is
  'Production role inferred from the upper-cased path by scan_archive.py classify_production_role (text): bat (proof '
  'for approval), layout, source (retouching), print_ready, final, ad_creative, brand_asset (media kit) or reference '
  '(flatplan); null when no rule matches (85.4%, pg_stats). A path heuristic, not a recorded role.';

comment on column public.production_files.issue_id is
  'uuid meant to link the file to a magazine issue. Unused: null on all rows, set by no writer in the repo, and no '
  'foreign key names its table (index idx_production_files_issue exists). Target table Unknown.';

comment on column public.production_files.story_id is
  'uuid meant to link the file to a story. Unused: null on all rows, set by no writer in the repo, no foreign key. '
  'Target table Unknown.';

comment on column public.production_files.image_identity_id is
  'uuid meant to link an image file to an image identity. Unused: null on all rows, set by no writer in the repo, no '
  'foreign key. The image_identities table comment (migration 20261007220000) lists it among unkeyed image_identity_id '
  'columns; that it was meant to reference image_identities is a reading of the name, not a recorded fact.';

comment on column public.production_files.source_drive is
  'Name of the drive the file was found on (text). Unused: null on all rows; the ingest does not send it.';

comment on column public.production_files.source_type is
  'Which scanned root the file came from (text, default ''local'', never used): archives (the Documents/Archives '
  'folder, 59,548 rows) or duplicates_ssd (the DUPLICATES_FOR_SSD folder, 41,031 rows). The ingest copies '
  'the scanner''s source_directory label into it.';

comment on column public.production_files.parsed_publication is
  'Publication code matched in the full path by scan_archive.py (text, upper-cased): LOFFICIEL, LOFSBH, LOFRIV, LOSBH or '
  'OFSBH. Filled on 28.7% (pg_stats). A filename heuristic; a code in a folder name tags every file below it.';

comment on column public.production_files.parsed_issue_number is
  'Issue number: the digits right after the publication code in the path, as text without leading zeros (88 distinct). '
  'Filled on 2.3% (pg_stats). A filename heuristic, not checked against any issue list.';

comment on column public.production_files.parsed_story is
  'Story label: the words after the publication code and issue digits in the file name, with version and stage '
  'suffixes removed (text, 230 distinct). Filled on 2.1% (pg_stats). Often a person''s name: private. A heuristic, not a '
  'story key.';

comment on column public.production_files.parsed_version is
  'Version token from the file name, as written (text): vN, edit N, FINAL, SR or last, first match. Case is not '
  'normalized (v1 and V1 both occur; 77 distinct). Filled on 2.4% (pg_stats).';

comment on column public.production_files.parsed_stage is
  'Production stage keyword from the full path, upper-cased (text): BAT (proof for approval), MAQUETTE (layout), '
  'RETOUCHE (retouching), PRINT, PROOF, CDF (flatplan) or PUB (advertisement). Filled on 11.1% (pg_stats).';

comment on column public.production_files.indexed_at is
  'Scan clock: when scan_archive.py recorded the file in the local SQLite index (timestamptz, NOT NULL; SQLite '
  'datetime(''now''), UTC). All rows fall on 2026-04-09 between 11:05:37 and 11:21:18 UTC. Not the file''s own '
  'modification time, which the scanner kept locally (file_modified_at) and the ingest did not copy.';

comment on column public.production_files.created_at is
  'Ingest clock: when the row was inserted into Postgres (timestamptz, NOT NULL, default now()). All rows on 2026-04-14 '
  '(UTC), five days after indexed_at.';

comment on column public.production_files.owner_id is
  'Owner scope (uuid). One value on every row: the fixed operator placeholder uuid set by ingest_publishing_data.py '
  '(OWNER_ID; the script says these ids "will link to auth accounts later"). It matches no auth.users row (read '
  '2026-10-11 08:40Z) and has no foreign key. No policy reads it: row security is on with no policy, so access is '
  'service role only.';

-- Queued documentation source: PR #984
-- Describe vehicle_form_completions: all 20 columns, none had a COMMENT ON COLUMN (0 of 20 described before, atlas read
-- 2026-10-12 08:30Z), and a table comment (there was none). Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 90,921 rows on 2026-10-12 08:32Z by exact count (the
-- atlas estimate is 90,921), 0 inserts, 0 updates and 0 deletes since the statistics counters began; the newest row was
-- created 2026-02-18 21:55Z.
--
-- METHOD (read 2026-10-12 08:31-08:34Z UTC):
--   Columns, types, defaults, constraints, triggers, policies, the anon SELECT grant and existing comments from
--   pg_attribute, pg_attrdef, pg_constraint, pg_trigger, pg_policy and pg_description; null fractions and distinct counts
--   from pg_stats. Row counts per form_type, provider, status, source_type and completeness_pct, distinct vehicles, the
--   fields_extracted key sets, clock ranges and comparisons, rows whose vehicle_id has no vehicles row and rows whose
--   service_execution_id has no service_executions row are exact counts over the whole table. "Filled" means non-NULL.
--   Writers and readers from code at origin/main f581dbea8 (supabase/functions, supabase/migrations, nuke_frontend,
--   scripts; also git history): the creating migration 20251203_service_integration_framework.sql; the edge function
--   service-orchestrator as it stood before commit 43b72deae (2026-03-07) archived and deleted it (it upserted one row per
--   completed service run, onConflict vehicle_id,form_type); the trigger function track_spid_form_completion() (live
--   body from 20260927200000_p3_9_spid_and_labor_rate_trigger_bodies.sql, trigger spid_form_completion_tracker on
--   vehicle_spid_data, enabled); calculate_verification_score(), the only other live function whose body names the table;
--   20261008002000_describe_service_executions.sql for the upstream run rows and the Hagerty adapter's placeholder values.
-- LIMITS:
--   Why 5,324 rows name a vehicle_id with no vehicles row under a validated ON DELETE CASCADE foreign key is Unknown
--   (not established from the catalog or the repo). pg_stat_user_tables counters began at an unrecorded time. Quoted
--   values are form types, providers, key names, counts and clocks only; no vehicle id or value of one vehicle.
-- CHANGED EXISTING COMMENTS:
--   None; the table and its columns had no comment.

COMMENT ON TABLE public.vehicle_form_completions IS
'Which external form or service result a vehicle has, as a completion record: one row per vehicle and form type (UNIQUE (vehicle_id, form_type)). It records that a source was run and which fields it returned, not the values. 90,921 rows (2026-10-12): 48,439 hagerty_instant_quote and 42,482 nhtsa_vin_decode, every one status complete at 100%, all created 2025-12-04 .. 2026-02-18 by the service-orchestrator edge function (archived and deleted 2026-03-07, commit 43b72deae), one per completed service_executions run. The Hagerty rows record the adapter''s placeholder estimates (model year times a constant, see service_executions.fields_populated), not Hagerty valuations. A second writer, trigger spid_form_completion_tracker on vehicle_spid_data, would add form_type spid rows; none exist. The values themselves are in vehicle_field_evidence (source_id = the run id). Event time = extracted_at (worker clock); ingest time = created_at.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_form_completions.id IS
'Surrogate key of the completion record, uuid, gen_random_uuid() default, the PRIMARY KEY. 90,921 values (2026-10-12). Unit: none (uuid). Source: column default. Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.vehicle_id IS
'The vehicle the form was completed for, uuid, nullable, FOREIGN KEY to vehicles ON DELETE CASCADE (validated). Filled on every row and distinct per form_type: 48,439 vehicles have a Hagerty row and 42,482 an NHTSA row (2026-10-12). 5,324 rows (3,339 Hagerty) name a vehicle_id with no vehicles row despite the validated key; why is Unknown. Unit: none (uuid). Source: service_executions.vehicle_id via service-orchestrator (equal on every row). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.form_type IS
'Which form or service the record is for, text, NOT NULL, unique together with vehicle_id. Written as the service_executions.service_key of the run: hagerty_instant_quote 48,439 and nhtsa_vin_decode 42,482 (2026-10-12). The creating migration lists spid, nhtsa, title, registration, gm_heritage, carfax, appraisal and inspection as intended values; the SPID trigger writes spid; none of those exist. No CHECK constrains it. Unit: none (code). Source: service-orchestrator. Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.form_version IS
'Version of the form (creating migration: ''2024'', ''v1''), text, nullable. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: none. Source: none. Grain: one vehicle and form type. Clock: n/a.';

-- ── Completion ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_form_completions.status IS
'Completion state, text, NOT NULL, CHECK in (not_started, partial, complete, commissioned, in_progress, failed). complete on all 90,921 rows (2026-10-12): both writers hard-code complete, so it says the run returned, not that every field was found. Unit: none (code). Source: service-orchestrator; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.completeness_pct IS
'Share of the form completed, integer percent, nullable, CHECK 0..100. 100 on all 90,921 rows (2026-10-12): both writers hard-code 100 rather than computing it from fields_extracted against fields_required. calculate_verification_score() weights it. Unit: percent (0..100). Source: service-orchestrator; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.fields_extracted IS
'Which fields the source returned, jsonb object of field name to boolean, nullable. service-orchestrator wrote every key of the result as true; one key set per form type (2026-10-12): hagerty_instant_quote {insurance_value, market_value_avg, market_value_high, market_value_low}; nhtsa_vin_decode {body_style, displacement, drivetrain, engine_type, fuel_type, make, manufacturer, model, plant_city, plant_state, series, trim, year}. true means the key was present in the response, not that the value is a real observation (the Hagerty values are adapter placeholders). The SPID trigger writes eight presence flags (vin, build_date, paint codes, engine, transmission, axle ratio, rpo_codes). Unit: none (jsonb booleans). Source: service-orchestrator; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.fields_required IS
'Fields the form requires, jsonb object of field name to boolean (creating migration), nullable. NULL on all 90,921 rows (2026-10-12); no writer sets it, so completeness_pct has no denominator. Unit: none (jsonb booleans). Source: none. Grain: one vehicle and form type. Clock: n/a.';

-- ── Source ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_form_completions.source_id IS
'Id of the record the completion came from, uuid, nullable, no foreign key; its table is named by source_type. Equal to service_execution_id on all 90,921 rows (2026-10-12), every one of which has a service_executions row. The SPID trigger writes the vehicle_spid_data image_id here with source_type spid_image. Unit: none (uuid). Source: service-orchestrator; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.source_type IS
'Kind of record source_id points to, text, nullable. service_execution on all 90,921 rows (2026-10-12); the SPID trigger writes spid_image. Unit: none (code). Source: service-orchestrator; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.source_url IS
'Link to the original document or response (creating migration), text, nullable. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: none (URL). Source: none. Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.provider IS
'Who issued the form, text, nullable, copied from service_integrations.provider of the run: Hagerty on the 48,439 hagerty_instant_quote rows and NHTSA (US Government) on the 42,482 nhtsa_vin_decode rows (2026-10-12). The SPID trigger writes GM Factory. A label, not a key to organizations. Unit: none (name). Source: service-orchestrator via service_integrations; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.service_execution_id IS
'The service run that produced the record, uuid, nullable, FOREIGN KEY to service_executions. Filled on all 90,921 rows (2026-10-12), each matching an existing run with the same vehicle_id; equal to source_id. The reverse link service_executions.form_completion_id was never written. The SPID trigger leaves it NULL. Unit: none (uuid). Source: service-orchestrator. Grain: one vehicle and form type. Clock: n/a.';

-- ── Commissioned (paid) service tracking (never written) ────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_form_completions.expires_at IS
'When a paid result stops being valid (creating migration: for paid services), timestamptz, nullable. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: timestamptz. Source: none. Grain: one vehicle and form type. Clock: intended validity end.';
COMMENT ON COLUMN public.vehicle_form_completions.commissioned_at IS
'When a paid service was commissioned for this form, timestamptz, nullable. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: timestamptz. Source: none. Grain: one vehicle and form type. Clock: intended order time.';
COMMENT ON COLUMN public.vehicle_form_completions.commission_price IS
'Price of a commissioned service, numeric, nullable, currency not recorded. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: Unknown (no currency column). Source: none. Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.commission_status IS
'State of a commissioned service (creating migration: pending, in_progress, completed), text, nullable, no CHECK. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: none (code). Source: none. Grain: one vehicle and form type. Clock: n/a.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_form_completions.extracted_at IS
'When the writer recorded the extraction, timestamptz, nullable. Filled on all 90,921 rows (2026-10-12), range 2025-12-04 23:27Z .. 2026-02-18 21:55Z; service-orchestrator stamped its own clock (new Date()) just before the upsert: earlier than created_at on 90,459 rows (by at most 14.4 s) and later on 462 (worker and database clocks differ), never equal. The SPID trigger copies vehicle_spid_data.extracted_at. Unit: timestamptz. Source: service-orchestrator (worker clock); track_spid_form_completion(). Grain: one vehicle and form type. Clock: worker time of the extraction.';
COMMENT ON COLUMN public.vehicle_form_completions.created_at IS
'When the row was inserted, timestamptz, default now(). Range 2025-12-04 23:27Z .. 2026-02-18 21:55Z (2026-10-12). Unit: timestamptz. Source: column default. Grain: one vehicle and form type. Clock: ingest time.';
COMMENT ON COLUMN public.vehicle_form_completions.updated_at IS
'When the row was last written, timestamptz, default now(); no trigger maintains it. Equal to created_at on all 90,921 rows (2026-10-12): no row was upserted a second time. Unit: timestamptz. Source: column default. Grain: one vehicle and form type. Clock: writer time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_form_completions'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_form_completions: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_form_completions columns still without a comment: %', missing;
  END IF;
END
$$;

-- Queued documentation source: PR #985
-- Describe properties: all 35 columns, none had a COMMENT ON COLUMN (0 of 35 described before, atlas read
-- 2026-10-12 08:30Z). The table comment (20261006073000_table_purpose_live_tables.sql) is replaced: it named one loader,
-- and 905 of the 1,278 rows come from sources that loader never reads. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 1,278 rows on 2026-10-12 08:36Z by exact count,
-- 0 inserts, 0 updates and 0 deletes since the statistics counters began; the newest row was created 2026-07-20.
--
-- METHOD (read 2026-10-12 08:36-08:38Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, the anon SELECT grant, inbound foreign keys and
--   existing comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and
--   pg_description; null fractions and distinct counts from pg_stats; the live body of update_property_search_vector().
--   Row counts and fill per discovered_via, property_type, listing_type, price_period, price_currency and status; the
--   metadata and specs key sets per source; source_url hosts; external_id shapes (digits masked); where
--   metadata.canonical_villa_id points; clock ranges. All are exact counts over the whole table. "Filled" means non-NULL
--   (for search_keywords: a non-empty array; for specs and metadata: not {}).
--   Writers from code at origin/main f581dbea8 (supabase/functions, supabase/migrations, scripts, nuke_frontend; the
--   discovered_via values searched as text): scripts/concierge/migrate-villas-to-properties.ts copies lofficiel-concierge
--   villa rows from businesses (written by scripts/concierge/import-sibarth-villas.ts from the Sibarth API) and upserts
--   on (property_type, source_url). No code in this repo writes the wimco_sitemap_jsonld, edenrock_index_umbraco,
--   lebarth_nextdata, elan or lofficiel-yacht-recon-2026-07 rows; their writer is Unknown. pipeline_registry: no row.
-- LIMITS:
--   pg_stat_user_tables counters began at an unrecorded time. Quoted values are source labels, codes, key names, hosts,
--   counts and clocks only: no address, coordinate, contact, price or property name.
-- CHANGED EXISTING COMMENTS:
--   COMMENT ON TABLE: was 'Concierge property entity (villas and venues) ... Loaded by
--   scripts/concierge/migrate-villas-to-properties.ts; rows 2026-01-30 .. 2026-07-20; no row writes since the statistics
--   reset.' Now it names every source, the yachts, the cross-source identity link and the writer gap.

COMMENT ON TABLE public.properties IS
'Concierge property entity (L''Officiel concierge): one row per villa or yacht listing as published by one agency or operator (grain: one source listing; the same villa can appear once per agency). 1,278 rows (2026-10-12): 1,211 villas from five villa agencies (wimco_sitemap_jsonld 388, sibarth 364, edenrock_index_umbraco 264, lebarth_nextdata 186, elan 9) and 67 yachts from lofficiel-yacht-recon-2026-07, created 2026-01-30 .. 2026-07-20. Cross-agency identity is carried only in metadata.canonical_villa_id (927 rows, 319 distinct ids, 608 pointing at an existing properties row), not by a key. Writers: scripts/concierge/migrate-villas-to-properties.ts created the sibarth and elan rows from businesses in 2026-01/02 (their description equals the tagline and their search_keywords are the Sibarth importer''s), but no row now carries that script''s metadata keys (migrated_from_business_id, original_metadata) or its discovered_via value (sibarth.com): a writer not in this repo rewrote them (their latest write is 2026-07-21) and created the other 905 rows; which writer is Unknown. No pipeline_registry row. RLS on with no policy, so anon and authenticated read no rows. Keyed to by property_images, community_events, villa_calendar_crawls and villa_availability_observations. Ingest time = created_at; updated_at is rewritten by the search-vector trigger on every write.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.id IS
'Surrogate key of the property listing, uuid, gen_random_uuid() default, the PRIMARY KEY. 1,278 values (2026-10-12). Four tables key to it (property_images, community_events, villa_calendar_crawls, villa_availability_observations). Unit: none (uuid). Source: column default. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.name IS
'Display name of the villa or yacht as the source publishes it, text, NOT NULL; migrate-villas-to-properties.ts strips a leading "Villa ". Not unique: about 55% distinct by pg_stats (2026-10-12), because one villa appears once per agency and agencies reuse names. Unit: none (text). Source: the listing agency''s page or API. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.slug IS
'URL slug of the listing, text, nullable, UNIQUE. Filled on all 1,278 rows, all lower-case kebab (2026-10-12); migrate-villas-to-properties.ts derives it from the source slug or the name. Unit: none (text). Source: writer-derived. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.external_id IS
'The listing''s identifier at its source, text, nullable, no unique constraint. Filled and distinct on all 1,278 rows (2026-10-12). Shapes by source: sibarth a bare integer (the Sibarth API id), wimco_sitemap_jsonld wimco:<n>, lebarth_nextdata lebarth:<n>, edenrock_index_umbraco edenrock:<uuid>, yachts <operator>-<id or name>. The writer''s dedupe key when source_url is missing. Unit: none (text). Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.source_url IS
'URL of the listing page at its source, text, nullable; unique together with property_type (index uq_properties_villa_source_url, the upsert target of migrate-villas-to-properties.ts). Filled and distinct on all 1,278 rows (2026-10-12). Hosts: www.wimco.com 388, sibarth.com 364, www.edenrockvillarental.com 264, www.lebarthvillas.com 186, www.edmiston.com 29, www.canados-stbarth.com 21, masterski-pilou.com 17, www.elanvillarental.com 9. Unit: none (URL). Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.discovered_via IS
'Which capture produced the row, text, nullable. Six values on all 1,278 rows (2026-10-12): wimco_sitemap_jsonld 388, sibarth 364, edenrock_index_umbraco 264, lebarth_nextdata 186, lofficiel-yacht-recon-2026-07 67, elan 9. migrate-villas-to-properties.ts copies businesses.discovered_via (sibarth.com from the Sibarth importer); no row here carries that value, so the sibarth rows were relabelled by a writer outside this repo (Unknown which). Unit: none (code). Source: the writing capture. Grain: one source listing. Clock: n/a.';

-- ── Type and listing ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.property_type IS
'Kind of property as text, nullable, no CHECK: villa 1,211 and yacht 67 (2026-10-12). Part of the (property_type, source_url) unique key. Duplicates property_type_id where that is filled. Unit: none (code). Source: writer. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.property_type_id IS
'The property type as a key, uuid, nullable, FOREIGN KEY to property_types. Filled on 440 rows (2026-10-12): 373 villa (the sibarth and elan rows) and 67 yacht; NULL on all 838 wimco, edenrock and lebarth rows, whose type is only in property_type. Unit: none (uuid). Source: migrate-villas-to-properties.ts (property_types slug villa) for the sibarth and elan rows; the yacht writer is Unknown. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.listing_type IS
'What the listing offers, text, default rental, no CHECK: rental 1,206, charter 29, day_charter 17, sale 26 (21 yachts, 5 sibarth villas) (2026-10-12). Unit: none (code). Source: the listing agency via the writer. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.status IS
'Listing state, text, default active, no CHECK: active on 1,277 rows and inactive on 1 edenrock row (2026-10-12). Whether active means still listed at the source on a given day is not recorded; no writer refreshes it. Unit: none (code). Source: writer default. Grain: one source listing. Clock: n/a (no as-of time).';
COMMENT ON COLUMN public.properties.is_public IS
'Whether the listing may be shown, boolean, default true: true on 1,277 rows, false on the 1 inactive edenrock row (2026-10-12). No RLS policy reads it (the table has RLS on and no policy). Unit: none (boolean). Source: writer default. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.is_featured IS
'Editorial feature flag, boolean, default false. false on all 1,278 rows (2026-10-12). Unit: none (boolean). Source: column default. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.owner_org_id IS
'The agency or owner organization of the listing, uuid, nullable, FOREIGN KEY to organizations. NULL on all 1,278 rows (2026-10-12). migrate-villas-to-properties.ts looks up a businesses id here, which the organizations key would refuse; the agency is recorded only as text in metadata.agency. Unit: none (uuid). Source: none in practice. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.owner_user_id IS
'The user who owns the listing, uuid, nullable, no foreign key. NULL on all 1,278 rows (2026-10-12); no writer sets it. Unit: none (uuid). Source: none. Grain: one source listing. Clock: n/a.';

-- ── Text ────────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.description IS
'Marketing description from the source, text, nullable. Filled on 1,050 rows (82.2%, 2026-10-12); NULL on every lebarth_nextdata and elan row. migrate-villas-to-properties.ts copies the tagline here: description equals tagline on 342 sibarth and elan rows. Unit: none (text). Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.tagline IS
'One-line marketing tagline, text, nullable. Filled on 351 rows (2026-10-12), all from sibarth; the other sources carry none. Unit: none (text). Source: the Sibarth API via businesses.metadata.tagline. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.search_keywords IS
'Search terms for the listing, text array, default {}. Non-empty on 400 rows (2026-10-12): all 373 sibarth and elan rows (copied from businesses.search_keywords as import-sibarth-villas.ts builds them: name, villa, sibarth, region, st barth, luxury, rental or for sale, tagline; all 364 sibarth rows contain sibarth and st barth) and 27 yachts. Feeds search_vector. Unit: none (text array). Source: import-sibarth-villas.ts via migrate-villas-to-properties.ts; yacht writer Unknown. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.search_vector IS
'Full-text search vector, tsvector, maintained by trigger trigger_property_search_vector (BEFORE INSERT OR UPDATE, function update_property_search_vector): to_tsvector(''english'', name, description, tagline, region, city and search_keywords). Filled on all 1,278 rows (2026-10-12). Derived; never write it directly. Unit: none (tsvector). Source: trigger. Grain: one source listing. Clock: n/a.';

-- ── Location ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.address IS
'Street address, text, nullable. NULL on all 1,278 rows (2026-10-12); no writer sets it. Unit: none (text). Source: none. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.city IS
'Locality as the source names it (St Barth quarters such as Pointe Milou or Gustavia; also Saint-Martin places), text, nullable, free text with spelling variants. Filled on 1,201 rows (94.0%, 2026-10-12), and equal to region on all 1,201. Unit: none (place name). Source: the listing agency (sibarth: the API region field, copied to both city and region). Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.region IS
'Region as the source names it, text, nullable. For villas the writers copy the locality into both city and region, so it adds no level above city; filled on 1,268 rows (2026-10-12), equal to city on all 1,201 rows that have a city. Unit: none (place name). Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.country IS
'Country code, text, default BL (Saint-Barthelemy): BL on all 1,249 filled rows; NULL on 29 (2026-10-12). A default, not a per-listing observation: it does not prove the property is in BL. Unit: ISO 3166-1 alpha-2 code. Source: column default or writer. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.postal_code IS
'Postal code, text, nullable. NULL on all 1,278 rows (2026-10-12); no writer sets it. Unit: none. Source: none. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.latitude IS
'Latitude of the listing as the source publishes it, numeric(10,8), nullable. Filled on 938 rows (2026-10-12): every wimco, sibarth and lebarth row; NULL on all edenrock, elan and yacht rows. Source-published map points, not surveyed positions. Unit: decimal degrees (WGS84 assumed; the datum is not recorded). Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.longitude IS
'Longitude of the listing as the source publishes it, numeric(11,8), nullable. Filled on the same 938 rows as latitude (2026-10-12). Unit: decimal degrees (WGS84 assumed; the datum is not recorded). Source: the listing agency. Grain: one source listing. Clock: n/a.';

-- ── Specs and price ─────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.specs IS
'Physical specification of the property as the source states it, jsonb object, default {}. Not {} on all 1,278 rows (2026-10-12). Keys differ by source: villas bedrooms_min and bedrooms_max everywhere, plus bathrooms, capacity, amenities (wimco, lebarth), sleeps, facilities, room_details, tier (edenrock), rents_as, check_in, check_out, min_nights (lebarth); yachts loa_m, loa_ft, beam_m, draft_m, cabins, guests, builder, year_built, year_refit, gross_tonnage, hull_material and others. Attributed claims of the agency; units are in the key names where stated (_m metres, _ft feet, _kn knots, _kg, _liters). Unit: per key. Source: the listing agency. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.base_price IS
'Lowest advertised price, numeric(12,2), nullable, in price_currency per price_period. Filled on 789 rows (2026-10-12): wimco 388 (per night), sibarth 359 rentals (per week; the low end of the published range), and 42 yachts; NULL on every edenrock, lebarth and elan row and on the sale listings. An asking rate at capture, not a booking. Unit: price_currency per price_period. Source: the listing agency. Grain: one source listing. Clock: capture time, not recorded per row.';
COMMENT ON COLUMN public.properties.price_currency IS
'Currency of base_price, text, default USD: USD 1,235, EUR 18 (yacht charters), NULL 25 (2026-10-12). Filled by default on rows with no price, so it does not prove a USD price exists. Unit: ISO 4217 code. Source: the listing agency or column default. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.price_period IS
'Period base_price covers, text, default week, no CHECK: week 843, night 388 (all wimco), day 17 (day charters), sale 5, NULL 25 (2026-10-12). Filled by default on rows with no price. Unit: none (code). Source: the listing agency or column default. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.min_booking_period IS
'Minimum booking length, integer, nullable, unit not declared. NULL on all 1,278 rows (2026-10-12); lebarth carries min_nights in specs instead. Unit: Unknown (not declared). Source: none. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.sale_price IS
'Asking price of a listing for sale, numeric(14,2), nullable. NULL on all 1,278 rows (2026-10-12), including the 26 sale listings. Unit: sale_price_currency. Source: none in practice. Grain: one source listing. Clock: n/a.';
COMMENT ON COLUMN public.properties.sale_price_currency IS
'Currency of sale_price, text, default USD. USD on all 1,278 rows by default (2026-10-12), although no sale_price is filled. Unit: ISO 4217 code. Source: column default. Grain: one source listing. Clock: n/a.';

-- ── Metadata and clocks ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.properties.metadata IS
'Capture and identity envelope, jsonb object, default {}. Not {} on all 1,278 rows (2026-10-12). Keys by source: agency on every villa source; canonical_villa_id, aliases, identity and candidate_match on the villa agencies except elan (the cross-agency identity resolution: 927 rows carry canonical_villa_id, 319 distinct, 608 pointing at an existing properties row; not a foreign key); project and scraped_at (sibarth, elan); ingested_at (wimco); observed_at, method, trust, source, is_superseded, superseded_by and availability_observations (edenrock); price_quarantine (elan); for yachts provenance_class, source_operator, price_raw, rate_options, ais, catalog_reference and others. Some yacht rows hold an operator contact; read it masked. Unit: none (jsonb). Source: the writing capture. Grain: one source listing. Clock: per-key capture clocks (scraped_at, ingested_at, observed_at) where present.';
COMMENT ON COLUMN public.properties.created_at IS
'When the row was inserted, timestamptz, default now(). Range 2026-01-30 .. 2026-07-20 (2026-10-12): sibarth and elan 2026-01-30 .. 02-18, yachts 2026-07-05 .. 07-06, wimco 2026-07-19, edenrock and lebarth 2026-07-20. Unit: timestamptz. Source: column default. Grain: one source listing. Clock: ingest time.';
COMMENT ON COLUMN public.properties.updated_at IS
'When the row was last written, timestamptz, default now(); set to now() on every insert and update by update_property_search_vector(). Later than created_at on all 1,278 rows (2026-10-12); latest 2026-07-21. A write clock, not a source observation time. Unit: timestamptz. Source: trigger. Grain: one source listing. Clock: writer time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.properties'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'properties: every column has a comment';
  ELSE
    RAISE NOTICE 'properties columns still without a comment: %', missing;
  END IF;
END
$$;

-- Queued documentation source: PR #1018
-- Describe market_proof_reports: the 31 columns with no COMMENT ON COLUMN (0 of 31 described before, catalog count on
-- prod, 2026-10-13) and the table. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-13 08:31-08:40 UTC):
--   Columns, types, defaults, constraints and existing comments from pg_attribute, pg_attrdef, pg_constraint and
--   pg_description; fill and value shape from pg_stats and whole-table counts (1,563 rows). Writers from git history
--   at origin/main bf8830617: the edge function market-proof, v1 added in 1e8a9911a (2026-02-19) and rewritten as v2 in
--   d3dddb12f (2026-02-19), deleted in 276a6e9cc (2026-03-29), called per pipeline row by batch-market-proof (also
--   deleted). The table was created by supabase/migrations/20260219220000_acquisition_pipeline.sql.
--   The only remaining code reader is supabase/functions/pipeline-dashboard (id, pipeline_id, comp_count, comp_median,
--   recommendation, created_at). No SQL function or view names the table, pipeline_registry has no row for it, it
--   has no trigger and no policy.
--   The two writer versions are told apart by segment_analysis: v2 rows carry the key condition_tier. v1: 578 rows,
--   2026-02-19 18:01-18:59 UTC. v2: 985 rows, 2026-02-19 19:06 UTC to 2026-02-27 05:09 UTC.
-- LIMITS:
--   No run log survives; rows are dated by created_at. Comparable sales came from the SQL function find_bat_comps
--   (BaT sold lots, year +/-2, model filter, limit 200) as it was in February 2026. The comp arrays are not
--   re-checked here against today's sale records. Quoted values are categorical codes: no names, ids or amounts.
-- DRIFT FOUND:
--   The creating migration declared vehicle_id REFERENCES vehicles(id); production has no such foreign key
--   (pg_constraint has only the primary key and the pipeline_id foreign key). Recorded here, not repaired.

COMMENT ON TABLE public.market_proof_reports IS
'One comparable-sales report per run of the retired edge function market-proof on one acquisition_pipeline candidate (grain: one run on one pipeline row; 1,563 rows over 863 pipeline rows, 2026-10-13). Written 2026-02-19 to 2026-02-27 by two versions of the function: v1 (578 rows, 2026-02-19 18:01-18:59 UTC) and v2 (985 rows from 2026-02-19 19:06 UTC; v2 rows carry segment_analysis.condition_tier). The function was deleted on 2026-03-29, so nothing writes the table now; supabase/functions/pipeline-dashboard reads it. Comps are BaT sold lots returned by the SQL function find_bat_comps at run time. Values are derived estimates for a buy decision, not observations of the candidate. Clock: created_at (= insert time of the run); there is no event time for the candidate.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_proof_reports.id IS
'Surrogate key of the report. Unit: none (uuid). Source: gen_random_uuid() default. No foreign key points at it. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.pipeline_id IS
'The acquisition_pipeline candidate the report is about, foreign key to acquisition_pipeline.id (ON DELETE CASCADE). Set by market-proof from its pipeline_id input. Not unique: 863 pipeline rows carry 1,563 reports, because a re-run inserted a new row rather than replacing the old one (2026-10-13). Unit: none. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.vehicle_id IS
'The candidate''s vehicles.id when the pipeline row had one (copied from acquisition_pipeline.vehicle_id; NULL otherwise). Filled on 99 of 1,563 rows, all from v2 (2026-10-13). The creating migration declared a foreign key to vehicles; production has none, so the reference is not enforced. Unit: none. Grain: one run. Clock: n/a.';

-- ── Comparable sales ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_proof_reports.comp_vehicle_ids IS
'vehicles.id of each comparable sale used, from find_bat_comps rows after the function''s engine-tier and model-match filters. Same length as comp_prices on every row (2026-10-13) but not aligned with it: both versions sort the prices ascending and keep the ids in query order, so position i of one array does not pair with position i of the other. Not a foreign key; ids are not re-checked. Unit: none (uuid[]). Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.comp_count IS
'Number of comparable sales used: the length of the sorted price list. Equals the length of comp_prices on 1,560 of 1,563 rows; the 3 that differ are v1 rows (cause Unknown). 3 v2 rows have comp_count 0 (2026-10-13). find_bat_comps was called with a limit of 200, so 200 is a ceiling, not a market size. Unit: count. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.comp_prices IS
'Sale price of each comparable, sorted ascending, as returned by find_bat_comps (sale_price of the BaT lot). Unit: USD as recorded on the lot. Some arrays contain two-digit values that cannot be vehicle sale prices; they were kept as returned and are evidence of source errors, not prices. Grain: one run. Clock: the comps'' own sale dates are not stored here.';
COMMENT ON COLUMN public.market_proof_reports.comp_median IS
'Median of comp_prices, computed by the function. Unit: USD. Grain: one run. Clock: n/a (derived at created_at).';
COMMENT ON COLUMN public.market_proof_reports.comp_avg IS
'Mean of comp_prices, rounded to whole dollars. Unit: USD. Grain: one run. Clock: n/a (derived at created_at).';
COMMENT ON COLUMN public.market_proof_reports.comp_min IS
'Smallest value in comp_prices. Inherits the source errors noted on comp_prices. Unit: USD. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.comp_max IS
'Largest value in comp_prices. Unit: USD. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.segment_analysis IS
'How the comp set was chosen, as a JSON object. Both versions: target {year, make, model, engine} (copied from the pipeline row) and match_strategy. v1 adds model_keywords, year_range, raw_pool_size and filtered_pool_size. v2 adds base_model, condition_tier, cost_to_ready, target_sale_price, net_profit and roi_pct (its deal economics). Filled on every row (2026-10-13). Unit: mixed (USD for money keys, percent for roi_pct). Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.total_bids_analyzed IS
'Sum of bid_count over the comparable sales used (NULL counts as 0). Unit: count of bids. Grain: one run. Clock: n/a.';

-- ── Never written ───────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_proof_reports.avg_bid_velocity IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Intended meaning (from the creating migration''s grouping under bid analysis): Unknown. Unit: Unknown. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.snipe_ratio_avg IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Meaning and unit: Unknown. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.whale_bidder_count IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Meaning: Unknown. Unit: count. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.total_comments_analyzed IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof reads auction comments. Unit: count. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.sentiment_distribution IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Shape: Unknown. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.expert_comment_count IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Unit: count. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.key_technical_concerns IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Unit: none (text[]). Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.market_sentiment_keywords IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Shape: Unknown. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.hagerty_value IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof fetches a Hagerty value. Unit: USD (by name). Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.verification_checklist IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Unit: none (text[]). Grain: one run. Clock: n/a.';

-- ── Estimate and decision ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_proof_reports.estimated_value IS
'The function''s value estimate for the candidate. Meaning differs by version: v1 = comp_median (578 rows, all filled); v2 = target sale price from an inferred condition tier (between the 25th percentile and the median for project or driver tiers, the median for nice, midway from the median to the 75th percentile for excellent), NULL when there was no asking price to infer a tier from (731 of 985 v2 rows filled, 2026-10-13). A derived estimate, not an appraisal. Unit: USD. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.estimated_value_low IS
'Low end of the value range. Meaning differs by version: v1 = comp_min; v2 = 25th percentile of comp_prices. Unit: USD. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.estimated_value_high IS
'High end of the value range. Meaning differs by version: v1 = comp_max; v2 = 75th percentile of comp_prices. Unit: USD. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.asking_price IS
'The candidate''s asking price as the pipeline row held it at run time (acquisition_pipeline.asking_price; NULL when absent). Filled on 1,227 of 1,563 rows (2026-10-13). A copy, not the source: the listing that stated it is on the pipeline row. Unit: USD. Grain: one run. Clock: value at created_at.';
COMMENT ON COLUMN public.market_proof_reports.discount_to_market IS
'(comp_median - asking_price) / comp_median, as a percent rounded to two decimals; positive means asking below the comp median. NULL when there is no asking price or no median; filled exactly where asking_price is (2026-10-13). Unit: percent. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.recommendation IS
'The function''s buy call: STRONG_BUY, BUY, FAIR or PASS (all four occur in both versions, 2026-10-13). v1 scored the discount to the comp median; v2 scored net profit and ROI after its cost-to-ready model (segment_analysis). An agent''s heuristic output, not an observation. Unit: categorical code. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.risk_factors IS
'Free-text warnings the function attached (for example a missing asking price, a wide price spread, few comps). Non-empty on 1,556 of 1,563 rows (2026-10-13). Generated text, not seller or inspector testimony. Unit: none (text[]). Grain: one run. Clock: n/a.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_proof_reports.report_generated_at IS
'When the function built the report: the v2 code sends new Date() from the function (differs from created_at on all 985 v2 rows). The v1 code in the repo does not set it, so it would fall to the now() default and equal created_at, yet 575 of 578 v1 rows differ; the deployed v1 evidently set it, and how is Unknown (2026-10-13). Unit: timestamptz. Grain: one run. Clock: compute time (function clock).';
COMMENT ON COLUMN public.market_proof_reports.created_at IS
'Insert time of the row: now() default, never passed by the writer. 2026-02-19 18:01 UTC to 2026-02-27 05:09 UTC (2026-10-13). Unit: timestamptz. Grain: one run. Clock: ingest time.';

-- Queued documentation source: PR #1019
-- Describe reference_libraries: the 21 columns with no COMMENT ON COLUMN (0 of 21 described before, catalog count on
-- prod, 2026-10-13) and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-13 08:36-08:41 UTC):
--   Columns, types, defaults, constraints, policies, grants and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_policy, has_table_privilege and pg_description; fill and value shape from pg_stats and exact
--   whole-table counts (48,907 rows). Live bodies of the SQL functions that name the table (pg_proc.prosrc):
--   get_or_create_library_for_vehicle, link_document_to_specs, trigger_update_library_stats, update_coverage_on_upload,
--   get_vehicle_library_docs, get_vehicle_references; the triggers on library_documents that call the middle three; the
--   view reference_library_stats. Code at origin/main bf8830617: supabase/migrations/20251122_reference_library_system.sql
--   (this shape), nuke_frontend/src/components/vehicle/VehicleReferenceLibrary.tsx and nuke_frontend/src/pages/Library.tsx,
--   scripts/upload-service-manuals.js, upload-catalog-urls.js, upload-multiple-catalogs.js, upload-3m-catalog.js, and
--   the merged description of vehicle_reference_links (20261008024000), which records the auto-link trigger history.
-- LIMITS:
--   No run log records which writer created a given row. Most rows were created by get_or_create_library_for_vehicle
--   from the auto-link trigger on vehicles (one library per new year, make, series and body style); that trigger is now
--   a stub (see vehicle_reference_links). Who set is_verified on 7 rows is Unknown: no code in the repo sets it on this
--   table. Quoted values are column, function and categorical names and counts; no ids, names or amounts.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it named parse-reference-document as a writer; that function only reads the table (an inner
--   join from library_documents). The new comment keeps the rest and adds the clocks, the auto-create origin and the
--   uniqueness gap. There were no column comments.

COMMENT ON TABLE public.reference_libraries IS
'Reference library per year, make, model, series and body: one row per library that holds contributed manuals, brochures and specs (grain: one library; 48,907 rows, 2026-10-13). Most rows were auto-created, one per new year, make, series and body style seen on a vehicle insert, by get_or_create_library_for_vehicle through the vehicles auto-link trigger (now a stub, so no library has been created since 2026-04-25 05:37 UTC); others were created by the upload scripts in scripts/ and the vehicle page upload form (VehicleReferenceLibrary.tsx), the only paths that write description (14 rows). Only 218 rows hold a document (library_documents). Maintained by triggers on library_documents: trigger_update_library_stats (document_count, updated_at) and link_document_to_specs (oem_spec_id). Readers: Library.tsx, VehicleReferenceLibrary.tsx, parse-reference-document (a join from library_documents), the view reference_library_stats, get_vehicle_library_docs, get_vehicle_references and update_coverage_on_upload. UNIQUE (year, make, series, body_style) does not deduplicate rows with a NULL series (48,437 of them): 15 rows repeat another row''s year, make, model, series and body style. Rows 2025-11-21 .. 2026-04-25. Clocks: created_at is insert time; there is no event time.';

-- ── Identity ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.reference_libraries.id IS
'Surrogate key of the library. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by foreign keys from library_documents.library_id, vehicle_reference_links.library_id, oem_vehicle_specs.source_library_id and manhunt_searches.library_id (2026-10-13). Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.year IS
'Model year the library covers, NOT NULL, copied from vehicles.year by get_or_create_library_for_vehicle or typed by an uploader. Not checked: 57 rows hold a year before 1886 or after 2027, with values from 0 to 9999 (2026-10-13); the auto-create path copies vehicles.year without a check, and which vehicle each came from is not recorded. Unit: model year. Grain: one library. Clock: event time (model year, as recorded on the vehicle).';
COMMENT ON COLUMN public.reference_libraries.make IS
'Manufacturer as the vehicle or uploader spelled it, NOT NULL, not keyed to a make table; casing varies (scripts/upload-service-manuals.js writes lower case; vehicle-derived rows keep the vehicle''s spelling). get_or_create_library_for_vehicle matches it with ILIKE. Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.model IS
'Model copied from vehicles.model when the library was auto-created, or typed by an uploader. Not part of the UNIQUE key or the lookup, so the first vehicle''s model wins for a year, make, series and body style. NULL on 455 rows; placeholder values such as N/a, Unknown, boat and trailer are among the most common (pg_stats, 2026-10-13). Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.series IS
'Manufacturer series code (for example C/K, C10), copied from vehicles.series or typed by an uploader. Filled on 470 of 48,907 rows (2026-10-13). Part of UNIQUE (year, make, series, body_style); because NULL never equals NULL in that constraint, the 48,437 rows without a series are not protected from duplicates. Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.body_style IS
'Body style copied from vehicles.body_style or typed by an uploader (for example Coupe, Pickup, Convertible); free text, 960 distinct values (pg_stats, 2026-10-13). Filled on 16,535 of 48,907 rows. Part of the UNIQUE key and of the lookup. Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries."trim" IS
'Never written: NULL on every row (exact count, 2026-10-13); no writer in the repo sets it. Read by the view reference_library_stats. Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.description IS
'Free-text label written by the upload scripts and the vehicle page upload form (for example "Reference library for <year> <make> <series>"); get_or_create_library_for_vehicle does not set it. Filled on 14 rows (2026-10-13). Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.notes IS
'Never written: NULL on every row (exact count, 2026-10-13); no writer in the repo sets it. Unit: none. Grain: one library. Clock: n/a.';

-- ── Counters ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.reference_libraries.vehicle_count IS
'Stored counter that nothing maintains: 0 on every row (2026-10-13), although 47,836 libraries have a vehicle_reference_links row. The live vehicle count per library is computed by the view reference_library_stats. Unit: count. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.document_count IS
'Number of library_documents rows for the library, kept by the trigger trigger_update_library_stats on library_documents (+1 on insert, -1 on delete, floor 0). Agrees with a live count of library_documents on all but 1 row (2026-10-13). Above 0 on 218 rows. Unit: count. Grain: one library. Clock: as of the last document insert or delete.';
COMMENT ON COLUMN public.reference_libraries.contributor_count IS
'Stored counter that nothing maintains: 0 on every row (2026-10-13). The view reference_library_stats computes it as distinct library_documents.uploaded_by. Unit: count. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.total_downloads IS
'Stored counter that nothing maintains: 0 on every row (2026-10-13). The view reference_library_stats sums library_documents.download_count instead. Unit: count. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.total_views IS
'Stored counter that nothing maintains: 0 on every row (2026-10-13). The view reference_library_stats sums library_documents.view_count instead. Unit: count. Grain: one library. Clock: n/a.';

-- ── People and verification ─────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.reference_libraries.created_by IS
'User who created the library, foreign key to auth.users(id). NULL on every row (2026-10-13): neither the auto-create function nor the upload paths pass it. The live update policy (libraries_authenticated_update) does not use it: its condition is true (2026-10-13). Unit: none (uuid). Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.is_verified IS
'Whether a person marked the library verified; default false. True on 7 rows (2026-10-13); which path set them is Unknown (no code in the repo sets it on this table; scripts/upload-service-manuals.js sets is_verified on library_documents, not here). Unit: boolean. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.verified_by IS
'User who verified the library, foreign key to auth.users(id). NULL on every row (2026-10-13), including the 7 rows marked verified. Unit: none (uuid). Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.verified_at IS
'When the library was verified. NULL on every row (2026-10-13), including the 7 rows marked verified. Unit: timestamptz. Grain: one library. Clock: would be the verification time; never recorded.';

-- ── Link to the OEM catalog ─────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.reference_libraries.oem_spec_id IS
'The oem_vehicle_specs row the library''s documents describe, foreign key to oem_vehicle_specs(id). Set by the trigger function link_document_to_specs when a library_documents row is inserted: it takes the first spec whose make (ILIKE), year range and series fit the library, or inserts one. Filled on exactly the 218 libraries that hold a document (2026-10-13). Read by scripts/discovery/configuration-catalog-relations.sql. Unit: none (uuid). Grain: one library. Clock: as of the last document insert.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.reference_libraries.created_at IS
'Insert time of the library: now() default, never passed by a writer. For auto-created rows this is the insert time of the first vehicle with that year, make, series and body style. 2025-11-21 20:21 UTC .. 2026-04-25 05:37 UTC (2026-10-13). Unit: timestamptz. Grain: one library. Clock: ingest time.';
COMMENT ON COLUMN public.reference_libraries.updated_at IS
'Time of the last change by trigger_update_library_stats (a document insert or delete); default now() at insert. Differs from created_at on exactly the 218 rows with documents; latest 2026-05-06 05:38 UTC (2026-10-13). There is no updated_at trigger, so other edits do not move it. Unit: timestamptz. Grain: one library. Clock: ingest time (last document change).';

-- Queued documentation source: PR #1187
-- Describe financial_documents: the 54 columns with no COMMENT ON COLUMN (4 of 58 described before, catalog count on
-- prod, 2026-10-14). Comments only; the table comment and the 4 existing column comments are unchanged.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-14 08:33-08:40 UTC):
--   Columns, types, defaults, constraints, indexes, triggers and inbound foreign keys from pg_attribute, pg_constraint,
--   pg_indexes and pg_trigger. Fill from pg_stats null_frac (the table has 65 rows, so the sample is the whole table)
--   and grouped counts of the categorical columns. Field-to-column mapping from financial_field_registry
--   (host_table = 'financial_documents', 30 rows, each noted "seeded from EXTRACTION_SPEC v1.1").
--   Writers: no edge function, migration or script in this repo writes the table (git grep at d7b418b20 finds only
--   docs/publishing/FINANCIAL_LAYER_HANDOFF.md and the reader nuke_frontend/src/pages/publishing/FinanceDashboard.tsx).
--   The handoff names the writer as the operator-side financial layer (financial_layer.sql v1.0 to v1.3, additive
--   only) and its local extraction tooling. All 65 rows were created on 2026-07-17 and none updated since that day.
-- LIMITS:
--   The extraction code is not in this repo, so each comment states the shape and fill read from the database and the
--   handoff's doctrine, not the extractor's exact rules. Where the meaning cannot be read, the comment says Unknown.
--   The table is owner-scoped and private: these comments quote categorical codes and counts only, no names,
--   identifiers, contacts, IBANs or amounts.

-- ── Identity and file ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.financial_documents.id IS
'Surrogate key of one source document (one logical document inside one file). Unit: none (uuid). Source: gen_random_uuid() default. Referenced by 7 foreign keys: financial_document_lines, financial_document_extractions, financial_payments.evidence_document_id, financial_payment_allocations, financial_document_links (document_id and related_document_id), financial_review_queue, and duplicate_of on this table. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.owner_id IS
'Operator account that owns the document; row security scopes reads to it (anon and other sessions get zero rows, docs/publishing/FINANCIAL_LAYER_HANDOFF.md). Unit: none (uuid; no foreign key). One distinct value on all 65 rows (2026-10-14); the handoff lists an owner_id remap from placeholder ids to real auth ids as pending build work. Part of the unique key (owner_id, content_sha256, logical_index). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.content_sha256 IS
'SHA-256 of the source file bytes, 64 lowercase hex characters on all 65 rows (2026-10-14). Unit: hex digest. Source: computed by the writer from the local file. With owner_id and logical_index it forms the partial unique index idx_fdoc_owner_sha_logical (where content_sha256 is not null), so the same bytes load once per logical document. Same document with different bytes is linked through duplicate_of, not this hash. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.logical_index IS
'Position of this logical document within its file, for files that hold more than one document. Unit: ordinal integer, default 1. Source: the writer. Every one of the 65 rows has 1 (2026-10-14): no multi-document file has been split yet. Third leg of the unique key (owner_id, content_sha256, logical_index). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.storage_path IS
'Path of the source file inside Supabase Storage. Unit: storage object path. All 65 rows start with the prefix financial/ and end in .pdf (2026-10-14). Source: the writer at upload. Grain: one file (shared by every logical document of that file). Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.source_filename IS
'File name of the source file as received (verbatim; may carry names, so it is private). Unit: text. All 65 rows end in .pdf (2026-10-14). Source: the writer, from the local file or email attachment. Grain: one file. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.page_count IS
'Number of pages in the source PDF. Unit: pages. Filled on all 65 rows, 4 distinct values (2026-10-14). Source: the writer (Unknown whether counted on the file or reported by the text extractor; the extractor is not in this repo). Grain: one file. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.byte_size IS
'Size of the source file. Unit: bytes. Filled on all 65 rows (2026-10-14). Source: the writer, from the local file. Grain: one file. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.source_kind IS
'How the document reached the operator. Unit: code, CHECK in (email_attachment, email_body, scan, upload, bank_export, other). Default email_attachment. On 2026-10-14: upload 60, email_attachment 5. Source: the writer. Grain: one document. Clock: n/a.';

-- ── Email envelope (filled only when source_kind is an email) ─────────────────────────────────────────────────

COMMENT ON COLUMN public.financial_documents.source_email_message_id IS
'Message-ID header of the email that carried the document. Unit: RFC 5322 message id (text). Filled on 5 of 65 rows, the email_attachment rows (2026-10-14). Indexed (idx_fdoc_email_msg) to join documents back to their message. Source: the writer, from the mail export. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.source_email_from IS
'From address of that email, verbatim (private contact data). Unit: email address text. Filled on 5 of 65 rows (2026-10-14). Source: the writer, from the mail export. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.source_email_domain IS
'Domain part of source_email_from, kept separately for grouping by counterparty domain (indexed, idx_fdoc_email_domain). Unit: domain name text. Filled on 5 of 65 rows, 3 distinct (2026-10-14). Source: the writer, derived from the From address. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.source_email_date IS
'Date header of that email: when the sender sent it. Unit: timestamptz. Filled on 5 of 65 rows (2026-10-14). Source: the writer, from the mail export. Grain: one document. Clock: event time of the delivery (send time), not the document date and not the load time.';

-- ── Classification ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.financial_documents.doc_type IS
'Kind of financial document, in the French accounting vocabulary. Unit: code, CHECK in (devis = quote, facture = invoice, avoir = credit note, insertion_order, bon_de_commande = purchase order, payment_receipt, remittance_advice, releve = statement, rate_card, media_kit, contract, commission_statement, unclassified, other). On 2026-10-14: facture 60, media_kit 3, avoir 2. Default unclassified. Source: the writer''s classifier; financial_field_registry declares a staging slot doc_type_candidates, which no row carries (2026-10-14). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.doc_type_confidence IS
'Classifier confidence in doc_type. Unit: fraction 0 to 1, numeric(4,3). Filled on all 65 rows, 3 distinct values (2026-10-14). Source: the writer''s classifier (Unknown how it is computed; the classifier is not in this repo). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.direction IS
'Which way the document moved relative to the owner''s operation: outbound = issued by the operator, inbound = received from a counterparty, internal = between the operator''s own entities. Unit: code, CHECK in (outbound, inbound, internal, unknown). On 2026-10-14: unknown 33, inbound 21, outbound 10, internal 1. Source: the writer, presumably against financial_operator_entities (Unknown: the rule is not in this repo). Grain: one document. Clock: n/a.';

-- ── Header identifiers and dates (promoted from extractions; financial_field_registry storage = column) ─────────

COMMENT ON COLUMN public.financial_documents.document_number IS
'Number the issuer printed on the document (invoice or credit-note number), verbatim. Unit: identifier text. Filled on 60 of 65 rows (2026-10-14); indexed where not null. Source: extracted from the document text; registry field document_number. An attributed claim of the issuer. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.deal_number IS
'Deal or order reference printed on the document, verbatim; the text leg that deal_id resolves. Unit: identifier text. Filled on 3 of 65 rows (2026-10-14); indexed where not null. Source: extracted from the document text; registry field deal_number. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.document_date IS
'Issue date printed on the document. Unit: date (no time zone). Filled on 46 of 65 rows (2026-10-14); indexed. Source: extracted from the document text; registry field document_date. Grain: one document. Clock: event time as the issuer states it (claim), not when it was received or loaded.';
COMMENT ON COLUMN public.financial_documents.due_date IS
'Payment due date printed on the document. Unit: date. Empty on all 65 rows (2026-10-14). Source: registry field due_date (column storage), not yet extracted. Grain: one document. Clock: event time as the issuer states it (claim).';
COMMENT ON COLUMN public.financial_documents.service_period_start IS
'First day of the period the document bills for. Unit: date. Empty on all 65 rows (2026-10-14). Source: registry field service_period_start, not yet extracted. Grain: one document. Clock: valid-time start as the issuer states it (claim).';
COMMENT ON COLUMN public.financial_documents.service_period_end IS
'Last day of the period the document bills for. Unit: date. Empty on all 65 rows (2026-10-14). Source: registry field service_period_end, not yet extracted. Grain: one document. Clock: valid-time end as the issuer states it (claim).';
COMMENT ON COLUMN public.financial_documents.season_label IS
'Publishing season the document refers to, as written (for example a season name and year). Unit: text. Empty on all 65 rows (2026-10-14). Source: registry field season_label, not yet extracted. Grain: one document. Clock: n/a.';

-- ── Parties (raw text is evidence; uuid legs are filled later by entity resolution) ───────────────────────────

COMMENT ON COLUMN public.financial_documents.issuer_org_id IS
'Organization resolved as the issuer, foreign key to organizations.id. Unit: none (uuid). Empty on all 65 rows (2026-10-14): the entity-resolution pass named in the issuer_name_raw comment has not run. Indexed (idx_fdoc_issuer_org). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.issuer_person_id IS
'Person resolved as the issuer, foreign key to discovered_persons.id. Unit: none (uuid). Empty on all 65 rows (2026-10-14); resolution not run. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.issuer_tax_id IS
'Issuer tax or company registration number printed on the document, verbatim (Unknown which scheme per row: VAT number, SIRET or other). Unit: identifier text. Filled on 30 of 65 rows (2026-10-14). Source: extracted; registry field issuer_tax_id (value_type tax_id). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.recipient_name_raw IS
'Recipient (billed party) name as printed on the document, verbatim; immutable evidence like issuer_name_raw, resolved later into recipient_org_id or recipient_person_id. Unit: text (private). Filled on 52 of 65 rows (2026-10-14). Source: extracted; registry field recipient_name_raw. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.recipient_org_id IS
'Organization resolved as the recipient, foreign key to organizations.id. Unit: none (uuid). Empty on all 65 rows (2026-10-14); resolution not run. Indexed (idx_fdoc_recipient_org). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.recipient_person_id IS
'Person resolved as the recipient, foreign key to discovered_persons.id. Unit: none (uuid). Empty on all 65 rows (2026-10-14); resolution not run. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.recipient_tax_id IS
'Recipient tax or company registration number printed on the document, verbatim. Unit: identifier text. Filled on 12 of 65 rows, 4 distinct (2026-10-14). Source: extracted; registry field recipient_tax_id. Grain: one document. Clock: n/a.';

-- ── Money (French invoice convention: HT = before tax, TVA = VAT, TTC = tax included) ─────────────────────────

COMMENT ON COLUMN public.financial_documents.currency IS
'Currency of every amount on the row. Unit: ISO 4217 code, CHECK ^[A-Z]{3}$. Filled on 59 of 65 rows, 3 distinct (2026-10-14). Source: extracted; registry field currency. A deal that mixes currencies gets NULL money totals in v_financial_deal_flow (handoff). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.amount_ht IS
'Total before tax (hors taxes) printed on the document. Unit: currency (see currency), numeric(14,2). Filled on 16 of 65 rows (2026-10-14). Source: extracted; registry field amount_ht. An attributed claim of the issuer, not a payment. Private. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.tva_rate IS
'VAT (TVA) rate printed on the document. Unit: percent, numeric(6,3) (Unknown whether stored as 20.000 or 0.200; one distinct value, 3 of 65 rows filled, 2026-10-14). Source: extracted; registry field tva_rate (value_type percentage). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.amount_tva IS
'VAT amount printed on the document. Unit: currency (see currency), numeric(14,2). Filled on 11 of 65 rows (2026-10-14). Source: extracted; registry field amount_tva. Private. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.amount_ttc IS
'Total including tax (toutes taxes comprises) printed on the document; the amount FinanceDashboard shows. Unit: currency (see currency), numeric(14,2). Filled on 50 of 65 rows; all three of amount_ht, amount_tva and amount_ttc are filled on 2 rows (2026-10-14). Source: extracted; registry field amount_ttc. An attributed claim, not a payment (payments live in financial_payments). Private. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.amount_confidence IS
'Extractor confidence in the amount fields of the row. Unit: fraction 0 to 1, numeric(4,3). Filled on the same 50 rows as amount_ttc, 2 distinct values (2026-10-14). Source: the writer''s extractor (Unknown how it is computed; per-field confidence factors live in financial_document_extractions). Grain: one document. Clock: n/a.';

-- ── Payment terms and bank details ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.financial_documents.payment_terms_raw IS
'Payment terms as printed (for example a number of days after invoice), verbatim. Unit: text. Filled on 2 of 65 rows (2026-10-14). Source: extracted; registry field payment_terms_raw. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.payment_terms_days IS
'Payment terms normalized to a number of days. Unit: days. Filled on 1 of 65 rows (2026-10-14). Source: the writer, parsed from payment_terms_raw; registry field payment_terms_days. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.payment_method_raw IS
'Payment method as printed (transfer, cheque, card), verbatim. Unit: text. Empty on all 65 rows (2026-10-14). Source: registry field payment_method_raw, not yet extracted. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.bank_iban_masked IS
'Bank account (IBAN) printed on the document, masked; the full IBAN stays on the operator machine and never reaches the cloud (handoff doctrine 3). Unit: masked IBAN text. Filled on 15 of 65 rows, 6 distinct (2026-10-14). Source: the writer; registry field bank_iban maps to this column. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.bank_iban_hash IS
'Hash of the full IBAN, so documents paying into the same account can be grouped without the IBAN itself. Unit: 64 hex characters (the length of a SHA-256 digest; Unknown whether salted). Filled on the same 15 rows as bank_iban_masked, 6 distinct (2026-10-14); indexed where not null. Source: computed locally by the writer. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.bank_bic IS
'Bank identifier code (BIC/SWIFT) printed on the document. Unit: BIC text. Filled on 33 of 65 rows (2026-10-14). Source: extracted; registry field bank_bic. Grain: one document. Clock: n/a.';

-- ── Links to deals and publications ───────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.financial_documents.deal_id IS
'Deal the document belongs to, foreign key to financial_deals.id (ON DELETE SET NULL). Unit: none (uuid). Filled on 3 of 65 rows, the same count as deal_number (2026-10-14). Source: the writer''s resolution of deal_number. v_financial_deal_flow aggregates documents by it. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.publication_id IS
'Publication the document concerns, foreign key to publications.id. Unit: none (uuid). Empty on all 65 rows (2026-10-14). Source: intended for the resolution of issue_canon or attributes.staging.issue_hint (18 rows carry an issue_hint). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.issue_id IS
'Publication issue the document concerns, foreign key to publication_issues.id. Unit: none (uuid). Empty on all 65 rows (2026-10-14); see issue_canon. Grain: one document. Clock: n/a.';

-- ── Text extraction ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.financial_documents.ocr_text IS
'Full text of the document. Unit: text. Empty on all 65 rows (2026-10-14) by design: full OCR text stays on the operator machine (handoff doctrine 3), and every row instead carries a local file reference under attributes.staging.ocr_text_local. Do not add a path that fills it from the cloud side. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.ocr_engine IS
'Tool that produced the document text. Unit: code. pdftotext on all 65 rows (2026-10-14): text layer extraction, no image OCR. Source: the writer. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.ocr_confidence IS
'Confidence of the text extraction. Unit: fraction 0 to 1, numeric(4,3). Empty on all 65 rows (2026-10-14): pdftotext reports none. Grain: one document. Clock: n/a.';

-- ── Processing state ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.financial_documents.extraction_status IS
'Stage of the document in the extraction pipeline. Unit: code, CHECK in (pending, ocr_done, extracted, resolved, verified, failed, rejected). On 2026-10-14: extracted 63, failed 2; none has reached resolved or verified. Source: the writer. Grain: one document. Clock: current state only; there is no per-stage timestamp (updated_at moves on any change).';
COMMENT ON COLUMN public.financial_documents.review_status IS
'Human review state of the extracted header. Unit: code, CHECK in (unreviewed, auto_accepted, needs_review, reviewed). On 2026-10-14: needs_review 55, auto_accepted 10, reviewed 0. Source: the writer; typed concerns go to financial_review_queue. Grain: one document. Clock: current state only.';
COMMENT ON COLUMN public.financial_documents.resend_count IS
'Number of times the same document was received again (re-sent by email). Unit: count. 0 on all 65 rows (2026-10-14). Source: the writer; each resend is logged under attributes.staging.resends[] (attributes comment; registry fields resends and resend_event). Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.privacy_tier IS
'Who may see the row. Unit: code, CHECK in (private, published, mutual, aggregate). private on all 65 rows (2026-10-14). Source: the writer. Grain: one document. Clock: n/a.';
COMMENT ON COLUMN public.financial_documents.created_at IS
'When the row was inserted in this database. Unit: timestamptz, default now(). All 65 rows on 2026-07-17 (one load). Grain: one document. Clock: ingest time, not the document date or the email date.';
COMMENT ON COLUMN public.financial_documents.updated_at IS
'When the row last changed, stamped by the BEFORE UPDATE trigger trg_fdoc_touch (financial_touch_updated_at). Unit: timestamptz. Latest value 2026-07-17 (2026-10-14 read): no row has changed since the load. Grain: one document. Clock: ingest time of the last change.';

-- Queued documentation source: PR #1188
-- Describe build_threads: the 29 columns with no COMMENT ON COLUMN (2 of 31 described before, catalog count on prod,
-- 2026-10-14). Comments only; the table comment and the 2 existing column comments are unchanged.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Companion of 20261008021000_describe_build_posts.sql.
--
-- METHOD (read 2026-10-14 08:33-08:35 UTC):
--   Columns, types, defaults, constraints (3 foreign keys, all validated; CHECK on extraction_status), policies and
--   pg_stat_user_tables from the catalog; fill from pg_stats null_frac and exact grouped counts over all 2,247 rows;
--   jsonb key counts over metadata and vehicle_hints.
--   Writers, from code at origin/main d7b418b20 and git history:
--     discover-build-threads (edge function, added 9f1578f4e 2026-01-30, deleted 53e40d55d 2026-04-06; read at
--       9871ee4fb^): upserts on thread_url with forum_source_id, thread_url, thread_url_normalized, thread_title,
--       author_handle, author_profile_url, vehicle_hints, vehicle_match_confidence, reply_count, view_count,
--       last_activity_date, extraction_status = discovered, metadata, updated_at.
--     extract-build-posts (edge function, same add, deleted 9871ee4fb 2026-03-31): sets extracting at start; on a
--       thread it had no row for, upserts title, author_handle, vehicle_hints, first_post_date; at the end sets
--       complete, posts_extracted, images_extracted, last_extracted_at, last_activity_date, extraction_cursor,
--       post_count and image_count_estimate.
--     scripts/extract-vehicle-identifiers.js, match-forum-vehicles.js, cross-reference-vins.js (vehicle_id only);
--       structure-build-timeline.js and batch-structure-threads-ollama.js (vehicle_id and vehicle_hints; the latter
--       also sets extraction_status = 'structured', which the CHECK rejects, so its update cannot land).
--   No cron job names the table; pg_stat_user_tables counts 0 inserts, updates and deletes since the statistics
--   were reset. Live SQL readers: get_threads_to_extract and backfill_org_vehicles_from_build_threads.
-- LIMITS:
--   The writers are deleted, so their behavior is read from their last committed version; whether that exact version
--   produced every row is Unknown. Quoted values are codes and counts: no handles, URLs or titles.

-- ── Identity and source ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.id IS
'Surrogate key of one forum build thread. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by build_posts.build_thread_id (ON DELETE CASCADE). Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.forum_source_id IS
'Forum the thread lives on, foreign key to forum_sources.id (ON DELETE CASCADE, validated), NOT NULL. 42 distinct forums over 2,247 rows (2026-10-14). Source: both writers, from the forum_sources row they crawled. Unit: none (uuid). Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.thread_url IS
'URL of the thread as found on the forum section page, NOT NULL and UNIQUE; the upsert key of both writers (onConflict thread_url), so one row per distinct URL string. Unit: URL text. Source: discover-build-threads (list pages) or extract-build-posts (direct URL). Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.thread_url_normalized IS
'thread_url passed through the writers'' normalizeForumUrl, for matching the same thread reached by different URL forms; not constrained unique, so two raw URLs of one thread can still make two rows. Filled on all 2,247 rows; equal to thread_url on 380 (2026-10-14). Unit: URL text. Source: both writers. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.thread_id_external IS
'The forum''s own thread id. Unit: text. Empty on all 2,247 rows (2026-10-14): no writer sets it. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.thread_title IS
'Thread title as shown on the forum, verbatim. Filled on all 2,247 rows (2026-10-14). Unit: text. Source: discover-build-threads from the section list, or extract-build-posts from the thread page. A forum member''s words, not a vehicle fact; vehicle_hints is parsed from it. Grain: one thread. Clock: n/a.';

-- ── Author ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.author_handle IS
'Forum handle of the thread starter, verbatim (public on the forum; personal). Filled on about 56% of rows (pg_stats null_frac 0.44, 2026-10-14). Unit: text. Source: discover-build-threads from the list row, or extract-build-posts from the first post. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.author_profile_url IS
'URL of the thread starter''s forum profile. Filled on about 56% of rows, alongside author_handle (pg_stats null_frac 0.44, 2026-10-14). Unit: URL text. Source: discover-build-threads. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.author_external_identity_id IS
'Resolved identity of the thread starter, foreign key to external_identities.id (validated). Empty on all 2,247 rows (2026-10-14): no writer resolves it. Unit: none (uuid). Grain: one thread. Clock: n/a.';

-- ── Vehicle link ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.vehicle_id IS
'Vehicle the thread is taken to be about, foreign key to vehicles.id (ON DELETE CASCADE, validated). Filled on 763 of 2,247 rows, 568 distinct vehicles; 47 rows hold an id absent from vehicles despite the validated key (2026-10-14; Unknown how, presumably a delete that skipped the foreign-key triggers). Set after discovery by the scripts extract-vehicle-identifiers.js, match-forum-vehicles.js, cross-reference-vins.js (VIN or year/make/model match) and structure-build-timeline.js (creates a vehicle from an LLM reading). A machine match, not a confirmed identity; no column records which script or evidence set it. Unit: none (uuid). Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.vehicle_match_confidence IS
'Despite its name, the discovery score that the thread is a build thread, not a vehicle-match confidence: discover-build-threads writes its build_confidence here (title keyword score, plus 0.15 if a year was parsed and 0.10 if a make was parsed, clamped to 0..1); the same value is in metadata.discovery_confidence. No vehicle-matching script writes it. Unit: fraction 0 to 1, numeric(3,2). 12 distinct values; 0.30 on 931 rows (2026-10-14). Grain: one thread. Clock: n/a.';

-- ── Thread counts (as read by the writers) ────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.post_count IS
'Posts read by extract-build-posts (prior posts_extracted plus the posts parsed in the last run), not the forum''s own post count. Filled on 1,077 rows, every complete thread plus 94 others (2026-10-14). Unit: posts. Source: extract-build-posts at completion. Grain: one thread. Clock: as of last_extracted_at.';
COMMENT ON COLUMN public.build_threads.image_count_estimate IS
'Images found in the posts read by extract-build-posts; the writer sets it to the same running total as images_extracted, so it is not an independent estimate. Filled where post_count is (about 47% of rows, 2026-10-14). Unit: images. Source: extract-build-posts. Grain: one thread. Clock: as of last_extracted_at.';
COMMENT ON COLUMN public.build_threads.view_count IS
'View counter shown on the forum section list. Filled on about 35% of rows (pg_stats null_frac 0.65, 2026-10-14). Unit: views. Source: discover-build-threads, parsed from the list row when the forum''s DOM map has a view_count selector. Grain: one thread. Clock: as of the discovery crawl (metadata.discovered_at), not current.';
COMMENT ON COLUMN public.build_threads.reply_count IS
'Reply counter shown on the forum section list. Filled on about 40% of rows (pg_stats null_frac 0.60, 2026-10-14). Unit: replies. Source: discover-build-threads, parsed from the list row when the DOM map has a reply_count selector. Grain: one thread. Clock: as of the discovery crawl (metadata.discovered_at), not current.';

-- ── Thread dates ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.first_post_date IS
'Date of the thread''s first post. Empty on all 2,247 rows (2026-10-14): only the extract-build-posts upsert for a thread with no prior row sets it, and every extracted thread already had one. Use min(build_posts.posted_at) instead. Unit: timestamptz. Grain: one thread. Clock: event time on the forum.';
COMMENT ON COLUMN public.build_threads.last_post_date IS
'Date of the thread''s last post. Empty on all 2,247 rows (2026-10-14): no writer sets it (last_activity_date carries that value). Unit: timestamptz. Grain: one thread. Clock: event time on the forum.';
COMMENT ON COLUMN public.build_threads.last_activity_date IS
'Latest post date known for the thread: the last-post date on the forum list at discovery, overwritten by the posted_at of the last post read when extract-build-posts completes. Filled on 57% of rows, from 2004-04-03 to 2026-01-30 (2026-10-14). Unit: timestamptz (parsed from forum text; time zone Unknown). Source: both writers. Grain: one thread. Clock: event time on the forum, as of the last crawl.';

-- ── Extraction state ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.extraction_status IS
'Where the thread stands in post extraction. Unit: code, CHECK in (discovered, queued, extracting, complete, failed, stale); default discovered. On 2026-10-14: discovered 1,041, complete 983, extracting 223 (stuck since 2026-01-30; extract-build-posts sets extracting at start and complete only at the end). queued would be set by the SQL function queue_thread_extraction. Source: both writers. Grain: one thread. Clock: current state only; no per-state timestamp.';
COMMENT ON COLUMN public.build_threads.posts_extracted IS
'Running total of posts stored in build_posts by extract-build-posts across runs; the next resumed run starts numbering at posts_extracted + 1 (the cause of the duplicate rows described on build_posts). Default 0. Unit: posts. Source: extract-build-posts. Grain: one thread. Clock: as of last_extracted_at.';
COMMENT ON COLUMN public.build_threads.images_extracted IS
'Running total of images found by extract-build-posts across runs. Default 0. Unit: images. Source: extract-build-posts. Grain: one thread. Clock: as of last_extracted_at.';
COMMENT ON COLUMN public.build_threads.last_extracted_at IS
'When extract-build-posts last completed a run on the thread. Filled on 1,077 rows; latest 2026-01-30 14:02Z (2026-10-14). Unit: timestamptz. Source: extract-build-posts (its own clock). Grain: one thread. Clock: ingest time of the last extraction.';

-- ── Flags and dedup (never set) ───────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.is_featured IS
'Meant to record that the forum marks the thread as featured. false (the default) on all 2,247 rows (2026-10-14): no writer sets it; stickiness is in metadata.is_sticky instead. Unit: boolean. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.is_complete IS
'Meant to record that the build itself is finished (not that extraction is; see extraction_status). false (the default) on all 2,247 rows (2026-10-14): no writer sets it. Unit: boolean. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.has_sale_mention IS
'Meant to flag a thread that mentions selling or a sale. false (the default) on all 2,247 rows (2026-10-14): no writer sets it, so false here does not mean no sale was mentioned. Unit: boolean. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.content_hash IS
'Meant to hold a hash of the first post for deduplication (creating migration). Empty on all 2,247 rows (2026-10-14): no writer sets it. Unit: hash text. Grain: one thread. Clock: n/a.';

-- ── Envelope and clocks ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.metadata IS
'Discovery envelope written by discover-build-threads: keys is_sticky (sticky on the forum list), discovery_confidence (same value as vehicle_match_confidence) and discovered_at (ISO timestamp of the discovery run), each on all 2,247 rows (2026-10-14). Unit: jsonb object, default {}. Grain: one thread. Clock: discovered_at is the ingest time of discovery.';
COMMENT ON COLUMN public.build_threads.created_at IS
'When the row was inserted. Default now(). 2026-01-29 to 2026-01-30 on all 2,247 rows (2026-10-14). Unit: timestamptz. Grain: one thread. Clock: ingest time, not the thread''s date on the forum.';
COMMENT ON COLUMN public.build_threads.updated_at IS
'When a writer last changed the row; set explicitly by the writers (there is no trigger). Default now(). Latest 2026-01-30 (2026-10-14): nothing has written since. Unit: timestamptz. Grain: one thread. Clock: ingest time of the last write.';

COMMIT;
