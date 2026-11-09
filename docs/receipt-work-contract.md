# Receipt-to-work reconciliation: column contract

Migration `supabase/migrations/20261111210000_receipt_work_reconciliation.sql` (full revert:
`supabase/sql/revert_20261111210000_receipt_work_reconciliation.sql`; schema rollback of the lifecycle amendment to
74916ea18: `supabase/sql/rollback_20261111210000_lifecycle_to_74916ea18.sql`; contract test:
`supabase/sql/test_receipt_work_reconciliation.sql`). Producer `scripts/receipt-work/reconcile-receipt-work.mjs`; sink
mappers `fromReceiptWorkLine` / `fromReceiptWorkWithdrawal` in `scripts/garage/derivation-evidence.mjs`.
The producer makes no model call; it reads and writes the database over the Supabase REST API (service role).

## Three separate concepts

| Concept | Where it lives | What it is |
|---|---|---|
| **Proposed context** | `evidence.relationship` (`status: proposed`, `kind: receipt_time_context`) | This department's computed proposal: a receipt line and photos share a time window. Never independent corroboration, installation proof, payment proof or an owner Sign (`relationship.not_asserted`). |
| **Document testimony** | `evidence.printed_claims` (`attributed_to: document`) | What the paper prints on the line: `line_date`, `hours`, `performer`, exactly as stored on `receipt_items`, including zero or credit (negative) hours, blank performers and historical dates. A claim attributed to the document, not account identity or labor duration. Missing stays null. Kept whether or not the reader can use it. |
| **Source custody** | `evidence.source_custody`, `evidence.lineage` | Who holds the receipt (`receipts.user_id` as `custodian_user_id`) and where it came from (`source_document_table/id`, page, line, link, cited frames). |

**Ownership testimony** (payer / bill-to as named on the paper, `receipts.card_holder`, `bill_to_name`) is not read or
written here, and nothing here touches vehicle ownership or roles.

Reader eligibility is narrower than testimony: a printed date after tomorrow cannot anchor photos taken after it, so it is
listed in `reader_ineligible` (`{"line_date": "after_today"}`) and is not used as the anchor; it is still returned and
stored as printed. Printed hours or a non-blank performer make a line `labor` regardless of sign.

A receipt and the photos it is matched to share source lineage. When the link itself came from those photos
(`link_basis = 'chronology_session'`), a same-day-photo conclusion gets half confidence.

## Pages

`land_document_pages(p_owner, p_vehicle, p_run, p_docs)` exists on main (migration
`20261109110000_receipt_document_pages.sql`). It is a service-only **writer function, not a page table**: it lands
photographed paper as `vehicle_documents` + `receipts` + `receipt_items` (admitting line `line_date`, `hours`,
`performer`) and keeps the document's page metadata in `receipts.raw_json.document_pages.pages`. The **exact line-to-page
mapping is unresolved**: a `receipt_items` row does not say which page printed it. So `lineage.page` /
`source_custody.page` stay null rather than guessed. A null page means "not mapped", not "no page writer".

## Read (never written)

| Table | Columns |
|---|---|
| `receipt_vehicle_links` | `id, receipt_id, vehicle_id, user_id, status (= 'linked'), retired_at (is null), basis, confidence, page_date, page_date_source` |
| `receipts` | `id, user_id, vendor_name, document_kind, receipt_date, is_superseded (not true), duplicate_of (is null), source_document_table, source_document_id` |
| `receipt_items` | `id, receipt_id, line_number, description, part_number, total_price, line_date, hours, performer` |
| `vehicle_images` | `id, vehicle_id, taken_at, vision_gate_status, is_sensitive, is_duplicate, is_superseded, is_document, redaction_level, vehicle_zone, apple_ml_labels, ai_scan_metadata #>> {classification,v2,angle,value}, ai_scan_metadata #>> {byok_deep_analysis,scene_type}, work_session_id` |
| `work_sessions` | `id, vehicle_id, session_date` |
| `timeline_events` | `id, vehicle_id, event_date` |
| `vehicles` | `id, owner_id, user_id` (fallback user only) |

Frame eligibility is one function, `receipt_work_frame_eligible(vehicle_images)`, used by the reader, by claims and by
answers: EXIF-dated, `vision_gate_status = 'approved'` (personal / misattributed / review frames never), not sensitive,
`redaction_level` none, not duplicate, not superseded, not paperwork, and scene not `product_screenshot`,
`cross_reference`, `receipt_document` or `hand_drawn_diagram`.

## Reader functions (service_role only)

`receipt_work_lines(p_vehicle_id, p_window_days = 90, p_max_images = 8)`: one row per current linked line (a line-less
receipt is one row). Returns `vehicle_id, user_id, receipt_id, item_id, link_id, link_basis, link_confidence,
vendor_name, document_kind, line_number, description, part_number, total_price, line_kind, zone, end_hint, anchor_date,
anchor_source, conclusion, confidence, days_to_first_photo, zone_photos_total, zone_photos_in_window, first_photo_day,
image_ids, day_photos, work_session_ids, timeline_event_ids, judgment_needed, logic_version, relationship_status,
source_document_table, source_document_id, source_page, custodian_user_id, printed_line_date, printed_hours,
printed_performer, reader_ineligible`.

- `line_kind`: `charge | backordered | kit_component | labor | note | part | receipt`.
- `zone`: `engine | dashboard | interior | exterior | wheel | undercarriage | null`; `end_hint`: `front | rear | null`.
- `anchor_source`: `line_date | page_date:<source> | receipt_date | null`.
- `conclusion`: `not_work_evidence | undated_line | work_day_photographed | work_day_unphotographed |
  receipt_day_photographed | receipt_day_unphotographed | part_zone_unknown | install_window_photographed |
  photographed_after_window | no_zone_photo_after_purchase`, plus `source_withdrawn` on retraction rows.

`receipt_work_withdrawals(p_vehicle_id)`: active conclusions whose subject the reader no longer returns, with `reason`:
`line_removed | receipt_removed | receipt_superseded | receipt_duplicate | link_retired | not_returned`.

## Written

### `garage_derivation_evidence` (append-only; existing table), kind `receipt_work_correlation`

Columns written: `kind, vehicle_id, user_id, session_key (anchor date), subject_key (receipt_item:<id> | receipt:<id>),
image_ids, conclusion, conclusion_detail, confidence, rationale, evidence, producer_agent, producer_script,
producer_version (<git sha12>:<script>), run_id, content_hash, dedupe_key, observed_at`; on the prior row
`superseded_at, superseded_by, superseded_reason`.

`evidence` fields: `receipt_id, item_id, link_id, link_basis, link_confidence, vendor_name, document_kind, line_number,
description, part_number, total_price, zone_photos_total, zone_photos_in_window, day_photos, work_session_ids,
timeline_event_ids, logic_version, relationship, printed_claims {attributed_to, source_table, source_id, line_date, hours,
performer}, source_custody {custodian_user_id, source_document_table, source_document_id, page}, lineage {receipt_id,
source_document_table, source_document_id, page, line_number, item_id, link_id, image_ids}, reader_ineligible`. All of it
is in `content_hash`, so a correction to any printed claim re-derives the row.

Lifecycle: unchanged content is skipped; changed content writes a new row and supersedes the prior; a withdrawn subject
gets a signed `source_withdrawn` retraction (`image_ids` empty, `evidence.withdrawn {reason, prior_evidence_id}`) that
supersedes the prior. Vehicles are discovered from active links **and** from active evidence or live questions, so a
vehicle whose last link was retired is still visited. Undo a run with `rollback_garage_derivation_run(run_id, reason,
dry_run)`. It supersedes the run's active rows; rows the run superseded stay superseded (append-only) and are restored by
re-running the producer.

### `evidence_judgment_requests` (new table)

Columns: `id, department ('receipt_work_reconciliation'), question_kind ('receipt_part_visible'), subject_table
('receipt_items'), subject_id, vehicle_id, user_id (non-null on raise), params, answer_schema, priority, status,
trigger_evidence_dedupe_key, producer_agent, producer_script, producer_version, run_id, dedupe_key (unique), question_hash,
created_at, claimed_at, claimed_by, answered_at, answer, answer_agent, answer_model, answer_version, cancelled_at,
cancelled_reason, cancelled_by_run_id, retire_kind, superseded_by, answer_history, lifecycle`.

- **Identity**: `question_hash = sha256(canonical({params, answer_schema}))`; `dedupe_key = sha256(department, question,
  subject, question_hash)`. Changed description, part number, price, printed claims, dates, lineage or candidate frames
  is a new question; it never inherits the old question's answer.
- **`status`**: `pending | claimed | answered | cancelled | withdrawn`. Only `answered` is a usable answer, and it is a
  model's reading of a proposed context (signed `answer_agent/model/version`), never an owner Sign or proof.
- **Transitions**, each appended to `lifecycle` as `{at, from, to, run_id | actor, kind, reason}`:
  - raised → `pending` (`raise_evidence_judgment`)
  - `pending` → `claimed` (`claim_evidence_judgments`; skips ineligible requests; a claim older than 30 min is re-claimable)
  - `claimed` → `answered` (`answer_evidence_judgment`: refuses unless the holder answers, the source and every
    candidate frame are still eligible, and the answer fits the schema)
  - `pending | claimed` → `cancelled`, `answered` → `withdrawn` with the answer kept (`retire_evidence_judgment`,
    `retire_kind`: `content_changed` (`superseded_by` = the new question), `source_withdrawn`, `frame_withdrawn`,
    `not_asked`). The producer retires every live question it no longer asks, including claimed and answered ones.
  - `cancelled` → `pending`, `withdrawn` → `answered`: identical content re-asked while eligible (revive)
  - `answered | withdrawn` → `pending | cancelled`, with the answer moved to `answer_history`
    (`reopen_evidence_judgment_answers`)
- **Eligibility** (`evidence_judgment_ineligibility(id)`, empty = eligible): `receipt_removed`, `receipt_superseded`,
  `receipt_duplicate`, `link_retired`, `line_removed`, `line_changed` (description, part number, price, printed date,
  hours or performer differ from the question), `frame_ineligible:<image id>` (privacy or gate withdrawal included).
- `params`: `question, receipt_item_id, receipt_id, vehicle_id, vendor_name, description, part_number, total_price,
  purchase_date, anchor_source, zone, end_hint, candidate_image_ids, days_to_first_photo, trigger_conclusion,
  logic_version, relationship, printed_claims, source_custody, lineage, reader_ineligible`.
- `answer`: `visible, installed (yes | no | cannot_tell), confidence (0..1), image_id (one of candidate_image_ids;
  required when visible = yes), bbox ([x1,y1,x2,y2], 0..999), quote`. A malformed answer is refused with its problems.
- Undo a producer run: `rollback_evidence_judgment_run(run_id, reason, dry_run)`. Questions it raised are retired;
  questions it retired or revived return to their prior state when that is still their latest transition; others are
  reported `skipped_later_activity`.

## Not touched

Photo pipeline, classifier, photo landing, document OCR and `land_document_pages`, library filing, vehicle
ownership/roles, `receipt_vehicle_links` (read only), privacy-hold rows (never cited).
