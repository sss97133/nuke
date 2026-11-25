---
id: 2026-11-25_harness-schematic-model-reader
change_type: research
scope: read-only physical harness graph projection and database contract
case: data-machine-cases 13.12, 13.12.2, 13.12.3
---

## Intended result

The schematic and physical wire outputs need the existing net, segment, termination and connector-mating keys, rather than an ordering invented from legacy circuit-end text. This change supplies one database read snapshot for those consumers. It creates no new source identities, engineering specifications or installed claims.

## Evidence

Live schema atlas read on 2026-11-25 names `harness_segments` as one physical conductor between terminations, `harness_nets` as electrical continuity, `wire_termination_specs` as design ends, `catalog_parts` as the catalog owner and `harness_evidence` as a field witness edge. Existing connectivity/reshape migrations establish those grains and `harness_endpoints.mates_with_endpoint_id` (case ledger 13.12.2). The 13.12.3 segmentation rule excludes the mating relationship from physical cable stock.

The current workspace reads circuit rows and sorts ends into chains (`map/useWiringMap.ts`, `map/useWorkspaceSelection.ts`, `map/SchematicBlock.tsx`). A live bounded read confirms circuit 23 is 18 AWG, its segment scalar is 20 AWG and its keyed part is M22759/32-18-2. All remain design records, uncut and unmeasured. The parallel workspace audit's wire 110 example is one net and two segments, with separate model plans of 1.09 and 3.54 ft, not a third physical cable between connector halves.

## Contract and boundaries

The reader projects existing IDs and recorded values in one SQL statement under invoker privileges, with explicit vehicle visibility and deleted-vehicle exclusion. It distinguishes physical segment edges from the stored connector-mating relation. It preserves missing endpoints, missing parts and scalar/part/circuit disagreement as qualification states, and does not silently choose a gauge. Current legacy checks have no input fingerprint; a stored PASS therefore does not become a current proof. Field witness edges remain links to their original observation, not newly accepted facts.

The content hash identifies the read snapshot, not a published engineering revision, a fold-run receipt or atomic source admission. Source ingestion, supersession of wrong segment values, check-input binding and publication remain separate repairs. No production source rows are mutated by this change. No free-text purchase, price or receipt fields are added to the projection.

## Acceptance

Database contract: wire 110 has exactly two physical segment edges and one deduplicated connector mating relation; no mating edge contributes cable footage. Wire 23's mismatch is exposed while the recorded source values remain unchanged. A changed end/part/segment changes the snapshot hash. Repeated unchanged reads retain it. Private/deleted/unknown vehicles return no graph for an unauthorized caller. The function is read-only and keeps existing source-table RLS in force.

The existing schematic now reads this projection directly, joins segment ends by termination IDs, groups endpoints by their real IDs and draws exactly one wire edge per physical segment. A stored connector mating is drawn separately and contributes no cable length or inferred cavity continuity. The selected wire's physical pieces and specification disagreements remain visible. Failed or wrong-vehicle reads remove the graph; there is no fallback to sorted legacy ends. Current section membership comes from this same snapshot.

This lane also owns that bounded schematic connection-logic repair and its model adapter. The other workspace session retains broader UI/workflow design ownership. The coordination record explicitly distinguishes this declared boundary from two-way acknowledgement.

## Validation

The unchanged projection was executed as a read-only SQL statement against the live vehicle on 2026-11-25: 554 circuits, 669 segments, 991 referenced ends and one stored connector-mating pair. Wire 110 retained its two 1.09/3.54 ft planned pieces. Wire 23 returned `specification_state=conflict`; the population returned 426 agreeing, one conflicting and 242 incomplete specifications. Agreement describes consistency of these stored fields, not engineering approval.

`CI_ENFORCE=1 scripts/ci/verify.sh` passed. The focused contract and its reused reshape fixture passed on isolated in-memory PostgreSQL 17.5 via PGlite 0.3.14. The local native PG17 runner was prevented from starting by the workspace's SysV shared-memory restriction, before executing SQL. The local PGlite harness adapted only the disposable database-name guard to its fixed `template1` name; the empty-schema and PG17 guards and all assertions remained. Native PG17 CI discovers and executes the checked-in contract unchanged.

Six focused React/graph tests cover shuffled terminations, two pieces plus a mating, selected planned lengths, keyboard/click selection, a gauge/part conflict, a missing end, public concept exclusion, incompatible/wrong-vehicle snapshots and a failed replacement read. Production build and client-secret checks passed. The React best-practices review checked effect cancellation, hook ordering, keyed rendering, memoized layout, lazy data fetch on schematic mount and keyboard selection. Browser acceptance and production deployment must still be verified after merge; the wider schedule/export readers, writer supersession and engineering release remain open.
