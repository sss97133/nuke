# NEXT SESSION — COO SPRINT DIRECTIVE (Updated 2026-02-27 14:50 AST)

## 🔴 TOP-LINE REALITY: 29.9 MILLION MISSING DATA POINTS

> "There's millions of missing data points that could have been extracted. We need to be fixing that."

The database has **1,241,184 vehicles** but is **83.2% empty**. Average field coverage is 16.8%. This is the #1 problem.

| Category | Missing | Root Cause |
|----------|---------|------------|
| Extractable (on listing pages) | 6.9M points | Extractors skip secondary fields |
| Enrichable (make/model/year lookup) | 13.1M points | No spec reference table built |
| Computed (our value-add scores) | 3.9M points | Scoring functions broken/incomplete |
| **TOTAL** | **29.9M points** | **Nobody was assigned to fix it** |

Worst offenders: engine_liters 0.1%, signal_score 0.2%, deal_score 0.7%, asking_price 0.9%.
See full audit: #185

---

## ⛔ CEO MANDATE: EVERY VP NEEDS A DETECTIVE

> "All VPs should be catching issues. They all need a Perplexity detective."
> "Pipeline is not healthy — VPs should be auto-finding errors."

**The last sprint produced 12 good commits but LEFT THE EXTRACTION QUALITY ISSUES UNTOUCHED.** #173 (shareable profiles), #182 (duplicate images), #183 (Barrett-Jackson 0% images) — all still open. Meanwhile, no VP noticed 2,736 vehicles with 0% images until the CEO spotted it visually.

**This stops now. Every VP must self-diagnose before doing any assigned work.**

---

## 🔍 DETECTIVE MANDATE — READ THIS BEFORE ANYTHING ELSE

**Every VP runs a diagnostic audit of their domain FIRST.** Before you touch your assigned task, run your detective checks. If the detective finds critical issues, fix those FIRST.

### How the Detective Works

1. **On session start:** Run your domain-specific audit queries (listed below per VP)
2. **Evaluate:** Compare results against thresholds
3. **If anomalies found:** Create `agent_tasks` for yourself, send Telegram alert for critical
4. **Fix critical findings FIRST**, then move to assigned work
5. **Log results** to `detective_audit_log` table (create it if it doesn't exist — see #184)

### Detective Queries by VP

#### VP Extraction — YOUR DETECTIVE CATCHES DATA QUALITY FAILURES
```sql
-- 1. Per-source image coverage (ALERT if any source < 50%)
SELECT source, COUNT(*) as total, COUNT(primary_image_url) as with_image,
       ROUND(COUNT(primary_image_url)::numeric / COUNT(*) * 100, 1) as pct
FROM vehicles GROUP BY source ORDER BY pct ASC LIMIT 10;

-- 2. Duplicate hero images (ALERT if any URL on 4+ vehicles)
SELECT primary_image_url, COUNT(*) as cnt
FROM vehicles WHERE primary_image_url IS NOT NULL
GROUP BY primary_image_url HAVING COUNT(*) > 3
ORDER BY cnt DESC LIMIT 10;

-- 3. Non-vehicle leakage (ALERT if count > 50)
SELECT COUNT(*) FROM vehicles WHERE year IS NULL OR model ILIKE 'n/a' OR make ILIKE 'buggy';

-- 4. Recent extraction output (ALERT if no vehicles created in last 4 hours)
SELECT source, COUNT(*) FROM vehicles
WHERE created_at > NOW() - INTERVAL '4 hours' GROUP BY source;
```

#### VP Platform — YOUR DETECTIVE CATCHES INFRASTRUCTURE FAILURES
```sql
-- 1. Failed crons (ALERT if any)
SELECT jobname, status, return_message FROM cron.job_run_details
WHERE status='failed' ORDER BY start_time DESC LIMIT 10;

-- 2. Invalid/unused indexes (ALERT if found — this caused the 57s timeout)
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)), indisvalid
FROM pg_stat_user_indexes JOIN pg_index ON indexrelid = pg_stat_user_indexes.indexrelid
WHERE idx_scan = 0 AND schemaname = 'public' AND pg_relation_size(indexrelid) > 0;

-- 3. Queue health (ALERT if failed > 100)
SELECT status, COUNT(*) FROM import_queue GROUP BY status;

-- 4. Slow query candidates
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements WHERE mean_exec_time > 5000 ORDER BY mean_exec_time DESC LIMIT 5;
```

#### VP Vehicle Intel — YOUR DETECTIVE CATCHES DATA QUALITY REGRESSION
```sql
-- 1. Field completion rates (track week-over-week)
SELECT COUNT(*) as total,
       ROUND(COUNT(vin)::numeric / COUNT(*) * 100, 1) as vin_pct,
       ROUND(COUNT(mileage)::numeric / COUNT(*) * 100, 1) as mileage_pct,
       ROUND(COUNT(nuke_estimate)::numeric / COUNT(*) * 100, 1) as estimate_pct,
       ROUND(COUNT(quality_grade)::numeric / COUNT(*) * 100, 1) as grade_pct
FROM vehicles;

-- 2. Mileage anomalies (suspiciously low)
SELECT id, year, make, model, mileage FROM vehicles
WHERE mileage < 100 AND year < 2020 AND mileage IS NOT NULL LIMIT 20;

-- 3. Quality distribution
SELECT quality_grade, COUNT(*) FROM vehicles
WHERE quality_grade IS NOT NULL GROUP BY quality_grade ORDER BY quality_grade;
```

#### CPO — YOUR DETECTIVE CATCHES USER-FACING BREAKAGE
```bash
# Test key pages return 200 (not 500, not infinite load)
curl -s -o /dev/null -w "%{http_code}" https://nuke.ag/
curl -s -o /dev/null -w "%{http_code}" https://nuke.ag/profile/skylar
curl -s -o /dev/null -w "%{http_code}" https://nuke.ag/search
curl -s -o /dev/null -w "%{http_code}" https://nuke.ag/market

# Check for visible error text in page HTML
curl -s https://nuke.ag/ | grep -i "error\|no data\|unable to load\|something went wrong"
```

#### CTO — YOUR DETECTIVE CATCHES ARCHITECTURE VIOLATIONS
```bash
# archiveFetch violations (new since last check)
grep -r "^import.*fetch\|= await fetch(" supabase/functions/ --include="*.ts" -l | grep -v _shared | grep -v archiveFetch | wc -l

# Deprecated imports
grep -r "hybridFetcher\|_archived" supabase/functions/ --include="*.ts" -l | wc -l

# Direct writes to computed fields
grep -r "signal_score\|nuke_estimate\|deal_score\|heat_score\|data_quality_score" supabase/functions/ --include="*.ts" | grep -i "update\|insert\|set" | grep -v pipeline_registry | head -10
```

---

## 🚨 EXECUTION MODEL: PARALLEL — EVERY AGENT STARTS IMMEDIATELY

Spin up a NEW agent for each task. Do NOT serialize. Do NOT pick up unrelated work.

---

## PRIORITY STACK

### TIER 0A: DATA REMEDIATION — 29.9M MISSING POINTS (VP Vehicle Intel + VP Extraction)

#### #185 — Phase 1: Spec Enrichment Pipeline (VP Vehicle Intel) [P0 — HIGHEST LEVERAGE]
**What:** Build a `vehicle_specs_reference` table from NHTSA/EPA data + our own 220K vehicles that already have specs. Then backfill: horsepower, torque, mpg, fuel_type, drivetrain, engine_type, engine_liters, body_style, weight, wheelbase, seats, doors.
**Why highest leverage:** One lookup per (make, model, year) fills 13 fields at once across 1.15M vehicles. That's ~13M data points from one pipeline.
**Data sources:** NHTSA vPIC API (free VIN decode + specs), EPA fuel economy API (free MPG), plus mine our own data where we already have specs for common make/model/year combos.
**Time estimate:** 2-3 sessions to build reference table + backfill cron.

#### #185 — Phase 2: Re-Extraction Pipeline (VP Extraction) [P0]
**What:** For the 85.5% of vehicles that have `listing_url`, re-visit the page and extract VIN, mileage, description, images, color, interior_color, transmission. DON'T overwrite existing data.
**Why:** 6.9M extractable data points are sitting on listing pages we already have URLs for.
**Implementation:** New `re-extract-missing-fields` edge function. Query vehicles with `listing_url IS NOT NULL AND (vin IS NULL OR mileage IS NULL OR primary_image_url IS NULL)`. Use `archiveFetch` to get cached page. Parse missing fields only.
**Time estimate:** 2-3 sessions.

#### #185 — Phase 3: Fix Computed Scores (VP Vehicle Intel) [P0]
**What:** signal_score at 0.2% and deal_score at 0.7% means the scoring pipelines are basically broken. Investigate and fix:
- Is `compute-vehicle-valuation-backfill` (cron 300) actually running? Check cron.job_run_details.
- Does the signal_score function exist? Is it wired to a cron?
- Does deal_score have the data dependencies it needs to compute?
**Time estimate:** 1 session to diagnose, 1 session to fix and backfill.

### TIER 0B: DETECTIVE SYSTEM ARCHITECTURE (CTO + VP Platform)

#### #184 — CTO + VP Platform: Build Detective Infrastructure [P0]
**What:** Create `detective_audit_log` table, `_shared/detective.ts` utility, wire Telegram alerts.
**This enables every VP's detective to persist findings and alert.**
**Time estimate:** 2 hours.
**See:** https://github.com/sss97133/nuke/issues/184

---

### TIER 1: CRITICAL OPEN ISSUES (copy-paste fix code is on each issue)

#### Agent 1 (CPO) → #173: Shareable Vehicle Profiles [P1]
**The fix is on the issue.** Public view mode hides warnings, empty sections, data conflicts. OG meta tags for share previews.
**CEO has been screaming about this for days.**
**Time estimate:** 2 hours.

#### Agent 2 (VP Extraction) → #182: Duplicate/Wrong Hero Images [P1]
**The fix is on the issue.** Post-write dedup trigger, known-bad-pattern filter, retroactive cleanup, scheduled monitor.
**CEO spotted map images and cross-vehicle image reuse on the homepage.**
**Time estimate:** 3 hours.

#### Agent 3 (VP Extraction) → #183: Barrett-Jackson 0% Images [P1]
**The fix is on the issue.** Update BJ extractor to pull hero image, add non-vehicle filter, parse mileage/description, backfill 2,736 records.
**2,736 vehicles with ZERO images is embarrassing.**
**Time estimate:** 4 hours.

#### Agent 4 (VP Platform) → #181: Automated Data Quality Alerting [P1]
**The fix is on #181 + #184.** Wire `data-quality-monitor` to Telegram + `agent_tasks`. Add post-extraction quality gate. Schedule the cron.
**Time estimate:** 2 hours.

---

### TIER 2: VERIFICATION OF PREVIOUS FIXES

#### Agent 5 (VP Platform) → Verify #175, #177, #178, #179 are live in production
Commit `7227db4` applied patches. Verify they're deployed and working:
- `/profile/skylar` loads (not UUID error) — #178
- Collection tab shows 250 vehicles (not 0) — #175
- Homepage shows new vehicles when sorted by newest — #179
- No DEBUG messages visible — #177
**If any are NOT working in production, fix immediately.**

---

### TIER 3: REMAINING OPEN ISSUES

#### Agent 6 (VP Platform) → #180: Email Alert Pipeline
**Blocked on CEO Gmail access.** Prep everything so CEO just clicks one button.

#### Agent 7 (VP Platform) → #174: User Health Check Endpoint
Build the diagnostic RPC so we never have to manually query 5 tables again.

#### Agent 8 (VP Platform) → #176: Market Dashboard Timeout
Likely addressed by the performance commits. Verify. If still broken, fix.

---

## PARALLELIZATION MAP

```
--- TIER 0A: DATA REMEDIATION (the real work) ---
Agent A (VP Vehicle Intel)  → #185 Phase 1: spec enrichment pipeline  [HIGHEST LEVERAGE]
Agent B (VP Extraction)     → #185 Phase 2: re-extraction pipeline    [6.9M extractable points]
Agent C (VP Vehicle Intel)  → #185 Phase 3: fix computed scores       [signal_score 0.2%, deal_score 0.7%]

--- TIER 0B: DETECTIVE INFRASTRUCTURE ---
Agent 1 (CTO + Platform)    → #184 detective infrastructure           [enables self-diagnosis]

--- TIER 1: CRITICAL OPEN ISSUES ---
Agent 2 (CPO)               → #173 shareable profiles                 [CEO screaming for days]
Agent 3 (VP Extraction)     → #182 duplicate hero images              [CEO spotted on homepage]
Agent 4 (VP Extraction)     → #183 BJ 0% images                      [2,736 vehicles, 0 images]
Agent 5 (VP Platform)       → #181 quality alerting                   [wire to Telegram]

--- TIER 2: VERIFICATION ---
Agent 6 (VP Platform)       → verify #175/#177/#178/#179 are live     [production check]

--- TIER 3: REMAINING ---
Agent 7 (VP Platform)       → #180 email pipeline                     [blocked on CEO Gmail]
Agent 8 (VP Platform)       → #174 health check endpoint             [diagnostic RPC]
Agent 9 (VP Vehicle Intel)  → #173 data quality uplift               [Skylar's 250 vehicles]
```

No dependencies. All start immediately. Detective checks run FIRST for each VP before task work.

---

## WHAT IS FROZEN (DO NOT WORK ON)

- ❌ Stripe Connect
- ❌ Inbox redesign
- ❌ Key Guardian / security audits
- ❌ SDK v1.3.0 / YONO sidecar
- ❌ FB Marketplace extraction
- ❌ Transfer dashboard enhancements
- ❌ Any new feature that doesn't fix user data quality or enable self-diagnosis

---

## KEY CONTEXT

- Skylar's UUID: `0b9f107a-d124-49de-9ded-94698f63c1c4`
- Client to demo for: **Dave Granholm** — needs shareable profile + vehicle links
- Image pipeline: PAUSED (`NUKE_ANALYSIS_PAUSED`) — this is intentional, work around it
- agent_tasks RLS: blocks remote inserts via anon key — use service role key
- Telegram bot: @Nukeagpbot, chatId: 7587296683
- Gmail for alerts: `toymachine91@gmail.com`
- 1,241,184 vehicles, 33M images, 83.2% empty fields, 29.9M missing data points

## DONE PROTOCOL

When you complete a task:
1. Update the GitHub issue with a comment: what you did, what files changed, test results
2. Close the issue if fully resolved
3. Append to `.claude/DONE.md` (create it if it doesn't exist)
4. **Run your detective checks AGAIN** to see if your fix revealed new issues
5. If new issues found, INSERT into `agent_tasks`

---

**COO DIRECTIVE: 29.9M missing data points is the existential problem. Data remediation is TIER 0. Build the spec enrichment pipeline, fix the re-extraction pipeline, fix the broken scoring functions. Every VP proves their value by filling fields, not building features.**

Filed by COO (Perplexity Computer) at 2026-02-27T18:50:00Z
