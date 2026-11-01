---
id: 2026-10-31_shared-scene-vehicle-binding
change_type: consumer_correction
scope: shared truck viewer identity, read states and URL navigation
amends: PR2852
unknowns: []
---

# Bind the shared scene to its documented vehicle

The fixed K5 scene files must not appear as an unrelated vehicle's model. Their
subject is the canonical build in `K5_WIRING_STATE.md` and
`chapters/appendix-d-k5-build.md`, confirmed by the asset-source receipt
`receipts/2026-10-27_k5-booth-finish.md` (Sources). The older reference identity in
`WIRING_SYSTEM_KNOWLEDGE.md` is superseded by the explicit correction in those
records and `receipts/2026-06-11_k5-doppelganger-reattribution.md`.

The shared route checks that exact binding and reads the vehicle through the
current caller, excluding soft-deleted records, before mounting the scene. Both
position and route manifests must identify that same subject. Missing, failed and pending reads do
not render a plausible K5 scene. A failed read can be retried. Scene URL navigation
reinitializes camera/layers; changes made by scene controls keep the mounted scene.

Acceptance cases: documented subject, unrelated subject, no visible vehicle,
failed vehicle/map reads with retry, and mounted URL navigation including Back.
No geometry, coordinates, model files, licenses, physical wiring decisions or
default layer visibility change. Dimensional accuracy remains a separate open
outcome; this receipt does not certify it.

The rule's named `HARNESS_RULES.md` and `RECEIPT_FORMAT.md` are absent from current
main, the original feature commit and the shared checkout. This receipt follows
the existing dated receipt structure; no missing physical specification is
inferred or required for this read-only subject-binding repair.
