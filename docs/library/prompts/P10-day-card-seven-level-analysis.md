# P10: Day Card — Seven-Level Analysis Narrative

## Context
Read these before executing:
- `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — "The Day Card (Timeline Popup)" section, "Seven-Level Analysis"
- `nuke_frontend/src/pages/vehicle-profile/DayCard.tsx` — current Day Card component
- `nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx` — `openDayCardPopup` function (line ~477-511)
- `nuke_frontend/src/pages/vehicle-profile/hooks/useBuildStatus.ts` — work order / line item data
- `docs/library/reference/dictionary/README.md` — "Day Card", "Seven-Level Analysis", "Computation Surface"

## Problem
The Day Card currently shows raw data only — session metadata, photo counts, cost totals, work descriptions. The computation surface doc specifies **seven levels of contextual analysis** that produce a synthesized narrative paragraph. None of these levels are computed yet.

The Day Card today:
```
Feb 27, 2026 — Work: Heavy Work (14 photos)
Duration: 11h 30m
Parts: $1,239
Labor: $977.50
Description: "Exhaust fabrication — custom 304 SS mandrel bends..."
```

What the computation surface promises:
```
"Session 14 of the K2500 build. Exhaust fabrication complete — 11.5h labor
at $85/hr ($977.50) plus $1,239 in materials. This is 40% above national
median for comparable trucks, but the scope included custom 304 SS mandrel
bends and QTP electric cutouts that most builds skip. Dave Granholm approved
the estimate within 2 hours. The build is now 73% complete."
```

The narrative turns raw cost data into intelligence: is this expensive? Is it fast? Is it normal? Where is the build overall?

## Scope
Add computed narrative section to DayCard. One component edit + one new query. No new tables. No new edge functions.

## Steps

1. Read `DayCard.tsx` end to end. Understand what data it already has access to via props and the `get_daily_work_receipt` RPC.

2. Add a `useDayCardContext` hook (inline in DayCard, not a separate file) that gathers the data needed for analysis levels 1-2:

```sql
-- Level 1: Vehicle build arc
-- How many total work sessions? Which number is this one? What % of estimated hours done?
SELECT
  count(*) as total_sessions,
  sum(duration_minutes) as total_minutes,
  (SELECT count(*) FROM work_sessions
   WHERE vehicle_id = $1 AND session_date <= $2) as session_number
FROM work_sessions
WHERE vehicle_id = $1;

-- Level 2: Job comparison
-- What do similar operations cost elsewhere? (from analysis_signals if available)
SELECT score, label, reasons, evidence
FROM analysis_signals
WHERE vehicle_id = $1
  AND widget_slug IN ('build_progress', 'cost_analysis', 'labor_efficiency')
ORDER BY computed_at DESC
LIMIT 3;
```

3. Compute the narrative from available data. Rules:
   - If only Level 1 data exists (session count, build arc): write a short factual sentence. "Session 14 of 23. Build 73% complete by hours."
   - If Level 2 exists (comparison data from analysis_signals): add the comparative context. "Exhaust fabrication at $2,216 — 40% above national median, scope included custom SS work."
   - If no work session data exists for this day (it's a photo session or listing event): write an observation-appropriate sentence. "Photo session documenting 14 images of engine bay area."
   - If insufficient data for any narrative: return null. The narrative section doesn't render.

4. Render the narrative below the raw data section and above the nav bar in DayCard, styled as:
```
ANALYSIS
─────────────────────────────────────
[narrative paragraph, 9px Arial, color: var(--text-secondary), line-height 1.6]
```

5. The narrative is a `<p>` element. No bullet points. No headers inside it. It reads like a sentence a knowledgeable mechanic would say looking at the day's work in context of the whole build.

## Verify
- Navigate to K2500 profile (`/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c`)
- Click a day on the timeline that has a work session
- Receipt popup appears → click `+` → DayCard opens in PopupStack
- Below the raw data (duration, photos, costs), an ANALYSIS section renders with a contextual paragraph
- The paragraph mentions the session number, build progress percentage, and at least one comparative fact if analysis_signals exist
- Days with only photo sessions or listing events render an appropriate observation sentence
- Days with no enrichment data show no ANALYSIS section (null guard)

## Anti-Patterns
- Do NOT call an LLM to generate the narrative. This is template-based computation from structured data. String interpolation, not AI.
- Do NOT create a new edge function. The data is already in the DB — query it client-side.
- Do NOT create a separate `NarrativeGenerator` component. The narrative is 15-20 lines of template logic inline in DayCard.
- Do NOT show Level 3-7 analysis until the data sources exist (client communication tracking, technician profiles, shop metrics, regional rates, national benchmarks). Show what you have, hide what you don't.
- Do NOT show percentages or comparisons when sample sizes are too small. "Session 2 of 3" is fine. "Build 67% complete" from 3 sessions of unknown scope is misleading.

## Library Contribution
After completing:
- Update `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — add "Implementation Status" subsection noting which levels are now computed
- Update `docs/library/reference/dictionary/README.md` — add "Day Card Narrative" definition
- Update `docs/library/reference/encyclopedia/README.md` — add subsection to Day Card chapter documenting the template logic
