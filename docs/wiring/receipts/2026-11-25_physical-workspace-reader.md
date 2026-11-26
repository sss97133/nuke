---
id: 2026-11-25_physical-workspace-reader
change_type: data_model
scope: database reader and working surface for physical harness records
case: docs/ledger/theory/data-machine-cases.md 13.12
---

# One physical model for the working surface

The existing map reads circuit rows and reconstructs a chain by sorting ends.
Its static placement files are independent of current PostgreSQL routes. The
physical owners already exist: harness_nets, harness_segments,
wire_termination_specs, harness_endpoints, harness_routings,
vehicle_harness_landmarks and harness_topology_nodes. Chapter 18 sections 1 and
3 require distinct physical segments and separate planned and measured lengths.
Case 13.12.1 supplies the representative two-piece, one-net connector example.

The extended security-invoker reader returns these existing keyed rows in one SQL
snapshot. All joins verify the same vehicle, including references into another
public vehicle. Retained physical pieces remain visible when their design is
superseded. Historical checks remain explicitly unbound to current inputs;
recorded PASS does not establish permission to cut or assemble. This reader
neither invents routing nor certifies electrical or physical completion.

The existing wiring_tech_wire_list and get_vehicle_wiring_circuits APIs return
circuit-grain records with incompatible return types. They cannot supply a
physical workspace or be replaced without breaking their existing consumers.
A concurrent lane released harness_schematic_model in PR4032 after the initial
capability search. This migration extends that now-canonical reader and preserves
its schematic contract keys as aliases of the same rows. The full workspace uses
its additional routing, retained-revision and provenance fields. No second
canonical reader or new source table is introduced.

The UI and workbook will use identical segment IDs and snapshot key. A circuit
without physical pieces stays visible as a missing relationship. An endpoint
mate is a declared design relationship, distinct from a wire piece or a passed
continuity test. Route geometry carries its database provenance and currentness.

Acceptance covers two physical pieces and their mate, unchanged repeated
snapshot identity, material changes, retained built revisions, unknown lengths,
private/deleted vehicles and malformed cross-vehicle references. Physical
measurements, stock availability and qualified electrical checks remain explicit
open work. There are no missing engineering decisions for this read-only
plumbing. Historical HARNESS_RULES.md and RECEIPT_FORMAT.md are absent in current
main; this follows the existing receipt format and retained construction canon.

Status: implementation in progress; no release or physical readiness claimed.
