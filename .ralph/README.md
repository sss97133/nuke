# .ralph/ - Autonomous Extraction Control Center

This directory contains all state, plans, and documentation for the Ralph Wiggum autonomous extraction system.

## Quick Start

```bash
# Check current status
./scripts/ralph-extraction-loop.sh --status

# Start a session (read handoff first!)
cat .ralph/SESSION_HANDOFF.md

# Run autonomous loop
./scripts/ralph-extraction-loop.sh --hours 2
```

## Files

| File | Purpose |
|------|---------|
| `SESSION_HANDOFF.md` | **START HERE** - Context for new sessions |
| `extraction_plan.md` | Task checklist with priorities |
| `extraction_progress.md` | Session-by-session log |
| `extraction_activity.md` | Raw loop activity log |
| `extraction_metrics.json` | Machine-readable stats |
| `EXTRACTION_FACTORY_PROMPT.md` | Claude prompt for extraction loops |
| `EXTRACTOR_QUALITY_PROMPT.md` | Quality-first methodology |
| `EXTRACTOR_QUALITY_COMPARISON.md` | Field-by-field extractor analysis |

## Architecture: RLM (Recursive Loop Model)

1. **External State** - All state in files, not memory
2. **One Step Per Loop** - Each iteration does ONE task
3. **Shell Wrapper** - `ralph-extraction-loop.sh` calls Claude repeatedly
4. **Circuit Breakers** - Stop on errors, investigate
5. **Rate Limiting** - Sleep between loops to preserve quota

## Quality First

**Rule:** Never run incomplete extractors at scale.

Before running any extraction:
1. Compare to BaT gold standard (see EXTRACTOR_QUALITY_COMPARISON.md)
2. Fix blockers (see Phase 0 in extraction_plan.md)
3. Test with 5-vehicle batch
4. Validate against source manually
5. THEN scale up

## Gold Standard

The benchmark is `supabase/functions/bat-simple-extract/index.ts` (997 lines).

Every extractor should match:
- Core fields: title, year, make, model, VIN, location
- Specs: mileage, colors, transmission, engine, body_style
- Auction: prices, bids, seller, lot, reserve_status
- Rich: description, ALL images, comments (if available)
- DB: vehicles, vehicle_images, auction_events/timeline
