# Session Handoff — 2026-03-25 08:30

## What Happened (12+ hour session, 2026-03-23 23:00 → 2026-03-25 08:30)

Massive autonomous session. 60+ commits, 40+ agents, every major system touched.

## Still Running
- Import queue drain (4,329 pending, processing)
- 50+ crons continuous enrichment
- Valuation shards (5x every 10min)
- Description discoveries (40/batch, chaining)
- All discovery crons for reactivated sources

## Next Priorities
1. Verify nuke.ag renders correctly (treemap, feed, browse, vehicle profile)
2. ClassicCars.com integration (40K listings gap)
3. Classic Driver sitemap parsing (European market)
4. The Market by Bonhams integration
5. Stripe/payment flow (still at zero records)
6. FB description enrichment via residential Playwright
7. Photo library page testing

---
# Session Handoff — 2026-03-25 09:22:58
*(Written explicitly by agent — high-quality context for next session)*

## What Was Happening
15+ hour session. 70+ commits, 50+ agents. Major deliverables: popup rhizome system (stacking popups, every badge clickable), hero treemap panels for sort buttons, view history tracking, interest memory, source badges on cards, clean card images (no overlays), avg price purged from 30+ files, BaT catalog confirmed 235K total (128K in DB, 106K gap), 89 stale sources reactivated (8,919 new vehicles), comment backfill cron re-enabled, design encyclopedia built. Still running: BaT shallow backfill (1,842 remaining), 50+ crons, valuation shards. Next: verify popup rhizome renders on nuke.ag, BaT full catalog crawl via sitemap (106K gap), ClassicCars.com integration (40K gap), surface description_discoveries signal data in vehicle cards/popups.

## Branch
main

## Recent Commits (last 3h)
8cc974944 View history tracking + recently viewed strip, BaT comment backfill rewrite
e92993232 Popup rhizome system: stacking popups, infinite drill-down, every badge clickable
fe733cd5c Remove all average price displays from UI, replace with median/range
66439586a Popup rhizome: wire card clicks into stacking popup system
bd2b32e40 Hero treemap panels for sort buttons + remove avg price
b27462d86 Feed hero panels: toolbar sort buttons open dimension visualizations
d64692f9b Card UX overhaul: inline expand (no reflow), rich tooltips, no duplication
d0eb464aa Fix expanded card: overlay in-place instead of pushing full row
1c29a283f Rich badge hover tooltips: dimension-specific stats replace raw counts
3302855ad Fix expanded card: remove duplicates, show rhizome data instead
8043422e9 Feed cards: clean images, no overlays, unified info line below title
9805cf6ec Feed card: remove image overlays, move all badges to info line below

## Uncommitted Changes (not yet committed)
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/feed/components/VehicleCard.tsx
nuke_frontend/src/feed/components/card/CardShell.tsx

## Staged
none

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read above "What Was Happening" section
3. Check git log if more detail needed: `git log --oneline -10`
4. Register in .claude/ACTIVE_AGENTS.md before starting

---
# Auto-Checkpoint — 2026-03-25 09:24:10
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
8cc974944 View history tracking + recently viewed strip, BaT comment backfill rewrite
e92993232 Popup rhizome system: stacking popups, infinite drill-down, every badge clickable
fe733cd5c Remove all average price displays from UI, replace with median/range
66439586a Popup rhizome: wire card clicks into stacking popup system
bd2b32e40 Hero treemap panels for sort buttons + remove avg price
b27462d86 Feed hero panels: toolbar sort buttons open dimension visualizations

## Uncommitted Changes
.claude/HANDOFF.md
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/feed/components/VehicleCard.tsx
nuke_frontend/src/feed/components/card/CardShell.tsx
scripts/bat-models-discovery.mjs

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-25 09:33:41
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
f8e795a81 Add condition observation backfill orchestrator script
8d8f04313 Bonhams extraction fix: 1,079 model names, 960 VINs, 38 body styles cleaned
8cc974944 View history tracking + recently viewed strip, BaT comment backfill rewrite
e92993232 Popup rhizome system: stacking popups, infinite drill-down, every badge clickable
fe733cd5c Remove all average price displays from UI, replace with median/range

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
DONE.md
scripts/bat-gap-discovery.mjs
scripts/bat-models-discovery.mjs

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-25 13:29:14
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
a2a350e66 Switch condition extraction to Gemini/Grok fallback chain (Anthropic credits exhausted)

## Uncommitted Changes
none

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-25 15:33:33
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/HANDOFF.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-25 15:38:25
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/HANDOFF.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-25 18:12:29
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
9039aa705 Fix condition backfill self-chaining (remaining count was timing out)
8aba867db Add Kimi k2-turbo as primary LLM, reorder fallback chain
b42f04e07 18 niche sources: 98K URLs, 5 RSS feeds, The Market by Bonhams 5.5K, ER Classics 1.8K
026e7e174 ClassicCars.com: 35,070 listings from Azure sitemaps, all queued
c78c83a09 Classic Driver: 54,890 European vehicle URLs from sitemap, all queued

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
scripts/mecum-algolia-discovery.mjs

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-25 18:19:00
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
66f5b8133 Revive all dead sources: Mecum Algolia (303K lots), BJ Strapi API (64K lots), RM 56 new
9039aa705 Fix condition backfill self-chaining (remaining count was timing out)
8aba867db Add Kimi k2-turbo as primary LLM, reorder fallback chain
b42f04e07 18 niche sources: 98K URLs, 5 RSS feeds, The Market by Bonhams 5.5K, ER Classics 1.8K
026e7e174 ClassicCars.com: 35,070 listings from Azure sitemaps, all queued
c78c83a09 Classic Driver: 54,890 European vehicle URLs from sitemap, all queued

## Uncommitted Changes
none

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-25 18:41:37
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
5890d31cd Fix condition backfill: 500 char min desc, ORDER BY longest first, adaptive loop
66f5b8133 Revive all dead sources: Mecum Algolia (303K lots), BJ Strapi API (64K lots), RM 56 new
9039aa705 Fix condition backfill self-chaining (remaining count was timing out)

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-25 22:36:34
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
a9513ee38 Badge Ontology: canonical spec for all badges — every badge is a data portal

## Uncommitted Changes
none

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Session Handoff — 2026-03-25 23:44:37
*(Written explicitly by agent — high-quality context for next session)*

## What Was Happening
CRITICAL: 49 frontend commits went to nuke_frontend/ which IS the correct path for Vercel, but the LOCAL working tree is a skeleton — only nuke_frontend/src/components/ exists on disk. Git objects have all 126 files but they're not checked out. Vercel deploys from git so the DEPLOYED site has everything, but local dev (npm run dev) is broken. Need to: 1) figure out why git checkout HEAD -- . doesn't restore nuke_frontend files, 2) restore the working tree so local dev works, 3) test all 49 commits of UI changes locally, 4) the timeline whitespace fix IS in git but may have a runtime bug — needs local testing. Also: comment count badge shows stale number (87 vs 527 actual). BaT fetch still running PID 69801. 148K import queue. 50+ crons.

## Branch
main

## Recent Commits (last 3h)
52c885029 Wire popup search filtering: every popup now filters content via title bar search input
6f0233a76 Contextual Agent Harness architecture: BYOK AI in every popup, cost model, subscription tiers
7bffa0243 Context harness + popup terminal vision: AI-aware search, CLI-style popup windows
294f97969 Buyer Intelligence Thesis + Popup Finder Windows feedback
a9513ee38 Badge Ontology: canonical spec for all badges — every badge is a data portal
214e18997 Fix auction banner: replace dark theme with light design system
81c660eee CDO: enrichment_quality_report() RPC — 8-section data quality dashboard
ff8b08c3e Auction banner: kill triple BaT, add BID NOW button, remove emoji
e9200b4f1 Fix timeline: remove duplicate header, compress empty years, hide when no events
a8f8955bd Redesign external auction live banner: remove redundancy, add BID NOW action
6a626c491 Fix vehicle timeline: remove redundant header, compress empty year ranges
59974e8e4 Deal flow: exchange tables restored, Stripe invoice RPC, Connect onboarding persisted Org discovery: full diagnostic — 63K sellers, 45K unlinked, pipeline disconnected
27dd49d4e Fix revenue infrastructure: exchange tables, invoice payments, Connect onboarding

## Uncommitted Changes (not yet committed)
none

## Staged
none

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read above "What Was Happening" section
3. Check git log if more detail needed: `git log --oneline -10`
4. Register in .claude/ACTIVE_AGENTS.md before starting

---
# Auto-Checkpoint — 2026-03-26 00:13:18
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
2ed610acd Fix hero_newest: use v.source not platform fields, fix source abbreviations

## Uncommitted Changes
none

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-26 00:17:07
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
2ed610acd Fix hero_newest: use v.source not platform fields, fix source abbreviations

## Uncommitted Changes
.claude/HANDOFF.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-26 00:36:08
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
2ed610acd Fix hero_newest: use v.source not platform fields, fix source abbreviations

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/pages/vehicle-profile/VehicleBadgeBar.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleSubHeader.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`
