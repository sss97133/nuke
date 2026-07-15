# Handoff — Assembled 2026-07-13 18:40:56

*Auto-assembled from per-agent handoff files. Most recent first.*

---
# Session Handoff — 2026-07-13_18-40-55 (agent 10304)

## What Was Happening
SESSION CLOSE 2026-07-13 (Fable-audit session, ran on Opus). Codebase-hardening arc COMPLETE + committed (gate green each): docs/ledger/ canonical map + capability lookup + intent ledger + theory cards; 6 guardrails + scripts/ci/verify.sh ratchet gate + pre-push (ENFORCE) + PreToolUse mint-block hook; scripts/ledger/refresh-facts.mjs (facts layer, catches drift); liveness-and-intent law as doorman invariant 5; model pins fixed opus->fable in BOTH ~/.claude and nuke/.claude. FIXES: 50->43 ghost/undeployed frontend calls (repointed/guarded/deployed); deployed 5 fns incl detect-sensitive-document (SEV-1 gate) + complete-bat-import (thin orchestrator, +caller shape fix); ingest PREVIEW mode -> add-by-URL now parse-only prefill, create at Sign (refuter-hardened: batch bypass, bool coerce, zero-fetch); revived vehicle_edit_audit organ (missing table crashed every authed title edit + search_path bug on 4 fns); VIN uniqueness excludes merged shells (trigger + 17char index live). SCHEDULED: cloud routine trig_01LpqwFgjgCkcewatrNkhRsM scores hammer-prediction #1 on 2026-07-16. PARKED/NEXT: (1) NEW ASK from Skylar 'do a big thing on APPRAISAL' — not started, likely the deal-system valuation surface; read docs/features/ask-nuke/THEORY.md + deal-system-pickup.md + feedback_valuation_block_when_not_defensible first (comps don't price builds; block don't guess). (2) drop old SHORT vin index via DROP INDEX CONCURRENTLY in low-traffic window (MAINTENANCE note in migration 20260713013000). (3) ~43 remaining undeployed-fn frontend calls in .claude/ISSUES.md (deploy-or-guard, same playbook; retired-feature deletions are Skylar-only). (4) journal-independent unmerge_vehicle path still owed.

## Branch
feat/cohort-terminal

## Recent Commits (last 3h)
none

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md
TOOLS.md
docs/library/technical/engineering-manual/18-deep-image-analysis.md
docs/wiring/K5_WIRING_STATE.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/image-viewer/useImageViewerState.ts
nuke_frontend/src/components/image/MobileImageGallery.tsx
nuke_frontend/src/components/images/WalkAroundCarousel.tsx
nuke_frontend/src/components/profile/PublicImageGallery.tsx
nuke_frontend/src/components/vehicles/VehicleCardDense.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx
scripts/daily-receipt/byok-image-batch.sh
scripts/daily-receipt/byok-vision-prompt.md
scripts/deep-image-analysis-byok.mjs
scripts/drain-queue-no-ai.mjs
supabase/functions/extract-auction-comments/index.ts
supabase/functions/extract-barrett-jackson/index.ts
supabase/functions/extract-bat-core/index.ts
supabase/functions/extract-cars-and-bids-core/index.ts
supabase/functions/extract-mecum/index.ts
supabase/functions/extract-rmsothebys/index.ts
supabase/functions/import-pcarmarket-listing/index.ts
supabase/functions/photo-pipeline-orchestrator/index.ts
supabase/functions/sync-live-auctions/index.ts

## Staged
none

---
# Session Handoff — 2026-07-13_08-56-45 (agent 84827)

## What Was Happening
EXPLORE THESIS — closed out, picks up next week. SESSION: (1) widened live-listing artery 2->441 feeds (all US CL metros + KSL/eBay/C&B/AutoHunter/Mecum/RMS/Bonhams/BJ/PCarMarket/dealers/GovDeals/PurpleWave/BarnFinds; commits da17c8feb + 44733bd44; per-feed regex+article-hop config, no new fns). (2) Skylar reframed: live-listings IS the missing Explore tab, don't rush a shit version, build thesis. THESIS (durable, in THEORY.md 'Explore surface grounding 2026-07-13'): Explore isn't missing, it's MISLABELED — web+iOS terminals both read the vehicles BaT sold-census labeled 'live listings market' (live C0 facade). Artery lands geo-less/unpriced/un-deduped/never-expired stubs in vehicles; enrichment crons OFF (reconcile-listing-status, dedup, enrich-*); no Explore MV reads live flow. BLOCKER IS DATA-HANDLING NOT UI. NEXT WEEK PICKUP, in order: (a) cheap do-now: relabel the sold-archive-as-live facade on iOS front-door tab + web /market; (b) AWAIT SKYLAR ON 2 FORKS: enrich-all-441 vs concentrate-cohorts [rec concentrate], and Explore headline deal-read vs geography-map; (c) build order once steered: fix ask-side atoms (geocode CL / expire stale / dedup / unify asking_price) -> canonical seam read (extend mv_market_position, sold bat_listings vs ask) -> repoint+relabel surface LAST. Develop-from: ExploreView shell, CohortTerminalView populated-flag discipline, mv_market_position, bat_listings spine. iOS app: ~/.worktrees/foundation-ios branch fable5/ignition-ios. Grounding workflow wf_3c80fee5-e60.

## Branch
feat/cohort-terminal

## Recent Commits (last 3h)
07dfcc506 ask-nuke THEORY: Explore surface grounding (2026-07-13) — thesis + 2 open forks

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md
TOOLS.md
docs/library/technical/engineering-manual/18-deep-image-analysis.md
docs/wiring/K5_WIRING_STATE.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/image-viewer/useImageViewerState.ts
nuke_frontend/src/components/image/MobileImageGallery.tsx
nuke_frontend/src/components/images/WalkAroundCarousel.tsx
nuke_frontend/src/components/profile/PublicImageGallery.tsx
nuke_frontend/src/components/vehicle/BATListingManager.tsx
nuke_frontend/src/components/vehicles/VehicleCardDense.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx
scripts/daily-receipt/byok-image-batch.sh
scripts/daily-receipt/byok-vision-prompt.md
scripts/deep-image-analysis-byok.mjs
scripts/drain-queue-no-ai.mjs
supabase/functions/extract-auction-comments/index.ts
supabase/functions/extract-barrett-jackson/index.ts
supabase/functions/extract-bat-core/index.ts
supabase/functions/extract-cars-and-bids-core/index.ts
supabase/functions/extract-mecum/index.ts
supabase/functions/extract-rmsothebys/index.ts
supabase/functions/import-pcarmarket-listing/index.ts
supabase/functions/photo-pipeline-orchestrator/index.ts
supabase/functions/sync-live-auctions/index.ts

## Staged
none

---
# Ghost Handoff — Agent 19022 (auto-captured)
*(Agent died without explicit handoff. Narrative from registration + commits.)*

00:01 | BAT-COVERAGE-BACKFILL | run_backfill.sh supervisor @2wkr self-healing over 64K missing; extract-bat-core(free). BOTTLENECK: ~10s stmt-timeout on vehicles insert -> intermittent 500s (transient, retried). Needs DB fix for full-speed. logs ~/bat-backfill/backfill.log | extract-bat-core
17:51 | COMMIT: c18b69040 Record deployed pulse-metrics SQL (dispersion/arbitrage columns on market_position + market_pulse_filtered)
18:27 | COMMIT: 50357a237 price_histogram RPC: cohort price-distribution buckets (bell-curve organ)
19:49 | COMMIT: 9059b9685 vehicles write path: 42.96s -> 38ms median insert — ONE missing index, not 38 heavy triggers
21:28 | COMMIT: da17c8feb poll-listing-feeds: per-feed regex extraction opens non-CL sources
21:42 | COMMIT: 44733bd44 poll-listing-feeds: rss_article_hop strategy — curated deal blogs feed the pipe

## Git State at Death
### Recent Commits
44733bd44 poll-listing-feeds: rss_article_hop strategy — curated deal blogs feed the pipe
da17c8feb poll-listing-feeds: per-feed regex extraction opens non-CL sources
9059b9685 vehicles write path: 42.96s -> 38ms median insert — ONE missing index, not 38 heavy triggers
cb5df2d45 ingest preview mode: add-by-URL fixed the right way — parse-only prefill, create at Sign

---
# Session Handoff — 2026-07-12_21-31-54 (agent 45645)

## What Was Happening
K5 wiring ordering session (2026-07-12). COMPLETE: output/wiring/K5-order-2026-07-12.md (red-team revised, 3 tranches; T1 ~$2,100 fork-proof CLEARED BUT NOT ORDERED — Skylar's word starts it); K5-endpoint-load-schedule (38 endpoints, provenance-tagged); 4 artifacts in docs/wiring/ (M130_PINOUT_TRIANGULATION_MATRIX 41/41 zero conflicts, COMPUTER_PLACEMENT_MEMO, DAKOTA_VHX_ARCHITECTURE incl BIM-EFI-1 fork, FIRST_POWER_CERTIFICATION_LADDER) each w/ red-pen logs; Bronco-format pinout xlsx (Downloads 'M130 ECU K5 Blazer.xlsx' + output/wiring/) w/ rulings baked in, 2 ▲ remain (inj/coil channels; CAN termination map); receipts + state §3 0a-0d updated. RULINGS FILED (certification-authority protocol — Skylar: 'youre supposed to be my dave', stop deferring): crank/cam=5V, AT1=nonissue, DBW correct, fuel=AV6+270Ω, isolator=4-post mechanical aux→B8, A26=ign-keyed relay, trans=PCS TCM-2650. CRITICAL CORRECTION AT CLOSE: TRANS IS A 6L90 NOT 6L80E (owner verbal) — audit vehicle_build_manifest + appendix-d + all docs for 6L80E mentions. NEXT: (1) Skylar's 2 free verify calls (PCS: 4WD 6L90 T43 OS; MoTeC USA/JRR: M130 GMLAN); (2) place Tranche 1 on his go; (3) punch list on truck (fans, water pump exists?, starter run length, audio in/out); (4) in-app purchase-flow design awaits go: docs/wiring/IN_APP_WIRING_FLOW_DESIGN.md P1 = place this order through Nuke. MOOD: Skylar closed DISAPPOINTED — day produced paper, zero parts ordered. Next session: LEAD WITH ORDERING, not documents. Also: he wants ME as the certifying authority, never punt to Dave.

## Branch
feat/cohort-terminal

## Recent Commits (last 3h)
da17c8feb poll-listing-feeds: per-feed regex extraction opens non-CL sources
9059b9685 vehicles write path: 42.96s -> 38ms median insert — ONE missing index, not 38 heavy triggers
cb5df2d45 ingest preview mode: add-by-URL fixed the right way — parse-only prefill, create at Sign
6002cfdc1 Filtered county map: mv_vehicle_county + county_density_filtered (staged, deploy after canonical rebuild)

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md
TOOLS.md
docs/library/technical/engineering-manual/18-deep-image-analysis.md
docs/wiring/K5_WIRING_STATE.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/image-viewer/useImageViewerState.ts
nuke_frontend/src/components/image/MobileImageGallery.tsx
nuke_frontend/src/components/images/WalkAroundCarousel.tsx
nuke_frontend/src/components/profile/PublicImageGallery.tsx
nuke_frontend/src/components/vehicles/VehicleCardDense.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx
scripts/daily-receipt/byok-image-batch.sh
scripts/daily-receipt/byok-vision-prompt.md
scripts/deep-image-analysis-byok.mjs
scripts/drain-queue-no-ai.mjs
supabase/functions/extract-auction-comments/index.ts
supabase/functions/extract-barrett-jackson/index.ts
supabase/functions/extract-bat-core/index.ts
supabase/functions/extract-cars-and-bids-core/index.ts
supabase/functions/extract-mecum/index.ts
supabase/functions/extract-rmsothebys/index.ts
supabase/functions/import-pcarmarket-listing/index.ts
supabase/functions/photo-pipeline-orchestrator/index.ts
supabase/functions/sync-live-auctions/index.ts

## Staged
none

---
# Session Handoff — 2026-07-11_21-09-42 (agent 75129)

## What Was Happening
CC-LOCATION-BACKFILL complete. INVESTIGATION: the 11,217 'cadillac, MICHIGAN' rows corrected by 20260712030000 were NOT a fabricated parser stamp — every listing_url slug says for-sale-in-cadillac-michigan-49601; they are one consignment mega-dealer (Cadillac MI 49601) whose live pages state the vehicle 'is at our clients home and Not In Cadillac, Michigan' with no location disclosed → true physical locations UNRECOVERABLE even by re-extraction; columns stay null (correct), each row now carries origin_metadata.listing_location with dealer-HQ semantics + sitemap lastmod. THE REAL BUG: scripts/drain-queue-no-ai.mjs parseClassicCars split the sitemap location slug on '-' taking the last token as state → two-word states shattered (buffalo new/YORK x1085, CAROLINA x1422, JERSEY x381, DAKOTA x216; 263 distinct state values incl Canadian postal fragments + bare zips) + whole batch violated platform convention (lowercase city, ALLCAPS full state). FIX SHIPPED: migration 20260712050000_backfill_classiccars_location_from_slug.sql (applied to prod, saved, NOT committed per rule) — batched security-definer fn reparsed all 22,659 non-dealer rows from surviving import_queue.raw_data.location slugs (all 33,900 queue rows intact) with longest-suffix US+CA state matching: 21,781 matched → Title Case city + 2-letter state + location_provenance source-DNA (observed_at=sitemap lastmod); 878 unmatched (international/malformed/source-typo slugs like texax) cleared with slug preserved, never guessed. Parser fixed in drain-queue-no-ai.mjs (parseLocationSlug, also covers parseClassicCarsHtml), node --check + 16 unit cases pass. marketplace_metro_pulse refreshes via cron */20 — no manual refresh needed. Verified: state distribution all 2-letter (FL 2581, CA 1956, NC 1269, NY 1085...), 0 lock waiters throughout. ISSUES.md entry added (FIXED). Uncommitted: migration file, drain-queue-no-ai.mjs, ISSUES.md. NEXT if anyone cares: 878 preserved slugs could get a manual/typo pass; other dealer clusters (19543 Morgantown PA x689, 90210 x476) are physical showrooms, left as-is.

## Branch
feat/cohort-terminal

## Recent Commits (last 3h)
none

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md
TOOLS.md
docs/library/technical/engineering-manual/18-deep-image-analysis.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/image-viewer/useImageViewerState.ts
nuke_frontend/src/components/image/MobileImageGallery.tsx
nuke_frontend/src/components/images/WalkAroundCarousel.tsx
nuke_frontend/src/components/profile/PublicImageGallery.tsx
nuke_frontend/src/components/vehicles/VehicleCardDense.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx
nuke_frontend/src/routes/DomainRoutes.tsx
package.json
scripts/daily-receipt/byok-image-batch.sh
scripts/daily-receipt/byok-vision-prompt.md
scripts/deep-image-analysis-byok.mjs
scripts/drain-queue-no-ai.mjs
supabase/functions/extract-auction-comments/index.ts
supabase/functions/extract-barrett-jackson/index.ts
supabase/functions/extract-bat-core/index.ts
supabase/functions/extract-cars-and-bids-core/index.ts
supabase/functions/extract-mecum/index.ts
supabase/functions/extract-rmsothebys/index.ts
supabase/functions/import-pcarmarket-listing/index.ts
supabase/functions/photo-pipeline-orchestrator/index.ts
supabase/functions/sync-live-auctions/index.ts
supabase/functions/universal-search/index.ts

## Staged
none

---
## Recent Checkpoints
2026-07-13_18-20-41.md
2026-07-13_18-14-31.md
2026-07-13_18-13-21.md
*(See .claude/checkpoints/ for full details)*

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read the handoff sections above
3. Check git log if more detail needed: `git log --oneline -10`
4. Check active agents: `cat .claude/agents/active/*.md 2>/dev/null`
