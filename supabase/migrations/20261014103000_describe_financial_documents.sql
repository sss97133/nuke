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

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

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

COMMIT;
