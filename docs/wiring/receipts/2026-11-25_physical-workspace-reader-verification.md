---
id: 2026-11-25_physical-workspace-reader-verification
amends: 2026-11-25_physical-workspace-reader
change_type: data_model
scope: canonical physical reader ownership and consumer verification
case: docs/ledger/theory/data-machine-cases.md 13.12
---

# Preserve each physical owner through the shared reader

The canonical reader extends the existing `harness_schematic_model(uuid)` owner
from PR4032. Chapter 18 sections 1 and 3 and case 13.12.1 distinguish a signal,
its net, separate physical pieces and the declared connector mate. The live
`harness_signals` and `harness_nets.signal_id` keys implement that distinction;
`vehicle_custom_circuits.id` is not a signal ID. The reader must return actual
same-vehicle signal records and match `harness_evidence` by both row kind and
owner key. A signal-kind edge carrying a circuit ID is not valid support.

Retained cut pieces belong to the source revision under which they were built.
Their prospective `current_circuit_id` is a revision target, not an ownership
change. The number of linked physical pieces and the count of circuits without
physical pieces use the actual source circuit ID. Current-plan membership stays
separate from physical linkage and from permission to build.

A physical end is resolved only when its vehicle and source circuit agree with
its segment. Malformed references remain bound into the reader's fingerprint,
but resolve to an explicit missing end; the diagram must not draw them as valid
connections. Cross-vehicle signal references likewise return no foreign record.
Superseded signals remain inspectable when retained nets still reference them.

The shared graph has one engineering payload for visitors and elevated folds.
It returns keyed evidence links, observation clocks and trust, with free-text
source/method fields uniformly omitted. This is an input-contract decision, not
a claim of a demonstrated public saved-snapshot disclosure. Original testimony
remains in its source owner. A separate authorized witness reader is required
for retained excerpts; linked identity alone does not prove source inspection.

The local browser replay uses a read-only projection of real database rows and
the candidate SQL reader. It demonstrated distinct pieces and a declared mate,
planned lengths separate from missing measurements, material-revision blockers,
mobile inspection and an actual Excel download with matching record IDs. The
Excel file has four native tables with filters, frozen headers and numeric
lengths. This is local candidate evidence, not a deployed reader or an approved
order/cut packet. The source circuit check history remains explicitly unbound.

The SQL contract covers owner/nonowner/anonymous/deleted scope, two physical
pieces, wrong-circuit ends, retained source revisions, real signal ownership,
cross-vehicle masking and stable snapshot identity. The focused UI contracts
cover the same linkage and source-visibility distinctions. Required physical
measurements and unresolved engineering decisions remain open; this change
does not invent their answers. There are no new engineering decisions needed
to correct these read contracts.

Status: candidate implementation and local verification; not merged or deployed.
