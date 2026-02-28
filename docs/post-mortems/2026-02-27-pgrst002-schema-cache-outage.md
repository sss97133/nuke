# Post-Mortem: PGRST002 Schema Cache Outage
**Date:** 2026-02-27
**Outage window:** ~07:41–07:47 UTC (approx. 6 minutes acute; partial degradation 07:41–08:00)
**Severity:** P0 — all REST API calls returning PGRST002, YONO vision worker offline, extraction pipeline offline
**Author:** CTO (task b11baf19)

---

## Summary

A burst of concurrent pg_cron jobs exhausted the `cron.max_running_jobs = 32` limit during a peak convergence window. Long-running quality backfill workers held slots past their 2-minute tick, preventing the next scheduled wave from starting. When PostgREST attempted its schema cache reload at ~07:46 it could not acquire a connection, triggering PGRST002 across all REST API callers. The YONO vision worker was collateral damage — its every-minute cron job could not start.

---

## Timeline (all times UTC)

| Time | Event |
|------|-------|
| 07:39–07:40 | Normal operation — 63–71 cron jobs succeeding per minute |
| 07:41 | **CLIFF**: 37 job startup timeouts, only 4 jobs succeeded |
| 07:41 | `yono-vision-worker-2`, `exchange-pricing-cycle`, `continuous-queue-processor` all fail to start |
| 07:44–07:45 | Statement timeouts hit `quality-backfill-worker-2` and `quality-backfill-worker-4` (heavy SELECT + UPDATE) |
| 07:45 | Second wave: 13 startup timeouts + 2 statement timeouts |
| 07:46 | **Blackout**: 9 startup timeouts, **0 succeeded** — PostgREST schema cache reload fails → PGRST002 |
| ~07:47+ | Stuck jobs begin clearing; partial recovery starts |
| ~08:00 | Full recovery (PostgREST schema cache reload succeeds) |

---

## Root Cause

**pg_cron background worker slot exhaustion, not connection pool exhaustion.**

### The Math

| Parameter | Value |
|-----------|-------|
| `cron.max_running_jobs` | **32** |
| `cron.use_background_workers` | **off** (uses client connections) |
| `max_connections` | **160** |
| Active cron jobs | **174** |
| Jobs scheduled every minute (`* * * * *`) | **44** |
| Jobs scheduled every 2 min (`*/2 * * * *`) | **17** |
| Jobs scheduled every 5 min (`*/5 * * * *`) | **22** |

At any given minute, **44 jobs** simultaneously want to start. When 32 of those slots are occupied by jobs that are still running (quality backfill workers taking >2 minutes due to row-lock contention on a 1.25M-row table), the scheduler cannot accommodate the next wave. The 13+ jobs that can't start get `job startup timeout`.

### The Cascade

1. **Quality backfill workers** (jobs 237–240) were running heavy `SELECT id FROM vehicles WHERE data_quality_score IS NULL LIMIT 75` + per-row UPDATE loops. Under concurrent extraction queue pressure, these ran over the 2-minute cron window.

2. **bat-snapshot-parser-continuous** (jobs 173–174) — already known to run 80–110s. Two of these slots were occupied going into 07:41.

3. At 07:41, the scheduler attempted to launch all 44 `* * * * *` jobs but found all 32 slots occupied (4 quality backfill + 2 bat-snapshot-parser + 26 from the previous minute's wave still running).

4. 37 jobs received `job startup timeout`. This included `yono-vision-worker-2` and `continuous-queue-processor-*`.

5. By 07:46 the situation had not resolved. PostgREST's schema cache TTL elapsed and it attempted a `SET search_path` + query against `information_schema`. With zero available client connections (all 32 pg_cron slots active + REST API connections), PostgREST failed its schema reload → **PGRST002 to all callers**.

### Why PostgREST Specifically

PostgREST's schema cache reloads on a background interval (or when it receives a `NOTIFY pgrst` signal). Each reload opens a new connection to query `information_schema`. With `max_connections = 160` and 32 pg_cron connections + extraction queue HTTP workers + active ralph-spawn agents all competing, PostgREST's reload connection request was refused. This returns `{"code":"PGRST002","message":"Could not retrieve schema cache"}` to every REST API caller.

### Contributing Factor: 10+ Concurrent Ralph-Spawn Agents

At ~07:00–08:00 UTC, review of `ACTIVE_AGENTS.md` shows at least 10 active agent sessions were logged during this window (Worker — BaT Queue Unblock, VP AI Zone Training, Extraction Quality Sprint, VP Platform, VP AI, etc.). Each agent session makes multiple Supabase REST API calls and DB queries per tool turn. This adds 20–50 additional connection requests per minute on top of the 44 cron job connections. The combined load is what saturated the 160-connection pool and prevented PostgREST from getting its reload connection.

---

## Impact

| System | Impact |
|--------|--------|
| PostgREST REST API | 100% PGRST002 errors for ~6 min acute, degraded ~60 min |
| Edge functions (DB-dependent) | All failed for the acute window |
| YONO vision worker | Offline for the outage window |
| Extraction queue | Continuous queue processor failed 07:41–07:46 |
| Exchange pricing cycle | Failed to run at 07:46 |
| `release-stale-locks` cron | Failed — could not run during peak, allowing lock accumulation |

---

## What We Got Right

- The quality backfill workers had `idle_in_transaction_session_timeout` behavior: they eventually hit statement timeout and freed slots (07:44–07:45), which allowed partial recovery at 07:42–07:43.
- The system self-healed within ~6 minutes without manual intervention.
- `bat-snapshot-parser` schedule was already changed from `* * * * *` → `*/3 * * * *` (correct direction).

---

## Prevention — Immediate Actions Required

### P0: Stagger the 44 every-minute cron jobs (CRITICAL)

44 jobs firing at the same second every minute is the root cause. They must be spread across the 60-second window.

**Target:** No more than 16 jobs firing at any given second.
**Method:** Convert roughly half of `* * * * *` jobs to `1-59/2 * * * *` (fires at odd seconds of each minute) and another third to `30 * * * *` or offset patterns.

This is the **only fix that actually addresses the root cause.**

### P1: Reduce `cron.max_running_jobs` from 32 to 20

Leaves 140 of 160 connections free for REST API + PostgREST + edge functions. Fewer cron jobs can pile up, PostgREST always has a connection slot.

```sql
ALTER SYSTEM SET cron.max_running_jobs = 20;
SELECT pg_reload_conf();
```

Note: This will cause more `job startup timeout` errors in cron details for low-priority jobs — that's acceptable. The alternative is PGRST002 for everyone.

### P2: Audit and deactivate low-priority cron jobs

174 active cron jobs is excessive. At least 30–40 are candidates for deactivation:
- Jobs that call edge functions already covered by queue workers
- Health check jobs that duplicate each other
- Backfill jobs that have completed their data corpus

**Target:** ≤120 active cron jobs, ≤30 of them at `* * * * *`.

### P3: Add `statement_timeout` to quality-backfill-worker cron jobs

The quality backfill workers lack per-job statement timeouts. They ran >2min and held slots. Fix:

```sql
-- Example: enforce 90-second statement timeout per quality backfill run
UPDATE cron.job
SET command = 'SET statement_timeout = ''90s''; ' || command
WHERE jobname LIKE 'quality-backfill-worker%';
```

### P4: Add PGRST002 detection alert

Create a cron job that checks `cron.job_run_details` for `job startup timeout` spikes and fires a Telegram notification if >10 startup timeouts in any 1-minute window.

### P5: Ralph-spawn concurrency cap during cron-peak minutes

`ralph-spawn` default `--concurrency 5` is fine. But running multiple ralph-spawn sessions simultaneously (10+ agents at once) is what tipped the pool over. ralph-spawn should check `pg_stat_activity` before starting and back off if `count(*) > 120`.

---

## Work Orders Issued

See agent_tasks table for follow-up work orders filed as part of this post-mortem.

---

## Lessons

1. **44 jobs at `* * * * *` will always converge.** Cron schedules must be staggered. This is an invariant, not a preference.
2. **pg_cron uses client connections, not background workers.** `cron.use_background_workers = off` means every running cron job consumes one of the 160 connection slots. This is a hard architectural constraint.
3. **PostgREST schema cache reload is fragile under connection saturation.** It happens silently in the background with no retry. One failed reload = full PGRST002 outage until the next reload succeeds.
4. **The stale lock release cron also failed.** This is a second-order effect — when the outage cron also fails, lock accumulation compounds the recovery time.
5. **Self-healing worked.** No manual intervention was needed. Statement timeouts cleared the stuck jobs within 4–6 minutes.
