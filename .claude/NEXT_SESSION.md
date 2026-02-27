# NEXT SESSION — COO Work Orders (Updated 2026-02-27 10:25 AST)

## 🚨 EXECUTION MODEL: PARALLEL AGENTS — DO NOT WAIT

**Spin up a NEW agent for each independent task. Do NOT serialize work.** Only block on a dependency if the code literally cannot compile without it. Every issue below is independent unless marked otherwise.

**First agent to open this file:** Read the full list, then immediately spawn agents for every task that can run in parallel. Use `Task` or background agents in Cursor. The goal is ALL 8 issues in progress within the first 5 minutes of the session.

---

## Parallelization Map

```
Agent 1 (CTO)      → #178 profile routing        [independent]
Agent 2 (Platform) → #175 collection tab query    [independent]
Agent 3 (Platform) → #180 email pipeline setup    [independent]
Agent 4 (CPO)      → #179 homepage feed filter    [independent]
Agent 5 (Extract)  → #179 image at extraction     [independent]
Agent 6 (CPO)      → #173 public view mode        [independent]
Agent 7 (Platform) → #177 debug messages          [independent, 5 min]
Agent 8 (VehIntel) → #173 data quality            [independent]
Agent 9 (Platform) → #174 health check endpoint   [independent]
Agent 10 (Platform)→ #176 market timeout          [low priority, if bandwidth]
```

None of these touch the same files except #173 (CPO + Vehicle Intel both touch VehicleProfile.tsx — CPO does frontend, VehIntel does data pipeline, no conflict).

---

## P0 — CRITICAL

### #178 — CTO: Fix Profile Username Routing
**File:** `nuke_frontend/src/pages/Profile.tsx`
**Bug:** `/profile/skylar` → `invalid input syntax for type uuid: "skylar"`
**Fix:** UUID regex check on route param. If not UUID, query `profiles.username` to resolve. 30-min fix.
**Test:** `https://nuke.ag/profile/skylar` loads.
**Blocks:** Nothing. Start immediately.

### #175 — VP Platform: Fix Collection Tab Query
**File:** `nuke_frontend/src/pages/Profile.tsx` (Collection tab section)
**Bug:** Collection tab shows 0 vehicles. `uploaded_by` has 250 vehicles, `owner_id` is NULL.
**Fix:** Update query to check `uploaded_by`. Run migration: `UPDATE vehicles SET owner_id = uploaded_by WHERE owner_id IS NULL AND uploaded_by IS NOT NULL`.
**Test:** Skylar's Collection tab shows 250 vehicles.
**Blocks:** Nothing. Start immediately.

---

## P1 — HIGH

### #179 — CPO: Homepage Feed Hides New Vehicles
**File:** `nuke_frontend/src/pages/CursorHomepage.tsx` (line ~927)
**Bug:** `.not('primary_image_url', 'is', null)` hides all vehicles without images. Image pipeline is PAUSED. New extractions are invisible.
**Fix:** Add toggle or remove filter when sorted by newest. CEO sees +1,422 today in stats but zero new vehicles in the feed.
**Blocks:** Nothing. Start immediately.

### #179 — VP Extraction: Pull Image at Extraction Time
**Bug:** BaT extraction creates vehicles without `primary_image_url`.
**Fix:** During BaT extraction, grab the listing's hero image URL and set it as `primary_image_url`. This makes vehicles visible in the feed without the full image pipeline.
**Blocks:** Nothing. Start immediately. Separate concern from the CPO toggle above.

### #180 — VP Platform: Connect Email Alert Pipeline
**Bug:** Gmail forwarding from `toymachine91@gmail.com` to `alerts@nuke.ag` never set up. Edge functions are built and tested. 0 emails in `contact_inbox`, 0 in `alert_email_log`.
**Fix (one of):**
- Option A: Gmail forwarding setup (needs CEO to confirm in Gmail)
- Option B: `dotenvx run -- node scripts/gmail-poller.mjs --setup` → OAuth as toymachine91 → `supabase secrets set GOOGLE_REFRESH_TOKEN=<token>`
**Blocks:** Needs CEO Gmail access for Option A, or local env for Option B. **Start the prep work immediately** — verify edge functions are deployed, test with a manual curl to `process-alert-email`, have everything ready so the CEO just clicks one button.

### #173 — CPO: Public View Mode for Vehicle Profiles
**File:** `nuke_frontend/src/pages/VehicleProfile.tsx`
**Fix:** Add public/admin toggle. Public hides "Incomplete profile" warnings, empty sections. CEO needs to share with Dave Granholm.
**Blocks:** Nothing. Start immediately.

### #177 — VP Platform: Remove DEBUG Messages
**File:** `nuke_frontend/src/pages/Profile.tsx`
**Fix:** Gate `DEBUG:` output behind `process.env.NODE_ENV !== 'production'`. 5-minute fix.
**Blocks:** Nothing. Do this first as a warmup, then move to bigger tasks.

### #174 — VP Platform: User Health Check Endpoint
**Spec:** Edge function `user_health_check(user_id)` → profile/auth/vehicle status.
**Blocks:** Nothing. Start immediately.

### #173 — VP Vehicle Intel: Data Quality
**Fix:** Mileage conflicts, empty timelines, 45% completion. Prioritize Skylar's 250 vehicles.
**Blocks:** Nothing. Start immediately.

---

## P2

### #176 — VP Platform: Market Dashboard Timeout
Low priority. Pick up if bandwidth allows.

---

## Key Context
- Skylar's UUID: `0b9f107a-d124-49de-9ded-94698f63c1c4`
- Gmail: `toymachine91@gmail.com`
- Alert address: `alerts@nuke.ag`
- Client: Dave Granholm (needs shareable profile link)
- Image pipeline: PAUSED (`NUKE_ANALYSIS_PAUSED`)
- agent_tasks RLS blocks remote inserts — use service role key
- GitHub issues: #173, #174, #175, #176, #177, #178, #179, #180

## COO Directive
**Do not wait. Do not serialize. Spin up an agent per task. Report back via DONE.md when each is complete.**

Filed by COO (Perplexity Computer) at 2026-02-27T14:25:00Z
