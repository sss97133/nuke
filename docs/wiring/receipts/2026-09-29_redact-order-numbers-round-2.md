---
id: 2026-09-29_redact-order-numbers-round-2
change_type: privacy_redaction
amends: 2026-09-29_redact-order-data
scope: docs/wiring (state doc, catalog, pin table, twin, configs, output, chapters, receipts, research), docs/library contemplation, scripts (one seed script retired), calc-data/fetch_sources.py, regenerated k5_registry.json
found_by: pieces lane (firewall-allocation receipt), lead scan, 2026-09-29
---

# Redaction, round 2: the rest of the owner's order numbers and cart and order totals

The repo is public (AGENTS.md invariant 4). The first pass (`2026-09-29_redact-order-data`) removed 14 marketplace
orders. A scan tonight found five more order numbers in 21 files, and the state doc's cart and order totals, which the
first pass had left for later. One of the order numbers was written by the lead tonight, in state row 0ag.

| Order | Where it appeared | Now |
|---|---|---|
| iBooster, from a salvage yard (2023-11) | catalog, IBOOSTER pin table, fetch_sources, a receipt, the iBooster research | `record obs:a7276b88` (the provenance row in `vehicle_observations`) |
| Delmo 4-bolt throttle-body adapter (2024-10) | state row 0f, a receipt, twin build script, twin dimensions | `record obs:a58db14b` |
| Zero Gravity, PCS TCM-2650 with harness (delivered 2024-09-12) | catalog, state rows 0f, 0g and 0j, three receipts | "the Zero Gravity order", no database record yet |
| Delmo DEL-Stributor (2025-11-03) | state row 0ag, twin HANDOFF and MANIFEST | "the Delmo order of 2025-11-03", no database record yet |
| TurboSquid 3D model (Dec 2024) | twin config, K20 fork plan, landmarks file, two receipts | "bought Dec 2024" (the price is removed) |

- **Masked as `$•••`:** the state doc's cart and order totals (§1 A/C row, rows 0f, 0j, 0k, 0l, 0n, 0x and the file table): the
  2026-09-24 eBay order total, the ProWire, DigiKey and ICT cart totals, the priced tool list, and the order-list total.
- **Not changed:** per-item vendor list prices and public listing ids. Those are market prices, not the owner's
  transactions. Dates and part numbers are also unchanged.
- **Still open:**
  - Three orders have no database record: the Zero Gravity TCM, the Delmo DEL-Stributor and the TurboSquid model.
    Each should become a provenance row through `ingest-observation`, sourced from the owner's Gmail, and the text
    should then cite its id.
  - Git history still holds the original text. Rewriting history is destructive and is the owner's call.

## A customer's contact details and invoice

- **Retired: the roadster consignment seed script in `scripts/` (named after the client).** The one-off script from 2026-02-28 carried a
  consignment client's name, home address, phone and email, plus the owner's payment handle. It had already run: its
  rows are in the database (work order and status history on vehicle 21ee373f, checked 2026-09-29), so nothing is lost.
- **A third party's invoice, the 2019 Desert Performance reference invoice.** The customer's name is replaced with
  "another Desert Performance customer" everywhere it appeared: appendix C, `WIRING_SYSTEM_KNOWLEDGE.md`, the tier
  chapter, state row 0g, the 2026-09-25 receipt, and the agent-must-cite contemplation, which now says "the consignor".
  Its amounts are masked as `$•••` in appendix C, in `WIRING_SYSTEM_KNOWLEDGE.md` and in the supply-chain chapter's
  section. The shop's street address is cut to the city.
- **Left as is:** the invoice number, where it only names the pricing source (the BOM and supply-chain chapters, a
  frontend comment, the QuickBooks bridge script), and the `harness_templates` source value that carries the customer's surname.
  Renaming that is a schema change. The applied migration 20260507180000 also names the customer in a comment;
  applied migrations are not edited.
- **The live database row:** `harness_templates` e3d9c454 is public and serves the customer's name and invoice
  number to a logged-out visitor in `source_reference` (probed 2026-09-29). It is masked by its own migration.

## Unknowns

None for this change. Only wording changes. Every fact stays, cited by its database record where one exists.
