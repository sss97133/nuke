# NEXT SESSION — COO Work Orders (Updated 2026-02-27 10:19 AST)

## STATUS: URGENT — CEO BLOCKING ISSUES

CEO (Skylar) cannot demo the platform to client Dave Granholm. Profiles are broken, vehicles don't show, email pipeline is disconnected. **All agents: read your assigned issues below and execute immediately.**

---

## P0 — CRITICAL (Do These First)

### CTO: Fix Profile Username Routing — GitHub #178
**File:** `nuke_frontend/src/pages/Profile.tsx`
**Bug:** `/profile/skylar` returns `invalid input syntax for type uuid: "skylar"`. The route handler passes the URL slug directly as a UUID to the DB query.
**Fix:** Check if route param is a valid UUID regex. If not, query `profiles` table WHERE `username = :param` to resolve to UUID, then proceed. This is a 30-minute fix.
**Test:** After fix, `https://nuke.ag/profile/skylar` should load Skylar's profile.

### VP Platform: Fix Collection Tab Query — GitHub #175
**File:** `nuke_frontend/src/pages/Profile.tsx` (Collection tab component)
**Bug:** Profile Collection tab shows "No public vehicles to display" despite user having 250 vehicles.
**Root Cause:** The Collection tab query is NOT checking `vehicles.uploaded_by`. Data shows:
- `vehicles.uploaded_by = '0b9f107a...'` → **250 results** ✅
- `vehicles.owner_id = '0b9f107a...'` → **0 results** ❌ (column is null)
**Fix:** Update the Collection tab's Supabase query to also check `uploaded_by` column. Consider migration: `UPDATE vehicles SET owner_id = uploaded_by WHERE owner_id IS NULL AND uploaded_by IS NOT NULL`.
**Test:** After fix, Skylar's profile Collection tab should show 250 vehicles.

---

## P1 — HIGH (After P0s Are Done)

### CPO + VP Extraction: New Vehicles Not Appearing in Homepage Feed — GitHub #179
**File:** `nuke_frontend/src/pages/CursorHomepage.tsx` (line ~927)
**Bug:** The feed query filters `.not('primary_image_url', 'is', null)` which hides ALL vehicles without thumbnails (~550K). BaT extraction creates vehicles without `primary_image_url`. Image pipeline is PAUSED. So new vehicles never show.
**CEO complaint:** "I'm not seeing any new vehicles in the cursor homepage"
**Fix options:**
1. CPO: Add toggle "Show vehicles without images"
2. VP Extraction: Pull BaT listing image as `primary_image_url` during extraction (before full image pipeline)
3. Quick: Remove the image filter for sort-by-newest mode
**Test:** After fix, newly extracted vehicles should appear in the feed immediately.

### VP Platform + VP Extraction: Email Alert Pipeline Not Connected — GitHub #180
**Problem:** CEO receives KSL, BHCC, BaT emails to `toymachine91@gmail.com` but they never reach extraction.
**Evidence:** `contact_inbox`: 0 rows. `alert_email_log`: 0 rows. `import_queue` via email: 0 rows.
**Root cause:** Gmail forwarding to `alerts@nuke.ag` was **never set up**. The edge functions are built and tested but the email never arrives.
**Fix (pick one):**
- Option A: Set up Gmail forwarding in `toymachine91@gmail.com` → `alerts@nuke.ag`
- Option B: Run `dotenvx run -- node scripts/gmail-poller.mjs --setup` → OAuth as toymachine91 → `supabase secrets set GOOGLE_REFRESH_TOKEN=<token>`
**Test:** Forward a test email → check `alert_email_log` for processed entry.

### CPO: Make Vehicle Profiles Client-Shareable — GitHub #173
**File:** `nuke_frontend/src/pages/VehicleProfile.tsx` (198KB)
**Requirements:** Add public/admin view toggle. Public hides "Incomplete" warnings. CEO needs to share with Dave Granholm.

### VP Platform: Remove DEBUG Messages — GitHub #177
`DEBUG: Received 0 contributions` visible on production profile pages. Gate behind NODE_ENV check. 5-min fix.

### VP Platform: Build User Health Check — GitHub #174
Edge function `user_health_check(user_id)` returning profile/auth/vehicle status.

### VP Vehicle Intel: Fix Data Quality Issues — GitHub #173
Mileage conflicts, empty timelines, 45% completion scores. Prioritize Skylar's 250 vehicles.

---

## P2 — When Bandwidth Allows

### VP Platform: Fix Market Dashboard Timeout — GitHub #176

---

## Agent Assignments Summary

| Agent | Tasks | Priority |
|-------|-------|----------|
| **CTO** | #178 (profile routing) | P0 |
| **VP Platform** | #175 (Collection query), #180 (email pipeline), #177 (DEBUG), #174 (health check), #176 (market) | P0, P1, P1, P1, P2 |
| **CPO** | #179 (homepage feed), #173 (shareable profiles) | P1 |
| **VP Extraction** | #179 (image at extraction), #180 (verify email pipeline) | P1 |
| **VP Vehicle Intel** | #173 (data quality) | P1 |

## Context
- Skylar's user UUID: `0b9f107a-d124-49de-9ded-94698f63c1c4`
- Gmail for alerts: `toymachine91@gmail.com`
- Target alert address: `alerts@nuke.ag`
- Client demo target: Dave Granholm
- All GitHub issues: #173, #174, #175, #176, #177, #178, #179, #180
- agent_tasks RLS blocks remote inserts — use service role key locally

## COO Notes
Filed by COO (Perplexity Computer) at 2026-02-27T14:19:00Z
