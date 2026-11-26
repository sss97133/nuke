---
id: 2026-11-25_physical-workspace-ui
change_type: ui
scope: physical harness workspace and matching Excel export
case: docs/ledger/theory/data-machine-cases.md 13.12
---

# Inspect physical pieces through the database reader

The active wiring page will read `harness_schematic_model` once. Tables, linked
record inspection, diagram and Excel use its identical snapshot, segment and termination
IDs. The existing physical owners are described by the companion reader receipt.
Chapter 18 sections 1, 3 and 4 separate circuit function, physical segmentation,
planned allowances and measured wire. The renderer does not infer readiness or
reconstruct wires by sorting connector names.

The working surface offers physical pieces, termination records, connection
points and source circuits. Section and search controls filter those records;
selecting a row opens its actual ends, related pieces, database route membership,
source revision and recorded check applicability. Unknown cavity text is retained
whole. Retained physical revisions remain inspectable. Unbound checks never
become a passing design badge. Catalog identity is distinct from stock evidence.
The expected material reference and source wire specification remain visible
when a catalog key is missing, with the same separate fields in Excel. Exact
circuit-code searches take precedence over substrings; ordinary searches exclude
hidden source text and UUIDs. Explicit record-ID searches remain available.
The piece table defaults to PostgreSQL's `in_current_plan` membership. Design
state is prominent in both table and workbook; alternatives and retained pieces
remain accessible. The issue summary opens all affected pieces, including built
holds outside the current plan. Current-plan membership never means cut-ready.

The real Excel fallback uses the existing application workbook writer, with
native tables, filters, frozen headings, numeric lengths and record hyperlinks.
No static position/route JSON or page-local wire/material derivation is used in
this workspace. The diagram uses shared geometry extracted from PR4032, while
every edge names one returned segment ID. Endpoint mating edges are drawn
separately, with no cable length or tested continuity implied. Raw uncertain
cavity labels wrap visibly. Existing dedicated truck presentation is outside this slice.

Acceptance: two database pieces for one circuit remain two rows and two inspectable
records; retained unknowns and null measurements survive UI/export; missing model
relationships remain visible; failed/wrong-subject reads do not show old data.
Browser acceptance uses the deployed reader and representative real records.

Source inspection uses exact `harness_evidence` row-kind/row-ID edges from the
same read. Circuits are not signals: related net and signal evidence follows the
piece's actual source-circuit ID, net ID and qualified signal ID. A retained piece
is never counted against its proposed successor circuit. Diagram connections
require both the segment and termination to name the same nonnull source circuit.
Links reuse the registered vehicle observation page and its existing
vehicle/observation access checks. The uniform `keyed_evidence_only` projection
withholds source/method/check prose; inspector and Excel omit unavailable prose
fields, retain observed clocks and trust, and qualify missing route basis as not
included in this read. The existing observation page itself withholds raw prose
and artifacts for every viewer pending a trusted privacy-reviewed projection.
The later owner-only source projection is specified and verified separately in
`2026-11-25_owner-evidence-reader.md`. It exposes retained claim and excerpt text
through the existing observation viewer after an explicit database owner check;
public rendering remains unchanged. Original stored document bytes remain a
separate gap; no raw-read or permission bypass is introduced.

The wider ordering, receiving, allocation,
qualified cutting and assembly workflow remains open until its database owners
and writers have been implemented and verified. No physical readiness is claimed.

Status: implemented locally. Focused tests pass across the
workspace, export, shared diagram and existing observation-reader/privacy suites.
Coverage includes existing
schematic contracts, physical piece/mate interactions, unknown labels, sorting,
subject/auth-context invalidation, native Excel roundtrip, exact evidence-link
navigation across all four record kinds, and withheld-source qualification. Production build,
client-secret scan and production React bundle check pass. No changed-file
TypeScript diagnostics; the repository-wide typecheck retains unrelated baseline
errors. Browser acceptance against representative real rows and release evidence
remain with the root integration lane. No design acceptance or release is claimed.
