# NEXT SESSION — COO SPRINT DIRECTIVE (Updated 2026-02-27 15:22 AST)

## 🚨 TIER 0A: REMOVE ALL HARDCODED STATS FROM UI

> "so a lot of those stats feel fake are hard to look at. those should be reporting live numbers. i hate seeing dead stats in UI its the worst. need to find and remove all. replace with a function when we want to show data, rookie move"

**STATUS: HOOK COMMITTED, ISSUE FILED — NEEDS WIRING UP**

### What's done:
- [x] `usePlatformStats.ts` committed to `nuke_frontend/src/hooks/` (SHA: ba692af)
- [x] GitHub issue #186 filed with complete inventory + fix code for every file
- [ ] Wire `usePlatformStats` into HomePage.tsx (replace '33M+', '50+')
- [ ] Wire into KeyFiguresWithCharts.tsx (replace '768,288', '$41.6 billion', '28.3 million')
- [ ] Wire into MarketCompetitors.tsx (replace '1.25M' x4)
- [ ] Add `total_images`, `total_listings`, `total_sources` to portfolio_stats_cache refresh cron

### Files with hardcoded lies (P0):
| File | Fake Stat | Real Number |
|------|-----------|-------------|
| `HomePage.tsx:70` | `'33M+'` photos | Query vehicle_images count |
| `HomePage.tsx:71` | `'50+'` data sources | Query distinct sources |
| `HomePage.tsx:89` | `'18K+'` profiles | 997K (portfolio_stats_cache) |
| `KeyFiguresWithCharts.tsx:27` | `'768,288'` vehicles | 997,429 (cache) / 1,241,204 (actual) |
| `KeyFiguresWithCharts.tsx:28` | `'$41.6 billion'` | $43.88B (cache) |
| `KeyFiguresWithCharts.tsx:29` | `'28.3 million'` images | Query vehicle_images count |
| `MarketCompetitors.tsx:5,39,44,125` | `'1.25M'` (4x) | 997K (cache) |

### The pattern to follow:
```tsx
import { usePlatformStats, formatStat, formatCurrency } from '../hooks/usePlatformStats';
const stats = usePlatformStats();
// Use formatStat(stats.totalVehicles) instead of '997K'
// Use formatCurrency(stats.totalValue) instead of '$41.6 billion'
```

---

## 🔴 TOP-LINE REALITY: 29.9 MILLION MISSING DATA POINTS

The database has **1,241,184 vehicles** but is **83.2% empty**. Average field coverage is 16.8%.

See full audit: #185

---

## ⛔ CEO MANDATE: EVERY VP NEEDS A DETECTIVE (#184)

**Every VP runs a diagnostic audit of their domain FIRST.** See #184 for per-VP SQL audit queries.

---

## PRIORITY STACK

### TIER 0A: HARDCODED STATS (#186) + DATA REMEDIATION (#185)
### TIER 0B: DETECTIVE INFRASTRUCTURE (#184)
### TIER 1: #173 shareable profiles, #182 duplicate images, #183 BJ 0% images, #181 alerting
### TIER 2: Verify #175/#177/#178/#179 are deployed to production
### TIER 3: #180 email pipeline, #174 health check, #176 market timeout

## WHAT IS FROZEN

- ❌ Stripe Connect, Inbox redesign, Key Guardian, SDK v1.3.0, YONO sidecar
- ❌ Any new feature that doesn't fix user data quality or enable self-diagnosis

## KEY CONTEXT

- Skylar's UUID: `0b9f107a-d124-49de-9ded-94698f63c1c4`
- Gmail for alerts: `toymachine91@gmail.com`
- Telegram: chatId `7587296683`
- 1,241,184 vehicles, 83.2% empty fields, 29.9M missing data points
- Image pipeline: PAUSED intentionally

Filed by COO (Perplexity Computer) at 2026-02-27T19:22:00Z
