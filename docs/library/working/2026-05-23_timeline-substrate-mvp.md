# 2026-05-23 — Timeline Substrate MVP

Session built the click-through chain from the GitHub-style heatmap day-square down to the atomic receipt artifact, plus the parts-lifecycle substrate model the user spelled out ("the receipts belong to the day they were created; some parts still aren't installed").

## Substrate moves (database)

| What | Result |
|---|---|
| 50 receipt observations on K5 dated `2026-01-23` (scan-batch artifact, no `transaction_date`) | superseded with new rows whose `observed_at` is derived from the unix-ms filename timestamp; marked `observed_at_confidence='low'` + `observed_at_source='file_upload_timestamp_ms'`; old rows preserved via supersession |
| 127 receipt duplicates on K5 (same file scanned multiple times) | superseded; active receipt count 503 → 377; keeper chosen by `(confidence_score DESC, line_items size DESC, ingested_at ASC)`; none deleted |
| Holley packing slip 766317 (image `4dd5e792-48f5-4f3c-bcbf-5531b39dfb4d`) | manually atom-extracted: 1 shipment `work_record` + 3 part-level `specification` rows (Holley 20-186, 300-129, 534-209) + 4 `observation_witness` rows linking the image. Each part carries `structured_data.lifecycle_status='purchased'` + `lifecycle_note` flagging install evidence as pending. |
| Batch line-item extraction across the 13 receipts with populated `structured_data.line_items` | 6 additional `specification` atoms across 5 parents. Yield was low because most receipt `line_items` have `description='N/N'` (OCR didn't capture parts). Idempotent via `structured_data.line_items_extracted_at` stamp. |
| Total parts in queryable "owned not installed" view | **9** (3 Holley + 6 from batch extract) |
| Install-detection SQL | written to `/tmp/install_detection_k5.sql`, **not yet run** (network was down at session end). Scans `vehicle_images.vision_gate_agent_reasoning` for exact part_number matches → writes `kind='condition'` observations with `lifecycle_status='installed'` + observation_witness links. Idempotent. |

## Click-through chain (UI)

New routes mounted under `/vehicle/:vehicleId/`:

| Route | What it shows |
|---|---|
| `/day/:date` | Full-page view of one day on the timeline. All `vehicle_observations` on that date (not just work_session-aware ones), each click-to-expand showing source artifact image inline (via `optimizeImageUrl` `medium`) + structured_data JSON. Surfaces temporal-layer warnings when `observed_at_confidence='low'`. |
| `/observation/:obsId` | One observation, full detail: kind, source, confidence, timestamps, source artifact image, structured_data table (URLs/images linkified), supersession lineage with prev/next links, related observations from same merchant. `OPEN IMAGE DETAIL →` button when `structured_data.witness_image_id` present. |
| `/inventory` | Parts owned, install evidence pending. Queries `specification` observations with `lifecycle_status='purchased'`. Grouped by vendor; vendor headers link to `/vendor/:slug`; part_number cells link to `/part/:partNumber`. |
| `/vendor/:vendorSlug` | All observations from one vendor on this vehicle. Case-insensitive substring match against `structured_data.{merchant,vendor}`. Grouped by `shipment_number` (preferred) or ISO month. Total-spend rollup when populated. |
| `/vendors` | Vendor directory — count, total $, first/last purchase date per vendor, with PARTS badge when the vendor has at least one specification observation. |
| `/part/:partNumber` | Lifecycle view for one PN. Status badge ("Install evidence on file" vs "Purchased, install pending"). Purchase witness image. Timeline of all observations referencing the PN. |
| `/image/:imageId` | The image as a first-class resource. Renders full-size (via `optimizeImageUrl` `large`), vision_gate badge + reasoning text, metadata, and every observation that witnesses it via `observation_witnesses`. |

## Vehicle-profile integration

- `InventoryWidgetLink` added to `WorkspaceContent.tsx` between AUCTION HISTORY and WIRING HARNESS. Self-guards (returns null when zero) per "No Empty Shells" rule. Currently shows "INVENTORY 9" on K5 with two buttons: `OPEN PARTS INVENTORY →` and `VENDOR DIRECTORY →`.
- `InvestmentLedger.tsx` PARTS ORDERS rows: vendor names now link to `/vendor/:slug` when the vendor name is non-empty + non-generic.
- Existing `BarcodeTimeline` `DayCard` popup now has an `OPEN FULL DAY →` button when `vehicleId` is set, drilling out to `/day/:date`.

## Page-crash fix

`EventForm.tsx` was importing TypeScript types (`EventType`, `EventSchema`, `EventChecklist`) and runtime values (`getEventSchema`, `getEventChecklist`) in a single `import { … }` block. Under strict ESM module resolution Vite couldn't elide the type-only names and threw `SyntaxError: does not provide an export named 'EventChecklist'`, which the Suspense boundary in `AppLayout` lifted up to `AuthErrorBoundary` → whole K5 profile blank. Fixed by splitting:

```ts
import type { EventType, EventSchema, EventChecklist } from '.../eventRegistry';
import { getEventSchema, getEventChecklist } from '.../eventRegistry';
```

## What the substrate model actually expresses now

A receipt observation has THREE temporal facts:
- `purchased_at` — when the vendor printed the receipt (target: `structured_data.transaction_date`)
- `scanned_at` — when the photo of the receipt was taken / ingested (target: `structured_data.observed_at_original` when corrected, else `ingested_at`)
- `installed_at` — when (and if) the part was installed; expressed by a SEPARATE `condition` observation with `lifecycle_status='installed'` that references the same `part_number` and witnesses the install via `observation_witnesses`.

A part's lifecycle status is **derived**, not stored on a single row:
- `purchased` — there's a specification observation, no install observation exists
- `installed` — there's an install-witness observation referencing the same part_number

This means the testimony substrate stays immutable (per `agent-trust-invariants.md`) and the lifecycle view is just a query.

## What's queued (won't fit in this session)

1. **Run install-detection SQL** (`/tmp/install_detection_k5.sql`) when network returns. Yield is likely modest because vision-gate reasoning text tends to mention vendors ("Holley") not exact PNs ("20-186"). Worth running to seed; upgrade pass = re-do K5 photo vision with PN-aware prompting.
2. **Receipt OCR v2** to refill `structured_data.line_items` and `structured_data.transaction_date` on the ~360 receipts where the v1 OCR returned `N/N`/`null`. Without this, the per-part inventory stays at 9 atoms.
3. **Atom-extract at scale**: replicate the Holley canonical pattern across every receipt with parsable line_items once OCR v2 lands. Expected jump from 9 → hundreds.
4. **Edit affordances**: "mark this part as installed (witnessed by image X)" button on the PartPage. Writes a `condition` observation + witness.
5. **Cross-vehicle PN view**: search a PN across the whole platform ("Holley 300-129 used on these 3 vehicles").

## File index for this session

- New routes: `src/pages/vehicle-profile/{DayPage,ObservationPage,InventoryPage,VendorPage,VendorsPage,PartPage,ImagePage,InventoryWidgetLink}.tsx`
- Modified: `src/routes/modules/vehicle/routes.tsx`, `src/pages/vehicle-profile/{DayCard,BarcodeTimeline,WorkspaceContent,InvestmentLedger}.tsx`, `src/components/intake/EventForm/EventForm.tsx`
- SQL artifacts: `/tmp/backfill_2026-01-23_batch.sql`, `/tmp/dedup_receipts.sql`, `/tmp/holley_766317_atoms.sql`, `/tmp/batch_extract_line_items.sql`, `/tmp/install_detection_k5.sql`
