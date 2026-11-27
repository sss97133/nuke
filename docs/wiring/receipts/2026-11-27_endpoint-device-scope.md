---
change_type: substrate_correction
scope: existing endpoint-to-device link vehicle scope
unknowns: []
---

An endpoint's independent design and manifest foreign keys allow the two parents
to belong to different vehicles. This breaks the device/terminal interpretation
needed by the schematic. The live atlas and trigger inspection found no scope
guard and no populated endpoint-manifest links before this change. The contract
reproduces the cross-vehicle link before applying the production migration.

`harness_endpoints.device_vehicle_id` is a derived common-parent scope key, not a
second vehicle owner. The trigger copies the existing design's vehicle only when
`manifest_device_id` is present; an unlink clears it. A completeness check and
native composite foreign keys to both existing parents enforce the common
vehicle, including concurrent writes and changes to either parent's vehicle.
Native RI triggers use PostgreSQL's normal enforcement; only the user-owned
derivation trigger fires ALWAYS. System trigger alteration is not supported by
the hosted non-superuser migration role.
Existing policies, source-change triggers, device selection and private evidence
remain unchanged. The trigger-only definer has a fixed search path and no API
execution grants, so an authorized endpoint writer needs no extra parent read
permission for the integrity check.

Installation refuses newly populated device links rather than guessing their
source or backfilling them. It adds no device link, rewrites no existing field and
does not classify purchased or installed equipment. The separate invoice
attribution correction and actual device/interface mapping remain necessary.

The disposable PG17 contract uses the actual migration and checks original-row
preservation, same-vehicle insertion/update, cross-vehicle and missing-parent
refusal, unassigned designs, both parent reassignments, caller scope-key forgery,
installation as a non-superuser table owner, default native RI enforcement,
authorized writes without parent read grants, unlink
and existing device-deletion behavior. Normal PR/CI deployment and actual catalog
verification remain required. This integrity repair does not close primary wire
sizing, missing route lengths, material reconciliation or builder acceptance.

The first migration (20261127201511) failed atomically in deployment 46065934164
because it attempted to alter internal RI triggers. Live inspection confirmed no
new column/function and zero waiting locks. It was never applied. This repair
retains that unapplied timestamp as a comment-only tombstone, adds
20261127204956 as a new migration and exercises the actual
migration under a NOSUPERUSER table owner. A superuser deliberately suppressing
native RI enforcement is outside this ordinary-write contract; no platform
permission or replication controls are changed.

The first PR's native job was canceled at its 25-minute GitHub deadline, although
the focused contract passed. Cancellation was incorrectly treated as success in
the merge sequence. The repair gives the unchanged full suite 35 minutes;
individual SQL timeouts, production worker limits and test coverage stay intact.
Exact-head checks must all conclude successfully before checked merge.
