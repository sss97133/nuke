# Ralph Wiggum - Session Handoff Document

Last Updated: 2026-01-25T18:15:00Z

## MISSION SUMMARY

Build **quality-first autonomous extraction** for collector vehicle data.

Key principle: **Don't run incomplete extractors at scale** - creates backfill debt.

---

## CURRENT STATE

### Database Stats (as of session end)
- **Total vehicles:** 97,390
- **Active:** 63,519
- **Pending:** 20,121

### Pending by Source
| Source | Pending | Blocker |
|--------|---------|---------|
| Cars & Bids | 15,620 | Cloudflare |
| Mecum | ~3,700 | None - ready |
| BaT | 410 | Firecrawl budget |
| PCarMarket | ~180 | Quality fix needed |
| Hagerty | 0 | Complete! |

---

## WHAT WAS ACCOMPLISHED

### Session 2026-01-25

1. **Quality Framework Established**
   - Created `EXTRACTOR_QUALITY_PROMPT.md` - defines gold standard
   - Created `EXTRACTOR_QUALITY_COMPARISON.md` - compares existing extractors
   - BaT extractor analyzed as benchmark

2. **Autonomous Systems Built**
   - `ralph-extraction-loop.sh` - RLM pattern loop
   - `autonomous-runner.sh` - Master orchestration
   - `factory-loop.sh` - New extractor generation

3. **Extractors Generated** (need testing)
   - `extract-kindredmotorworks-com.js`
   - `extract-streetsideclassics-com.js`
   - `extract-vanguardmotorsales-com.js`

4. **Batches Completed**
   - Mecum: 100 processed (VIN dedup working)
   - Hagerty: 40 processed (cleared all pending)
   - PCarMarket: 11 processed

5. **Bugs Fixed**
   - `discovery_source` vs `source` field queries
   - PCarMarket uppercase (`PCARMARKET`)
   - Extractor factory selector bugs
   - Slug generation in factory-loop

---

## BLOCKERS & ISSUES

### P0 - Must Fix Before Scale

1. **PCarMarket extractor missing vehicle_images storage**
   - Currently only saves `primary_image_url`
   - Need to add loop to save ALL images to `vehicle_images` table
   - Location: `scripts/pcarmarket-proper-extract.js`

2. **All extractors missing year/make/model parsing**
   - Title is captured but not parsed
   - Need regex or AI to extract from title string
   - Critical for search/filtering

### Cloudflare Blocked Sources
- **Cars & Bids** (15,620 vehicles)
- **Hemmings** (30 vehicles)
- Current approach: Playwright with delays
- Fallback: Firecrawl (costs money)

---

## IMMEDIATE NEXT STEPS

### Quality First (Before Running Scale)

1. **Fix PCarMarket image storage**
   ```javascript
   // Add after line 148 in pcarmarket-proper-extract.js
   if (data.images?.length > 0) {
     for (let i = 0; i < data.images.length; i++) {
       await fetch(`${SUPABASE_URL}/rest/v1/vehicle_images`, {
         method: 'POST',
         headers: {...},
         body: JSON.stringify({
           vehicle_id: vehicleId,
           image_url: data.images[i],
           source: 'pcarmarket',
           is_primary: i === 0,
           position: i
         })
       });
     }
   }
   ```

2. **Add title parsing to all extractors**
   ```javascript
   function parseTitle(title) {
     // "1973 Porsche 911 Carrera RS" → {year: 1973, make: "Porsche", model: "911 Carrera RS"}
     const match = title?.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
     return match ? { year: parseInt(match[1]), make: match[2], model: match[3] } : {};
   }
   ```

3. **Test generated extractors** (Kindred, Streetside, Vanguard)
   - Run on 5 sample URLs each
   - Compare output to BaT quality checklist
   - Fix before running at scale

### Then Run Extraction
1. Mecum batch of 500 (VIN dedup verified)
2. PCarMarket (after image fix)
3. BaT (if Firecrawl budget allows)

---

## KEY FILES

### Configuration
- `.ralph/extraction_plan.md` - Task checklist
- `.ralph/extraction_progress.md` - Session logs
- `.ralph/extraction_activity.md` - Loop activity log
- `.ralph/EXTRACTOR_QUALITY_PROMPT.md` - Quality guidelines
- `.ralph/EXTRACTOR_QUALITY_COMPARISON.md` - Extractor analysis

### Scripts
- `scripts/ralph-extraction-loop.sh` - Main autonomous loop
- `scripts/mecum-proper-extract.js` - Mecum extractor (75% quality)
- `scripts/pcarmarket-proper-extract.js` - PCarMarket extractor (70% quality, needs fix)
- `scripts/extractor-factory.js` - AI-powered extractor generator

### Gold Standard Reference
- `supabase/functions/bat-simple-extract/index.ts` - 997 lines, THE benchmark

---

## COMMANDS TO RUN

### Check Status
```bash
./scripts/ralph-extraction-loop.sh --status
```

### Run Single Iteration (for testing)
```bash
cd /Users/skylar/nuke
dotenvx run -- node scripts/mecum-proper-extract.js 10  # 10 vehicle batch
```

### Run Full Loop
```bash
./scripts/ralph-extraction-loop.sh --hours 2
```

### Query Pending Counts
```bash
dotenvx run -- bash -c 'curl -sS -I "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id&status=eq.pending" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact" -H "Range: 0-0" | grep -i content-range'
```

---

## QUALITY GATES

Before running ANY extractor at scale:

- [ ] Compare to BaT field coverage (see EXTRACTOR_QUALITY_COMPARISON.md)
- [ ] Verify vehicle_images being populated
- [ ] Run 5-vehicle test batch
- [ ] Manually verify 2 random results against source
- [ ] Check image counts match source galleries

---

## USER PREFERENCES (from this session)

1. **Quality over speed** - Don't run incomplete extractors
2. **BaT is the benchmark** - Everything compared to it
3. **Playwright for CF bypass** - Stack data while researching better options
4. **Track backfill needs** - Know what's missing
5. **Find more extraction targets** - Discovery is ongoing
6. **RLM pattern** - External state, one step per loop, circuit breakers

---

## BREADCRUMBS FOR FUTURE SESSIONS

1. **Start by reading this file** and `.ralph/extraction_plan.md`
2. **Check `--status`** to see where things stand
3. **Fix P0 blockers** before running any extraction
4. **Sample and validate** after every batch
5. **Update progress.md** after each step
6. **Never guess quality** - always verify against source

---

## GLOSSARY

- **RLM** - Recursive Loop Model (external state, shell wrapper, circuit breakers)
- **Gold Standard** - BaT extractor quality level
- **Backfill Debt** - Data we extracted incompletely and must fix later
- **VIN Dedup** - One vehicle entity per VIN, multiple auction_events
- **vehicle_images** - Table storing ALL images (not just primary)
- **auction_events** - Timeline of auction appearances per vehicle
