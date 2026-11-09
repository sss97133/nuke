# Receipt-to-work reconciliation: column contract

Migration `supabase/migrations/20261111210000_receipt_work_reconciliation.sql` (revert:
`supabase/sql/revert_20261111210000_receipt_work_reconciliation.sql`, contract test:
`supabase/sql/test_receipt_work_reconciliation.sql`). Producer `scripts/receipt-work/reconcile-receipt-work.mjs`; sink
mapper `fromReceiptWorkLine` in `scripts/garage/derivation-evidence.mjs`. No model or network call: deterministic SQL + JS.

## Semantics

- Every row is a **proposed contextual relationship**: a receipt line (or a line-less receipt) and the vehicle's photos
  that share a time window. `relationship.status = 'proposed'`, `relationship.kind = 'receipt_time_context'`.
- It is **never** independent corroboration, installation proof, payment proof, or an owner Sign
  (`relationship.not_asserted = [independent_corroboration, installation_proof, payment_proof, owner_sign]`).
  A receipt and the photos it is matched to share source lineage; the link itself may come from those photos
  (`link_basis = 'chronology_session'`), and then the same-day-photo conclusion gets half confidence.
- Printed `line_date`, billed `hours` and `performer` are **document-attributed claims** (`claims_attributed_to = 'document'`),
  not account identity or labor duration. Missing stays null. A malformed value is **refused** (listed in
  `refused_fields`, never used), not coerced: dates outside 1900-01-01..today+1; hours not in (0, 1000]; a blank performer
  is missing, not a performer.
- A judgment answer is the answering agent/model's reading of a proposed context, signed with
  `answer_agent/answer_model/answer_version`; it is not an owner Sign either.

## Read (never written)

| Table | Columns |
|---|---|
| `receipt_vehicle_links` | `id, receipt_id, vehicle_id, user_id, status (= 'linked'), retired_at (is null), basis, confidence, page_date, page_date_source` |
| `receipts` | `id, user_id, vendor_name, document_kind, receipt_date, is_superseded (not true), duplicate_of (is null), source_document_table, source_document_id` |
| `receipt_items` | `id, receipt_id, line_number, description, part_number, total_price, line_date, hours, performer` |
| `vehicle_images` | `id, vehicle_id, taken_at (not null; EXIF, UTC day), vision_gate_status (= 'approved'), is_sensitive, is_duplicate, is_superseded, is_document (all not true), vehicle_zone, apple_ml_labels, ai_scan_metadata #>> {classification,v2,angle,value}, ai_scan_metadata #>> {byok_deep_analysis,scene_type} (not product_screenshot / cross_reference / receipt_document / hand_drawn_diagram), work_session_id` |
| `work_sessions` | `id, vehicle_id, session_date` |
| `timeline_events` | `id, vehicle_id, event_date` |
| `vehicles` | `id, owner_id, user_id` (fallback user only) |

Not read: `land_document_pages` (not in the live schema yet). `source_page` / `lineage.page` stay null until receipts carry
a page reference.

## Reader function

`receipt_work_lines(p_vehicle_id uuid, p_window_days int = 90, p_max_images int = 8)`, SECURITY DEFINER, service_role only.
One row per linked line; returns `vehicle_id, user_id, receipt_id, item_id, link_id, link_basis, link_confidence,
vendor_name, document_kind, line_number, description, part_number, total_price, line_kind, zone, end_hint, anchor_date,
anchor_source, conclusion, confidence, days_to_first_photo, zone_photos_total, zone_photos_in_window, first_photo_day,
image_ids, day_photos, work_session_ids, timeline_event_ids, judgment_needed, logic_version, relationship_status,
source_document_table, source_document_id, source_page, refused_fields`.

- `line_kind`: `charge | backordered | kit_component | labor | note | part | receipt` (receipt = line-less receipt).
- `zone`: `engine | dashboard | interior | exterior | wheel | undercarriage | null`; `end_hint`: `front | rear | null`.
- `anchor_source`: `line_date | page_date:<source> | receipt_date | null`.
- `conclusion`: `not_work_evidence | undated_line | work_day_photographed | work_day_unphotographed |
  receipt_day_photographed | receipt_day_unphotographed | part_zone_unknown | install_window_photographed |
  photographed_after_window | no_zone_photo_after_purchase`.
- `confidence` = link confidence (default 0.7) x conclusion factor (x 0.5 for a chronology-made link on a same-day-photo
  conclusion). `logic_version = 'receipt_work_lines/20261111210000'`.

## Written

### `garage_derivation_evidence` (append-only; existing table)

Kind `receipt_work_correlation` (added to `garage_derivation_evidence_kind_check`). Columns written:
`kind, vehicle_id, user_id, session_key (anchor date), subject_key (receipt_item:<id> | receipt:<id>), image_ids,
conclusion, conclusion_detail {line_kind, zone, end_hint, anchor_date, anchor_source, days_to_first_photo, first_photo_day,
judgment_needed}, confidence, rationale, evidence, producer_agent, producer_script, producer_version (<git sha12>:<script>),
run_id, content_hash, dedupe_key, observed_at`; on re-derivation the prior row's `superseded_at, superseded_by,
superseded_reason`.

`evidence` lineage fields: `receipt_id, item_id, link_id, link_basis, link_confidence, vendor_name, document_kind,
line_number, description, part_number, total_price, zone_photos_total, zone_photos_in_window, day_photos,
work_session_ids, timeline_event_ids, logic_version, relationship {status, kind, claims_attributed_to, not_asserted},
lineage {receipt_id, source_document_table, source_document_id, page, line_number, item_id, link_id, image_ids},
refused_fields`.

Undo a run: `rollback_garage_derivation_run(run_id, reason, dry_run)` (supersedes the run's active rows; rows it had
superseded stay superseded and are restored by re-running the producer).

### `evidence_judgment_requests` (new table)

`id, department ('receipt_work_reconciliation'), question_kind ('receipt_part_visible'), subject_table ('receipt_items'),
subject_id, vehicle_id, user_id, params, answer_schema, priority (line price, 0..10000), status, trigger_evidence_dedupe_key,
producer_agent, producer_script, producer_version, run_id, dedupe_key (unique; subject + sorted candidate frames + logic
version + semantics version, no run id), created_at, claimed_at, claimed_by, answered_at, answer, answer_agent,
answer_model, answer_version, cancelled_at, cancelled_reason, cancelled_by_run_id, answer_history`.

- `status`: `pending | claimed | answered | cancelled`.
- `params`: `question, receipt_item_id, receipt_id, vehicle_id, vendor_name, description, part_number, total_price,
  purchase_date, zone, end_hint, candidate_image_ids, days_to_first_photo, trigger_conclusion, logic_version,
  relationship, lineage, refused_fields`.
- `answer` (validated by `evidence_judgment_answer_problems`): `visible, installed (yes | no | cannot_tell), confidence
  (0..1), image_id (one of candidate_image_ids; required when visible = yes), bbox ([x1,y1,x2,y2], 0..999), quote`.
  A malformed answer is refused with the list of problems.
- Raised only for `install_window_photographed` and `photographed_after_window` lines with candidate frames.
- A re-run cancels pending requests it no longer raises (`cancelled_by_run_id` = that run).

Functions (service_role only): `claim_evidence_judgments(department, question_kind, limit, claimed_by, stale_minutes = 30)`,
`answer_evidence_judgment(id, claimed_by, answer, answer_agent, answer_model, answer_version)`,
`reopen_evidence_judgment_answers(answer_version, reason, dry_run)` (prior answers kept in `answer_history`),
`rollback_evidence_judgment_run(run_id, reason, dry_run)` (cancels the run's open requests and re-opens requests the run
cancelled as stale).

## Not touched

Photo pipeline, classifier, photo landing, document OCR, library filing, vehicle ownership/roles, `receipt_vehicle_links`
(read only), privacy-hold rows (never cited: only `vision_gate_status = 'approved'`, non-sensitive frames).
