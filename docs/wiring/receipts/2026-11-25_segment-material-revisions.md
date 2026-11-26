---
id: 2026-11-25_segment-material-revisions
change_type: data_model
scope: harness_segments material consistency, existing key/resync/conform folds and dependency invalidation
case: docs/ledger/theory/data-machine-cases.md 13.12
---

# Material revisions preserve physical history

The current segment material projection can disagree with its source circuit:
resync moves the circuit key, conform retains a matching hop, and the part fold
updates the catalog key without updating the gauge or colour. The bounded live
audit on 2026-11-25 found one mismatch among 669 current K5 segments: circuit 23
specifies 18 AWG red, its segment says 20 AWG red, and its catalog key names
M22759/32-18-2. This receipt changes projection consistency, not that design.

## Existing owners and evidence

- `harness_segments` is one physical wire between two termination keys;
  `vehicle_custom_circuits` is the design source and `catalog_parts` its material
  key. Existing owners are `key_harness_segments`, `resync_harness_segments` and
  `conform_harness_segments` (case 13.12.3 passes 11, 25 and 30).
- Live definitions and columns were retained read-only on 2026-11-25 and compared
  with the tracked definitions before replacement. Private audit receipts stay
  outside git.
- Case 13.12.1 separates planned design from measured outcomes and requires
  keyed, replayable changes. Chapter 18 sections 1 and 3 distinguish design
  segments from work performed on actual wire. Chapter 16 section 1 describes
  wire specification identity; this repair introduces no new electrical limits.

## Change and boundaries

Resolve the current source revision, exact material tuple and current end pair
for each segment. Supersede an uncut, unmeasured inconsistent projection in one
transaction; retain the old row and its links. A missing or ambiguous catalog
match is unresolved and never retains a stale material key. Preserve unchanged
route provenance and applicable option links; leave material/test observations
on the historical row rather than carrying unsupported evidence forward.

Physical progress causes a persistent, query-derived hold. Neither the loader
folds nor direct material/end changes may rewrite cut or measured wire into a
different design. Dependency changes invalidate conclusions and recompute safe
uncut projections. Public status reads remain security-invoker, vehicle-scoped,
and expose engineering qualification without private witness payloads.

## Acceptance

The focused disposable PostgreSQL contract covers the observed mismatch, a
second vehicle, unmapped and ambiguous catalog replacements, partial successor
admission, physical-progress holds, unchanged route provenance, historical
evidence, repeat-call idempotency and denied visitor mutations/private reads.
No purchase, physical cut, assembly or test is authorized by this consistency
repair. Root owns the consumer and the reviewed release/runtime acceptance.

## Unknowns

None for this bounded projection repair. Engineering, receipt/stock and physical
measurement gaps remain open. Historical HARNESS_RULES.md and RECEIPT_FORMAT.md
are absent from current main; this follows the existing dated receipt format.

## Evidence stage

Implemented with a focused disposable PostgreSQL contract. Static diff checks
pass. Live read-only preflight (2026-11-25 23:45 UTC) found 1 eligible revision
among 669 current segments, 0 physical holds and 0 ambiguous catalog matches;
57 catalog matches are missing, 185 material mappings are unknown, 152 current
end pairs are unresolved and 137 source circuits are not decided. The only
eligible revision is the observed gauge mismatch. These qualifications overlap.
The optimized read-only status query took 243 ms in EXPLAIN ANALYZE; its prior
shape took 4,328 ms. No live fold or write was run.

The focused contract passes on the existing isolated PGlite PostgreSQL 17.5
runtime, including the historical harness contracts it chains. It exercises
changed plug-code topology as well as same-pin successor admission, measured
material retention, two-step progress-erasure rejection and actual anonymous /
authenticated role calls. Native local PostgreSQL initialization is blocked by
the sandbox's shared-memory permission and no Docker daemon is available; the
repository's native PostgreSQL CI remains a release requirement. This lane has
made no commit, push, production write or deployment.
