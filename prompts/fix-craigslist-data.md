# Craigslist Data Cleanup Agent Prompt

## Context

Craigslist listings expire quickly, so we can't re-scrape. The data we have is messy:
- **model** field contains full listing title with price, mileage, emojis, location
- **make** is often missing (shows as `?` or null)
- **discovery_url** slug often contains the real make/model

**Total CL vehicles:** ~6,669
**Affected:** Almost all have junk in model field

## Target Database

**Table:** `vehicles`
**Filter:** `auction_source = 'Craigslist'`

**Key Fields:**
| Field | Current State | Target State |
|-------|--------------|--------------|
| `make` | Often null/`?` | Actual make (Ford, Toyota, etc.) |
| `model` | Full listing title with junk | Clean model name only |
| `year` | Usually correct | Keep as-is |
| `make_source` | n/a | Set to `craigslist_cleanup_v1` when fixed |

## Data Sources Available

1. **discovery_url** - Contains slug like `/d/plano-2016-kia-soul-with-only-miles/`
   - Parse: `{location}-{year}-{make}-{model}-{junk}`
   - Most reliable source for make/model

2. **model** field (current) - Contains full title like:
   - `Soul with only 34795 miles - $9,750`
   - `GENESIS 🔷ONE OWNER🔷129K MILES - $4,999`
   - Can extract by removing price/mileage/emoji patterns

3. **title** field - Usually same as model, no additional value

4. **description** - Sometimes has "2016 Kia Soul" etc., but often truncated

## Cleanup Script

Ready to use: `/Users/skylar/nuke/scripts/fix-craigslist-data.js`

```bash
# Dry run first (shows what would change)
dotenvx run -- node scripts/fix-craigslist-data.js 100 --dry-run

# Apply changes
dotenvx run -- node scripts/fix-craigslist-data.js 500
```

## Known Model → Make Mappings

The script includes 100+ mappings like:
- `soul` → Kia
- `mustang` → Ford
- `camry` → Toyota
- `911` → Porsche
- `firebird` → Pontiac

## Edge Cases to Handle

1. **Location in URL instead of model** - Some URLs are like `rio-linda-1971-convertible`
2. **Partial makes** - "Chevy" → "Chevrolet", "VW" → "Volkswagen"
3. **Mercedes format** - URLs show `mercedes-benz-clk` but model field might just have "CLK"
4. **Trim in model** - "Accord EX-L" should stay, but "Accord EX-L Style Meets Reliability" should be trimmed

## Success Criteria

After cleanup, searching for "roadrunner" should NOT return a "Kia Soul" because:
- The Soul now has proper `make = 'Kia'` and `model = 'Soul'`
- Search vector will be rebuilt with correct terms

## Verification Query

```sql
SELECT year, make, model, discovery_url
FROM vehicles
WHERE auction_source = 'Craigslist'
AND (make IS NULL OR model ILIKE '%$%' OR model ILIKE '%miles%')
LIMIT 10;
```

Should return 0 rows when complete.
