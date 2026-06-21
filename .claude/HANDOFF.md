# Handoff — Assembled 2026-06-18 06:09:05

*Auto-assembled from per-agent handoff files. Most recent first.*

---
# Session Handoff — 2026-06-18_06-09-05 (agent 98225)

## What Was Happening
FB MARKETPLACE DEAL CATCHER — freshness is the open problem. CONTEXT: Skylar furious that fast-lane sends months-old, off-lane listings; he only wants SICK DEALS detected within SECONDS of listing (best deals = found in first 60s, e.g. his Porsches). The product is the GENERAL fast-find/value-understanding/surface-to-users engine; his flips are the proving ground (see memory feedback_sick_deal_and_money_respect + docs/products/DEAL_FLOW_ACQUISITION_ENGINE.md + the_oracle.md). DONE this session: scripts/fb-fast-lane.mjs rewritten — dropped year-tiers+CREAMPUFF keyword firehose, gate is now the LANE array (mirrors fb-watchlist-scraper.ts WATCHLIST); primed baseline so quiet. THE METRIC Skylar wants: (now - listing creation_time) -> ~0. BLOCKER: the working headless feed (CATEGORY_FEED, doc_id 33269364996041474) has NO creation_time and no newest-sort. Authed/newest-first feed reverse-engineering FAILED headlessly and TRIPPED FB BOT WALL (repeated 400 len-1542) using his cookies -> STOPPED to protect his FB account. DO NOT resume rapid headless authed probing. Cookie path WORKS: scripts/export-chrome-cookies.py via ~/.local/venvs/fbcookies (c_user+xs present). NEXT ACTION: capture FB's real newest-first marketplace GraphQL request via Chrome MCP (needs facebook.com ALLOWED in Chrome extension — was permission-denied earlier; Skylar must flip that toggle once). Grab doc_id + sort enum + creation_time field, then replicate headlessly on tight cadence with a real-age freshness gate. Existing infra to reuse: monitor-fb-marketplace, fb-marketplace-orchestrator, FB import tables (20260201000001_facebook_marketplace_import.sql).

## Branch
feat/cohort-terminal

## Recent Commits (last 3h)
none

## Uncommitted Changes
.claude/HANDOFF.md
.claude/rules/frontend.md
.gitignore
DONE.md
TOOLS.md
docs/content/X_POSTS.md
docs/library/intellectual/contemplations/README.md
docs/library/intellectual/studies/README.md
docs/library/intellectual/theoreticals/README.md
docs/library/reference/dictionary/README.md
docs/library/reference/dictionary/tables.md
docs/library/reference/encyclopedia/README.md
docs/library/technical/design-book/README.md
docs/library/technical/engineering-manual/05-image-pipeline.md
docs/products/DEAL_FLOW_ACQUISITION_ENGINE.md
docs/wiring/chapters/05-build-manifest.md
docs/wiring/chapters/appendix-d-k5-build.md
docs/wiring/output/K5_S2_P1_ignition_coils.svg
docs/wiring/output/K5_S2_P2_fuel_injectors.svg
docs/wiring/output/K5_S2_P3_engine_sensors.svg
docs/wiring/output/K5_S2_engine_schematic_v2_p2.svg
docs/wiring/output/K5_bom.txt
docs/wiring/output/K5_coil_mapping.md
docs/wiring/output/K5_connector_schedule.txt
docs/wiring/output/K5_cut_list.txt
docs/wiring/output/K5_cut_list_v2.txt
docs/wiring/output/K5_engine_bay_ls3_overlay.svg
docs/wiring/output/K5_engine_bay_ls3_standalone.svg
docs/wiring/output/K5_harness_build_sheets.md
docs/wiring/output/K5_harness_build_sheets_v2.md
docs/wiring/output/K5_section2_engine_ls3.svg
docs/wiring/output/K5_shopping_list.md
docs/wiring/output/K5_wire_cost_analysis.md
docs/wiring/output/K5_wire_routing_guide.md
docs/wiring/output/K5_wire_spec_and_costs.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/ComprehensiveWorkOrderReceipt.tsx
nuke_frontend/src/components/auction/ExternalAuctionLiveBanner.tsx
nuke_frontend/src/components/auction/VehicleAuctionQuickStartCard.tsx
nuke_frontend/src/components/debug/DatabaseDiagnostic.tsx
nuke_frontend/src/components/deck/useDeckData.ts
nuke_frontend/src/components/garage/GarageTab.tsx
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/organization/DataRoomGate.tsx
nuke_frontend/src/components/organization/OrganizationInventory.tsx
nuke_frontend/src/components/organization/VehicleRelationshipVerification.tsx
nuke_frontend/src/components/vehicle/VehicleReferenceLibrary.tsx
nuke_frontend/src/components/wiring/HarnessView3D.tsx
nuke_frontend/src/hooks/useVehiclesDashboard.ts
nuke_frontend/src/lib/imageOptimizer.ts
nuke_frontend/src/pages/AdminDashboard.tsx
nuke_frontend/src/pages/CreateOrganization.tsx
nuke_frontend/src/pages/ExtractionReview.tsx
nuke_frontend/src/pages/SellDashboard.tsx
nuke_frontend/src/pages/WiringPlan.tsx
nuke_frontend/src/pages/journal/JournalPage.tsx
nuke_frontend/src/pages/showcase/VehicleShowcase.tsx
nuke_frontend/src/pages/vehicle-profile/DayCard.tsx
nuke_frontend/src/pages/vehicle-profile/InventoryWidgetLink.tsx
nuke_frontend/src/pages/vehicle-profile/InvestmentLedger.tsx
nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSaleSettings.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSubHeader.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/routes/modules/vehicle/routes.tsx
nuke_frontend/src/services/dashboardService.ts
nuke_frontend/src/services/listingExportService.ts
nuke_frontend/src/services/myAuctionsService.ts
nuke_frontend/src/services/unifiedImageImportService.ts
nuke_frontend/src/services/vehicleDiscoveryService.ts
nuke_frontend/vite.config.ts
package.json
scripts/daily-receipt/rebuild-worth-days.sh
scripts/fb-watchlist-scraper.ts
scripts/imessage-vehicle-sync.mjs
scripts/iphoto-intake.mjs
scripts/nuke-photo-drop.mjs
scripts/scheduled/nightly-regression.sh
scripts/scrape-prowire-catalog.js
scripts/work-photos-intake.mjs
supabase/functions/_shared/observationWriter.ts
supabase/functions/api-v1-vehicle-history/index.ts
supabase/functions/create-work-session-from-evidence/index.ts
supabase/functions/generate-listing-package/index.ts
supabase/functions/import-fb-marketplace/index.ts
supabase/functions/ingest-observation/index.ts
supabase/functions/link-document-entities/index.ts
supabase/functions/photo-pipeline-orchestrator/index.ts
supabase/functions/refine-fb-listing/index.ts

## Staged
none

---
# Session Handoff — 2026-06-17_21-14-00 (agent 2840)

## What Was Happening
Session 8414823f (BaT autofill -> deliberation engine -> session-knowledge index). Long session, two bodies of work, both landed.

A) DELIBERATION ENGINE (P1-P5) — built, deployed, PROVEN on '66 Mustang 83f6f033:
 - P1 attribute-registry: added vehicle.title_status/title_state/zip/owned_time (+ temporal flag; current_color/exterior_color/condition_cues/sale_disposition marked present_state).
 - P2 link-document-entities: emits projection_event atoms on title/ownership decode (N/A-sentinel guarded). DEPLOYED; live-trigger never run (gated: writing to non-Skylar vehicles blocked; Mustang has no title image in storage).
 - P3 generate-listing-package: DERIVES title_status/zip/owned_time/exterior_color via internal synthesize_attribute call w/ flat-column fallback; emits field_provenance. Proven (synthesis-only confidence 0.285).
 - P4 field_provenance frozen into listing_exports.metadata.job (channelAdapters.ts).
 - P5 mcp-connector synthesize_attribute: recency-weights present_state attrs by EVIDENCE-CAPTURE time (evidence_ref.image_ids->vehicle_images.taken_at, half-life 365d). PROVEN flip: turquoise teardown(2022)=0.059 vs black(recent)=0.456 -> color-now=black. Timeless attrs untouched.
 - Bugs fixed: V8-fabrication, structured-color, evidence_ref-column-read, N/A-as-lien. Smoke 5/5.

B) SESSION-KNOWLEDGE INDEX (retrieval, not training) — built+wired+verified:
 - ~/bin/build-session-index.py -> ~/.claude/session-index.db (SQLite FTS5, 5132 sessions/107K msgs/215MB, 8s rebuild).
 - ~/bin/session-search 'topic' = cited passages; --list = table-of-contents.
 - Wired consult-first: reference_session_search_index.md + MEMORY.md READ-FIRST + global ~/.claude/CLAUDE.md harness line. USE IT before re-deriving.
 - Vault: ~/session-vault/sessions-snapshot-2026-06-17.tar.gz (5.3GB+sha256), single-disk, OFFSITE PENDING.

NOT DONE / NEXT (all gated on Skylar, none on design):
 1. Mustang never actually submitted to BaT — allow bringatrailer.com in Claude-in-Chrome extension, then run bat-submit skill.
 2. NONE of the sell/submit UI is in the iOS app (apps/nuke-capture-ios) — web+engine only. The in-app Submit/Sell + tap-to-sign surface is the real next build per Skylar.
 3. Offsite copy of session vault (external drive or cloud) — he must pick destination.
 4. P2 live-trigger needs a Skylar-owned title in storage. key-access/consignment UX unbuilt. Widen channels needs forms captured.
Manual vehicles.zip_code/title_status/purchase_date on Mustang now redundant (consumer derives).

## Branch
feat/cohort-terminal

## Recent Commits (last 3h)
e1d5b901c worth-proof: vehicle parts ledger — the documented-investment floor, projected from photos
3e2221294 worth-proof: derive equipment from photo TESTIMONY (per the applied-ontology canon)
119717af0 docs: author the 4 cockpit theory docs that live code cited but didn't exist (Phase 7.4)
78eed8dfe image-ecosystem Tier-1 (parallel agents): wire built pieces, schedule promoter, deprecate dead tables
57fd2f592 worth-proof: claimed_metrics — the C7 owner-correction path (last missing checklist item)
f923636bb worth-proof: align labor-minutes to Skylar's documented v3 formula (not my reinvention)
efa22abdd worth-proof: attribute cascade to canonical user-linked Skylar (entity hygiene)
a199b239e worth-proof: wire cascade_technician_evidence into the cron (no more one-shots)
016480be6 worth-proof: connect the photo corpus to the BUILT technician_worth_proof (not rebuild)
5ce49d360 feat(cohort): year-make-model cohort terminal — subject, RPCs, web, search

## Uncommitted Changes
.claude/HANDOFF.md
.claude/rules/frontend.md
.gitignore
DONE.md
TOOLS.md
docs/content/X_POSTS.md
docs/library/intellectual/contemplations/README.md
docs/library/intellectual/studies/README.md
docs/library/intellectual/theoreticals/README.md
docs/library/reference/dictionary/README.md
docs/library/reference/dictionary/tables.md
docs/library/reference/encyclopedia/README.md
docs/library/technical/design-book/README.md
docs/library/technical/engineering-manual/05-image-pipeline.md
docs/products/DEAL_FLOW_ACQUISITION_ENGINE.md
docs/wiring/chapters/05-build-manifest.md
docs/wiring/chapters/appendix-d-k5-build.md
docs/wiring/output/K5_S2_P1_ignition_coils.svg
docs/wiring/output/K5_S2_P2_fuel_injectors.svg
docs/wiring/output/K5_S2_P3_engine_sensors.svg
docs/wiring/output/K5_S2_engine_schematic_v2_p2.svg
docs/wiring/output/K5_bom.txt
docs/wiring/output/K5_coil_mapping.md
docs/wiring/output/K5_connector_schedule.txt
docs/wiring/output/K5_cut_list.txt
docs/wiring/output/K5_cut_list_v2.txt
docs/wiring/output/K5_engine_bay_ls3_overlay.svg
docs/wiring/output/K5_engine_bay_ls3_standalone.svg
docs/wiring/output/K5_harness_build_sheets.md
docs/wiring/output/K5_harness_build_sheets_v2.md
docs/wiring/output/K5_section2_engine_ls3.svg
docs/wiring/output/K5_shopping_list.md
docs/wiring/output/K5_wire_cost_analysis.md
docs/wiring/output/K5_wire_routing_guide.md
docs/wiring/output/K5_wire_spec_and_costs.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/ComprehensiveWorkOrderReceipt.tsx
nuke_frontend/src/components/auction/ExternalAuctionLiveBanner.tsx
nuke_frontend/src/components/auction/VehicleAuctionQuickStartCard.tsx
nuke_frontend/src/components/debug/DatabaseDiagnostic.tsx
nuke_frontend/src/components/deck/useDeckData.ts
nuke_frontend/src/components/garage/GarageTab.tsx
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/organization/DataRoomGate.tsx
nuke_frontend/src/components/organization/OrganizationInventory.tsx
nuke_frontend/src/components/organization/VehicleRelationshipVerification.tsx
nuke_frontend/src/components/vehicle/VehicleReferenceLibrary.tsx
nuke_frontend/src/components/wiring/HarnessView3D.tsx
nuke_frontend/src/hooks/useVehiclesDashboard.ts
nuke_frontend/src/lib/imageOptimizer.ts
nuke_frontend/src/pages/AdminDashboard.tsx
nuke_frontend/src/pages/CreateOrganization.tsx
nuke_frontend/src/pages/ExtractionReview.tsx
nuke_frontend/src/pages/SellDashboard.tsx
nuke_frontend/src/pages/WiringPlan.tsx
nuke_frontend/src/pages/journal/JournalPage.tsx
nuke_frontend/src/pages/showcase/VehicleShowcase.tsx
nuke_frontend/src/pages/vehicle-profile/DayCard.tsx
nuke_frontend/src/pages/vehicle-profile/InventoryWidgetLink.tsx
nuke_frontend/src/pages/vehicle-profile/InvestmentLedger.tsx
nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSaleSettings.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSubHeader.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/routes/modules/vehicle/routes.tsx
nuke_frontend/src/services/dashboardService.ts
nuke_frontend/src/services/listingExportService.ts
nuke_frontend/src/services/myAuctionsService.ts
nuke_frontend/src/services/unifiedImageImportService.ts
nuke_frontend/src/services/vehicleDiscoveryService.ts
nuke_frontend/vite.config.ts
package.json
scripts/daily-receipt/rebuild-worth-days.sh
scripts/fb-watchlist-scraper.ts
scripts/imessage-vehicle-sync.mjs
scripts/iphoto-intake.mjs
scripts/nuke-photo-drop.mjs
scripts/scheduled/nightly-regression.sh
scripts/scrape-prowire-catalog.js
scripts/work-photos-intake.mjs
supabase/functions/_shared/observationWriter.ts
supabase/functions/api-v1-vehicle-history/index.ts
supabase/functions/create-work-session-from-evidence/index.ts
supabase/functions/generate-listing-package/index.ts
supabase/functions/import-fb-marketplace/index.ts
supabase/functions/ingest-observation/index.ts
supabase/functions/link-document-entities/index.ts
supabase/functions/photo-pipeline-orchestrator/index.ts
supabase/functions/refine-fb-listing/index.ts

## Staged
none

---
# Session Handoff — 2026-06-17_18-21-17 (agent 77110)

## What Was Happening
BaT submission / deliberation engine session. BUILT+DEPLOYED+PROVEN: full P1-P5 deliberation loop — (P1) registered vehicle.title_status/title_state/zip/owned_time in attribute-registry; (P2) link-document-entities now emits projection_event atoms on title/ownership decode (with N/A-sentinel guard) — DEPLOYED but live-trigger never run (gated: writing to non-Skylar vehicles blocked by classifier; Mustang has no title image in storage); (P3) generate-listing-package DERIVES fields via internal synthesize_attribute call w/ flat-column fallback + emits field_provenance; (P4) field_provenance frozen into listing_exports.metadata.job; (P5) mcp-connector synthesize_attribute now recency-weights present_state attrs (current_color/exterior_color/condition_cues/sale_disposition) by EVIDENCE-CAPTURE time (evidence_ref.image_ids->vehicle_images.taken_at, half-life 365d) — timeless attrs untouched. Proven on Mustang 83f6f033: color-now flips turquoise(2022,0.059)->black(0.456). Also: BaT agent_pilot adapter mapToBatSubmission in channelAdapters.ts + .claude/skills/bat-submit + web ChannelSwitchboard human-keys checklist. 4 bugs fixed (V8-fabrication, structured-color, evidence_ref-column-read, N/A-as-lien). Smoke 5/5. NOT DONE / NEXT: (1) Mustang never submitted to BaT — gated on user allowing bringatrailer.com in Claude-in-Chrome extension, then run bat-submit skill; (2) NONE of this is in the iOS app (apps/nuke-capture-ios / worktree foundation-ios) — web+engine only — the in-app Submit/Sell surface + tap-to-sign human-keys is the real next build per Skylar; (3) key-access/consignment grant UX unbuilt (schema exists); (4) widen to Cars&Bids/Hagerty needs their forms captured. Manual vehicles.zip_code/title_status/purchase_date on the Mustang are now redundant (consumer derives).

## Branch
feat/cohort-terminal

## Recent Commits (last 3h)
5ce49d360 feat(cohort): year-make-model cohort terminal — subject, RPCs, web, search
c3faf6d17 worth-proof: zero stale phantom sessions + fleet re-derivation sweep
8b9da3fbb worth-proof: true labor-minutes via temporal burst clustering (kill span inflation)

## Uncommitted Changes
.claude/HANDOFF.md
.claude/rules/frontend.md
.gitignore
DONE.md
TOOLS.md
docs/content/X_POSTS.md
docs/library/intellectual/contemplations/README.md
docs/library/intellectual/studies/README.md
docs/library/intellectual/theoreticals/README.md
docs/library/reference/dictionary/README.md
docs/library/reference/dictionary/tables.md
docs/library/reference/encyclopedia/README.md
docs/library/technical/design-book/README.md
docs/library/technical/engineering-manual/05-image-pipeline.md
docs/products/DEAL_FLOW_ACQUISITION_ENGINE.md
docs/wiring/chapters/05-build-manifest.md
docs/wiring/chapters/appendix-d-k5-build.md
docs/wiring/output/K5_S2_P1_ignition_coils.svg
docs/wiring/output/K5_S2_P2_fuel_injectors.svg
docs/wiring/output/K5_S2_P3_engine_sensors.svg
docs/wiring/output/K5_S2_engine_schematic_v2_p2.svg
docs/wiring/output/K5_bom.txt
docs/wiring/output/K5_coil_mapping.md
docs/wiring/output/K5_connector_schedule.txt
docs/wiring/output/K5_cut_list.txt
docs/wiring/output/K5_cut_list_v2.txt
docs/wiring/output/K5_engine_bay_ls3_overlay.svg
docs/wiring/output/K5_engine_bay_ls3_standalone.svg
docs/wiring/output/K5_harness_build_sheets.md
docs/wiring/output/K5_harness_build_sheets_v2.md
docs/wiring/output/K5_section2_engine_ls3.svg
docs/wiring/output/K5_shopping_list.md
docs/wiring/output/K5_wire_cost_analysis.md
docs/wiring/output/K5_wire_routing_guide.md
docs/wiring/output/K5_wire_spec_and_costs.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/ComprehensiveWorkOrderReceipt.tsx
nuke_frontend/src/components/auction/ExternalAuctionLiveBanner.tsx
nuke_frontend/src/components/auction/VehicleAuctionQuickStartCard.tsx
nuke_frontend/src/components/debug/DatabaseDiagnostic.tsx
nuke_frontend/src/components/deck/useDeckData.ts
nuke_frontend/src/components/garage/GarageTab.tsx
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/organization/DataRoomGate.tsx
nuke_frontend/src/components/organization/OrganizationInventory.tsx
nuke_frontend/src/components/organization/VehicleRelationshipVerification.tsx
nuke_frontend/src/components/vehicle/VehicleReferenceLibrary.tsx
nuke_frontend/src/components/wiring/HarnessView3D.tsx
nuke_frontend/src/hooks/useVehiclesDashboard.ts
nuke_frontend/src/lib/imageOptimizer.ts
nuke_frontend/src/pages/AdminDashboard.tsx
nuke_frontend/src/pages/CreateOrganization.tsx
nuke_frontend/src/pages/ExtractionReview.tsx
nuke_frontend/src/pages/SellDashboard.tsx
nuke_frontend/src/pages/WiringPlan.tsx
nuke_frontend/src/pages/journal/JournalPage.tsx
nuke_frontend/src/pages/showcase/VehicleShowcase.tsx
nuke_frontend/src/pages/vehicle-profile/DayCard.tsx
nuke_frontend/src/pages/vehicle-profile/InventoryWidgetLink.tsx
nuke_frontend/src/pages/vehicle-profile/InvestmentLedger.tsx
nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSaleSettings.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSubHeader.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/routes/modules/vehicle/routes.tsx
nuke_frontend/src/services/dashboardService.ts
nuke_frontend/src/services/listingExportService.ts
nuke_frontend/src/services/myAuctionsService.ts
nuke_frontend/src/services/unifiedImageImportService.ts
nuke_frontend/src/services/vehicleDiscoveryService.ts
nuke_frontend/vite.config.ts
package.json
scripts/daily-receipt/rebuild-worth-days.sh
scripts/fb-watchlist-scraper.ts
scripts/imessage-vehicle-sync.mjs
scripts/iphoto-intake.mjs
scripts/nuke-photo-drop.mjs
scripts/scheduled/nightly-regression.sh
scripts/scrape-prowire-catalog.js
scripts/work-photos-intake.mjs
supabase/functions/_shared/observationWriter.ts
supabase/functions/api-v1-vehicle-history/index.ts
supabase/functions/create-work-session-from-evidence/index.ts
supabase/functions/generate-listing-package/index.ts
supabase/functions/import-fb-marketplace/index.ts
supabase/functions/ingest-observation/index.ts
supabase/functions/link-document-entities/index.ts
supabase/functions/photo-pipeline-orchestrator/index.ts
supabase/functions/refine-fb-listing/index.ts

## Staged
none

---
# Session Handoff — 2026-06-17_18-18-35 (agent 76299)

## What Was Happening
SESSION: white-label/modes R&D -> polymorphic-entity keystone. 

LIVE ON PROD (all additive, no testimony touched, no synthetic data): keystone steps 1-5 — (1) vehicle_observations.subject_type/subject_id [mig 20260617000000], (2) ingest-observation accepts optional subject [index.ts + _shared/observationWriter.ts, deployed via CLI; conditional spread = vehicle path byte-identical; non-vehicle skips gapFill/fieldEvidence], (3) 'activity' kind [mig ...000100; pre-confirmation action, promoted to work_record on intent confirm], (4) organization_contributors verification_method/verified_by/verified_at/claim_evidence [mig ...000200; existing roles=self_claimed], (5) projection gate canProject() in src/entity/entityProof.ts gating resolveBrand + activateBrand.

BUILT, GREEN (tsc+build), NOT DEPLOYED, UNCOMMITTED (web): nuke_frontend/src/branding/* (engine, ModeSwitcher, ModeAutoController schedule+geofence, BrandingContext), src/entity/{entityProof,EntityProofPanel}.ts, BrandStudio page (/brand-studio), 'Modes' in UserDropdown. Driven by ?brand= + localStorage.

VERIFIED real data: Viva (viva-las-vegas-autos, 3 work_orders) = WEARABLE; Desert Performance/FBM/Hot Kiss/Taylor/Epstein = refused. Skylar 8 roles all self_claimed.

DOCS: engineering-manual/20-polymorphic-subject-build-guide.md (all 5 steps marked applied), contemplations/the-illegible-asset.md, dictionary/tables.md, working/dad-test-white-label.md.

NEXT (need Skylar): (a) dad-test = deploy frontend (publish, his call) -> nuke.ag/?brand=org:viva-las-vegas-autos works now that Viva passes gate; (b) iOS app has NONE of this (native Swift) — real frontier = Focus Filters + alternate app icons; (c) 4b proof_of_work role auto-verify BLOCKED: work_orders.lead_actor_id -> separate actors entity, no user link, map actor<->user first; (d) step2 e2e non-vehicle write validates when real org writer exists. FLAG: photo-pipeline-orchestrator recurring 500s (unrelated, pre-existing). Nothing committed (per rule).

## Branch
feat/cohort-terminal

## Recent Commits (last 3h)
b0bf37ff7 worth-proof: fleet labor-minute correction $33,887 -> $7,067 (kill ~$27K phantom)
c3faf6d17 worth-proof: zero stale phantom sessions + fleet re-derivation sweep
8b9da3fbb worth-proof: true labor-minutes via temporal burst clustering (kill span inflation)

## Uncommitted Changes
.claude/HANDOFF.md
.claude/rules/frontend.md
.gitignore
DONE.md
TOOLS.md
docs/content/X_POSTS.md
docs/library/intellectual/contemplations/README.md
docs/library/intellectual/studies/README.md
docs/library/intellectual/theoreticals/README.md
docs/library/reference/dictionary/README.md
docs/library/reference/dictionary/tables.md
docs/library/reference/encyclopedia/README.md
docs/library/technical/design-book/README.md
docs/library/technical/engineering-manual/05-image-pipeline.md
docs/products/DEAL_FLOW_ACQUISITION_ENGINE.md
docs/wiring/chapters/05-build-manifest.md
docs/wiring/chapters/appendix-d-k5-build.md
docs/wiring/output/K5_S2_P1_ignition_coils.svg
docs/wiring/output/K5_S2_P2_fuel_injectors.svg
docs/wiring/output/K5_S2_P3_engine_sensors.svg
docs/wiring/output/K5_S2_engine_schematic_v2_p2.svg
docs/wiring/output/K5_bom.txt
docs/wiring/output/K5_coil_mapping.md
docs/wiring/output/K5_connector_schedule.txt
docs/wiring/output/K5_cut_list.txt
docs/wiring/output/K5_cut_list_v2.txt
docs/wiring/output/K5_engine_bay_ls3_overlay.svg
docs/wiring/output/K5_engine_bay_ls3_standalone.svg
docs/wiring/output/K5_harness_build_sheets.md
docs/wiring/output/K5_harness_build_sheets_v2.md
docs/wiring/output/K5_section2_engine_ls3.svg
docs/wiring/output/K5_shopping_list.md
docs/wiring/output/K5_wire_cost_analysis.md
docs/wiring/output/K5_wire_routing_guide.md
docs/wiring/output/K5_wire_spec_and_costs.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/ComprehensiveWorkOrderReceipt.tsx
nuke_frontend/src/components/auction/ExternalAuctionLiveBanner.tsx
nuke_frontend/src/components/auction/VehicleAuctionQuickStartCard.tsx
nuke_frontend/src/components/debug/DatabaseDiagnostic.tsx
nuke_frontend/src/components/deck/useDeckData.ts
nuke_frontend/src/components/garage/GarageTab.tsx
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/organization/DataRoomGate.tsx
nuke_frontend/src/components/organization/OrganizationInventory.tsx
nuke_frontend/src/components/organization/VehicleRelationshipVerification.tsx
nuke_frontend/src/components/vehicle/VehicleReferenceLibrary.tsx
nuke_frontend/src/components/wiring/HarnessView3D.tsx
nuke_frontend/src/hooks/useVehiclesDashboard.ts
nuke_frontend/src/lib/imageOptimizer.ts
nuke_frontend/src/pages/AdminDashboard.tsx
nuke_frontend/src/pages/CreateOrganization.tsx
nuke_frontend/src/pages/ExtractionReview.tsx
nuke_frontend/src/pages/SellDashboard.tsx
nuke_frontend/src/pages/WiringPlan.tsx
nuke_frontend/src/pages/journal/JournalPage.tsx
nuke_frontend/src/pages/showcase/VehicleShowcase.tsx
nuke_frontend/src/pages/vehicle-profile/DayCard.tsx
nuke_frontend/src/pages/vehicle-profile/InventoryWidgetLink.tsx
nuke_frontend/src/pages/vehicle-profile/InvestmentLedger.tsx
nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSaleSettings.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSubHeader.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/routes/modules/vehicle/routes.tsx
nuke_frontend/src/services/dashboardService.ts
nuke_frontend/src/services/listingExportService.ts
nuke_frontend/src/services/myAuctionsService.ts
nuke_frontend/src/services/unifiedImageImportService.ts
nuke_frontend/src/services/vehicleDiscoveryService.ts
nuke_frontend/vite.config.ts
package.json
scripts/daily-receipt/rebuild-worth-days.sh
scripts/fb-watchlist-scraper.ts
scripts/imessage-vehicle-sync.mjs
scripts/iphoto-intake.mjs
scripts/nuke-photo-drop.mjs
scripts/scheduled/nightly-regression.sh
scripts/scrape-prowire-catalog.js
scripts/work-photos-intake.mjs
supabase/functions/_shared/observationWriter.ts
supabase/functions/api-v1-vehicle-history/index.ts
supabase/functions/create-work-session-from-evidence/index.ts
supabase/functions/generate-listing-package/index.ts
supabase/functions/import-fb-marketplace/index.ts
supabase/functions/ingest-observation/index.ts
supabase/functions/link-document-entities/index.ts
supabase/functions/photo-pipeline-orchestrator/index.ts
supabase/functions/refine-fb-listing/index.ts

## Staged
none

---
# Session Handoff — 2026-06-17_11-51-05 (agent 26040)

## What Was Happening
IMAGE-ECOSYSTEM near-complete. SHIPPED+VERIFIED: P1(W3+coverage+fleet-driver+brief), P4(W2 image_observations writer+backfill, engine 5%→51%), P6(findings card+timeline illumination), P7.1(propose_attribute MCP tool — vocab growth, was 0/52), P8.1(get_image_ecosystem_status standing dashboard). 9 commits on fix/image-attribution-gate-filter (latest 30d68650). Migrations 20260617000000/010000/020000/030000/040000. STATUS CALL: select get_image_ecosystem_status() → 80 veh/seen 8745(49.7%)/placed 9080(51.6%)/clip climbing/gate_backlog 11568. BACKGROUND running: fleet cron (42+ vehicles, self-advancing) + CLIP embed nohup (with_clip→560+ toward 16K). OWNER-GATED (need Skylar, cardinal rules): P2.3 gate-approver (evidence-less frames held review_needed); P5 cascade arms 3-5 = entity-resolution(orgs->services->observations) + labor/value owner-confirm ( rule) — NOT wiring; the next owner decision that unblocks P5 is the entity-resolution approach. REMAINING SAFE-LOWER-VALUE: P7.2 api-v1-events unknown-property→pending_claims (general property loop, tangential to images); P7.3 expose SQL project_attribute via MCP; P8.2 mark ~45 empty image tables deprecated (DROP=owner); P1.3 stuck-processing reap (batched, no longer pollutes canonical metric). GOTCHAS: psql single quoted connstring; bash3.2 no mapfile; per-vehicle queries only; statement_timeout<=120s; schema_proposals status must be 'open' not 'pending', proposal_type needs add_image_attribute.

## Branch
fix/image-attribution-gate-filter

## Recent Commits (last 3h)
30d68650c Phase 8.1: get_image_ecosystem_status() — standing observability surface
a45c0e63d Phase 7.1: propose_attribute MCP tool — close the knowledge-growth loop
99a5c7f40 docs: Phase 5 finding — cascade arms are entity resolution + owner-gated, not wiring

## Uncommitted Changes
.claude/HANDOFF.md
.claude/rules/frontend.md
.gitignore
DONE.md
TOOLS.md
docs/content/X_POSTS.md
docs/library/intellectual/contemplations/README.md
docs/library/intellectual/studies/README.md
docs/library/intellectual/theoreticals/README.md
docs/library/reference/dictionary/README.md
docs/library/reference/dictionary/tables.md
docs/library/reference/encyclopedia/README.md
docs/library/technical/design-book/README.md
docs/library/technical/engineering-manual/05-image-pipeline.md
docs/products/DEAL_FLOW_ACQUISITION_ENGINE.md
docs/wiring/chapters/05-build-manifest.md
docs/wiring/chapters/appendix-d-k5-build.md
docs/wiring/output/K5_S2_P1_ignition_coils.svg
docs/wiring/output/K5_S2_P2_fuel_injectors.svg
docs/wiring/output/K5_S2_P3_engine_sensors.svg
docs/wiring/output/K5_S2_engine_schematic_v2_p2.svg
docs/wiring/output/K5_bom.txt
docs/wiring/output/K5_coil_mapping.md
docs/wiring/output/K5_connector_schedule.txt
docs/wiring/output/K5_cut_list.txt
docs/wiring/output/K5_cut_list_v2.txt
docs/wiring/output/K5_engine_bay_ls3_overlay.svg
docs/wiring/output/K5_engine_bay_ls3_standalone.svg
docs/wiring/output/K5_harness_build_sheets.md
docs/wiring/output/K5_harness_build_sheets_v2.md
docs/wiring/output/K5_section2_engine_ls3.svg
docs/wiring/output/K5_shopping_list.md
docs/wiring/output/K5_wire_cost_analysis.md
docs/wiring/output/K5_wire_routing_guide.md
docs/wiring/output/K5_wire_spec_and_costs.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/ComprehensiveWorkOrderReceipt.tsx
nuke_frontend/src/components/auction/ExternalAuctionLiveBanner.tsx
nuke_frontend/src/components/auction/VehicleAuctionQuickStartCard.tsx
nuke_frontend/src/components/debug/DatabaseDiagnostic.tsx
nuke_frontend/src/components/deck/useDeckData.ts
nuke_frontend/src/components/garage/GarageTab.tsx
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/organization/DataRoomGate.tsx
nuke_frontend/src/components/organization/OrganizationInventory.tsx
nuke_frontend/src/components/organization/VehicleRelationshipVerification.tsx
nuke_frontend/src/components/vehicle/VehicleReferenceLibrary.tsx
nuke_frontend/src/components/wiring/HarnessView3D.tsx
nuke_frontend/src/hooks/useSearchPage.ts
nuke_frontend/src/hooks/useVehiclesDashboard.ts
nuke_frontend/src/lib/imageOptimizer.ts
nuke_frontend/src/pages/AdminDashboard.tsx
nuke_frontend/src/pages/CreateOrganization.tsx
nuke_frontend/src/pages/ExtractionReview.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/SellDashboard.tsx
nuke_frontend/src/pages/WiringPlan.tsx
nuke_frontend/src/pages/journal/JournalPage.tsx
nuke_frontend/src/pages/showcase/VehicleShowcase.tsx
nuke_frontend/src/pages/vehicle-profile/DayCard.tsx
nuke_frontend/src/pages/vehicle-profile/InventoryWidgetLink.tsx
nuke_frontend/src/pages/vehicle-profile/InvestmentLedger.tsx
nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSaleSettings.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSubHeader.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/routes/DomainRoutes.tsx
nuke_frontend/src/routes/modules/vehicle/routes.tsx
nuke_frontend/src/services/dashboardService.ts
nuke_frontend/src/services/listingExportService.ts
nuke_frontend/src/services/myAuctionsService.ts
nuke_frontend/src/services/unifiedImageImportService.ts
nuke_frontend/src/services/vehicleDiscoveryService.ts
nuke_frontend/vite.config.ts
package.json
scripts/fb-watchlist-scraper.ts
scripts/imessage-vehicle-sync.mjs
scripts/iphoto-intake.mjs
scripts/nuke-photo-drop.mjs
scripts/scheduled/nightly-regression.sh
scripts/scrape-prowire-catalog.js
scripts/work-photos-intake.mjs
supabase/functions/_shared/cockpit/attribute-registry.ts
supabase/functions/_shared/observationWriter.ts
supabase/functions/api-v1-vehicle-history/index.ts
supabase/functions/create-work-session-from-evidence/index.ts
supabase/functions/generate-listing-package/index.ts
supabase/functions/import-fb-marketplace/index.ts
supabase/functions/ingest-observation/index.ts
supabase/functions/link-document-entities/index.ts
supabase/functions/photo-pipeline-orchestrator/index.ts
supabase/functions/refine-fb-listing/index.ts
supabase/functions/universal-search/index.ts

## Staged
none

---
## Recent Checkpoints
2026-06-18_05-59-10.md
2026-06-18_05-54-26.md
2026-06-18_05-41-42.md
*(See .claude/checkpoints/ for full details)*

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read the handoff sections above
3. Check git log if more detail needed: `git log --oneline -10`
4. Check active agents: `cat .claude/agents/active/*.md 2>/dev/null`
