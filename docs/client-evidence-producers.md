# Client evidence producers (mail intake, timeline, labor)

Code: `scripts/client_evidence/` (Python stdlib only). Tests: `python3 scripts/client_evidence/test_client_evidence.py`
(synthetic fixtures only; runs in `frontend-tests`). All entry points are **dry-run**; none executed against production.

## What exists and what it extends
- **Writer reused, nothing minted.** Mail attachments land through the existing private `financial_evidence_v1` path
  (`ingest-observation` -> `public.ingest_financial_evidence`; cells in `financial_document_extractions`, lines in
  `financial_document_lines`, review concerns in `financial_review_queue`). No new table, function or migration.
  Source-tree vs deployed parity of that writer is not established here; verify before any apply.
- **Not reused:** `process-receipt`, `smart-receipt-linker` (orphaned, non-idempotent, no client/payment model),
  `daily-receipt` 70%-span / minimum-time fallbacks, `mail_attachments.py` (Mail.app internals).

## `mail_manifest.py`
Input: a `client_mail_manifest_v1` export from an authorized read-only connector (no mail credentials here, no labels or
read state touched). Per attachment: Gmail message/thread id, RFC id, part id, SHA-256, a **private** `user-documents/<owner>/…`
reference, and claims with page/line citations. Output: a `client_mail_changeset_v1` with one envelope per unique SHA-256.
- Forwards add origin cells (`origin.N`), never a second document. Composite/component PDFs are declared in `relations`;
  claims sharing an `economic_key` collapse to one economic item with several origins (amounts are never added).
- Four clocks stay separate: sent (`clock_sent_at`), document, service period, ingest (the run clock).
- Claim kinds are distinct: `estimate_quote`, `invoice_claim`, `customer_billed` (revenue candidates), `supplier_cost` (expense
  candidate), `deposit`, `balance`, `payment_request`, `payment_assertion` (no direction). Every cell is
  `claim_unverified, posted:false`; no expense or payment is posted.
- Refusals: credential-like keys, raw body/OCR keys, bank-identifier-shaped strings, non-private bucket, path outside the owner,
  missing hash, timezone-less `sent_at`, more than 100 cells.
- `apply()` requires a backup receipt naming the exact changeset hash and an injected submit function that calls the sanctioned
  writer; replay is deterministic (idempotency key = hash of account, SHA-256, method, version).

## `accounting.py`
Invoice view (gross, discount, net, deposit applied, balance) where a zero balance never erases cost; printed-vs-computed and
component-sum mismatches are flagged, never corrected; cost vs customer charge stay separate ledgers.

## `timeline.py`
Events carry stance (plan / quote / promise / reported_work / reported_completion / status_inquiry / payment_* / visual_observed),
an exact citation (message+attachment+page, or image identity) and producer/run. Time is `interval` or `unknown` unless the
source gives a work/document clock or a trusted capture time; `sent_at` and import timestamps are never a work date.
Re-projection marks old rows superseded (kept) and never deletes.

## `labor.py`
- Rate is configuration (`rate_sources`, with effective dates and a source ref); there is no default rate. A current rate that
  differs from the historical one is flagged.
- Invoice hours are a **source claim** (`verified:false`). Photo sessions need a trusted capture time (`exif_original`,
  `trusted_capture_claim`) and confirmed vehicle identity; personal, misattributed, unresolved, review-needed, privacy-hold,
  inspection, documentation and parts-sourcing frames are excluded. Versioned gap and cap; overlapping windows count once;
  a lone frame adds no time (no minimum, no span fraction); upper bound stays unknown.
- Photo evidence and invoice hours are alternatives and never summed. No eligible frames = `no_evidence` (not zero labor).
  `default_hold` holds estimation when no frame has a trusted capture time.

## Limits
- No timeline or labor write path: those stay changesets until a sanctioned writer for event projections exists.
- Citations on `financial_document_lines` ride in `issues` because the writer's line schema has no page key.
- Parsing of PDF text into claims is the connector/extractor's job; this layer validates and projects cited claims.
