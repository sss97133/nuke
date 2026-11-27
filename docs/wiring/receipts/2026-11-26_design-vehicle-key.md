---
change_type: substrate_correction
scope: enforce future non-null harness design vehicle references while preserving existing unvalidated history
unknowns: []
---

The live schema resolves endpoint ownership through
`harness_endpoints.design_id -> harness_designs.vehicle_id`, as consumed by the
existing structural reader and component scope guard in migrations
`20261125224228` and `20261126062400`. The design vehicle column is nullable UUID
but has no foreign key to `vehicles`. The live catalog and bounded row audit on
2026-11-27 UTC found an existing unmatched non-null vehicle reference. Its history
is not established; it must remain intact for attributed recovery.

Migration `20261127045333` adds a foreign key over the existing column using
`NOT VALID`. PostgreSQL enforces subsequent non-null assignments without claiming
that legacy rows have been validated. NULL stays unassigned. No row is rewritten,
deleted, assigned a substitute vehicle, or promoted to current engineering data.
The existing source-change trigger, writer, access policies, worker and public
reader remain their canonical owners. No physical specification or harness option
is selected by this correction. Grounding: data-machine case13.12 criteria1,3,4
and5; the exact existing source/reader edges cited above; PostgreSQL17 ALTER TABLE
documentation for `ADD FOREIGN KEY ... NOT VALID`.

The focused native contract runs the exact migration with a pre-existing orphan,
a valid subject and an unassigned subject. It verifies preserved rows and the
unvalidated catalog flag, rejection of new/changed orphan assignments, continued
valid/NULL assignments, protection of a referenced parent, and refusal to claim
successful validation while legacy history is unresolved. These fixtures are
synthetic and live only in a disposable PostgreSQL17 contract database.

This correction closes admission of new broken design vehicle references. It
does not close historical orphan recovery, describe the remaining legacy cached
fields, establish vehicle ownership or public visibility, or complete the
builder's order/cut/assembly workflow. Those remain separate open outcomes. The
empty unknown list applies to this constraint's behavior and deployment only;
there is no automatic validation or legacy-data repair.

Ship through checked PR and normal Supabase deployment. Before DDL, inspect
active queries for both `harness_designs` and referenced `vehicles`, lock waiters
and other deployments. Afterwards verify the exact FK remains unvalidated,
existing row identities are unchanged, new enforcement is active and the current
canonical harness still resolves through its original design and evaluation.
