# CWTFO Handoff — 2026-03-06

## What Was Happening
Founder asked for status of all concurrent sessions after crashes. Escalated into a full data integrity audit when quality issues surfaced.

## What's Complete
1. **Situational brief** — full platform pulse delivered
2. **Data integrity audit** — measured by URL (not row count) for the first time. Key finding: 39% of database is duplicate/junk rows. Real vehicle count is ~630K, not 1.3M.
3. **Source-by-source extraction yield report** — shows exactly what each extractor captures vs what's available
4. **ConceptCarz investigation prompt** — ready at `.claude/prompts/CONCEPTCARZ_INVESTIGATION.md` for a dedicated agent to investigate and remediate 348K empty shell records

## Critical Findings (Do Not Lose)
- **BaT bloat**: 618K rows → 170K distinct URLs. Top listing duplicated 445 times.
- **ConceptCarz**: 348K records, all from one bulk import on 2026-02-06, zero provenance, zero images/desc/VIN. Likely auction results aggregator data that should be reference data, not vehicle records.
- **Barrett-Jackson gap**: 69K archived snapshots exist but only 19% of fields extracted — biggest enrichment opportunity from existing data.
- **Cars & Bids**: 34K vehicles have no URL — can't trace back to source.
- **Agent tasks stalled**: 22 pending tasks, 0 running. Crashes killed all agents and nobody restarted them.
- **CSS churn**: 10+ commits rewriting the same vehicle profile page since Feb 28.

## Founder's Direction
- Wants accountability at ingestion — log what tool, what URL, what was extracted vs available
- Wants measurement by URL, not vehicle row
- Wants "look once, extract everything" — not repeated partial passes
- Wants transparency papers per ingestion run
- Wants signal merging, not duplicate stacking — 430 copies should merge into 1 record with 430 observations
- Is frustrated that agents aren't producing visible quality improvements despite volume of work

## What's Next
1. **Launch ConceptCarz investigation** — give prompt to a new agent, founder will babysit
2. **BaT deduplication** — merge 618K → 170K, keep richest record per URL
3. **B-J re-extraction from archives** — 69K snapshots sitting unused, biggest quick win for data quality
4. **Ingestion reform** — every ingest must: check URL exists first, log fields available vs extracted, normalize source names
5. **Restart agent tasks** — 22 pending tasks need `nuke-spawn` to dispatch
6. **Source name normalization** — "mecum"/"Mecum", "bat"/"Bring a Trailer" splits need cleanup

## Previous Handoff (Vehicle Profile Redesign)
The prior session was working on vehicle profile page fixes. See commit `b66bf1a63`. Outstanding frontend work listed in that session's notes:
- Gallery toolbar buttons broken (no onClick handlers)
- Scroll-to-top timeline reveal
- Tab bar redesign
- Nuke estimate accuracy issues
- Key files: `vehicle-profile.css`, `WorkspaceContent.tsx`, `BarcodeTimeline.tsx`, `ImageGallery.tsx`

## Files Changed This Session
- `DONE.md` — added audit findings
- `.claude/HANDOFF.md` — this file
- `.claude/prompts/CONCEPTCARZ_INVESTIGATION.md` — new, investigation prompt for dedicated agent
