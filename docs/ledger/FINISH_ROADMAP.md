# FINISH ROADMAP — the treasure map

Generated 2026-07-12. The opposite of a delete list: **only the DELIBERATE-UNFINISHED clusters**, ranked by value × closeness-to-done. These are half-built organs with documented intent, real sunk value, and a finish line that still exists. Full archaeology in `INTENT_LEDGER.md`; per-asset detail in `disposition.json`.

| # | Cluster | Value | Closeness | Deadline pressure |
|---|---------|-------|-----------|-------------------|
| 1 | Hammer prediction | product core (deal system) | hours to first obligation | **2026-07-15 — 3 days** |
| 2 | Image production / shoot layer & grant | second vertical, real client, licensing revenue | days (specimen half-done) | client delivery open |
| 3 | Wiring & parts intelligence | $119.5K paid build → productizable | v2 step 1 of 5 applied | gated on owner calls |
| 4 | Acquisition pipeline | buy-side of the product | schema+data+feeders live | ledger mislabel risk NOW |
| 5 | Deal jackets (Viva reconstruction) | direct financial payoff | linkage last mile | none |
| 6 | Receipts / documents OCR | tax + SEV-1 recovery gate | deploy 4 existing fns | standing SEV-1 plan |
| 7 | Work orders / work_sessions ledger | shop-grade labor value | confirmation pass only | none until next customer |

---

## 1. Hammer prediction — revive, don't mint
**Meant to be:** the deal sniper — predicted BaT hammer bands from comps, bid curves, and the 13.9M-comment corpus; THEORY.md (peer-reviewed 2026-07-09) rules it "DORMANT — revive, don't mint."
**Already built (sunk value):** hammer_predictions 50,534 rows / 31 cols (607 scored); prediction_accuracy calibration quantifying the condition-blind failure (v13 48.2% → v24 33.2% median error); auction_comments 13.9M rows + 62-archetype question taxonomy; score-live-auctions and update-live-sentiment still in repo; bat_listings sold artery alive daily; a fully-specified v1 revive cut in THEORY.md.
**Gap:** score open prediction #1 (89e5fd50, Glendale H1) at maturity **2026-07-15** — verify the score-live-auctions cron or hand-run it; log prediction #2 (Mustang hammer band) BEFORE the Mustang listing goes live; then the amendments: condition features on comps, coverage-scored intervals, censored marking, a weekend of hindcasting. UI/ask-fn deliberately deferred 6 months.
**Worth finishing?** Yes, unambiguous — it is the accepted product plan with a 3-day deadline attached, and the Mustang prediction directly serves the sale that makes money.

## 2. Image production / shoot layer & the grant
**Meant to be:** the commerce layer for a 20-year professional photo archive — shoot as first-class asset, credits as service provenance, monetization as the bearer-key **grant** ("the grant is the product," discourse 2026-07-07). A company pays for the L'Officiel license; this is the machine that lets that happen repeatably.
**Already built:** production_files index of 100,579 real editorial files (26.7k LOFFICIEL, image_identity_id FK seam ready); nuke_production_credits 4,656 rows with a live sanctioned writer; image_identities live and growing (24.3k rows); assets registry live with specimen #1 (Julie Rodrigo shoot, landed 2026-07-07); the full verified theory with prescribed build sequence.
**Gap:** (1) mint the grant — grants table + pull log, the "one legitimate mint"; (2) complete specimen #1 end-to-end: four role edges, twenty deliverables with derivation stubs, one bearer grant, one pull log — a real client is waiting; (3) wire the seam: 0 of 100,579 production_files linked to identities (only 2,289 hashed); (4) settlement path credits → payouts, later.
**Worth finishing?** Yes — it is the platform's second vertical, five days old in intent, with an actual paying-client-shaped request (Julie, "one image per look") as the forcing function.

## 3. Wiring & parts intelligence — "phone in, harness out"
**Meant to be:** the K5's $119,543 client build generalized into an agentic harness-design product; the business line is written in WIRING_SUBSTRATE_V2_SPEC.md (pro's barrier is $60k materials + hand Excel; win the harness, ECU territory behind it is open).
**Already built:** complete v1 file substrate (cut list v4.2: 174 wires/1,143.5 ft; D38999 build sheets; 30 Blender landmarks; 49 decision receipts; canon ch. 16-18); v2 DB substrate step 1 APPLIED (168 circuits, 34 decisions, 10 policy rules, 30 landmarks as rows on the K5 overlay); parity-tested harnessDerivation.ts; 5-view workspace UI with 3D formboard; deployed generator fns (BOM/spec/cut-list/quote).
**Gap:** v2 steps 2-5 — lifecycle_state backfill (**blocked on Skylar's ordered-vs-in_hand call**), workbench reads/writes DB rows instead of URL params, phone observation kinds into ingest-observation, the pin-tracker board. Plus open harness decisions (M130 side, firewall overflow, battery-wake, gauge). Generalization to vehicle #2 unstarted.
**Worth finishing?** Yes — the only cluster where someone already PAID for the output, active protocol files enforce it, and each step is scoped.

## 4. Acquisition pipeline — the buy-side seed
**Meant to be:** discover cheap private-seller listings, market-proof with honest parts+labor economics, advance through contact → inspect → acquire stages with seller intelligence. Cars are survival money; this is the fast-find half of the general deal system.
**Already built:** 6-table schema + stage machine + crons; 864 pipeline entries, 2,308 transitions, 1,563 market-proof reports, 47 cross-posts, 152 seller profiles (one written 2026-07-02 — reuse has already begun); /pipeline dashboard UI; acquire-vehicle deployed; live feeder arteries (marketplace_listings 115,674 current through 2026-07-11; CL queue; local FB scraper fleet).
**Gap:** the stage-advance loop past discovery (8 contacted / 1 inspecting / 0 acquired ever); crons inactive; revival must go through THEORY.md wave-6 rules (condition features, verdict asymmetry, defensible entry prices), not a rerun of the condition-blind Feb loop. **Immediate cheap task: correct CANONICAL_LEDGER's false "0 rows ever" verdicts so no sweep archives real seed data.**
**Worth finishing?** Yes, as part of the Ask-Nuke revival — the substrate is mandated ("revive, never re-derive") and the feeders never stopped.

## 5. Deal jackets — the Viva financial reconstruction
**Meant to be:** decades of physical deal jackets → Dropbox → AI parsing → Viva's actual per-vehicle economics. The payoff is written down: 18 Viva vehicles with blank acquisition/recon costs waiting on extraction (docs/vlva-financial-sheet-oct2023-present.md).
**Already built:** 931 OCR'd document photos in deal_documents (177 titles, 71 cost sheets, 68 receipts...); deal_jackets 26, reconditioning 66, ownership 18; deal-jacket-pipeline deployed and ruled canonical (HALF-BUILT); the Doug/Dropbox workflow guide; the adjacent transfer framework fully live (written today).
**Gap:** the linkage last mile — only 17 of 931 documents linked to any vehicle; the one financially-complete jacket ($3,594.61 gross) points at a ghost vehicle_id; cron 171 inactive; no frontend surface renders jacket data.
**Worth finishing?** Probably — it stopped by dormancy, not decision, and the output is real dollars-and-cents knowledge about the family dealership. Reactivation is a cron flip + a linking pass. Adjudicate cron 171 in NEEDS_SKYLAR.

## 6. Receipts / documents OCR lane
**Meant to be:** receipts and reference documents as vehicle-history substrate with a sensitivity gate at the front door.
**Already built:** receipts 2,430 / receipt_items 327 / line_items 680 (K5 build sheet fully OCR'd — 148 items, clonable for Doug's K20); 916-row OCR queue; document-ocr-worker deployed and answering; four pipeline fns complete in repo (receipt-extract, detect-sensitive-document, parse-reference-document, index-reference-document); 23 wiring reference docs serving the K5 canon.
**Gap:** deploy the four fns (they 404 in prod — every extraction so far was an ad-hoc BYOK sweep); detect-sensitive-document is the mandated gate of the standing SEV-1 recovery plan (~494 de-hosted docs) and literally cannot run; resolve the receipts vs vehicle_receipts schema split; ~2,385 receipts have no line items; no product surface.
**Worth finishing?** Yes for the gate + deploy (an afternoon, unblocks a standing recovery plan); the bulk line-item extraction can stay opportunistic BYOK work.

## 7. Work orders / work_sessions ledger
**Meant to be:** the dual-system shop record — photo-derived forensic labor ledger + customer-facing invoice projection ("Both are valid. Neither replaces the other").
**Already built:** work_sessions 1,899 rows with a live writer in the image drain; confirm_work_session owner-gate (confirm/amend/reject); full invoice engine (resolve_work_order_status RPC + project_customer_invoice MCP tool + editable statement) proven on the Granholm K2500; ShopFinancials.tsx live in Profile.
**Gap:** the owner-confirmation pass — most rows sit at ~0.30 trust and no labor value accrues until confirmed; no bulk-confirm surface exists; labor_estimates never landed output; archive the two superseded traps (work-session fn, generate-work-logs). Billing track needs nothing until a next real customer.
**Worth finishing?** The confirmation surface, yes — it converts 5 months of already-captured evidence into defensible labor value on Skylar's own builds (feeds resale narratives, e.g., the Mustang/K5). The rest waits for a customer.
