# Handoff — Assembled 2026-03-28 16:31:44

*Auto-assembled from per-agent handoff files. Most recent first.*

---
# Session Handoff — 2026-03-28_16-31-44 (agent 51793)

## What Was Happening
Work photo pipeline — CLOSED OUT. Full system built: drop-folder ingest (vision + AirTag co-location), work-photos auto-intake (launchd), activity-linker (8K EXIF pings backfilled), device-ping edge function, tracked_devices/device_locations/known_places tables. 711+ photos ingested across 4 vehicles. Actor profile derived. Key design decision: NO iOS Shortcuts — location comes from photos (EXIF GPS) and AirTags (FindMy), not user-configured automations. Native app background location when it exists. Everything documented in memory/work-photo-system.md.

## Branch
main

## Recent Commits (last 3h)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
.claude/rules/frontend.md
DONE.md
docs/library/reference/dictionary/README.md
docs/library/reference/encyclopedia/README.md
docs/library/reference/index/README.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/map/NukeMap.tsx
nuke_frontend/src/components/map/controls/MapLayerPanel.tsx
nuke_frontend/src/components/map/hooks/useMapLayers.ts
nuke_frontend/src/components/map/mapService.ts
nuke_frontend/src/components/map/types.ts
nuke_frontend/src/design-system.css
nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/styles/unified-design-system.css
package.json
scripts/drop-folder-ingest.mjs
scripts/fb-marketplace-local-scraper.mjs
scripts/user-stylometric-analyzer.mjs
supabase/functions/_shared/archiveFetch.ts
supabase/functions/_shared/batFetcher.ts
supabase/functions/_shared/hybridFetcher.ts
supabase/functions/refine-fb-listing/index.ts

## Staged
none

---
# Session Handoff — 2026-03-28_16-30-41 (agent 51298)

## What Was Happening
Redid vehicle profile build data integration using library harness. Read encyclopedia, dictionary, computation surface doc, schematics, design book foundations+screens, frontend rules, library rules, ALL existing code first. What was done: (1) VehicleProfileContext.loadTimelineEvents() now loads work_sessions in parallel with timeline_events and merges them (work sessions become event_type: 'work_session' events). (2) BarcodeTimeline.tsx enhanced: recognizes work_session events with WORK_TYPE_LABELS, tags EventDay.hasWorkSession + workMeta, receipt popup shows duration/photos/description for work days, 'OPEN DAY CARD' button opens DayCard in PopupStack. (3) DayCard.tsx adapted for popup mode: isPopup + vehicleId props, auto-loads detail via get_daily_work_receipt RPC, shows header with work type/description/costs in popup mode. (4) BuildLog CollapsibleWidget removed from WorkspaceContent (was a parallel system per computation surface doc). (5) GenerateBill + WorkOrderProgress moved INTO BuildStatus panel widget. (6) Docs: computation surface doc section 7 added (timeline data merging), dictionary Work Session added. K2500 test vehicle: 26 work sessions now visible as green heatmap cells in BarcodeTimeline, clicking opens receipt then Day Card popup. Library gaps still open: schematics/vehicle-profile.md stale, 04-screens.md component inventory stale.

## Branch
main

## Recent Commits (last 3h)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
.claude/rules/frontend.md
DONE.md
docs/library/reference/dictionary/README.md
docs/library/reference/encyclopedia/README.md
docs/library/reference/index/README.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/map/NukeMap.tsx
nuke_frontend/src/components/map/controls/MapLayerPanel.tsx
nuke_frontend/src/components/map/hooks/useMapLayers.ts
nuke_frontend/src/components/map/mapService.ts
nuke_frontend/src/components/map/types.ts
nuke_frontend/src/design-system.css
nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/styles/unified-design-system.css
package.json
scripts/drop-folder-ingest.mjs
scripts/fb-marketplace-local-scraper.mjs
scripts/user-stylometric-analyzer.mjs
supabase/functions/_shared/archiveFetch.ts
supabase/functions/_shared/batFetcher.ts
supabase/functions/_shared/hybridFetcher.ts
supabase/functions/refine-fb-listing/index.ts

## Staged
none

---
# Session Handoff — 2026-03-28_16-14-22 (agent 44579)

## What Was Happening
Wrote canonical vehicle profile computation surface doc in design-book. Updated dictionary (6 terms), frontend rules (surgical edits), encyclopedia (computation surface section), MEMORY.md pointer. This doc is the reference for all future vehicle profile work — agents must read it before touching profile code.

## Branch
main

## Recent Commits (last 3h)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
.claude/rules/frontend.md
DONE.md
docs/library/reference/dictionary/README.md
docs/library/reference/encyclopedia/README.md
docs/library/reference/index/README.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/map/NukeMap.tsx
nuke_frontend/src/components/map/controls/MapLayerPanel.tsx
nuke_frontend/src/components/map/hooks/useMapLayers.ts
nuke_frontend/src/components/map/mapService.ts
nuke_frontend/src/components/map/types.ts
nuke_frontend/src/design-system.css
nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/styles/unified-design-system.css
package.json
scripts/drop-folder-ingest.mjs
scripts/fb-marketplace-local-scraper.mjs
scripts/user-stylometric-analyzer.mjs
supabase/functions/_shared/archiveFetch.ts
supabase/functions/_shared/batFetcher.ts
supabase/functions/_shared/hybridFetcher.ts
supabase/functions/refine-fb-listing/index.ts

## Staged
none

---
# Session Handoff — 2026-03-28_15-54-14 (agent 34740)

## What Was Happening
Built build log UI on vehicle profile — BuildLog.tsx, DayCard.tsx, WorkOrderProgress.tsx, GenerateBill.tsx, useBuildLog.ts hook. Wired into WorkspaceContent.tsx left column after Build Status panel. Self-guarding (returns null if no work_sessions). K2500 renders 26 day cards with photos grouped by area (exhaust, brakes, general). Calendar strip at top shows all sessions color-coded by work type. Sign-off checkboxes toggle line item status between complete/in_progress. Generate Bill renders invoice inline with NUKE header, vehicle info, customer info from deal_jackets, line items table, totals. Send fires via Resend edge function (send-invoice-email — NOTE: this edge function may need to be created/deployed if it doesn't exist yet). Next: create send-invoice-email edge function if missing, real-time Supabase subscriptions for work_sessions/line_items changes, photo lightbox on DayCard expanded view.

## Branch
main

## Recent Commits (last 3h)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
docs/library/reference/dictionary/README.md
docs/library/reference/index/README.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/map/NukeMap.tsx
nuke_frontend/src/components/map/controls/MapLayerPanel.tsx
nuke_frontend/src/components/map/hooks/useMapLayers.ts
nuke_frontend/src/components/map/mapService.ts
nuke_frontend/src/components/map/types.ts
nuke_frontend/src/design-system.css
nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/styles/unified-design-system.css
package.json
scripts/drop-folder-ingest.mjs
scripts/fb-marketplace-local-scraper.mjs
scripts/user-stylometric-analyzer.mjs
supabase/functions/_shared/archiveFetch.ts
supabase/functions/_shared/batFetcher.ts
supabase/functions/_shared/hybridFetcher.ts
supabase/functions/refine-fb-listing/index.ts

## Staged
none

---
# Session Handoff — 2026-03-28_15-26-05 (agent 22640)

## What Was Happening
Work photo pipeline session — COMPLETE. Built: (1) drop-folder-ingest.mjs with vision classify + AirTag co-location routing, 496 March photos ingested. (2) work-photos-intake.mjs with GPS shop routing, launchd daemon com.nuke.work-photos every 10min. (3) activity-linker.mjs with device_locations backfill (8K pings from EXIF), work session detection. (4) device-ping edge function deployed for iOS Shortcut location pings. (5) DB: tracked_devices, device_locations, known_places tables. 3 devices registered (phone, laptop, K10 AirTag), 71 C10 AirTag added, Karmann Ghia vehicle created (7bb50537). Photos.sqlite snapshot refreshed. Actor profile derived (23 work days, 10.4h avg, 9:35am-8pm). NEXT: user needs to create iOS Shortcut on phone pointing to device-ping endpoint. Then test full loop: take photo at shop → auto-ingest → AirTag resolves vehicle → done.

## Branch
main

## Recent Commits (last 3h)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
docs/library/reference/dictionary/README.md
docs/library/reference/index/README.md
nuke_frontend/src/App.tsx
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/map/NukeMap.tsx
nuke_frontend/src/components/map/controls/MapLayerPanel.tsx
nuke_frontend/src/components/map/hooks/useMapLayers.ts
nuke_frontend/src/components/map/mapService.ts
nuke_frontend/src/components/map/types.ts
nuke_frontend/src/design-system.css
nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/loadVehicleData.ts
nuke_frontend/src/styles/unified-design-system.css
package.json
scripts/drop-folder-ingest.mjs
scripts/fb-marketplace-local-scraper.mjs
scripts/user-stylometric-analyzer.mjs
supabase/functions/_shared/archiveFetch.ts
supabase/functions/_shared/batFetcher.ts
supabase/functions/_shared/hybridFetcher.ts
supabase/functions/refine-fb-listing/index.ts

## Staged
none

---
## Recent Checkpoints
2026-03-28_16-31-35.md
2026-03-28_16-27-28.md
2026-03-28_16-26-30.md
*(See .claude/checkpoints/ for full details)*

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read the handoff sections above
3. Check git log if more detail needed: `git log --oneline -10`
4. Check active agents: `cat .claude/agents/active/*.md 2>/dev/null`
