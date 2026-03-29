# P13: Analysis Signals — Compute Sweep for Active Vehicles

## Context
Read these before executing:
- `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — "Do Not Cache What Should Be Computed", "Existing Tables to Use" (analysis_signals row)
- `nuke_frontend/src/pages/vehicle-profile/AnalysisSignalsSection.tsx` — frontend renderer (just created)
- `nuke_frontend/src/pages/vehicle-profile/hooks/useAnalysisSignals.ts` — query hook (just created)
- `supabase/functions/analysis-engine-coordinator/index.ts` — existing sweep coordinator
- `TOOLS.md` — check for existing analysis/computation edge functions

## Problem
Phase 4 of vehicle profile polish wired the frontend to read `analysis_signals` and render them as severity-colored rows with popup detail. But the table is sparse — most vehicles have zero signals because the `analysis-engine-coordinator` hasn't been run recently or doesn't compute the signal types the frontend expects.

The frontend is ready. The backend pipeline needs to populate the table for the vehicles that matter most — the ones people actually look at.

## Scope
1 script + 1 edge function update. No new tables. No frontend changes.

## Steps

1. Query which vehicles have been viewed recently (the ones that would benefit from signals):
```sql
-- Vehicles with recent profile views but no analysis_signals
SELECT v.id, v.year, v.make, v.model,
  (SELECT max(viewed_at) FROM vehicle_views vv WHERE vv.vehicle_id = v.id) as last_viewed,
  (SELECT count(*) FROM analysis_signals s WHERE s.vehicle_id = v.id) as signal_count
FROM vehicles v
WHERE v.id IN (
  SELECT DISTINCT vehicle_id FROM vehicle_views
  WHERE viewed_at > now() - interval '30 days'
)
ORDER BY signal_count ASC, last_viewed DESC
LIMIT 100;
```

2. Read the existing `analysis-engine-coordinator` edge function. Understand what widget slugs it computes, what triggers a recomputation, and how staleness is tracked.

3. Create a script `scripts/backfill-analysis-signals.mjs` that:
   - Queries the 100 most-viewed vehicles without signals (query above)
   - For each vehicle, calls the `analysis-engine-coordinator` with `{ action: "compute", vehicle_id }`
   - Batches 5 at a time with 2s delay between batches
   - Logs: `[vehicle_id] computed N signals (severity breakdown)`
   - Stops if any call returns an error (don't burn through credits on a broken pipeline)

4. The coordinator should compute at minimum these signal types:
   - `build_progress` — % complete based on work sessions / estimated total
   - `data_quality` — field fill rate, image count, provenance coverage
   - `price_position` — sale price vs nuke estimate divergence
   - `photo_coverage` — zone distribution (all engine bay, no interior = gap)
   - `identity_confidence` — VIN decode match rate

   If the coordinator doesn't compute these, add them. Each signal computation is:
   ```typescript
   {
     widget_slug: 'data_quality',
     score: 72,          // 0-100
     label: 'Data Quality: Adequate',
     severity: 'medium', // critical | high | medium | low
     reasons: ['Missing interior photos', 'No service records', '3 of 16 fields have provenance'],
     evidence: { field_fill_rate: 0.56, image_count: 14, zone_coverage: { engine_bay: 8, exterior: 6 } },
     recommendations: { next_actions: ['Upload interior photos', 'Add service records'] },
     confidence: 0.85,
   }
   ```

5. Add to package.json:
```json
"ops:signals": "dotenvx run -- node scripts/backfill-analysis-signals.mjs"
```

## Verify
- Run `npm run ops:signals`
- Check K2500 has signals: `SELECT widget_slug, score, severity, label FROM analysis_signals WHERE vehicle_id = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';`
- Navigate to K2500 profile — SIGNALS section appears below dossier panel with severity-colored rows
- Click a signal row — popup opens with reasons, evidence, recommendations
- Run again — signals are updated (stale_at/computed_at advance), not duplicated

## Anti-Patterns
- Do NOT compute signals for all 18K vehicles. Start with the 100 most-viewed. This is a backfill, not a migration.
- Do NOT call an LLM to compute signals. These are deterministic computations from structured data. SQL + arithmetic, not AI.
- Do NOT create new tables. `analysis_signals` already has every column needed.
- Do NOT make the script a cron. It's a one-shot backfill. The coordinator's existing cron handles ongoing recomputation once signals exist.
- Do NOT compute Level 3-7 analysis (client, technician, shop, region, national). That data doesn't exist yet. Compute what we have: vehicle-level and job-level metrics.

## Library Contribution
After completing:
- Update `docs/library/reference/almanac/` — add "Analysis Signal Distribution" stats (how many vehicles have signals, severity breakdown)
- Update `docs/library/reference/encyclopedia/README.md` — add "Analysis Signals" section documenting widget slugs and computation methods
- Update `docs/library/technical/engineering-manual/` — add chapter on running the signals backfill and interpreting results
