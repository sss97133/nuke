# Handoff — 2026-03-21 Evening

## What happened
- Header rework shipped and working (one row, three zones)
- Library expanded by 2,862 lines (contemplations, papers, design book chapters)
- Vehicle profile fixes: empty rows hidden, dossier identity hidden, banner minimized, gallery contain default
- VehicleSubHeader badge bar made visible via CSS swap (VehicleHeader hidden but mounted for data)
- Three broken production pushes: hasImages filter emptied feed, VehicleHeader removal broke data flow, revert/re-push churn

## What's live now
- Header: new single-row design (working)
- Feed: back to showing all vehicles (hasImages reverted)
- Profile: VehicleSubHeader badges visible + sticky, VehicleHeader hidden, empty rows gone, banner minimized
- Gallery: contain default for thumbnails

## What's NOT done
- Image tab bar still has 8 confused buttons (ZONES/GRID/FULL/INFO/SESSIONS/CATEGORY/CHRONO/SOURCE)
- Feed still shows boats/RVs/trailers from FB Marketplace (needs vehicle type filtering at ingestion)
- Feed images still have data quality issues (FB Marketplace images not imported)
- Timeline barcode-to-heatmap compression on scroll (not started)
- No local dev testing workflow established — MUST test locally before pushing

## Critical lesson
DO NOT push untested changes to production. Branch, local dev server, verify every affected page visually, then merge. The hasImages default and VehicleHeader removal both would have been caught by 30 seconds of local testing.
