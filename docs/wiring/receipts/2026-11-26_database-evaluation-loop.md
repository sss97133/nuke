---
id: 2026-11-26_database-evaluation-loop
change_type: research
scope: database-owned structural evaluation and currentness
case: data-machine-cases 13.12, 13.12.2, 13.12.3
unknowns: []
---

## Outcome and ownership

The owner explicitly authorized the DB-required recursive wiring loop on 2026-11-25, including necessary PostgreSQL tables, keys, edges and folds. The intended activity remains a usable Blazer schematic and correct build/order outputs. This slice establishes the database evaluation owner; it does not establish electrical sizing, physical fit, measured cable cuts or purchasing release.

Existing physical owners remain `harness_segments`, `wire_termination_specs`, `harness_endpoints`, `harness_nets`, `vehicle_custom_circuits` and `catalog_parts`. Their grains and connector segmentation are retained from the 13.12 case ledger and the parent `2026-11-25_harness-schematic-model-reader` receipt. No new source testimony, circuit identity, product identity, stock ledger, scheduler or work queue is created. Canonical source admission and physical-progress-preserving revisions belong to the coordinated material/workspace lane.

## Tables, keys and clocks

`harness_model_evaluations` stores one immutable input/code-bound result for a vehicle. Its input and code JSONB receipts are private; public roles have only named metadata column privileges. Unique `(vehicle_id,input_hash,logic_key)` makes unchanged replay idempotent. Content hashes identify inputs/code, not signatures or engineering approval.

`harness_model_nodes` stores computed electrical junctions. `harness_model_segment_ends` attaches the exact source segment/side/termination to a node through a composite evaluation/node FK. Stored current net plus endpoint/cavity or bus keys establish shared nodes. Separate physical ends and pieces survive shared electrical continuity; connector mates never add cable.

`harness_model_rules` retains versioned native predicate definitions. `harness_model_checks` binds each result to a typed vehicle/circuit/segment/termination subject and that exact rule version. `harness_model_wire_requirements` records one gross plan per selected physical piece, with explicit held/provisional status and feet only for known MIL stock classification. It adds no second route allowance and performs no supplier-pack conversion, stock deduction, receipt or consumption inference. Recorded physical progress from segment measurements/state, parent-circuit state/measurement and retained build events holds new-wire eligibility even before the expanded reader is deployed; a missing build record is not proof that no physical work occurred.

`harness_model_state` is a cursor with source/folded epochs, latest evaluation, check clock and bounded SQLSTATE/backoff metadata. It is not another queue. All result rows are append-only, all center/source IDs are FKs, insert guards reject cross-vehicle sources and unrecorded segment-end attachments, and every new column is described.

## One recursive operating loop

Source triggers retain invalidations for already enrolled harnesses while private/deleted, and visibility return admits them again; only public execution scope enters the worker. Source triggers advance the epoch and signal the existing `model_fold_signal`/`model_fold_work` machinery. The existing `model_fold_tick` notices code changes and eligible retries; its existing `model_fold_one` invokes the domain fold. Existing enable/signals, settle, attempts, vehicle limits, leases and worker budget remain the scheduling controls. There is no new cron or network/model call. Missing or ambiguous MIL catalog identities are dependencies even when no prior exact part FK existed.

The producer captures the source input and code receipts, computes typed outputs, and atomically stores them. Failure rolls back partial results, records SQLSTATE without private exception prose and backs off. A try-advisory lock avoids waiting behind a source writer. Publication uses an epoch and logic-key comparison; an intervening source or code change leaves the new receipt historical. Unchanged inputs reuse the prior receipt. Computed output tables do not signal themselves.

The code receipt includes the canonical reader, its optional `harness_segment_spec_status` dependency, input builder, pure SQL compute, producer, insert guard, public result reader and fingerprint functions, plus active rule definitions and PostgreSQL version. New check helpers must be added to this explicit dependency closure when introduced. A change to the material-status helper invalidates an old result even when its wrapper is unchanged.

`harness_evaluated_model` is an invoker-RLS reader. It returns a model only if source epoch, full selected input fingerprint, logic fingerprint and visible child counts all match. Missing cached rows cannot look like zero failed checks. Private/deleted/unavailable vehicles return unavailable; an anonymous sign-in cannot claim private-owner visibility. Source/input helpers enforce the same condition. Cached private receipts are never read by the public projection.

The selected design excludes superseded source circuits and `in_current_plan=false` retained physical revisions. Those records remain with the canonical physical reader, outside this selection. An explicit property allowlist prevents future raw-reader provenance or metadata extensions from silently entering public evaluation output. The selected content identity has no duplicate `ends` alias, raw whole-graph snapshot key or unrelated route/geometry arrays. Future route and electrical checks must admit their actual inputs and keys before claiming coverage.

## Qualification and coordinated consumers

Twelve structural predicates currently cover circuit physical-piece presence, source-end links, specification agreement, exact wire-stock key, recorded material blockers, new-wire eligibility, positive planned amount/basis, cavity/contact/seal/tool key presence and an explicit engineering-coverage hold. A key-presence pass is not range/fit or tool qualification. Imported legacy check verdicts are not promoted to current proof. `engineering_coverage` always holds this structural-only evaluation.

The workspace lane has acknowledged this persisted check/requirement owner in its shared review. This lane acknowledged the consolidation in `EVALUATION-ACK-20261126.md` in the private coordination folder. The workspace lane retains terminal/splice/shared-component demand, UI, package/stock/allocation and assembly work. Its alternate runtime-check and gross-wire drafts are integration candidates, not parallel release owners. UI migration must consume stored node/end IDs and checks/requirements when the evaluated reader says current; a merely implemented database reader does not establish a useful client schematic.

## Validation and remaining acceptance

`test_harness_model_evaluation.sql` reuses the real reshape/reader fixture and patches minimal boundaries of the independently tested generic worker. It checks two physical wire110 pieces totaling 4.63 planned feet, wire23's recorded conflict, no engineering promotion, atomic/idempotent persistence, immutable results, source-change pending -> worker -> new receipt, no-op writes, code-only recomputation, failed rule rollback/backoff/recovery, retained rule versions, current-design selection under reader extensions, transitive-helper fingerprinting, cross-vehicle/physical-side insert guards, timezone-stable identity, isolated-end continuity, hosted default-privilege producer isolation, private input privileges, private-edit/public-return recovery and former-public withdrawal for anonymous owners and missing cached checks. Physical progress retains its gross plan while holding new stock eligibility.

The focused contract passes in isolated PGlite PostgreSQL17.5. A pinned private combined assay also passes the workspace lane's actual material-revision and expanded-reader contracts together with this migration: current selection excludes retained physical revisions, public/elevated input hashes match, metadata is allowlisted and material-helper semantic changes invalidate the result. Source hashes and logs are retained under `/Users/skylar/nuke-logs/wiring-coordination-20261125/`.

A local pure-SQL cost assay on the retained public Blazer snapshot selected 482 of 669 recorded segments, 916 referenced ends, and produced 708 nodes, 948 valid end attachments, 6,974 named predicate results and 482 gross wire plans in 94ms. This assay supplied referenced catalog identity presence only and measures computation cost; it is not a production fold, complete source visibility/attachment coverage, electrical qualification or buy-list acceptance. Missing attachments remain source/check work. The local native PG17 server is blocked before SQL by sandbox shared-memory restrictions; native CI executes the checked-in contract unchanged.

Before closure: native PR CI and exact-diff review, normal migration deployment, actual scheduled worker admission of the initial Blazer evaluation, anonymous current-result read and representative live schematic/order consumers must be verified. The owner goal also retains sourced electrical sizing/protection, atomic source revision/admission, stock/package reconciliation and physical build outcomes. None is closed by this receipt.
