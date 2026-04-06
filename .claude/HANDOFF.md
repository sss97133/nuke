# Handoff — Assembled 2026-04-05 21:54:19

*Auto-assembled from per-agent handoff files. Most recent first.*

---
# Session Handoff — 2026-04-05_21-54-19 (agent 44281)

## What Was Happening
Product rollout session. Built landing page + product pages, ran 3 rounds of audits (17 agents), then executed fixes in parallel (5 agents). What's done: 19 dead files deleted (-8K lines), search z-index fixed, feed defaults changed (3-col, NEWEST, follow enabled, live/sold badges), price history chart on profiles, AuctionTrendsDashboard unlocked at /market/trends, button variants fixed, landing CSS tokenized, PWA manifest fixed. What's NOT done: landing page still shows 6 products (should show 1 - Search), feed changes not visually verified, nothing deployed to production, no 'show me all the Camaros' make-level pages, no persistent nav in header. Three planning docs produced: docs/PRODUCT_AUDIT.md, docs/DESIGN_REVIEW.md, docs/DESIGN_REVIEW_DEEP_DIVE.md plus 16 individual reports in docs/audit/ and docs/design-review/. Next session should: (1) simplify landing to lead with Search, (2) verify feed changes visually while logged in, (3) deploy to production, (4) start on make-level browse pages (the real product vision - understand a vehicle market, not just find a car).

## Branch
main

## Recent Commits (last 3h)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
TOOLS.md
docs/library/technical/design-book/README.md
mcp-servers/nuke-context/resolve.mjs
nuke_frontend/public/manifest.json
nuke_frontend/src/App.tsx
nuke_frontend/src/components/DiscoveryFeed.tsx
nuke_frontend/src/components/GlobalUploadStatus.tsx
nuke_frontend/src/components/ProxyBidModal.tsx
nuke_frontend/src/components/VehicleComments.tsx
nuke_frontend/src/components/VehicleContributors.tsx
nuke_frontend/src/components/VehicleMailbox/VehicleExpertChat.tsx
nuke_frontend/src/components/VehicleTimeline.tsx
nuke_frontend/src/components/auth/AuthErrorBoundary.tsx
nuke_frontend/src/components/compliance/RiskDisclosureModal.tsx
nuke_frontend/src/components/compliance/index.ts
nuke_frontend/src/components/image/ImageLightbox.tsx
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/map/DeckGLMap.tsx
nuke_frontend/src/components/map/NukeMap.tsx
nuke_frontend/src/components/map/layers/businessLayer.ts
nuke_frontend/src/components/map/panels/MapOrgDetail.tsx
nuke_frontend/src/components/map/types.ts
nuke_frontend/src/components/organization/OrganizationCard.tsx
nuke_frontend/src/components/organization/ServiceVehicleCard.tsx
nuke_frontend/src/components/organization/SoldInventoryBrowser.tsx
nuke_frontend/src/components/parts/PartCheckoutModal.tsx
nuke_frontend/src/components/parts/PartEnrichmentModal.tsx
nuke_frontend/src/components/popups/VehiclePopup.tsx
nuke_frontend/src/components/profile/OrganizationAffiliations.tsx
nuke_frontend/src/components/profile/VehicleCollection.tsx
nuke_frontend/src/components/vehicle/EditHistoryViewer.tsx
nuke_frontend/src/components/vehicle/LinkedOrganizations.tsx
nuke_frontend/src/components/vehicle/NukeEstimatePanel.tsx
nuke_frontend/src/components/vehicle/SimilarSalesSection.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/components/vehicle/VehicleVideoSection.tsx
nuke_frontend/src/components/wiring/HarnessBuilder.tsx
nuke_frontend/src/components/wiring/HarnessCanvas.tsx
nuke_frontend/src/components/wiring/HarnessCanvasEdge.tsx
nuke_frontend/src/components/wiring/HarnessCanvasNode.tsx
nuke_frontend/src/components/wiring/HarnessCanvasSectionGroup.tsx
nuke_frontend/src/components/wiring/HarnessCompletenessPanel.tsx
nuke_frontend/src/components/wiring/HarnessLoadSummary.tsx
nuke_frontend/src/components/wiring/HarnessSidebar.tsx
nuke_frontend/src/components/wiring/HarnessSystemsPalette.tsx
nuke_frontend/src/components/wiring/HarnessToolbar.tsx
nuke_frontend/src/components/wiring/ModelHarnessAnnotator.tsx
nuke_frontend/src/components/wiring/WiringDetailPanel.tsx
nuke_frontend/src/components/wiring/WiringDeviceNode.tsx
nuke_frontend/src/components/wiring/WiringOverlaySandbox.tsx
nuke_frontend/src/components/wiring/WiringQueryContextBar.tsx
nuke_frontend/src/components/wiring/WiringWirePath.tsx
nuke_frontend/src/components/wiring/WiringWorkspace.tsx
nuke_frontend/src/components/wiring/harnessConstants.ts
nuke_frontend/src/components/wiring/vehicleSilhouettes.ts
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/feed/components/FeedSkeleton.tsx
nuke_frontend/src/feed/components/VehicleCard.tsx
nuke_frontend/src/feed/hooks/useFeedSearchParams.ts
nuke_frontend/src/feed/types/feed.ts
nuke_frontend/src/feed/utils/feedUrlCodec.ts
nuke_frontend/src/pages/AdminAnalytics.tsx
nuke_frontend/src/pages/AdminDashboard.tsx
nuke_frontend/src/pages/AuctionListing.tsx
nuke_frontend/src/pages/AuctionMarketplace.tsx
nuke_frontend/src/pages/BuilderDashboard.tsx
nuke_frontend/src/pages/Capture.tsx
nuke_frontend/src/pages/ContractStation.tsx
nuke_frontend/src/pages/CreateOrganization.tsx
nuke_frontend/src/pages/CreditsSuccess.tsx
nuke_frontend/src/pages/CurationQueue.tsx
nuke_frontend/src/pages/Dashboard.tsx
nuke_frontend/src/pages/DealerAIAssistant.tsx
nuke_frontend/src/pages/DealerBulkEditor.tsx
nuke_frontend/src/pages/DeveloperSignup.tsx
nuke_frontend/src/pages/EditVehicle.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/MarketDashboard.tsx
nuke_frontend/src/pages/MarketFundDetail.tsx
nuke_frontend/src/pages/MarketSegmentDetail.tsx
nuke_frontend/src/pages/MarketSegments.tsx
nuke_frontend/src/pages/MergeProposalsDashboard.tsx
nuke_frontend/src/pages/MyAuctions.tsx
nuke_frontend/src/pages/MyOrganizations.tsx
nuke_frontend/src/pages/OrganizationProfile.tsx
nuke_frontend/src/pages/Organizations.tsx
nuke_frontend/src/pages/Portfolio.tsx
nuke_frontend/src/pages/Profile.tsx
nuke_frontend/src/pages/RestorationIntake.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/StripeConnect.tsx
nuke_frontend/src/pages/StripeConnectStore.tsx
nuke_frontend/src/pages/UnlinkedReceipts.tsx
nuke_frontend/src/pages/VehicleProfile.tsx
nuke_frontend/src/pages/Vehicles.tsx
nuke_frontend/src/pages/WiringPlan.tsx
nuke_frontend/src/pages/WiringSandbox.tsx
nuke_frontend/src/pages/WorkOrderStatement.tsx
nuke_frontend/src/pages/admin/HoverCardDemo.tsx
nuke_frontend/src/pages/admin/ProxyBidOperations.tsx
nuke_frontend/src/pages/admin/ShippingSettings.tsx
nuke_frontend/src/pages/admin/X402Settings.tsx
nuke_frontend/src/pages/vehicle-profile/AnalysisSignalsSection.tsx
nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/BuildTimelineChart.tsx
nuke_frontend/src/pages/vehicle-profile/DayCard.tsx
nuke_frontend/src/pages/vehicle-profile/FieldEvidencePopup.tsx
nuke_frontend/src/pages/vehicle-profile/FieldProvenanceDrawer.tsx
nuke_frontend/src/pages/vehicle-profile/GenerateBill.tsx
nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSubHeader.tsx
nuke_frontend/src/pages/vehicle-profile/WorkOrderProgress.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/routes/DomainRoutes.tsx
nuke_frontend/src/routes/modules/admin/routes.tsx
nuke_frontend/src/routes/modules/marketplace/routes.tsx
nuke_frontend/src/routes/modules/organization/routes.tsx
nuke_frontend/src/routes/modules/vehicle/routes.tsx
nuke_frontend/src/styles/unified-design-system.css
nuke_frontend/src/styles/vehicle-profile.css
package-lock.json
package.json
scripts/fb-marketplace-local-scraper.mjs
scripts/fb-scrape-saved.ts
scripts/package.json
supabase/functions/backfill-cl-asking-price/index.ts
supabase/functions/backfill-cl-descriptions/index.ts
supabase/functions/backfill-gooding-descriptions/index.ts
supabase/functions/backfill-image-angles/index.ts
supabase/functions/backfill-mecum-descriptions/index.ts
supabase/functions/backfill-rmsothebys-descriptions/index.ts
supabase/functions/backfill-vin-from-snapshots/index.ts
supabase/functions/barn-finds-discovery/index.ts
supabase/functions/bid-curve-analysis/index.ts
supabase/functions/compute-wiring-overlay/index.ts
supabase/functions/consolidate_photo_events.sql
supabase/functions/discover-build-threads/index.ts
supabase/functions/feed-query/index.ts
supabase/functions/index-classic-com-dealer/index.ts
supabase/functions/intelligent-crawler/index.ts
supabase/functions/mcp-connector/index.ts
supabase/functions/migrate-snapshots-to-storage/index.ts
supabase/functions/patient-zero/index.ts
supabase/functions/predict-hammer-price/index.ts
supabase/functions/scrape-multi-source/index.ts
supabase/functions/widget-broker-exposure/index.ts
supabase/functions/widget-buyer-qualification/index.ts
supabase/functions/widget-commission-optimizer/index.ts
supabase/functions/widget-completion-discount/index.ts
supabase/functions/widget-deal-readiness/index.ts
supabase/functions/widget-geographic-arbitrage/index.ts
supabase/functions/widget-presentation-roi/index.ts
supabase/functions/widget-rerun-decay/index.ts
supabase/functions/widget-sell-through-cliff/index.ts
supabase/functions/widget-time-kills-deals/index.ts
supabase/functions/x-media-upload/index.ts
supabase/functions/x-post/index.ts

## Staged
none

---
# Ghost Handoff — Agent 23476 (auto-captured)
*(Agent died without explicit handoff. Narrative from registration + commits.)*

10:26 | invoice-finalize | shipping final Granholm receipt | WorkOrderStatement
10:34 | COMMIT: f2c8c78f6 fix(invoice): pull in labor/parts/courtesy sections with side margins
13:05 | COMMIT: 364f18685 fix(invoice): clean print output — strip grey bg, border, site chrome

## Git State at Death
### Recent Commits

---
# Session Handoff — 2026-04-05_14-23-51 (agent 82143)

## What Was Happening
FB Pipeline Remaining Items — COMPLETED. Created 197 vehicle records from orphaned marketplace_listings (all with year+make). 49,441 of 49,658 listings now linked (99.6%). Downloaded 1,622 images from FB CDN to Supabase storage for 164 vehicles. Cleaned unicode \u00b7 dots from vehicle models (was literal escape sequence, not unicode char). Fixed enricher filter to use scraped_at instead of seller_name. Moved pycookiecheat to ~/.local/venvs/fbcookies (persistent). Deleted dead scripts (debug-chrome-cookies, fb-enrich-from-chrome). Added npm scripts. REMAINING: 217 listings with no year/make (can't auto-create vehicles). 18 duplicate K10 vehicles (same seller relisting — entity resolution needed). ~12K FB vehicles still need YONO vision pass for body_style.

## Branch
main

## Recent Commits (last 3h)
364f18685 fix(invoice): clean print output — strip grey bg, border, site chrome

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
docs/library/technical/design-book/README.md
mcp-servers/nuke-context/resolve.mjs
nuke_frontend/public/manifest.json
nuke_frontend/src/App.tsx
nuke_frontend/src/components/DiscoveryFeed.tsx
nuke_frontend/src/components/GlobalUploadStatus.tsx
nuke_frontend/src/components/ProxyBidModal.tsx
nuke_frontend/src/components/VehicleComments.tsx
nuke_frontend/src/components/VehicleContributors.tsx
nuke_frontend/src/components/VehicleTimeline.tsx
nuke_frontend/src/components/auth/AuthErrorBoundary.tsx
nuke_frontend/src/components/compliance/RiskDisclosureModal.tsx
nuke_frontend/src/components/compliance/index.ts
nuke_frontend/src/components/image/ImageLightbox.tsx
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/organization/OrganizationCard.tsx
nuke_frontend/src/components/organization/ServiceVehicleCard.tsx
nuke_frontend/src/components/organization/SoldInventoryBrowser.tsx
nuke_frontend/src/components/parts/PartCheckoutModal.tsx
nuke_frontend/src/components/parts/PartEnrichmentModal.tsx
nuke_frontend/src/components/popups/VehiclePopup.tsx
nuke_frontend/src/components/profile/OrganizationAffiliations.tsx
nuke_frontend/src/components/profile/VehicleCollection.tsx
nuke_frontend/src/components/vehicle/EditHistoryViewer.tsx
nuke_frontend/src/components/vehicle/LinkedOrganizations.tsx
nuke_frontend/src/components/vehicle/NukeEstimatePanel.tsx
nuke_frontend/src/components/vehicle/SimilarSalesSection.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/components/vehicle/VehicleVideoSection.tsx
nuke_frontend/src/components/wiring/WiringDetailPanel.tsx
nuke_frontend/src/components/wiring/WiringDeviceNode.tsx
nuke_frontend/src/components/wiring/WiringOverlaySandbox.tsx
nuke_frontend/src/components/wiring/WiringWirePath.tsx
nuke_frontend/src/components/wiring/WiringWorkspace.tsx
nuke_frontend/src/components/wiring/harnessConstants.ts
nuke_frontend/src/components/wiring/vehicleSilhouettes.ts
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/feed/components/FeedSkeleton.tsx
nuke_frontend/src/feed/components/VehicleCard.tsx
nuke_frontend/src/feed/hooks/useFeedSearchParams.ts
nuke_frontend/src/feed/types/feed.ts
nuke_frontend/src/feed/utils/feedUrlCodec.ts
nuke_frontend/src/pages/AdminAnalytics.tsx
nuke_frontend/src/pages/AdminDashboard.tsx
nuke_frontend/src/pages/AuctionListing.tsx
nuke_frontend/src/pages/AuctionMarketplace.tsx
nuke_frontend/src/pages/BuilderDashboard.tsx
nuke_frontend/src/pages/Capture.tsx
nuke_frontend/src/pages/ContractStation.tsx
nuke_frontend/src/pages/CreateOrganization.tsx
nuke_frontend/src/pages/CreditsSuccess.tsx
nuke_frontend/src/pages/CurationQueue.tsx
nuke_frontend/src/pages/Dashboard.tsx
nuke_frontend/src/pages/DealerAIAssistant.tsx
nuke_frontend/src/pages/DealerBulkEditor.tsx
nuke_frontend/src/pages/DeveloperSignup.tsx
nuke_frontend/src/pages/EditVehicle.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/MarketDashboard.tsx
nuke_frontend/src/pages/MarketFundDetail.tsx
nuke_frontend/src/pages/MarketSegmentDetail.tsx
nuke_frontend/src/pages/MarketSegments.tsx
nuke_frontend/src/pages/MergeProposalsDashboard.tsx
nuke_frontend/src/pages/MyAuctions.tsx
nuke_frontend/src/pages/MyOrganizations.tsx
nuke_frontend/src/pages/OrganizationProfile.tsx
nuke_frontend/src/pages/Organizations.tsx
nuke_frontend/src/pages/Portfolio.tsx
nuke_frontend/src/pages/Profile.tsx
nuke_frontend/src/pages/RestorationIntake.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/StripeConnect.tsx
nuke_frontend/src/pages/StripeConnectStore.tsx
nuke_frontend/src/pages/UnlinkedReceipts.tsx
nuke_frontend/src/pages/VehicleProfile.tsx
nuke_frontend/src/pages/Vehicles.tsx
nuke_frontend/src/pages/WiringPlan.tsx
nuke_frontend/src/pages/WiringSandbox.tsx
nuke_frontend/src/pages/WorkOrderStatement.tsx
nuke_frontend/src/pages/admin/HoverCardDemo.tsx
nuke_frontend/src/pages/admin/ProxyBidOperations.tsx
nuke_frontend/src/pages/admin/ShippingSettings.tsx
nuke_frontend/src/pages/admin/X402Settings.tsx
nuke_frontend/src/pages/vehicle-profile/AnalysisSignalsSection.tsx
nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/BuildTimelineChart.tsx
nuke_frontend/src/pages/vehicle-profile/DayCard.tsx
nuke_frontend/src/pages/vehicle-profile/FieldEvidencePopup.tsx
nuke_frontend/src/pages/vehicle-profile/FieldProvenanceDrawer.tsx
nuke_frontend/src/pages/vehicle-profile/GenerateBill.tsx
nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSubHeader.tsx
nuke_frontend/src/pages/vehicle-profile/WorkOrderProgress.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/routes/DomainRoutes.tsx
nuke_frontend/src/routes/modules/admin/routes.tsx
nuke_frontend/src/routes/modules/marketplace/routes.tsx
nuke_frontend/src/routes/modules/organization/routes.tsx
nuke_frontend/src/routes/modules/vehicle/routes.tsx
nuke_frontend/src/styles/unified-design-system.css
nuke_frontend/src/styles/vehicle-profile.css
package-lock.json
package.json
scripts/fb-marketplace-local-scraper.mjs
scripts/fb-scrape-saved.ts
scripts/package.json
supabase/functions/backfill-cl-asking-price/index.ts
supabase/functions/backfill-cl-descriptions/index.ts
supabase/functions/backfill-gooding-descriptions/index.ts
supabase/functions/backfill-image-angles/index.ts
supabase/functions/backfill-mecum-descriptions/index.ts
supabase/functions/backfill-rmsothebys-descriptions/index.ts
supabase/functions/backfill-vin-from-snapshots/index.ts
supabase/functions/barn-finds-discovery/index.ts
supabase/functions/bid-curve-analysis/index.ts
supabase/functions/consolidate_photo_events.sql
supabase/functions/discover-build-threads/index.ts
supabase/functions/feed-query/index.ts
supabase/functions/index-classic-com-dealer/index.ts
supabase/functions/intelligent-crawler/index.ts
supabase/functions/mcp-connector/index.ts
supabase/functions/migrate-snapshots-to-storage/index.ts
supabase/functions/patient-zero/index.ts
supabase/functions/predict-hammer-price/index.ts
supabase/functions/scrape-multi-source/index.ts
supabase/functions/widget-broker-exposure/index.ts
supabase/functions/widget-buyer-qualification/index.ts
supabase/functions/widget-commission-optimizer/index.ts
supabase/functions/widget-completion-discount/index.ts
supabase/functions/widget-deal-readiness/index.ts
supabase/functions/widget-geographic-arbitrage/index.ts
supabase/functions/widget-presentation-roi/index.ts
supabase/functions/widget-rerun-decay/index.ts
supabase/functions/widget-sell-through-cliff/index.ts
supabase/functions/widget-time-kills-deals/index.ts
supabase/functions/x-media-upload/index.ts
supabase/functions/x-post/index.ts

## Staged
none

---
# Session Handoff — 2026-04-05_13-43-23 (agent 62254)

## What Was Happening
FB Saved Items Pipeline Fix — end-to-end session

COMPLETED:
1. Built fb-enrich-with-cookies.mjs v3 — Chrome cookie extraction via pycookiecheat + plain HTTP enrichment. No Playwright/browser automation needed. 445 listings enriched in first run.
2. Body_style classification — 19,128 FB vehicles classified, ~150 variant labels normalized to 8 canonical types + NOT_AUTO. 0 non-canonical values remain.
3. Junk image cleanup — 87 polluted images deleted from 3 vehicles (Blazer/Porsche/C10), real photos re-uploaded via Nuke MCP ingest_photos.
4. Scraper pipeline fixes in fb-marketplace-local-scraper.mjs: parseTitle returns fullTitle for body_style, classifyVehicle handles split makes (Sea+Ray), deriveBodyStyle expanded patterns, emoji/comma stripping.
5. Audit by 3-agent expert team, all CRITICAL/HIGH fixes applied: safe rate limiting (3-7s), circuit breaker, retry, session invalidation detection, price sanity, fetch timeout.
6. DB cleanup: garbage sale_prices nulled, 165 non-canonical body_styles normalized.
7. Daily cron: 0 6 * * * with v3 enricher, limit 50.

REMAINING:
- 423 listings still show seller_name=NULL (many FB listings genuinely lack visible seller names — the enricher ran but FB didn't expose seller). Need alternate enrichment signal.
- 355 marketplace_listings with no vehicle_id — need vehicle record creation pipeline.
- ~12K FB vehicles with NULL body_style need YONO vision pass.
- Playwright fb-scrape-saved.ts still uses Chrome for Testing — could be updated to use cookie approach instead, but the enricher makes it redundant for now.
- pycookiecheat venv at /tmp/fbcookies/ — lost on reboot, needs persistent install or setup script.

FILES CHANGED:
- scripts/fb-enrich-with-cookies.mjs (new, v3)
- scripts/export-chrome-cookies.py (new)
- scripts/fb-scrape-saved.ts (user_saved flag)
- scripts/fb-marketplace-local-scraper.mjs (3 bug fixes + audit fixes)
- scripts/debug-chrome-cookies.mjs (debug, can delete)
- scripts/fb-enrich-from-chrome.mjs (dead, superseded by cookies version, can delete)

## Branch
main

## Recent Commits (last 3h)
364f18685 fix(invoice): clean print output — strip grey bg, border, site chrome

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
docs/library/technical/design-book/README.md
mcp-servers/nuke-context/resolve.mjs
nuke_frontend/src/App.tsx
nuke_frontend/src/components/DiscoveryFeed.tsx
nuke_frontend/src/components/GlobalUploadStatus.tsx
nuke_frontend/src/components/VehicleComments.tsx
nuke_frontend/src/components/VehicleContributors.tsx
nuke_frontend/src/components/VehicleTimeline.tsx
nuke_frontend/src/components/auth/AuthErrorBoundary.tsx
nuke_frontend/src/components/organization/OrganizationCard.tsx
nuke_frontend/src/components/organization/ServiceVehicleCard.tsx
nuke_frontend/src/components/organization/SoldInventoryBrowser.tsx
nuke_frontend/src/components/profile/OrganizationAffiliations.tsx
nuke_frontend/src/components/profile/VehicleCollection.tsx
nuke_frontend/src/components/vehicle/EditHistoryViewer.tsx
nuke_frontend/src/components/vehicle/LinkedOrganizations.tsx
nuke_frontend/src/components/vehicle/NukeEstimatePanel.tsx
nuke_frontend/src/components/vehicle/SimilarSalesSection.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/components/vehicle/VehicleVideoSection.tsx
nuke_frontend/src/components/wiring/WiringDetailPanel.tsx
nuke_frontend/src/components/wiring/WiringDeviceNode.tsx
nuke_frontend/src/components/wiring/WiringOverlaySandbox.tsx
nuke_frontend/src/components/wiring/WiringWirePath.tsx
nuke_frontend/src/components/wiring/WiringWorkspace.tsx
nuke_frontend/src/components/wiring/harnessConstants.ts
nuke_frontend/src/components/wiring/vehicleSilhouettes.ts
nuke_frontend/src/pages/AuctionListing.tsx
nuke_frontend/src/pages/AuctionMarketplace.tsx
nuke_frontend/src/pages/BuilderDashboard.tsx
nuke_frontend/src/pages/Capture.tsx
nuke_frontend/src/pages/CreateOrganization.tsx
nuke_frontend/src/pages/CreditsSuccess.tsx
nuke_frontend/src/pages/CurationQueue.tsx
nuke_frontend/src/pages/Dashboard.tsx
nuke_frontend/src/pages/DealerAIAssistant.tsx
nuke_frontend/src/pages/DealerBulkEditor.tsx
nuke_frontend/src/pages/DeveloperSignup.tsx
nuke_frontend/src/pages/EditVehicle.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/MarketDashboard.tsx
nuke_frontend/src/pages/MarketFundDetail.tsx
nuke_frontend/src/pages/MarketSegmentDetail.tsx
nuke_frontend/src/pages/MarketSegments.tsx
nuke_frontend/src/pages/MergeProposalsDashboard.tsx
nuke_frontend/src/pages/MyAuctions.tsx
nuke_frontend/src/pages/MyOrganizations.tsx
nuke_frontend/src/pages/OrganizationProfile.tsx
nuke_frontend/src/pages/Organizations.tsx
nuke_frontend/src/pages/Portfolio.tsx
nuke_frontend/src/pages/Profile.tsx
nuke_frontend/src/pages/RestorationIntake.tsx
nuke_frontend/src/pages/UnlinkedReceipts.tsx
nuke_frontend/src/pages/VehicleProfile.tsx
nuke_frontend/src/pages/Vehicles.tsx
nuke_frontend/src/pages/WiringPlan.tsx
nuke_frontend/src/pages/vehicle-profile/AnalysisSignalsSection.tsx
nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/BuildTimelineChart.tsx
nuke_frontend/src/pages/vehicle-profile/DayCard.tsx
nuke_frontend/src/pages/vehicle-profile/FieldEvidencePopup.tsx
nuke_frontend/src/pages/vehicle-profile/FieldProvenanceDrawer.tsx
nuke_frontend/src/pages/vehicle-profile/GenerateBill.tsx
nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSubHeader.tsx
nuke_frontend/src/pages/vehicle-profile/WorkOrderProgress.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/routes/modules/organization/routes.tsx
nuke_frontend/src/routes/modules/vehicle/routes.tsx
nuke_frontend/src/styles/vehicle-profile.css
package-lock.json
package.json
scripts/fb-marketplace-local-scraper.mjs
scripts/fb-scrape-saved.ts
scripts/package.json
supabase/functions/backfill-cl-asking-price/index.ts
supabase/functions/backfill-cl-descriptions/index.ts
supabase/functions/backfill-gooding-descriptions/index.ts
supabase/functions/backfill-image-angles/index.ts
supabase/functions/backfill-mecum-descriptions/index.ts
supabase/functions/backfill-rmsothebys-descriptions/index.ts
supabase/functions/backfill-vin-from-snapshots/index.ts
supabase/functions/barn-finds-discovery/index.ts
supabase/functions/bid-curve-analysis/index.ts
supabase/functions/consolidate_photo_events.sql
supabase/functions/discover-build-threads/index.ts
supabase/functions/feed-query/index.ts
supabase/functions/index-classic-com-dealer/index.ts
supabase/functions/intelligent-crawler/index.ts
supabase/functions/mcp-connector/index.ts
supabase/functions/migrate-snapshots-to-storage/index.ts
supabase/functions/patient-zero/index.ts
supabase/functions/predict-hammer-price/index.ts
supabase/functions/scrape-multi-source/index.ts
supabase/functions/widget-broker-exposure/index.ts
supabase/functions/widget-buyer-qualification/index.ts
supabase/functions/widget-commission-optimizer/index.ts
supabase/functions/widget-completion-discount/index.ts
supabase/functions/widget-deal-readiness/index.ts
supabase/functions/widget-geographic-arbitrage/index.ts
supabase/functions/widget-presentation-roi/index.ts
supabase/functions/widget-rerun-decay/index.ts
supabase/functions/widget-sell-through-cliff/index.ts
supabase/functions/widget-time-kills-deals/index.ts
supabase/functions/x-media-upload/index.ts
supabase/functions/x-post/index.ts

## Staged
none

---
# Session Handoff — 2026-04-05_13-40-16 (agent 60690)

## What Was Happening
LONG SESSION — save everything. SOLID WORK: commercial structure doc (complete thesis, contact chain Hauthils→Bendet→Materazzo→Gelardi, heritage paradox, data presentation framework), research (GT350-H, Porsche 80%, Hertz-Tesla), Chapter 14 deck system architecture (782 lines), DB enrichment (355/390 SBH orgs = 91% with brand data, logo quality fixes), deck v2 content is strong. VISUAL EXECUTION FAILING: map has been rebuilt 3+ times, still has coordinate issues and logo rendering problems. Root cause: agents can't see the map tiles so every coordinate is a guess. The prompt harness for map-building agents is not producing correct output — more rules in longer prompts makes it worse not better. DECK v2 at luxe-fleet-ford-v2.html has correct logos and research integrated but needs visual review. MAP at stbarth-map-v2.html is latest rebuild from OSM data — needs human verification of pin positions. KEY USER FEEDBACK: stop patching, the factory system should produce correct output. SiBarth vs SiBarth Real Estate are two different companies (fixed in DB). Eden Rock is Eden Rock not Oetker (fixed). Never use prompt/alert/confirm in browser code. FBM logo has dark+light variants now. User has real Bronco-on-SBH photos (4 images shared in chat) that need ingesting. Ashley/SiBarth testimonial documented. NEXT SESSION: 1) visually verify map coordinates with human help 2) integrate research into deck properly 3) get Eden Rock assets from oetkerhotels.com (needs browser, JS-rendered) 4) ingest user's Bronco photos 5) apply colorways

## Branch
main

## Recent Commits (last 3h)
364f18685 fix(invoice): clean print output — strip grey bg, border, site chrome

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
docs/library/technical/design-book/README.md
mcp-servers/nuke-context/resolve.mjs
nuke_frontend/src/App.tsx
nuke_frontend/src/components/DiscoveryFeed.tsx
nuke_frontend/src/components/GlobalUploadStatus.tsx
nuke_frontend/src/components/VehicleComments.tsx
nuke_frontend/src/components/VehicleContributors.tsx
nuke_frontend/src/components/VehicleTimeline.tsx
nuke_frontend/src/components/auth/AuthErrorBoundary.tsx
nuke_frontend/src/components/organization/OrganizationCard.tsx
nuke_frontend/src/components/organization/ServiceVehicleCard.tsx
nuke_frontend/src/components/organization/SoldInventoryBrowser.tsx
nuke_frontend/src/components/profile/OrganizationAffiliations.tsx
nuke_frontend/src/components/profile/VehicleCollection.tsx
nuke_frontend/src/components/vehicle/EditHistoryViewer.tsx
nuke_frontend/src/components/vehicle/LinkedOrganizations.tsx
nuke_frontend/src/components/vehicle/NukeEstimatePanel.tsx
nuke_frontend/src/components/vehicle/SimilarSalesSection.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/components/vehicle/VehicleVideoSection.tsx
nuke_frontend/src/components/wiring/WiringDetailPanel.tsx
nuke_frontend/src/components/wiring/WiringDeviceNode.tsx
nuke_frontend/src/components/wiring/WiringOverlaySandbox.tsx
nuke_frontend/src/components/wiring/WiringWirePath.tsx
nuke_frontend/src/components/wiring/WiringWorkspace.tsx
nuke_frontend/src/components/wiring/harnessConstants.ts
nuke_frontend/src/components/wiring/vehicleSilhouettes.ts
nuke_frontend/src/pages/AuctionListing.tsx
nuke_frontend/src/pages/AuctionMarketplace.tsx
nuke_frontend/src/pages/BuilderDashboard.tsx
nuke_frontend/src/pages/Capture.tsx
nuke_frontend/src/pages/CreateOrganization.tsx
nuke_frontend/src/pages/CreditsSuccess.tsx
nuke_frontend/src/pages/CurationQueue.tsx
nuke_frontend/src/pages/Dashboard.tsx
nuke_frontend/src/pages/DealerAIAssistant.tsx
nuke_frontend/src/pages/DealerBulkEditor.tsx
nuke_frontend/src/pages/DeveloperSignup.tsx
nuke_frontend/src/pages/EditVehicle.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/MarketDashboard.tsx
nuke_frontend/src/pages/MarketFundDetail.tsx
nuke_frontend/src/pages/MarketSegmentDetail.tsx
nuke_frontend/src/pages/MarketSegments.tsx
nuke_frontend/src/pages/MergeProposalsDashboard.tsx
nuke_frontend/src/pages/MyAuctions.tsx
nuke_frontend/src/pages/MyOrganizations.tsx
nuke_frontend/src/pages/OrganizationProfile.tsx
nuke_frontend/src/pages/Organizations.tsx
nuke_frontend/src/pages/Portfolio.tsx
nuke_frontend/src/pages/Profile.tsx
nuke_frontend/src/pages/RestorationIntake.tsx
nuke_frontend/src/pages/UnlinkedReceipts.tsx
nuke_frontend/src/pages/VehicleProfile.tsx
nuke_frontend/src/pages/Vehicles.tsx
nuke_frontend/src/pages/WiringPlan.tsx
nuke_frontend/src/pages/vehicle-profile/AnalysisSignalsSection.tsx
nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/BuildTimelineChart.tsx
nuke_frontend/src/pages/vehicle-profile/DayCard.tsx
nuke_frontend/src/pages/vehicle-profile/FieldEvidencePopup.tsx
nuke_frontend/src/pages/vehicle-profile/FieldProvenanceDrawer.tsx
nuke_frontend/src/pages/vehicle-profile/GenerateBill.tsx
nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSubHeader.tsx
nuke_frontend/src/pages/vehicle-profile/WorkOrderProgress.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/routes/modules/organization/routes.tsx
nuke_frontend/src/routes/modules/vehicle/routes.tsx
nuke_frontend/src/styles/vehicle-profile.css
package-lock.json
package.json
scripts/fb-marketplace-local-scraper.mjs
scripts/fb-scrape-saved.ts
scripts/package.json
supabase/functions/backfill-cl-asking-price/index.ts
supabase/functions/backfill-cl-descriptions/index.ts
supabase/functions/backfill-gooding-descriptions/index.ts
supabase/functions/backfill-image-angles/index.ts
supabase/functions/backfill-mecum-descriptions/index.ts
supabase/functions/backfill-rmsothebys-descriptions/index.ts
supabase/functions/backfill-vin-from-snapshots/index.ts
supabase/functions/barn-finds-discovery/index.ts
supabase/functions/bid-curve-analysis/index.ts
supabase/functions/consolidate_photo_events.sql
supabase/functions/discover-build-threads/index.ts
supabase/functions/feed-query/index.ts
supabase/functions/index-classic-com-dealer/index.ts
supabase/functions/intelligent-crawler/index.ts
supabase/functions/mcp-connector/index.ts
supabase/functions/migrate-snapshots-to-storage/index.ts
supabase/functions/patient-zero/index.ts
supabase/functions/predict-hammer-price/index.ts
supabase/functions/scrape-multi-source/index.ts
supabase/functions/widget-broker-exposure/index.ts
supabase/functions/widget-buyer-qualification/index.ts
supabase/functions/widget-commission-optimizer/index.ts
supabase/functions/widget-completion-discount/index.ts
supabase/functions/widget-deal-readiness/index.ts
supabase/functions/widget-geographic-arbitrage/index.ts
supabase/functions/widget-presentation-roi/index.ts
supabase/functions/widget-rerun-decay/index.ts
supabase/functions/widget-sell-through-cliff/index.ts
supabase/functions/widget-time-kills-deals/index.ts
supabase/functions/x-media-upload/index.ts
supabase/functions/x-post/index.ts

## Staged
none

---
## Recent Checkpoints
2026-04-05_21-50-52.md
2026-04-05_21-48-47.md
2026-04-05_21-45-30.md
*(See .claude/checkpoints/ for full details)*

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read the handoff sections above
3. Check git log if more detail needed: `git log --oneline -10`
4. Check active agents: `cat .claude/agents/active/*.md 2>/dev/null`
