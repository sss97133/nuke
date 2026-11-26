---
id: 2026-11-26_parts-receiving-stock
change_type: data_model
scope: source-backed direct-unit material receiving and revision-bound stock reservations
case: docs/ledger/theory/data-machine-cases.md 13.12
unknowns: []
---

# Received material has its own evidence and conserved quantity

The owner authorized the order, receive/pull, cut and assemble system and necessary
database owners. This bounded extension distinguishes a witnessed arrival, an
explicit inspection, a reservation and a physical pull. It makes no electrical,
route, length or actual construction decision. Chapter18's DESIGN/HANDS boundary
and case13.12's procurement/build separation apply. No real receipt, job, stock,
inspection, cut or assembly event is seeded by the migration.

The live owner inventory was inspected before minting. `parts_reception` owns
supplier/PO/part receiving records but has no unit, catalog key, immutable source
revision or stock allocation; its `quality_check_passed` default true is not
inspection testimony. `purchase_order_items` owns order lines, `receipt_items`
owns attributed document lines, and `work_order_part_products` owns captured
product links. Neither an ordered quantity nor a receipt line establishes physical
possession. No material lot/allocation owner exists in the bounded live atlas and
metadata search. Exact metadata is retained in
`/Users/skylar/nuke-logs/wiring-build-system-20261125/receiving-stock-owner-read.json`.

The existing `record_inspection_findings` authenticated-only Sign demonstrates
the sanctioned pattern: actor from `auth.uid()`, event clock distinct from database
recording clock, owner-input work_record, explicit role gate. Unsigned owner and
vehicle statements cannot sign receipt or inspection. New receiving operations
use an explicitly nonanonymous authenticated account and never accept an actor
or custodian supplied by service code. Service and anonymous callers cannot sign.

The new typed owners are `parts_reception_lots` and `parts_stock_allocations`.
Lots preserve exact source keys, counted quantity and unit, catalog identity and
event/recording clocks. Arrival and inspected/usable quantities remain separate;
unrecorded inspection is unknown, not zero or a legacy boolean. Direct each/foot
quantities are the bounded first admission. Catalog package claims retain their
version if cited, but unverified package data cannot normalize stock.
The legacy reception edge stays unset: no existing authorized receipt/custodian
path proves that relation. A caller-supplied `reception_id` is refused without
looking up that record. One counted arrival can credit an owned receipt line once;
unreceipted stock and later partial deliveries remain supported-path gaps.

Allocations reserve conserved stock for an exact published evaluation requirement
and physical segment/end/component revision. They do not claim a pull or cut.
Inspection, release and physical pull remain separate attributed events in the
canonical observation log, with typed lot/allocation edges. Lot locks serialize
balance changes; retry keys cannot mint a second receipt or reservation. Source
withdrawal, duplicate source identity, changed catalog identity or target revision
holds affected stock and retains disputed allocation history. No automatic release,
retarget, job choice or current physical completion is inferred.

Late pull reports pin the inspection that existed at their performed time. The
sum of retained physical pulls must fit each contemporaneous acceptance; a later
inspection increase cannot backfill a past shortage. Withdrawal never erases a
pull, frees reserved stock or silently revives an earlier inspection. Re-keying a
cavity cannot reserve the same contact again: conservation follows the canonical
physical owners and contributor ends across evaluation revisions.

`parts_stock_inventory(vehicle, after_id, limit)` supplies paged owner inventory,
including held lots, receipt origin keys, exact reservations and signed pull
choices. It reads the canonical current evaluation once and exposes recorded and
credited releases separately. Empty results mean no recorded lots in this path;
they do not assert absence of unreceipted stock. The existing owned vehicle
receipt-line reader remains the source selector; no parallel receipt owner is
introduced.

The focused PostgreSQL17.5 PGlite contract passes actor/service/anonymous and
ownership negatives, direct units, duplicate-line/retry protection, unknown and
cumulative inspection, separate pull/release, source withdrawal, historical pull
chronology, lot/requirement conservation, a second vehicle and inventory paging.
The pinned actual canonical evaluator chain also passes wire and component
reservation, pull and a recorded-cavity-to-keyed-cavity change without duplicate
reservation. The physical-operation chain passes exact signed-pull binding,
cut-induced current-model invalidation, retained debit and source withdrawal.
Logs are in `/Users/skylar/nuke-logs/wiring-build-system-20261125` and the shared
`wiring-coordination-20261125` directory.

`test_parts_stock_concurrency.sql` adds four native dblink cases: competing
reservations in one lot, competing lots for one physical requirement, pull versus
release, and inspection versus pull. These require independent native sessions;
they are written but have not run in this environment. The existing database
contract CI discovers the file automatically. PGlite is not concurrency evidence.

This slice is implemented and locally tested, not merged, deployed or verified
with an owner's actual receiving activity. Signed-in source selection, receiving,
reservation and pull on the intended product surface remain the acceptance case.
No real receipt, job, count, inspection or physical act was invented for testing.
