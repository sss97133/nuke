# INTENT LEDGER — the second axis

Generated 2026-07-12. Companion to `CANONICAL_LEDGER.md` / `ledger.json` / `disposition.json`.

**The runtime ledger answers one question: is it alive or dead.** This ledger answers the other one: **was it *meant* to be alive?** Waste and incompletion look identical at runtime — a dark table with 100k rows and a dark table with 0 rows are both "dead" — but one is a half-built organ and the other is a corpse. The disposition of every cluster is the product of the two axes:

| | **Intent: meant-to-be** | **Intent: let go / never deliberated** |
|---|---|---|
| **Runtime: alive** | Canonical (not in this doc) | Zombie — undeploy |
| **Runtime: dark** | **DELIBERATE-UNFINISHED** — protect, finish | **SUPERSEDED / ABANDONED / DEBRIS** — archive |

Fates used here:

- **DELIBERATE-UNFINISHED** — a documented intention with sunk value, stopped mid-build (or parked on purpose). The finish line still exists. These go to `FINISH_ROADMAP.md`.
- **SUPERSEDED** — the *goal* survived; this *implementation* was replaced by a named successor. Safe to archive once dangling callers are stripped.
- **ABANDONED-DEAD-END** — a real, deliberate attempt that Skylar consciously let go (usually in the March-2026 platform triage). Not to be rebuilt without a new decision.
- **GENUINE-DEBRIS** — no intent record at all: ghosts, phantoms, test scaffolds, shell accidents.
- **LIVE-PROTECTED** (member-level) — a live organ trapped inside a dead cluster. **Never archive these with the corpse.**

Cluster verdicts: **7 DELIBERATE-UNFINISHED · 8 SUPERSEDED · 3 ABANDONED-DEAD-END** (all high confidence). Asset-level: 51 protect-and-finish, 11 live-protected, 303 safe-to-archive (108 superseded + 106 abandoned + 89 debris), plus 13 pure-debris groups listed in `disposition.json`.

---

## Corrections this ledger forces on the runtime ledger

1. **CANONICAL_LEDGER's "0 rows ever" verdict on the acquisition-pipeline tables is FALSE.** Direct `count(*)` 2026-07-12: acquisition_pipeline=864, acquisition_stage_log=2,308, market_proof_reports=1,563, pipeline_sellers=8 (one row written 2026-07-02). Any archive sweep acting on the runtime ledger alone would destroy real seed data.
2. **wiring_reference_documents is NOT a 0-row v1 leftover** — it holds 23 rows serving the active K5 wiring canon. The documents-cluster verdict (keep) overrides the wiring-cluster grouping that lumped it with dead v1 tables.
3. **vehicle_image_tags must not be "fixed" by creating the table** — the phantom is still queried by tagService.ts, universal-search, and AnnotoriousImageTagger. The cure is removing the code paths.

---

# I. DELIBERATE-UNFINISHED — protect and finish (7)

## 1. Image production / credits / contracts commerce layer
**The story.** Skylar holds L'Officiel group licenses (his words, session 734cfc5a, 2026-05-03) and a ~20-year professional photo archive; this cluster is its commerce layer. One-shot load 2026-04-14: production_files (100,579 editorial files indexed off his SSDs, 26.7k tagged LOFFICIEL), nuke_production_credits (4,643 email-derived contributor credits), image_contracts (complete licensing schema, 0 rows). It sat dark; a 2026-06-17 audit even marked the empty halves DEPRECATED. Then it was explicitly re-recognized: the June 25-26 identity-spine session revived image_identities as the live ingestion root (24.3k rows, photo-sync daemon) and gave nuke_production_credits a live production writer. On **2026-07-07** the discourse "The Shoot Layer and the Grant" re-founded the whole vision from a real client request (Julie Rodrigo): the shoot as first-class asset, credits as service provenance, monetization as the **grant** (bearer-key outbound licensing — "the grant is the product"). Specimen #1 (the Julie shoot) landed in `assets` the same day. This is the platform's second vertical, mid-build; the contract half was deliberately re-designed (grant, not storefront) and not yet minted.
**Evidence.** DB: production_files=100,579 (all 2026-04-14, 0 linked to image_identity_id); nuke_production_credits=4,656 (13 from the live 2026-06-26 chokepoint); image_contracts=0; image_identities=24,300; assets=1 ('shoot', Julie eyewear editorial, 2026-07-07). Migrations 20260617080000 (deprecate) → 20260625000000/20260625130000 (revive). Docs: CANONICAL_LEDGER.md:333; docs/library/intellectual/discourses/2026-07-07_the-shoot-layer-and-the-grant.md. Sessions 734cfc5a, 42152453, 207ca406 (LOG.md:6056).
**Protected members:** production_files, nuke_production_credits (+ live organs image_identities, assets). **image_contracts** is superseded in design by the grant — hold as schema reference, drop only with owner signoff after the grant mints (→ NEEDS_SKYLAR).

## 2. Hammer prediction + comment/sentiment auction intelligence
**The story.** Wave 5 of the deal system: a BaT hammer-price predictor running for real 2026-02-19 → 2026-04-01 (50,534 hammer_predictions rows, hourly scoring cron), on top of the wave-1 13.9M-row comment corpus. It stopped in the April reprioritization; most edge functions died in the March triage — but the ledger, the calibration record (prediction_accuracy: v13 median error 48.2% → v24 33.2% — it *measured* why condition-blind comps fail), and the corpus survived. On **2026-07-09** the peer-reviewed Ask-Nuke theory ruled it "DORMANT — revive, don't mint." Two live obligations right now: open prediction #1 (row 89e5fd50, Glendale '95 H1) **matures 2026-07-15 — three days away** — and prediction #2 (Mustang hammer band) must be logged before the Mustang listing goes live.
**Evidence.** docs/features/ask-nuke/THEORY.md:236-266; memory deal-system-pickup.md ("do not archive before maturity"); commit 920881304; migration 20260222200000; deletions 34d110a38/f39c14bc6/200581de7/feba5d375. score-live-auctions + update-live-sentiment still in repo. session-search has zero hits on the exact identifiers — documented index blindness, not lack of deliberation.
**Protected members:** hammer_predictions, score-live-auctions, update-live-sentiment, auction_sentiment_timeline, the auction_comments corpus. The 16 deleted wave-5 functions are shed skin (abandoned/debris).

## 3. Deal closing: deal jackets (+ live transfer framework)
**The story.** Three threads. (1) Deal jackets: built 2025-11-02 (Viva import workflow written for Doug), rebuilt 2026-02-14 as deal-jacket-pipeline + forensic-deal-jacket, fed 931 real document photos Feb 2026 — the point is reconstructing Viva's financials (18 vehicles with blank cost data waiting on extraction, docs/vlva-financial-sheet-oct2023-present.md). It stopped by *dormancy*, not decision: cron 171 inactive, and the runtime ledger explicitly protects it (HALF-BUILT, "reactivate cron if needed"). (2) The ds-* suite was **DealerScan, not DocuSign** — a YC-era dealer-OCR product bet, deliberately killed 2026-03-09. (3) The ownership-transfer framework is ALIVE — ownership_transfers (2,821) and transfer_milestones (50,778) written TODAY via the auction-close trigger; only its inbound webhooks were pruned.
**Evidence.** Commits 161543423, b5a9039bf, 6e346eba7, dd1a3916d (DealerScan), deletions 34d110a38/200581de7. DB 2026-07-12: deal_jackets=26, deal_documents=931 (only 17 linked to vehicles), deal_reconditioning=66; crons 171 + 189 inactive; transfer tables max(updated_at)=2026-07-12 14:12Z. ledger.json:444, CAPABILITY_MAP.md:74.
**Protected members:** deal-jacket-pipeline + the deal_* data family (jackets/documents/vehicle_details/ownership/reconditioning). transfer_staleness_sweep needs a reactivate-or-delete ruling (→ NEEDS_SKYLAR). ds_* rows and the DealerScan suite archive with the corpse.

## 4. Acquisition pipeline / deal sourcing (incl. FB lane)
**The story.** The buy-side machine: discover cheap private-seller listings (CL `cto` lane, FB Marketplace lane), market-proof them with honest parts+labor economics, track them through acquisition stages with seller intelligence and cross-post detection. Built in one sprint 2026-02-19→26 and it RAN — 864 pipeline entries, 2,308 stage transitions, 1,563 market-proof reports — then writes stopped 2026-02-27 in the die-off that killed waves 3+5. The substrate is already being *reused*: pipeline_sellers got a fresh row 2026-07-02 (Gullwing broker John Hallenborg, LOG.md:6924), and the feeder arteries (marketplace_listings 115,674 rows through 2026-07-11, craigslist_listing_queue) are live daily. THEORY.md (2026-07-09) declares this domain the product and mandates revive-never-re-derive. The server-side FB orchestrator was superseded by the local residential-IP scraper + fb-scraper skill + launchd fleet; sweep/bot-scraper/message-fb-seller are documented ghosts.
**Evidence.** Direct counts 2026-07-12 (contradicting CANONICAL_LEDGER:396,414 "0 rows ever" — see Corrections). Commits 97875fe9b, 75cc5b951, 329bd43ca; migrations 20260219220000/20260225000010/20260226000002; extraction-playbook.md:2520; dead-code-audit-results.md:165 ("may be reactivated"); AcquisitionPipeline.tsx exists.
**Protected members:** all 6 pipeline tables + market_proof_reports + acquire-vehicle + fb_marketplace_sellers + report-marketplace-sale. FB orchestrator/monitor superseded; three ghosts are debris.

## 5. Wiring & parts intelligence (K5-build spinoff)
**The story.** The most alive thread in the repo: turn the K5's paid client build ($119,543 invoiced) into "phone in, harness out" — an agentic harness-design product with the business line written down in docs/wiring/WIRING_SUBSTRATE_V2_SPEC.md. Born 2025-12-06, schema+sandbox Mar 2026, ran hot Apr–Jun 2026: 49 decision receipts, cut list v4.2 (174 wires/1,143.5 ft), 5-view workspace UI with 3D formboard, competence canon ch. 16-18, and v2 DB-substrate step 1 APPLIED 2026-06-10 (168 circuits, 34 decisions, 10 policy rules, 30 landmarks as rows). The "1 row ever" signal on vehicle_wiring_overlays is by design — one overlay per vehicle, K5 is the pilot. Only the parts-sourcing side-arm (ebay catalog, Holley scraper, 2002ad indexer, AI recommender) was genuinely let go in triage, superseded by the supply-side doctrine ("gap computation is a SQL join, not an AI model").
**Evidence.** WIRING_SUBSTRATE_V2_SPEC.md; K5_WIRING_STATE.md (decisions through 2026-06-19); commits 48e6021f8, 3a59e06f0, 7f911a329, d7129a833, 6538d279e; session 13a6bb90 (v2 ingestion applied); .claude/rules/wiring-*.md auto-load; deletions f39c14bc6/200581de7 (parts arm only).
**Protected members:** compute-wiring-overlay, wiring_decisions/policy_rules, vehicle_wiring_overlays, parts_fitment, generate-wiring-quote/-bom/-harness-spec, extract-bat-parts-brands. Superseded: query-wiring-needs, recommend-parts-for-vehicle, dead v1 wiring tables. Blocked on owner calls: lifecycle_state backfill, M130 mount side, firewall overflow, battery-wake element, gauge choice.

## 6. Documents / vault / receipts OCR
**The story.** Two lineages. The Document Vault (privacy PWA, SMS-unlock) was built Feb 2026 and **deliberately deleted** — the 2026-06-17 strategy session cites it as a learned lesson ("don't build the financial layer on an untrustworthy substrate"); it is a corpse on the DO-NOT-REBUILD list. The receipt/document OCR lane is the opposite: real data, live intent. 793 receipts re-extracted for tax legitimization 2026-05-02; all 45 K5 receipt images OCR'd into 148 line items 2026-05-08 ("a parts list you can clone for Doug's K20"). But every extraction was an ad-hoc BYOK agent sweep — the four surviving pipeline functions (receipt-extract, detect-sensitive-document, parse-reference-document, index-reference-document) are in the repo yet 404 in prod. detect-sensitive-document is the *mandated gate* of the standing SEV-1 recovery plan (re-ingest ~494 de-hosted documents, session cffd5098) and cannot run.
**Evidence.** Commits 7c8da0766, 2cf10c430, 9ab2fd4b7 (vault kill); f39c14bc6/200581de7 (OCR variants). DB: receipts=2,430, receipt_items=327, line_items=680, document_ocr_queue=916 (657 skipped), wiring_reference_documents=23. Prod probe: 4 fns 404, document-ocr-worker 200. Sessions 0632010e, cffd5098, 52b3d5f1; LOG.md:109.
**Protected members:** the four undeployed fns, documents/document_extractions, component_documents, wiring_reference_documents, the receipts data family. Vault members: abandoned, stay dead.

## 7. Work orders / restoration work tracking
**The story.** A two-track shop system, per the written decision record (docs/library/technical/work-order-intelligence.md, 2026-05-24: timeline events = forensic truth, work orders = customer view — "Both are valid. Neither replaces the other"). Track 1 (billing): work_orders + parts/labor/payments populated by real ingestion (Zelle SMS, Gmail receipts) to invoice the Granholm K2500 — parked deliberately when Granholm was dropped 2026-05-07 (PULSE.md:138); data rerouted as build substrate. Track 2 (ledger): work_sessions, 1,899 rows, written continuously through 2026-07-06 by create-work-session-from-evidence inside the image drain, with a confirm_work_session owner-gate (value accrues only on confirm). What stopped was the single customer, not the vision. The intake-bot periphery (sms-work-intake, go-grinder, etc.) was tried, judged, and deleted in triage.
**Evidence.** DB: work_orders=26, parts=83, labor=23, payments=14, work_sessions=1,899 (live 6 days ago), labor_estimates=0. mcp-connector:865-894, 2910; commits 89dcbeb0e, ae30b897c, 50ef3799f; memory feedback_work_story_lives_in_work_sessions_table.md.
**Protected members:** the work_orders family, work_sessions support tables, user_labor_rates, ShopFinancials.tsx. Superseded traps: the `work-session` edge fn (name-trap, zero callers) and generate-work-logs — archive both.

---

# II. SUPERSEDED — goal survived, implementation replaced (8)

## 8. Valuation engine (gen-1)
Gen-1 vehicle pricing (vehicle_valuations, market_indexes, price-analytics/market-spread/outlier fns) from the 2025 deal-intelligence waves; stopped producing early 2026 (market_indexes last row 2026-01-25, vehicle_valuations 2026-03-08); most functions deleted in the March triage. **Successor is alive and hardened:** compute-vehicle-valuation → nuke_estimates (cron every 10 min since 20260227140000) — 774,439 rows, last estimate 2026-07-12 14:12Z, 31,370 in the last 7 days; iOS MARKET ESTIMATE surface (e552c1ece); governed by ask-nuke THEORY.md. **Live organs inside the corpse — do not archive:** clean_vehicle_prices (430K-row MV, the successor's comp source), vehicle_valuation_feed (426K MV), and the record_prices table (507 rows, read at compute-vehicle-valuation:669). Two members are phantoms that never existed (vehicle_valuations_components, vehicle_price_baselines). Cleanup debt: repoint vehicleValuationService.ts/useValuationIntel.ts off vehicle_valuations before archiving.
Evidence: DB counts 2026-07-12; commits 9ab2fd4b7/f39c14bc6/200581de7 (deletions), 96d314837/1c2223c65/c50690fe8 (successor hardening); sessions f3e8748c/f8197fba/c8704157.

## 9. Multi-source scraper/extractor fleet (abandoned variants)
Every new source spawned a new function instead of modifying one ("9 extractors for BaT alone at peak", 464 total — the triage post-mortem's named pathology). The March triage killed hundreds; the canonical lane is ruled in CANONICAL_LEDGER §1: `ingest` → import_queue → process-import-queue → ~17 per-source extractors + extract-vehicle-data-ai fallback, BaT two-step, poll-listing-feeds cron. Everything here is zombie, ghost, or (4 cases) micro-half-built wiring the ledger already marks "fix or strip, don't reimplement": import-classic-auction + extract-specialty-builder (routed but undeployed → queue 404s), collecting-cars-discovery (missing its extractor), scrape-vehicle's broken FE callers. One operational loose end: `fly status -a nuke-ksl-scraper` before deleting the Fly artifacts (billing check).
Evidence: platform-triage-2026-03.md:161-172, 324-335; CANONICAL_LEDGER §1:70-108; triage commits; zero session hits for the crawler/forum-lane ghosts.

## 10. BaT deep-integration variants
Three waves of deep BaT coverage (Feb-2025 scrape-job system; Jan–Feb-2026 crawler/queue lane; Mar-2026 "Perfect Ingestion Pipeline" that completed its one-shot — bat_sold_price propagated to 70,152 vehicles — before its variants were swept). The goals survived: comments live in auction_comments, parsing in _shared/batParser.ts, and the canonical lane runs today (bat-daily-discovery 06:00 + bat-extraction-queue-slow */5 → extract-bat-core + extract-auction-comments). All member tables are 0 rows or dropped. Cleanup debt: BATListingManager/BaTBulkImporter/VehicleProfileContext still call the undeployed complete-bat-import.
Evidence: commits e4ae8c8ed, 582e36757, aa633802a, 1f97ec72c (re-arm diagnosis); live cron table; ledger.json per-member DEAD verdicts.

## 11. VIN decode & vehicle record hygiene
The Dec-2025 "VIN AS SOURCE OF TRUTH" architecture (vin_decoded_data staging + compare/populate SQL) shipped its read paths but the write path never ran — 0 rows, 13k reads of nothing. It was bypassed, not finished: batch-vin-decode (cron every 30 min since 2026-02-27) writes decoded fields directly into vehicles. Repair siblings executed in the W1 purge. Live cost of the debris: a Jun-12 session burned turns querying the empty ghosts. Successors: batch-vin-decode; calculate_vehicle_completion_algorithmic; map-vehicles.
Evidence: d35778744; 20260227140000; 200581de7; CAPABILITY_MAP.md:52-59; session 13a6bb90.

## 12. Legacy vision fleet + photo social/classification
The gen-1 per-image AI fleet (angle/condition/engine-bay/training-export) and Instagram-style photo UX, dismantled deliberately in the triage waves as YONO moved to Modal and the BYOK analysis drain became the live pipeline; the photo-social concept was absorbed into the June-2026 engagement grammar (record_interaction → vehicle_observations spine). Never had users (6 comments, 0 tags/likes; several tables never existed). **Live hazard:** phantom vehicle_image_tags still queried by three live code paths — remove the paths, never create the table. **Preserve:** ai_angle_classifications_audit rows (15,506). **Live organs:** dedup-vehicle-images, validate-vehicle-image.
Evidence: CANONICAL_LEDGER:140,312,336; triage commits incl. 752fdff2a (YONO Modal); sessions c8704157, 42152453; successor image_angle_observations=27,973 rows.

## 13. Org identity graph & seller intelligence
The sprawling Nov-2025–Feb-2026 org apparatus (nodes/edges identity graph, seller enrichment, ECR collection branch) was found disconnected in the 2026-03-25 diagnostic ("63K sellers, 45K unlinked") and deleted in triage; identity_nodes/identity_edges/ecr_collections dropped. The identity *function* survives in a lean live core used daily: **external_identities (573k rows, THE identity graph — never re-mint nodes/edges)** + organizations (5.7k) + organization_vehicles (285k) + the /org UI + /claim-identity flow (real BaT claim landed 2026-06-11). Two micro-half-builts inside: auto-merge-duplicate-orgs (live callers 404 silently — deploy or strip) and generate-org-due-diligence (verify deployment). Caution: api-v1-organizations may have external consumers — do not delete blindly. 27 empty org tables + 6 dead views + prod orphans are shed skin.
Evidence: 5519fe153, 59974e8e4, triage deletions; CANONICAL_LEDGER:251, 267-276; sessions 23512738, 7dcf599f, b672f323.

## 14. Public API & webhooks developer platform
The Feb-2026 "Automotive Data API" push (77KB strategy report, API v1 endpoints, SDK, developer hub, Stripe billing, webhooks) was mostly killed in the March triage, then the vision was **re-founded agent-first in May 2026**: OAuth 2.0 server for the Claude.ai MCP connector, mcp-connector at nuke.ag/mcp, /v1/events with per-VIN scopes, self-serve nk_live_ keys, a live fleet of 16 api-v1-* functions. **The one unfilled shell:** subscriber webhooks — webhooks-manage is deployed and still promised in openapi.yaml, but webhook_endpoints/webhook_deliveries were never migrated (the 2026-06-11 audit lists it MISSING). Build the tables + worker, or strip the promise (→ NEEDS_SKYLAR).
Evidence: NUKE_API_STRATEGY_REPORT.md; openapi.yaml:22-24,369-376; commits 6c0c50b1f/7ce27178d (gen-1), 19c0be0bb/0ea23a98a/462f0fc47 (gen-2); sessions 342b4d7b/4ba5b1a1/23512738.

## 15. Autonomous agent fleet & platform self-operation
The Jan–Feb-2026 edge-function agent fleet (ralph-wiggum-extract, agent-orchestrator, ai-agent-supervisor, autonomous-*) plus the ops-observability layer lost the architecture war: queue work → SQL drain-routines + 18 pg crons; status → db-stats + the ralph coordinator's `{action:'brief'}`; unattended runs → local launchd byok-fleet drivers. Executed in three triage waves whose commit messages call it "abandoned... retired features"; ledger.json stamps every member DEAD with named alternatives. Lone survivor: ralph-wiggum-rlm-extraction-coordinator, repointed and canonical (the CLAUDE.md quick command). agent_* tables are orphaned schema, ≤4 rows.
Evidence: 6bb0aa564 (creation); 34d110a38/f39c14bc6/200581de7 (execution); CANONICAL_LEDGER L146, L153-155, L171; session 52b3d5f1 (zombie deployments).

---

# III. ABANDONED-DEAD-END — deliberately let go (3)

## 16. Fractional exchange / investor product
One half of the genesis vision (the 2025-01-23 "Decentralized Fractional Ownership Marketplace" doc, recovered in session e63df3c8). Genuinely built in a Feb-2026 burst — order-book matching engine, place-market-order, Market Exchange/Fund/Portfolio UX, investor decks, /offering page — and never got a user or a row. The March triage deliberately deleted the trading layer; the Mar-25 "exchange tables restored" commit was mechanical breakage-repair, not revival. **The other half of the same genesis doc — the AI-truck-finder deal system — is what won** (bat_listings/hammer_predictions/ask-nuke). CANONICAL_LEDGER already rules the investor portal retired. **Live organs inside — do not archive:** the treemap stack (treemap-vehicles wrapper, treemap_refresh_all, 9-10 populated mv_treemap_* views, 211k rows — reactivate the dormant refresh cron). custom_investment_contracts is a **fabricated $150M demo — never resurrect as substrate**; investor_offerings never existed. Final archive of the real-but-never-launched offerings schema (vehicle_offerings/share_holdings/market_orders) gets owner signoff (→ NEEDS_SKYLAR).
Evidence: session e63df3c8; commits f29bd01f1→99aece241 (build), 9ab2fd4b7/b4fa118ab/34d110a38/f39c14bc6 (kill), 27dd49d4e (mechanical restore); CANONICAL_LEDGER §11:395-417.

## 17. Purchase flow: bidding, deposits, checkout, shipping
The fall-2025 "buy a vehicle on-platform" marketplace (Stripe deposits + auto-buy; one mega-commit transaction+shipping system projecting "$350+ per transaction"). No transaction ever occurred. The March triage explicitly killed it and the decision is standing law: `.claude/rules/platform-hygiene.md:16-17` — "Deleted Features (DO NOT REBUILD): betting, trading/exchange, vault, concierge/villa, shipping, investor portal." The money tables are dropped. What remains is debris the triage missed: dangling FE organs (BuyVehicleButton, auctionPaymentService, shippingService, vehicleTransactionService, ShippingNotificationManager + consumers) whose backends are gone — runtime-broken, safe to delete — and two deployed-but-dead fns (create-vehicle-transaction-checkout, create-setup-session). **Keep stripe_connect_accounts (1 row)** — it belongs to the live 2026-03-25 deal-flow Connect onboarding. Live money moved elsewhere: Stripe invoice RPC + Connect in deal-flow; actual sales off-platform on BaT.
Evidence: 88c7ddeb7 (build), 9ab2fd4b7/34d110a38/f39c14bc6 (kill), 59974e8e4 (successor); dead-code-audit-results.md:25-38, 179-181; sessions 9127c3d9, 342b4d7b, 23512738.

## 18. Comms / bots / notifications layer
Oct-2025–Feb-2026: every channel tried as a delivery mechanism — Telegram bots, SMS/concierge notifications, Instagram webhooks, X posting, in-app notification center. The triage killed it all and a formal post-mortem studied why: Telegram had an 18.4:1 prompt-to-commit ratio, killed "not because the concept was wrong but because the underlying capabilities were not yet reliable enough"; Vault/Concierge/Villa "never stabilized" (18.7:1); Twitter/Social had 0 commits ever; zero post-triage recurrence ("cleanly killed"). Codified in platform-hygiene.md. Three carve-outs: nuke-data-bot folded into **mcp-connector** (e22702a7d); the concierge domain reborn as the **standalone lofficiel-concierge project** (prod-deployed, LOG 2026-07-01/02); and **gmail-alert-poller / process-alert-email are RETAINED-LIVE** — survived triage into the live data loop, dormant-but-canonical email intake. X posting is manual by design (x-monitor.ts + x-brief.ts + X_POSTS.md).
Evidence: dead-features-autopsy.md; platform-hygiene.md; commits 9ab2fd4b7, 34d110a38, e22702a7d, 08b53d4ff; session f3e8748c.

---

# IV. Pure debris (no archaeology needed)

13 groups of repo-level junk — root status-report corpus, scrape residue, shell accidents, dead dirs, one-off backfill fns, duplicate scripts, superseded FE pages — enumerated in `disposition.json → pure_debris`. One exception held back: the **IMG_\* root photo batch (37 files) is user substrate** — verify pipeline ingestion before archiving (→ NEEDS_SKYLAR).

---

*Next documents: `FINISH_ROADMAP.md` (the 7 shells worth filling, ranked) · `NEEDS_SKYLAR.md` (7 fast adjudications) · `disposition.json` (machine-readable, per-asset).*
