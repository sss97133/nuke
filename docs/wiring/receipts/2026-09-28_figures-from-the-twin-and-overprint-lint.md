# Receipt: component-location figures from the digital twin; overprint lint; one row per unsettled wire

- **Date:** 2026-09-28 (afternoon)
- **Change type:** toolchain (`calc-data/figures_v5.py` new, `diagram_v5.py`, `manual_v5.py`) + manual pages
- **Follows:** `receipts/2026-09-28_wiring-diagram-sheets-from-rows.md`
- **Ask (owner, 2026-09-28):** "whats missing is the drawing of the things the wires control ... back in the day they
  draw incredible 2d images ... with cut out of vehicle for context ... nowadays these visuals come from the cad files";
  "your pdf was almost convincing but fell flat because a lot of supplemental data was missing and basic design
  errors, overlaping text and wires etc. like no one looked at it before they sent it to me".

## The overprint: cause and cure
- Cause: a plug whose cavities are not recorded printed all its wires on one ○ row, so their labels stacked. I saw it
  on sheets 1-9/1-10 and shipped anyway. That is the "done from repo state" failure the working rules forbid.
- Cure in the generator, not by hand: (a) `rows_for` gives every wire whose cavity is not settled its own row, keyed by
  wire id; (b) every text box on a sheet is recorded and `overlaps()` fails the build on any intersecting pair, the same
  way `book_lint` fails on a code word. Result: 0 overprints on all 8 sheets (build output 2026-09-28).

## Figures from the twin (what is real, what is not)
- Test renders (headless Blender 4.3.2, Freestyle ink): the TurboSquid body (647 meshes, 1.36 M vertices) draws as
  manual-grade line art; the K5H_* component insert is **primitives** (8-vertex boxes, 64-vertex cylinders: coils,
  injectors, sensors, M130, PDM30, battery…), so a component drawn from the twin is a box, not the part.
- Therefore `figures_v5.py` renders **component-location** figures only: camera above the driver's front quarter
  (azimuth −20°, elevation 62°; and −50°/35°), the hood removed by the camera clip plane 0.30 m above the block,
  body as grey ghost lines, components in ink, and each component's true 2-D position written to JSON.
- `manual_v5.py` page **Component Location — Engine Bay**: the figure with numbered call-outs at the twin positions and
  a legend of registry plugs (TWIN_PLUG map). M130 and PDM30 are noted "mount not decided" (state §4). The page states
  that components are placeholder outlines until vendor CAD is added.
- Part pictorials (the GM 0A-5 style) need vendor CAD: TE/Deutsch publish STEP for DT/DTM (te.com autosport CAD page,
  3dfindit), Bosch and Blue Sea likewise; MoTeC boxes exist as community models (GrabCAD "motec"). A STEP → mesh step
  is missing on this Mac (system Python 3.14 refuses cadquery; an install into Blender's bundled Python 3.11 is being
  tried). A Canny trace of the truck's own photos was tested and is not manual-grade (noise from packaging and
  background); not used.

## What the 1987 manual has that this book does not yet (from the 1987 LDTSM text, Section 8A "Cab Electrical")
- Basic electrical pages: circuit controllers, wire size table, test-lamp use.
- Per system: DESCRIPTION → DIAGNOSIS CHART (symptom → numbered PROCEDURE steps with the wire/terminal to test) →
  ON-VEHICLE SERVICE (repair and replacement) → SPECIFICATIONS → SPECIAL TOOLS.
- Component location views with numbered call-outs (now started: one page, engine bay).
- The book has: general description, connector identification, circuit tabulation, specifications (options,
  readiness, fill), one component-location page, wiring diagram sheets with parts lists.

## Measured (2026-09-28, after)
- Manual: 14 pages (1-1 … 1-6 text/tables/location; 1-7 … 1-14 diagram sheets incl. one parts facing page).
- Sheets: sensors 26/0 open, coils 32/0, injectors 16/0, throttle-power 25/18, front body 44/35. Overprints: 0.

## Open (named close paths)
- Vendor CAD per plug (TE STEP first: DT/DTM/D38999 bodies), tessellated to the twin, replacing the insert's boxes; then
  the GM-style part pictorials at stated azimuth/elevation.
- Diagnosis charts per system generated from the rows (which wire, which terminal, expected reading).
- Special-tools page from `catalog/tools.yaml`; wire-size and circuit-controller pages from the canon chapters.
