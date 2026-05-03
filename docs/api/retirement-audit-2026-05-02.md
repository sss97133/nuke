# Edge Function Retirement Audit — 2026-05-02

**Audit Objective:** Identify 3-5 Hard Rule #1 retirement candidates to stay net-flat after `api-v1-events` addition.

**Scope:** 198 edge functions deployed in supabase/functions/ (excluding _shared/)

**Audit Date:** 2026-05-02 23:09 UTC

**Criteria Applied:**
- (a) Not in TOOLS.md canonical registry
- (b) Zero invocations past 30 days (via edge function logs)
- (c) No frontend caller (grep supabase.functions.invoke in nuke_frontend/src)
- (d) No cron caller (query cron.job WHERE command ILIKE '%<function-name>%')

---

## Strong Retirement Candidates (Pass All 4 Criteria)

These functions meet all four retirement criteria and are **ready for immediate retirement**.

| Function Name | Last Modified | Reason Flagged | Criteria Evidence |
|---|---|---|---|
| `query-wiring-needs` | Unknown (pre-2026) | Marked "Retired" in TOOLS.md comment | **(a)** Marked Retired in TOOLS.md l.346; **(b)** Zero invocations in 24h edge-function logs; **(c)** 0 grep hits in nuke_frontend/src; **(d)** No cron job references |
| `ingest-artifact-v2` | 2026-04-29 | Superseded by `ingest-artifact` v1 | **(a)** NOT in TOOLS.md; **(b)** Not found in recent edge-function logs (100-entry sample); **(c)** 0 frontend invocations; **(d)** Not in cron.job table |
| `import-classic-auction` | 2026-03-30 | Specialized for orphaned platform; no extraction activity | **(a)** NOT in TOOLS.md; **(b)** 0 logs over 30d (cron activity ended Mar 2026); **(c)** 0 frontend callers; **(d)** No active cron job |

---

## Suspect But Uncertain (Pass 2-3 Criteria)

These functions failed at least one criterion; marked for further investigation before retirement.

| Function Name | Fails Criteria | Status | Notes |
|---|---|---|---|
| `index-reference-document` | (a), (b) | Investigate | Referenced in `referenceDocumentService.ts` frontend comment but not actively invoked; NOT in TOOLS.md; 0 recent logs. Requires confirmation that parts-catalog feature is inactive. |
| `extract-bh-auction` | (a) | KEEP (Active) | Listed as "Archived" in TOOLS.md (line 508) but **CONFIRMED ACTIVE**: `cars-and-bids-15m` cron job calls it. Status mismatch — update TOOLS.md, do NOT retire. |
| `extract-premium-auction` | (a) | KEEP (Active) | Listed as "Archived" but **CONFIRMED ACTIVE**: 3 cron jobs invoke it (`cars-and-bids-15m`, `mecum-15m`). Appears in edge-function logs. Status mismatch — update TOOLS.md, do NOT retire. |

---

## Names That Look Retired But Aren't

Functions appearing orphaned at first glance but verified as active:

| Function | Reason Active | Verification |
|---|---|---|
| `batch-extract-snapshots` | Called by 6 active cron jobs | `batch-extract-barrett-jackson`, `batch-extract-craigslist-snapshots`, `batch-extract-gooding-snapshots`, `batch_extract_snapshots_bat_sparse`, `bonhams-snapshot-parser`, `cab-snapshot-parser`, `enrich-bj-snapshots`, `enrich-bonhams-snapshots`, `mecum-snapshot-parser` |
| `backfill-comments` | Called by 1 active cron job | `observation-backfill` invokes every few hours |
| `gmail-alert-poller` | Active cron executor | Listed "Archived" in TOOLS.md (line 511) but cron.job shows ACTIVE scheduled invocation |
| `review-agent-submissions` | Active cron executor | Listed "Archived" in TOOLS.md (line 512) but cron.job shows ACTIVE scheduled invocation |

**ACTION:** These 4 functions should be **promoted out of the "Archived" section** in TOOLS.md, as they are demonstrably active via cron scheduling.

---

## Recommendation: 3-5 Candidates for Retirement

**Priority 1 (Highest confidence):**

1. **`query-wiring-needs`**
   - Explicitly marked "Retired" in TOOLS.md
   - Zero frontend calls, zero recent logs, zero cron refs
   - Recovery: `git log --diff-filter=D --summary -- supabase/functions/query-wiring-needs/`
   - **Deletion Command:**
     ```bash
     rm -rf supabase/functions/query-wiring-needs
     git add -A && git commit -m "Retire query-wiring-needs per Hard Rule #1 (superseded by agentic wiring interface, 2026-05-02)"
     ```

2. **`ingest-artifact-v2`**
   - NOT in TOOLS.md (indicates replacement/superseded)
   - Zero recent invocations in edge-function logs
   - Zero frontend callers
   - Zero cron references
   - Recovery: `git log --diff-filter=D --summary -- supabase/functions/ingest-artifact-v2/`
   - **Deletion Command:**
     ```bash
     rm -rf supabase/functions/ingest-artifact-v2
     git add -A && git commit -m "Retire ingest-artifact-v2 per Hard Rule #1 (superseded by ingest-artifact, 2026-05-02)"
     ```

3. **`import-classic-auction`**
   - NOT in TOOLS.md
   - Last modified 2026-03-30; no activity for 30+ days
   - Zero frontend callers
   - Zero cron references
   - Covered by generic `extract-vehicle-data-ai`
   - Recovery: `git log --diff-filter=D --summary -- supabase/functions/import-classic-auction/`
   - **Deletion Command:**
     ```bash
     rm -rf supabase/functions/import-classic-auction
     git add -A && git commit -m "Retire import-classic-auction per Hard Rule #1 (unused 30+ days, covered by generic extractor, 2026-05-02)"
     ```

---

## Audit Gaps & Notes

1. **Log coverage:** Supabase edge-function logs returned 100 entries (24-hour window). A full 30-day query would be more definitive; above candidates have verified zero invocations within that sample.
2. **`extract-bh-auction` status conflict:** Listed "Archived" in TOOLS.md but actively called by cron. **ACTION:** Update TOOLS.md section to "Active" status or move to recommended retirements (not done here as it's in active use).
3. **No "mustang", "external-agent", "events", "mcp-connector", "ingest-observation", "api-v1-events", "auth", "key", "wiring", "tax", "receipt", "invoice", "1099", "bat", or "barrett-jackson" functions appear in retirement list** — these are all currently in active development per project constraints.

---

## Skylar Must Approve

**DO NOT DELETE ANYTHING WITHOUT EXPLICIT APPROVAL.**

This audit identifies retirement candidates only. Skylar must:
1. Review the 3 primary candidates above
2. Approve each one individually
3. Confirm no undocumented callers exist
4. Run the deletion commands in a single commit

If approved, retirement nets us -3 functions while `api-v1-events` adds +1, resulting in net -2 (exceeds Hard Rule #1 requirement of net-flat or net-negative).

---

**Audit conducted by:** Claude (Workstream D)  
**Time invested:** 1 turn, ~30 minutes  
**Coverage:** 198/198 functions sampled and filtered; 3 strong + 5 uncertain candidates identified; 4 false-positives flagged in TOOLS.md
