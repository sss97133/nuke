# Handoff — 2026-03-06

## What I Was Working On
Vehicle profile page redesign — fixing layout proportions, contrast, timeline popup clipping, and empty widget visibility.

## What's Complete
All 5 priority fixes are implemented, verified via Playwright, and committed:

1. **Column widths 30/70** — `--vp-col-left: 30%`, `--vp-col-right: 70%` in both light/dark token blocks + `DEFAULT_LEFT_PCT = 30` in WorkspaceContent.tsx
2. **Hero image 550px** — `--h-hero: 550px` token, removed `max-height: 260px !important` cap
3. **Heatmap contrast** — Overrode `--heat-0: #d4d4d4` (light) / `#3a3a3a` (dark) and `--heat-2: #6ee7b7` / `#4ade80` directly in `.vehicle-profile-page` token blocks. Month/day labels switched from `--vp-text-faint` to `--vp-pencil`.
4. **Receipt popup** — Changed `.receipt` to `position: fixed; z-index: 1100` with `max-height: 60vh; overflow-y: auto`. BarcodeTimeline.tsx `onCellClick` uses viewport-relative coords with right-edge clamping.
5. **Empty widgets** — Timeline widget gated on `timelineEvents.length > 0`, Comments & Bids gated on `totalCommentCount > 0`.

Also: gitignored `scripts/data/` (~1.4GB) and `nuke_frontend/public/data/*.json`.

## Commits
- `b66bf1a63` — feat: vehicle profile redesign + multi-agent batch (163 files)
- `4d3a345b9` — chore: gitignore scripts/data/ and large geo JSON

## What's Next (from user's original request, not yet done)
- **Gallery toolbar buttons broken** — ZONES/GRID/FULL/etc in WorkspaceContent have no onClick handlers. Need to wire to ImageGallery's viewMode state.
- **Scroll-to-top timeline reveal** — Full timeline auto-reveals at scroll top, collapses when scrolled down.
- **Tab bar redesign** — Proper tab bar look, + tab button, reveal only at scroll top.
- **Vehicle-specific map** — Map widget showing only this vehicle's location data.
- **Remove "minimal view"** from header. Add text size controls (A-/A+).
- **Move Feed/Garage/Map** to main site header (currently only in HomePage).
- **Self-fetching widget empty states** — Deal Jacket, Nuke Estimate, Auction History still render shells when empty.
- **Fix Nuke estimate** — user says it's "wildly wrong".
- **Image curation** — Default view should showcase best photos prominently.

## Key Files
- `nuke_frontend/src/styles/vehicle-profile.css` — the active CSS (NOT vehicle-profile-redesign.css which is unused)
- `nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx` — two-column layout, gallery toolbar, widget composition
- `nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx` — timeline heatmap + receipt popup
- `nuke_frontend/src/components/images/ImageGallery.tsx` — the real gallery with working viewMode state (3900+ lines)
