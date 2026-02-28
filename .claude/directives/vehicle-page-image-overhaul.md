# P1: Vehicle Page Image System Overhaul — CEO Directive

**GitHub Issue:** https://github.com/sss97133/nuke/issues/191
**Reference:** https://nuke.ag/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c

## THE PROBLEM

The image layout on vehicle pages is not telling the story of the vehicle. We have 33M images, vision model classifications, EXIF data (camera, GPS, timestamps), category tags, session grouping, and AI analysis — and almost none of it is doing work in the UI. The gallery is a database dump with filters bolted on. The controls have drifted from intent.

## WHAT'S BROKEN

1. **Hero area** — Black void when media doesn't load. Should always be a super clear, beautiful shot that proves the vehicle is real. Non-negotiable.
2. **Flat image grid** — 50+ images in 3-column masonry with zero hierarchy. Money shot and a camper tie-down close-up get identical treatment.
3. **Vision data is buried** — YONO classifications, EXIF, GPS coordinates, AI analysis — all hidden behind clicks or tiny badges. The intelligence layer exists but the frontend isn't consuming it.
4. **"ANALYZE NOW" on existing vehicles** — If a vehicle has been in the system, analysis should already be done. This button undermines confidence.
5. **"exterior_three_quarter" terminology** — DEPRECATE ENTIRELY. This wording has proliferated everywhere. Replace with purely technical coordinate-based naming. Coordinates eventually render colloquial labels (engine bay, undercarriage, details) but the underlying system is coordinate-driven, not prose-driven.
6. **Control bar drift** — Grid/Full/Info/Sessions/Chrono/Category/Source/Zoom are accumulated feature switches, not a coherent viewing experience. Defaults should tell a story without requiring the user to dig.

## THE DIRECTION

Design references: **Pic-Time** (immersive hero, smooth lightbox, editorial masonry, highlights-first curation), **iPhone Photos** (clean browsing, metadata surfaced naturally), **Adobe Bridge** (data-dense info views for power users). The utilitarian aesthetic stays — Arial, flat, data-dense, greyscale. Functionally superior, not decorated.

### Hero
- Best exterior shot selected by vision model confidence score, not "first image" or whatever primary_image_url defaults to
- Surface metadata inline below hero: camera, location (GPS → city/state), date
- **Architect hero container as flexible media slot** — static image now, carousel next, livestream portal later. Do NOT hardcode as `<img>`

### Post-Hero Carousel → Coordinate Map
- Short term: curated walk-around sequence (front → rear → interior → engine → undercarriage → details → documents) driven by category tags
- Long term: interactive coordinate map overlay on vehicle silhouette showing where each image was captured
- This is the high-tech differentiator

### Image Grouping
- Collapsible sections: "ENGINE BAY (6)" not flat grid with tiny green chips
- Model: Highlights / Exterior / Engine / Interior / Undercarriage / Detail / Documents

### GPS Map Toggle
- Add to image sub-header toolbar
- Toggle between gallery view and map showing photo capture locations
- Previously attempted, fell apart due to rough implementation. Better mapping capability now — bring it back

### Pre-Analysis Pipeline
- No more "ANALYZE NOW" buttons on already-ingested vehicles
- Run vision analysis on ingest automatically
- Button can exist for manual re-analysis but should not be default state

## AGENT ASSIGNMENTS

- **CTO** — Coordinate across all of this. Touches frontend, vision pipeline, and data schema.
- **CDO (VP Design)** — Lead layout overhaul. Pic-Time/iPhone Photos/Bridge references. Keep it utilitarian.
- **VP Vehicle-Intelligence** — Coordinate map system. Deprecate "exterior_three_quarter", define coordinate-based classification schema.
- **VP AI** — Pre-analysis pipeline. Every image classified on ingest.
- **VP Platform** — Hero container architecture (static → carousel → livestream). GPS map component. Performance.
