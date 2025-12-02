# JUST DO ANGLES - The Simplest Task

## The Goal

**Set angle for all 2,742 images.**

That's it. No complicated analysis, no tiers, no context.

Just answer: "What angle is this photo from?"

## Why This First

- ✅ Trivial question (no expertise needed)
- ✅ Ultra-cheap ($0.00008 per image = $0.22 total)
- ✅ Fast (1 second per image = 45 minutes)
- ✅ Measurable (COUNT images WHERE angle IS NOT NULL)
- ✅ Useful (enables filtering by angle)

## Run It

```bash
node scripts/just-set-angles.js
```

**What happens:**
- Processes 1 image per second (slow = stable)
- Just sets angle field
- Shows progress every 10 images
- Total time: ~45 minutes
- Total cost: $0.22

## Metric

```sql
-- Before: 0
-- After: 2,742
SELECT COUNT(*) FROM vehicle_images WHERE angle IS NOT NULL;
```

**This is the baseline. Get angles first, then worry about harder stuff.**
