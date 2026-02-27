# NEXT SESSION — COO Work Orders (2026-02-27 06:01 PST)

## STATUS: URGENT — CEO BLOCKING ISSUES

CEO (Skylar) cannot demo the platform to client Dave Granholm. Profiles are broken, vehicles don't show, and there's no way to diagnose user issues. **All agents: read your assigned issues below and execute immediately.**

---

## P0 — CRITICAL (Do These First)

### CTO: Fix Profile Username Routing — GitHub #178
**File:** `nuke_frontend/src/pages/Profile.tsx`
**Bug:** `/profile/skylar` returns `invalid input syntax for type uuid: "skylar"`. The route handler passes the URL slug directly as a UUID to the DB query.
**Fix:** Check if route param is a valid UUID regex. If not, query `profiles` table WHERE `username = :param` to resolve to UUID, then proceed. This is a 30-minute fix.
**Impact:** Cannot share profile URLs with clients. Only UUID URLs work.
**Test:** After fix, `https://nuke.ag/profile/skylar` should load Skylar's profile.

### VP Platform: Fix Collection Tab Query — GitHub #175
**File:** `nuke_frontend/src/pages/Profile.tsx` (Collection tab component)
**Bug:** Profile Collection tab shows "No public vehicles to display" despite user having 250 vehicles.
**Root Cause:** The Collection tab query is NOT checking `vehicles.uploaded_by`. Data shows:
- `vehicles.uploaded_by = '0b9f107a...'` → **250 results** ✅
- `vehicles.owner_id = '0b9f107a...'` → **0 results** ❌ (column is null)
- No `user_vehicles` junction table exists
**Fix:** Update the Collection tab's Supabase query to also check `uploaded_by` column. Consider migration: `UPDATE vehicles SET owner_id = uploaded_by WHERE owner_id IS NULL AND uploaded_by IS NOT NULL`.
**Test:** After fix, Skylar's profile Collection tab should show 250 vehicles.

---

## P1 — HIGH (After P0s Are Done)

### CPO: Make Vehicle Profiles Client-Shareable — GitHub #173
**File:** `nuke_frontend/src/pages/VehicleProfile.tsx` (198KB)
**Problem:** Vehicle profiles show yellow "Incomplete profile" warnings, data conflicts, empty sections to ALL visitors. Not shareable with clients.
**Requirements:**
1. Add public/admin view toggle — public view hides incomplete warnings
2. Present available data cleanly, don't highlight what's missing
3. Work with VP Vehicle Intel on data quality
**Example:** https://nuke.ag/vehicle/e7694519-0fe8-4c60-9a39-18b68c5ba68a
**Coordinate with:** VP Vehicle Intel (data quality), VP Platform (implementation)

### VP Platform: Remove DEBUG Messages — GitHub #177
**File:** `nuke_frontend/src/pages/Profile.tsx`
**Bug:** `DEBUG: Received 0 contributions` visible on production profile pages.
**Fix:** Find and remove/gate all `DEBUG:` prefixed output behind `process.env.NODE_ENV !== 'production'` or admin flag. 5-minute fix.

### VP Platform: Build User Health Check — GitHub #174
**Spec:** Create edge function `user_health_check(user_id)` that returns:
- Profile exists? ✅/❌
- Auth record exists? ✅/❌  
- Vehicles via `uploaded_by`? Count
- Vehicles via `owner_id`? Count
- Vehicles visible in Collection tab? Count (same query as frontend)
- Recent activity
**Why:** Today we have zero tooling to diagnose "my vehicles don't show up". Took raw DB queries across 5 tables to figure out the Collection tab bug.

### VP Vehicle Intel: Fix Data Quality Issues — GitHub #173
**Problem:** Vehicle profiles have:
- Conflicting mileage (960 vs 90,960 on same vehicle)
- Empty timelines despite having auction dates
- 45% completion scores with lots of null fields
**Fix:** Audit enrichment pipeline. Mileage conflicts should be flagged/resolved during ingestion. Timeline should auto-populate from available dates. Prioritize enrichment on Skylar's 250 vehicles.
**Example:** Vehicle `e7694519-0fe8-4c60-9a39-18b68c5ba68a`

---

## P2 — When Bandwidth Allows

### VP Platform: Fix Market Dashboard Timeout — GitHub #176
`/market` throws `canceling statement due to statement timeout`. Add indexes, materialized views, or caching for dashboard stats.

---

## Agent Assignments Summary

| Agent | Tasks | Priority |
|-------|-------|----------|
| **CTO** | #178 (profile routing) | P0 |
| **VP Platform** | #175 (Collection query), #177 (DEBUG msgs), #174 (health check), #176 (market timeout) | P0, P1, P1, P2 |
| **CPO** | #173 (shareable profiles) | P1 |
| **VP Vehicle Intel** | #173 (data quality) | P1 |

## Context
- Skylar's user UUID: `0b9f107a-d124-49de-9ded-94698f63c1c4`
- Client demo target: Dave Granholm
- Profile page: `nuke_frontend/src/pages/Profile.tsx` (45KB)
- Vehicle profile: `nuke_frontend/src/pages/VehicleProfile.tsx` (198KB)
- RLS policies may be blocking agent_tasks inserts via anon key — service role key needed
- All GitHub issues filed: #173, #174, #175, #176, #177, #178

## COO Notes
- I (COO/Perplexity Computer) diagnosed all issues via Supabase queries + browser audit
- The agent_tasks table has RLS blocking remote inserts — use service role key locally
- When P0s are fixed, Telegram me status at chat 7587296683
- Filed by COO at 2026-02-27T14:01:00Z
