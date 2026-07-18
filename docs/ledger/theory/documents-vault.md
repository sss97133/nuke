# DOCUMENTS & VAULT — theory card

**The model:** A document is evidence, not a record type. Capture → storage bucket → `document_ocr_queue` → `document-ocr-worker` (classify with cheap model → per-type extraction prompt → link entities); extracted fields are measurements carrying provenance `(value, source, method, observed_at, trust)`. Labels ("title", "bill_of_sale", brand=Salvage) are projections of that measurement made at extraction/render time — never new schema columns or new per-doc-type tables. The old "vault" product layer (PWA, attestations, SMS access) is RETIRED (deleted 2026-03-07); today "vault" just means `secure_documents` = sensitive docs only.

**The invariant(s):**
- Paperwork is QUOTED verbatim, never inferred — don't derive relationships from name overlaps on a title (`feedback_paperwork_quote_dont_infer.md`).
- A title photo is acquisition-context evidence: pull the surrounding story, not just the fields (`feedback_title_photos_are_acquisition_context.md`).
- Every extracted number keeps its source DNA; agent writes go through ingest-observation, never raw INSERT into testimony tables.
- Extracted facts land in the DB with citations — never in output/*.md files (`feedback_md_files_are_not_product_substrate.md`).

**Canonical entrypoints** (from CAPABILITY_MAP.md / ledger.json, verdict=CANONICAL):
- Document OCR → `document-ocr-worker` fn + `document_ocr_queue` table (deployed, cron INACTIVE — dormant not dead: reactivate, don't mint)
- Receipt extraction → `receipt-extract` (on disk, NOT deployed — DEPLOY FIRST; its FE callers currently 404)
- Receipt storage → `receipts` (2,430 rows) + `receipt_items`
- Per-vehicle documents → `vehicle_documents` (139 rows, 5 live readers)
- Title scan → `extract-title-data` fn (caller: TitleScan.tsx; returns structured fields, no title table exists)
- Manual page serving → `get-manual-pages` fn
- Reference/manual indexing → `scripts/ingest-service-manual.py` + `scripts/library_ingest_to_db.py` → `service_manual_chunks` (41,941 rows, read by mcp-connector) / `library_documents`
- Sensitive docs → `secure_documents` (43 rows; treat READ-ONLY — its write gate `detect-sensitive-document` is undeployed)

**Do NOT:** resurrect the vault-* fn suite ×5 or create vault_*/vehicle_title_documents/vehicle_manuals/vehicle_manual_links tables (they DO NOT EXIST despite CODEBASE_MAP); call `process-receipt` (deployed orphan, 0 callers); touch `smart-receipt-linker` without first recovering its deleted source from git history (⚠ zombie on a LIVE upload path); write to `documents`, `deal_documents`, or `vehicle_receipts` (dead/never took hold); imitate the deleted OCR fns (ds-extract-document, extract-pdf-text, receipt-photo-ocr…) — `document-ocr-worker` even contains a dangling ds-extract-document call, ignore it; never run a "clean up missing functions" sweep.

**Before you build here:** read the DOCUMENTS rows of `docs/ledger/CAPABILITY_MAP.md` and check `docs/ledger/ledger.json` verdicts — if a capability exists (even dormant/half-built), extend or deploy it; minting a parallel fn/table is the failure mode that produced the graveyard above.
