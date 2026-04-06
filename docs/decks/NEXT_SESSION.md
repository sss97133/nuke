# Luxe Fleet — Next Session Instruction Manual

**Read this before doing anything. This is what 100+ turns of work produced — what's solid, what failed, and what to do differently.**

---

## WHAT'S SOLID (don't rebuild)

| Asset | Path | Status |
|-------|------|--------|
| Commercial structure | `docs/decks/fleet-luxe-commercial-structure.md` | Complete. Thesis, contact chain, vehicle strategy, data framework. |
| Research | `docs/decks/assets/research-rental-to-purchase.md` | Complete. GT350-H, Porsche 80%, Enterprise 49%, Hertz-Tesla. |
| Chapter 14 | `docs/library/technical/design-book/14-deck-system.md` | Complete. 782 lines. Deck-as-view architecture. |
| Deck v2 | `docs/decks/luxe-fleet-ford-v2.html` | Content is strong. Logos mostly correct. Research integrated. Needs visual polish. |
| DB enrichment | 355/390 SBH orgs (91%) | brand_design_language populated. Logos, colors, GPS on key entities. |
| Logo manifest | `docs/decks/assets/logo-manifest.md` | Usage rules per background type. |
| Hotel logos fixed | Le Barthélemy (SVG), Le Toiny (SVG), Nikki Beach (SVG), FBM (dark+light variants) | In DB. |
| Stakeholder reviews | `docs/decks/reviews/` + SYNTHESIS.md | 5 simulated reviews. Actionable feedback. |
| Design book ch12+13 | `docs/library/technical/design-book/12-documents.md` + `13-multi-brand-composition.md` | Document tokens + multi-brand rules. |
| Brand scraper | `scripts/scrape-brand-assets.mjs` | Working. npm: `brand:scrape`. |
| Target analysis | `.claude/commands/target-analysis.md` | Slash command. |

## WHAT FAILED (don't repeat)

### 1. The standalone map
Built a Leaflet map from scratch 3+ times. Every iteration had:
- Coordinates in the ocean (villa cluster averages don't equal building positions)
- Overlapping labels (Leaflet has no collision detection)
- Ford logos floating through water (guessed road paths)
- Parent brand logos instead of property names (Eden Rock → "Oetker Hotels")
- `prompt()` dialogs blocking the page

**Why it failed:** Agents can't see the map tiles. Every coordinate is a guess. More rules in longer prompts made it worse.

**The actual solution:** Nuke already has a working map system:
- `nuke_frontend/src/components/map/NukeMap.tsx`
- `nuke_frontend/src/components/map/DeckGLMap.tsx`
- `nuke_frontend/src/components/map/hooks/useMapData.ts`
- Uses DeckGL + real viewport-based queries
- Has org detail panels, layer controls, search

The map at `nuke.ag/?tab=map` was returning a fetch error. **Fix the fetch error, filter to SBH, style for deck context.** Don't rebuild from scratch.

### 2. Incremental HTML patching
The deck went through 20+ edits. Each "fix" broke something else:
- Ford logo went from working SVG → broken PNG with filter → text wordmark → back to SVG
- FBM logo cycled through 5 different broken states
- Hotel interior photos got stuffed in then ripped out
- A `prompt()` dialog got added then had to be removed

**Why it failed:** Editing a 700-line HTML file through 20 sequential Edit tool calls. Context degrades, edits conflict, the file becomes a patchwork.

**The actual solution:** The deck should be GENERATED from data (Chapter 14 architecture), not hand-edited. Or at minimum: make ALL changes in ONE pass, not incrementally.

### 3. Logo contrast
Every logo had contrast issues because rules were applied per-edit:
- L'Officiel dark SVG on dark slide = invisible
- Ford Blue Oval with `brightness(0) invert(1)` = white blob
- FBM white JPG on light card = dark box showing

**The actual solution:** Logo variant selection must be SYSTEMATIC, not per-slide. The DB now has:
- `brand_design_language.logos.primary_dark` (for dark backgrounds)
- `brand_design_language.logos.primary_light` (for light backgrounds)
- `brand_design_language.logos.svg` (best quality)

A rendering function should pick the right variant automatically: `getLogoForBackground(orgSlug, bgType)`. Chapter 14 has the spec for this.

## WHAT THE NEXT SESSION SHOULD DO

### Priority 1: Fix `nuke.ag/?tab=map`
The existing map infrastructure is the right tool. The fetch error is the blocker. Diagnose and fix:
```bash
# Check the edge function that serves map data
supabase functions logs map-data --limit 20
# Or check the mapService.ts to see what endpoint it calls
```

### Priority 2: Clean deck render
Don't edit `luxe-fleet-ford-v2.html` incrementally. Instead:
- Read it for CONTENT (the thesis, the slides, the narrative)
- Build a render script that queries the DB for all entity data
- Outputs a clean HTML file with correct logos per background
- Every image from the confirmed working list (see logo-manifest.md)

### Priority 3: Ingest user's photos
The user shared 4 incredible Bronco-on-SBH photos in the chat:
- Vintage SBH road with old trucks (heritage)
- Classic airport approach shot (model under plane)
- Bronco in Gustavia (cobblestones, palms)
- Red Bronco at SBH airport with plane overhead

These are the money shots. They need to be saved and ingested into org_assets or vehicle_images.

### Priority 4: Eden Rock assets
`oetkerhotels.com/hotels/eden-rock-st-barths/` is covered in assets but fully JS-rendered. Needs browser automation (Chrome MCP) to scrape. Never use the Oetker parent brand logo — Eden Rock is Eden Rock.

### Priority 5: Colorways
The user mentioned colorways haven't been applied yet. Each brand has colors in `brand_design_language.colors`. The deck and map should use these systematically.

## KEY CONTEXT (domain knowledge from the session)

- **Fouquet's is buying the vehicles.** Not Ford, not Fleet Luxe. Fouquet's is the buyer.
- **Ford's ask is small:** 1 vehicle placement + 1 L'Officiel ad buy (EUR 7-60K)
- **FBM already sells Ford.** Ranger Raptors. ~20 Broncos. $1K/service call with no support.
- **The Bronco Roadster Concept exists.** Ford built a one-off modern U13 at Silver Lake + SEMA 2025. Robert Gelardi (Chief Designer). Editorial images at `fromtheroad.ford.com`.
- **Contact chain:** Hauthils → Stacey Bendet (alice+olivia CEO, was on SBH 14 weeks ago) → Lisa Materazzo (Ford CMO) → Robert Gelardi
- **SiBarth ≠ SiBarth Real Estate.** Two different companies. Ashley runs SiBarth (villas). He bought the first Bronco on SBH.
- **Heritage paradox:** The island protects everything (UNESCO beaches, architecture, vegetation) except the automotive landscape. Kia Picanto × Loro Piana.
- **GT350-H (1966):** Ford invented the rental-to-purchase pipeline the same year the Bronco launched. 4x production increase. The killer citation.
- **L'Officiel has a white logo variant:** `logo-lofficiel-rev-amtd.svg` for dark backgrounds
- **Fouquet's has both:** white SVG + black SVG on Storyblok CDN
- **Never use `alert()`, `confirm()`, or `prompt()` in any browser code**
