# Withdraw misplaced purchase evidence through the existing manifest

Change type: `substrate_correction`. Scope: an attributed negative procurement review; no physical wiring or part-selection decision.

The contamination already identified in `K5_WIRING_STATE.md` section3, row0g, and the reference invoice's stated purpose in [appendixC](../chapters/appendix-c-desert-perf.md) remains present in the live device manifest. The original private invoice was re-read; it identifies another vehicle. Its lines can support reference pricing, not this vehicle's acquisition. Source captures, subject identity and byte digest are retained privately; no customer, invoice number, financial amount or email is copied here.

Keep `vehicle_build_manifest` as the device owner and `vehicle_observations` as the sourced review log. The new `purchase_review_observation_id` is the typed witness edge. A service-only writer checks that the live review names the exact same-vehicle device and expected purchase-evidence hash, and that the device has no recorded physical lifecycle or actual cost. It withdraws an invoice-only purchase assertion to `purchased = NULL`, `status = identified`, `evidence_level = assumed`. NULL means unknown; it is not a claim that the item was never bought. The old source and complete before-image stay in the existing owner-only evidence array.

The constructor never changes the part, manufacturer, device interface, physical endpoint, wire, route, stock, price or installation. Wrong-vehicle, superseded, changed-input, physical-build and direct re-promotion paths must fail. Anonymous callers cannot write or read the private audit. Existing public manifest fields expose the corrected unknown state; the new witness edge receives no public column grant.

This is not a new purchase ledger or device model. It implements the case ledger13.12 requirements that another vehicle's testimony cannot become this vehicle's fact, that corrections retain their sources, and that consumers read the database. No owner Sign or engineering/order approval is recorded.

## Unknowns

None for this bounded source-proof withdrawal. Actual acquisition, current device selection/applicability, physical conductor multiplicity and build readiness remain open outcomes. They are not filled by this correction.

## Verification

The native PostgreSQL contract exercises accepted withdrawal, exact retry, retained private before-image, stale/foreign/superseded/malformed review refusal, physical-build refusal, direct-write/re-promotion refusal and private ACLs. Release uses the normal checked PR and CI migration workflow; production correction is a separate canonical API call after its review observation is admitted. Runtime proof must cover the current public manifest response and existing downstream stale signal.
