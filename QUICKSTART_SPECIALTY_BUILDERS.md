# Specialty Builders - Quick Start

## 🚀 One-Command Start

```bash
cd /Users/skylar/nuke && ./scripts/specialty-builder-coordinator.sh
```

This will:
1. Check Ollama availability
2. Discover inventory from Velocity & Kindred
3. Process pending extractions with validation
4. Self-heal incomplete extractions
5. Report statistics

---

## 📝 What's Built

**Self-healing extraction system** for specialty builders:
- Velocity Restorations, Kindred, Singer, RUF, Brabus, Cool N Vintage
- Fixes missing descriptions, timeline events, VIN/chassis numbers
- Uses Ollama (OpenAI quota exhausted)
- Automatically re-scrapes incomplete extractions

---

## 🔧 Commands

### Test Single URL
```bash
./scripts/test-specialty-extract.sh <URL>
```

### Add Test Listings
```bash
./scripts/add-test-listings.sh
```

### Process Queue (Run Once)
```bash
./scripts/specialty-builder-coordinator.sh
```

### Continuous Operation
```bash
# Every 5 minutes
watch -n 300 ./scripts/specialty-builder-coordinator.sh
```

---

## 📊 Monitor

```sql
-- Check recent extractions
SELECT
  listing_url,
  status,
  listing_title,
  raw_data->'validation'->>'quality_score' as quality,
  raw_data->'validation'->'missing_fields' as missing
FROM import_queue
WHERE listing_url ILIKE '%velocity%' OR listing_url ILIKE '%kindred%'
ORDER BY created_at DESC LIMIT 10;
```

---

## ✅ What It Fixes

| Problem | Solution |
|---------|----------|
| Missing descriptions | Validates >50 chars, re-scrapes if missing |
| Missing timeline events | Extracts auction affiliation, lot numbers, build dates |
| Missing VIN/chassis | Treats chassis as synonym for high-end builds |
| Missing auction data | Parses "sold at", "lot #", auction house names |

---

## 📂 Key Files

- `supabase/functions/extract-specialty-builder/` - Extraction function (deployed)
- `scripts/specialty-builder-coordinator.sh` - Autonomous coordinator
- `scripts/test-specialty-extract.sh` - Single URL test
- `SPECIALTY_BUILDER_STATUS.md` - Full documentation
- `RESULTS_SPECIALTY_BUILDERS.md` - Deployment results

---

## 🎯 Next Steps

1. Run coordinator to discover inventory
2. Or provide specific listing URLs to test
3. System will self-heal incomplete extractions automatically

**Ready to roll!** 🏁
