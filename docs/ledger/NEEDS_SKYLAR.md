# NEEDS SKYLAR — 7 fast adjudications

Generated 2026-07-12. Everything else in the intent ledger is decided; these need your call. Seed = keep/finish, corpse = archive. One line back per item is enough.

---

## 1. `image_contracts` — drop when the grant mints?
**Q:** The 2026-07-07 grant design (bearer-key, no storefront/DRM) supersedes this storefront-contract schema. Drop the table once the grants table exists?
**Keep:** it's the only written record of the licensing-contract field set (territory, exclusivity, splits, dual signatures) — useful reference while designing the grant.
**Archive:** 0 rows ever, marked DEPRECATED 2026-06-17, design superseded.
**Lean:** hold until grant v1 mints, then drop. Just confirming the auto-drop is authorized at that point.

## 2. Subscriber webhooks — build or strip the promise?
**Q:** webhooks-manage is deployed and openapi.yaml promises webhooks, but webhook_endpoints/webhook_deliveries were never migrated — the feature 404s at the DB layer.
**Keep/finish:** one migration + a delivery worker completes it; the 488-line delivery engine is recoverable from git.
**Archive:** zero external developers today; the agent-first stack (MCP + /v1/events) is the real surface; docs promising vapor is worse than no docs.
**Lean:** strip — delete webhooks-manage, remove from openapi.yaml. Rebuild when a real consumer asks.

## 3. `transfer_staleness_sweep` (cron 189) — reactivate or delete?
**Q:** The ownership-transfer framework is LIVE (ownership_transfers written today), but its staleness sweep cron is inactive and the inbound email/SMS signal path was deleted — milestones only advance from auction events.
**Keep:** live framework deserves its hygiene sweep; reactivation is a flag flip.
**Archive:** if stale-transfer nagging has no consumer, the cron is noise.
**Lean:** reactivate — it guards a table that took 50,778 milestone writes.

## 4. Deal-jacket cron 171 — finish the Viva reconstruction?
**Q:** 931 OCR'd Viva documents sit 98% unlinked; 18 vehicles in the Viva financial sheet have blank cost data this pipeline was built to fill. Reactivate + run the linking pass, or park indefinitely?
**Keep:** stopped by dormancy, not decision; the payoff is real dealership economics; canonical per ledger ("reactivate cron if needed").
**Archive/park:** it's Viva's books, not yours — only worth it if Doug/the family still wants the reconstruction.
**Lean:** finish — the extraction is already paid for (931 docs OCR'd); the last mile is the cheap part.

## 5. Fractional-exchange schema remnants — final archive?
**Q:** vehicle_offerings / share_holdings / market_orders are the REAL (never-launched, 0-row) offerings schema from the genesis-vision half you let go in March. Archive for good?
**Keep:** it's the only artifact of the fractional-shares half of the 2025-01-23 genesis doc.
**Archive:** triage already ruled the product dead; the deal-finder half won; platform-hygiene law says don't rebuild trading. (Treemap stack and custom_investment_contracts are already handled separately — treemap stays live, the $150M demo never resurrects.)
**Lean:** archive. The genesis doc itself is preserved; the empty schema adds nothing.

## 6. IMG_* root photo batch (37 files) — ingested?
**Q:** 37 IMG_* photos sitting in the repo root are user substrate, not repo debris. Confirm they've been ingested through the photo pipeline (or say "not mine / already in Photos"), then they get archived out of the repo.
**Keep:** if any are un-ingested originals, deleting loses evidence.
**Archive:** if they're already in the Mac Photos library / pipeline, the root copies are duplicates.
**Lean:** verify-then-archive — an agent can hash-match against the library first; you only rule on any leftovers.

## 7. Wiring `lifecycle_state` backfill — ordered vs in_hand
**Q:** v2 substrate step 2 is blocked on your call: for parts already receipted, does initial lifecycle_state = `ordered` or `in_hand`? (Plus the standing harness decisions when you're ready: M130 mount side, firewall 8-wire overflow, battery-wake element, DC-primary gauge.)
**Context:** this is the only blocker between the applied v2 step 1 and the workbench going DB-backed.
**Lean:** none — it's your shop floor; whichever matches physical reality on the shelves.
