# Retained preview intake

The existing identity-first image writer previously ignored a supplied-review
processing mode. A retained Photos preview could therefore enter ordinary
processing and event grouping before its source, rendition and vehicle filing
had been reviewed. Source discovery alone did not close that gap.

The optional `subscription_review` mode preserves the exact rendition hash,
Photos asset identifier and retained capture clock. It starts with an unfiled
leaf, no photographer assertion and no ordinary pending-processing request.
An independently retained coarse classification and source-bound visual
comparison can then use the existing attribution owner. Supersession pointers,
privacy, source hashes, current classification and anchor vehicle membership
are checked at filing; a date or shop location alone cannot file an image.

The three prerequisite function bodies were compared exactly with production
on 2026-11-15. Deployment guards refuse a changed body rather than overwriting
unknown live behavior. The earlier closed proposal's drift warning was dated
evidence; the fresh comparison matched its expected prior bodies.

Capture, classification, filing, keyed component evidence and receipt/work
reconciliation remain distinct stages. The deferred metadata is not a global
worker veto. A preview is not the original file, a purchased part is not proof
of installation, and a photo after a receipt's retrieval window is not evidence
that the work never happened. Source disposition and consumer readback must
remain visible until each stage completes.

The disposable database contract covers intake, exact replay, concurrent
capture, classification/anchor qualification and concurrent source withdrawal.
It does not establish real-source coverage or deployed consumer acceptance.

The existing `photo-sync-daemon.mjs` accepts
`--reviewed-rendition-plan=/absolute/plan.json --reviewed-receipt=/absolute/receipt.jsonl`.
Use `--dry-run` first. The plan contains at most 25 records in the prepared
identity-first payload shape, plus a byte-bound local privacy review. Every file
is hashed before any upload. The command probes the required writer capability,
reconciles canonical rows before resending, verifies storage after an ambiguous
upload response, and verifies exact source identity after admission. It does not
advance the ordinary sync watermark or mark classification, filing or consumer
acceptance complete. This is a bounded repair entry point, not a new daemon.
