# The Wiring Build, Inside Nuke — Grounded Design

**Date:** 2026-07-12 · Vehicle: 1977 K5 Blazer (e08bf694, Scott client build) · **Status:** design, not yet built
**Source:** design workflow wf_03a67327 (5 grounded layer agents + synth), each reading the real codebase.
**Owner's dream (verbatim):** "use the app to streamline the wiring job and build it."

> **The finding:** ~80% of this is standing prod organs. The work is ~14 *seams*, not a greenfield store. Notably the **purchase spine (`purchase_orders` / `purchase_order_items` / `supplier_accounts`, migration 20260227280000) is fully built and DORMANT — zero consumers.** We awaken it, we don't mint it.

---

## The one idea
The harness is a **projection**, and the **trust tag decides what you can buy.** `deriveHarness()` already reflows the whole harness on every subsystem toggle. Once each endpoint's grounded current + provenance lives on `vehicle_build_manifest`, the BOM, the buy-now/hold split, the sourced parts, the purchase, and the build checklist are all pure reads off that one derivation.

## The arc (each step names the existing organ it rides)
1. **Configure** — `HarnessWorkbench.tsx` + `deriveHarness()` (exists). Toggling AUDIO off *deletes* the amp-feed + speaker wires — the "audio in or out?" punch item becomes a switch.
2. **Grounded BOM** — `generateBOM.ts` re-rooted on `DerivedHarness` (today it reads legacy `OverlayResult` → **2–4× undercount bug**). Every line drills to its wire/endpoint/device and carries a provenance chip.
3. **Trust auto-splits buy-now vs hold** — a pure `splitOrder(harness)` selector: `GROUNDED`+`BOUNDED` (24 endpoints, ~$3,100) → buy-now; `DEVICE_UNKNOWN`+`NEEDS_TRUCK` (14, ~$1,000) → hold. **Nobody sets the split; provenance is the split.**
4. **Source real parts + live price** — `resolve-bom-skus.mjs` + `catalog_parts` (10,853 rows; ProWire's 1,197 M22759 SKUs resolve today). Price = testimony with `price_scraped_at`; >30d greyed, never silently trusted.
5. **Process the purchase** — awaken `purchase_orders`: a `create-purchase-orders` fn promotes approved lines into `work_order_parts` (COGS atoms on Scott's work_order) + one PO per vendor. `order_method` already models `browser|email|manual`. **Deep-link-out + recorded PO — not an in-app checkout** (no vendor has an API).
6. **COGS → Scott's invoice (automatic)** — `project_invoice` / `resolve_work_order_status` already project over `work_order_parts`. Write a part = it's on the invoice.
7. **Receipt reconcile** — forwarded vendor receipt → `receipt-extract` → matches PO on `po_number` → upgrades `unit_price` scraped→**paid-actual**, flips PO to delivered. Margin = bill − receipt cost.
8. **Build on the formboard** — `FormboardCanvas.tsx` BUILD MODE (status = a fill tint on geometry it already routes) + per-wire Build Checklist in `DeviceDetailPanel` whose rows *are* the `wire-closure.schema.json` fields.
9. **Close the loop** — VERIFY captures the measured length → `ingest-observation` (the only write path) → `harnessDerivation` measured-override tightens the BOM footage. **`needs_truck` → `measured_on_vehicle`, trust `projected` → `proven`.** The build is what finally grounds the estimates — Dave's method, instrumented.

## Minimal new pieces (each retires something)
- **ALTER `vehicle_build_manifest`** + `power_draw_amps`/`load_provenance`/`load_source`/`load_observed_at` + one data-load from the 2026-07-12 schedule → **retires the endpoint-schedule MD as substrate.** `deriveHarness` auto-reflows gauge, zero engine change.
- **Re-root `generateBOM` on `DerivedHarness`** + live BOM panel → **retires the OverlayResult undercount path.**
- **Seed the ~30 hand-verified K5 SKUs into `catalog_parts`** + `price_scraped_at` col → **retires the order MD as the store of buyable parts** (supply-side rule: seed the research).
- **`splitOrder()` client selector** → retires the hand-authored buy/hold split.
- **`create-purchase-orders` fn + `PurchaseOrderPanel` tab + seed 7 K5 vendors into `supplier_accounts`** → **awakens dormant `purchase_orders`; demotes `parts_orders` to buyer-checkout.**
- **Reconcile step in `ingest-receipts-as-observations`** (PO match, price upgrade).
- **`ingest-wire-closure` + measured-length override in `harnessDerivation`** → retires the closure JSONs as inert files.
- **Per-wire Build Checklist + formboard status tint** (the only genuinely new UX; attaches to the panel that already opens on wire-select).

## Phased plan (dogfood each phase on the real K5 order)
- **P1 — Place THIS order through the app.** The ~$3,100 buy-now bucket → vendor buy cards → recorded POs on Scott's work_order. *(manifest amps load + generateBOM re-root + catalog seed + splitOrder + create-purchase-orders + panel.)* **Dogfood: actually order the K5 wire + hardware this week through the app.**
- **P2 — Money closes.** Receipts reconcile → prices flip projected→proven → Scott's invoice re-projects with margin.
- **P3 — The held bucket / punch list.** 14 held endpoints render as a "what needs you" list (generalize `DeviceReadiness`); closing one (ID the fans, measure the starter run) flips its wires hold→buy-now and re-sums the budget. **Dogfood: work the real punch list on the truck, then place order 2 (spine + alt).**
- **P4 — Build + close the loop.** Formboard BUILD MODE + per-wire closure → measured observations onto Scott's timeline. **Dogfood: close the 3 already-drafted wire receipts through the app.**

## Honest gaps (where the vision breaks)
- **No vendor has an API.** "Process the purchase" = deep-link-out + recorded PO, pay on the vendor site with the shop card. Chrome-MCP browser-fill (`order_method='browser'`, like bat-submit) is the ceiling. Stripe organs serve AI-credits, not parts.
- **The unresolved PDM channel is a *design* blocker, not missing data** — coil rail has no channel, PDM 30/30 full, E-Stopp mislabeled. No seed fixes this; the channel architecture must resolve first.
- **12 device-unknowns** — gauge/lug/fuse ride on a device ID we don't have. Held until confirmed on the truck.
- **Price staleness** — no Firecrawl refresh loop wired; a >30d price shows "orderable-but-reprice."
- **`receipts.purchase_order` is TEXT, not an FK** — reconciliation is fuzzy matching; a mismatch silently corrupts COGS.
- **No margin convention on `work_order_parts`** (single `unit_price`) — a bill-vs-cost rule must land before P2, or the receipt reconcile erases margin.
- **Two cart lineages** (`parts_orders` vs `purchase_orders`) + two catalogs (`catalog_parts` vs `parts_catalog`) — P1 must pick `purchase_orders`+`catalog_parts` and demote the others or they drift.
