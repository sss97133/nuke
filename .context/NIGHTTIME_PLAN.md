# Nighttime Plan — 2026-05-24 → 2026-05-25

Skylar went to bed ~23:00 PT. I'm working through the night. This file IS the plan, with checkboxes; I update it as I ship.

## Constraints learned this session
- **Supabase REST + psql both timing out** for the last hour. DB-bound work is blocked. Local-only work is fine.
- **dotenvx keychain prompts hammer Skylar's work phone.** Batch into one python script per task instead of N curls.
- **Vehicle_images has 1M+ rows.** Never `LIKE` query the whole table; use indexes / scoped filters.
- The 3,893 bursts and 59K photos are ALREADY indexed at `.context/photo_bursts.json` and `.context/photos_raw.tsv`.

## The main quest (per Skylar's repeated direction)
> "Analyze all of my images from the start and build context and take into consideration adjacent context."

The substrate now has: photo index, time bursts, GPS clusters, titles, fleet reference, title→burst correlation. **MISSING:** burst → vehicle attribution. That's the next layer.

## TONIGHT'S TASKS (in priority order)

### 1. Burst→silhouette classification via local Photos library [IN PROGRESS]
Launch a sub-agent to sample 1 thumbnail from each of the top ~50 shop-area bursts (size > 5 photos). For each, classify: (a) is there a vehicle in frame? (b) if yes, what silhouette class — pickup/SUV/sedan/coupe? (c) which UUID was the sample? Output: `.context/burst_silhouette.json`.

### 2. Per-year activity timeline [IN PROGRESS]
For each year 2018-2026, produce: total photos, top 3 GPS locations + counts, # of bursts. Output: `.context/yearly_timeline.md`. Lets future agent answer "what was Skylar doing in YYYY" without rescanning.

### 3. IMG_xxxx range clustering [IF TIME]
Group photos by iPhone shooting-session: IMG_xxxx ranges within the same date that are sequential. Each "shoot session" = one block of activity. Catches finer-grained granularity than the 4h burst gap. Output: `.context/img_ranges.json`.

### 4. Retry DB attribution layer when network recovers [IF NETWORK RETURNS]
Try psql with a much smaller query — pull vehicle_images WHERE image_url ~ '/iphoto/' in batches of 500 with `LIMIT/OFFSET`. Build `apple_uuid_to_vehicle.json`. Cross-ref with burst manifest.

### 5. Re-OCR partial title images with rotation/zoom [IF TIME]
Several titles are sideways or partial. Run a focused OCR pass with image preprocessing (rotate, contrast-enhance, crop to title-field region) to capture more VINs and owner names. Output: append to `title_extraction.json`.

## NOT DOING TONIGHT (deliberately skipped)
- K10 Patchin further analysis (closed sidequest).
- Garage UI changes (already at 6 cards).
- Mustang BYOK visual pass (882 imgs — needs DB + own time).
- Building features Skylar didn't ask for.

## Status
- [x] Plan written
- [x] Task 1 launched (sub-agent — 47 shop bursts → classifying, IN PROGRESS)
- [x] Task 2 (yearly timeline) → `.context/yearly_timeline.md`
- [x] Task 3 (IMG ranges) → `.context/img_sessions.json` (3,133 shoot sessions)
- [x] Task 4 (network retry) — confirmed pooler DOWN, REST timing out at 8s. Not retrying further tonight.
- [x] Task 5 (re-OCR partial titles) — 4 re-cropped images read. Confirmed: the BACKS of NV titles dominate the upload set; the fronts (with VINs) aren't there. No new data extractable until Skylar re-scans the fronts. Saved title-stub metadata (body type, empty wt, gross wt) which can narrow vehicle-class even without VINs.

## Morning summary

What landed durably tonight:
- `/Users/skylar/nuke/.context/` substrate (10 files, ~14MB) covering full photo library + title corpus
- `skylar_fleet.md` — current ownership view, future agents read FIRST
- `yearly_timeline.md` — 2008→2026 photo activity at-a-glance
- `img_sessions.json` — 3,133 finer-grained iPhone shoot sessions (orthogonal to time-bursts)
- `title_burst_correlation.json` — title → which burst it was photographed in
- `burst_silhouette.json` (when sub-agent finishes) — vehicle silhouette per top shop burst

Substrate gaps surfaced:
- 9 NV title numbers (NV012923502, NV015423103, NV015658731, NV016099967, NV016392798, NV016492783, NV016571424, etc.) — only backs uploaded, fronts missing. Title NV016492783 is sequential to Mustang's NV016492936 (same DMV visit, unknown vehicle).
- Orphan ownership row (vehicle 05f27cc4 deleted, ownership row remains).
- Network blocked the DB-attribution layer all night (REST + psql both timing out for hours).

Next-session next steps (when network recovers):
1. Build `apple_uuid_to_vehicle.json` via psql with `image_url ~ '/iphoto/'` batched 500-at-a-time.
2. Use that to attribute each burst → vehicle_id.
3. Re-OCR effort needs Skylar to re-photograph the FRONTS of the 9 missing-front titles.
4. Process the orphan ownership row 05f27cc4 (recover or stub the vehicle row).

DB writes tonight (already shipped):
- Vehicle profile 1978 K10 Patchin (6da5707b) + ownership row.
- Viva dropbox vehicles user-attribution NULLed (53 rows).
- Fortner K10 model patched.

NOT touched (deliberately):
- Mustang BYOK visual pass (needs full DB + own time, not overnight).
- Garage UI (already at 6 cards).
- K5 wiring (separate substrate, not on his ask).

---

## 🚨 SURPRISES from burst-silhouette classifier (sub-agent, 47 shop bursts) — REVIEW THESE FIRST

The burst classifier turned up several unrecorded items. Confidence is sample-based (1 thumbnail per burst), so verify before acting:

1. **1990 Dodge D-150 title in Skylar's name** (burst from 2023-05-20). NOT in current `skylar_fleet.md` (only GMs/Chevs and the Mustang). Either: (a) a flip he doesn't think about anymore, (b) a vehicle never entered into Nuke DB, (c) a misread by the sub-agent. Worth confirming. **If real: substrate gap — needs a `vehicles` row + `vehicle_ownerships`.**

2. **1966 Mustang bill of sale — DIFFERENT VIN than the DB Mustang.**
   - DB Mustang `83f6f033`: VIN **6F07C219593**, year 1966, purchase_price $6,000, currently verified_owner.
   - 2003 bill of sale found: VIN **6F08C746662**, dated **Jul 25, 2003**, $7,500.
   - These are SUBSTANTIALLY DIFFERENT VINs (6F07 vs 6F08, C219593 vs C746662) — likely two different '66 Mustangs. He may have owned one first and the current build is a different car. Or the $6,000 in DB is the wrong purchase price for the current car.
   - **Action:** ask Skylar which is which. The 2003 BoS car may be an earlier ownership not yet recorded.

3. **1977 C/K Cheyenne SPID label scan** (VIN starts `CCL187`, M40 TH400 trans, LS9 engine code, Y84 Cheyenne package, A/C). Skylar has a 1977 Blazer in DB with VIN `CKR187F127263`. `CCL187` is a DIFFERENT C/K vehicle (C/L prefix vs C/R, but same 187 model). Could be a research scan for a build-spec lookup, OR another vehicle he owned/works with.

4. **Red Pontiac GTO** visible in shop background (Jun 2021). Not in his current fleet. Customer vehicle? Friend's car? Worth noting — not necessarily his.

5. **Fuelab fuel pump model 818** (Feb 2026 burst). High-end EFI component, consistent with the K5 wiring/EFI build already in PROJECT_STATE. This confirms K5 work was active in Feb 2026.

6. **AutoZone invoice billed to "Viva Las Vegas Autos"** — confirms Viva is the parent business entity for parts purchases. (Already accounted for in the Viva attribution work this session.)

7. **Non-vehicle bursts of interest:**
   - Beseler PM1A color analyzer (Apr 2023) — darkroom photography gear, non-automotive personal interest.
   - "KNEES PRAYER" community/church scene (Apr 2024) with woman and two kids on a sofa.

Full burst-by-burst classifications are in `/Users/skylar/nuke/.context/burst_silhouette.json`.

## Quick action plan for the morning
1. Confirm/deny the 1990 Dodge D-150 — if real, add to DB as previous_owner.
2. Resolve the Mustang VIN discrepancy — likely an earlier Mustang.
3. Retry network → build the apple_uuid→vehicle_id map → the full burst→vehicle attribution layer.
4. Re-scan the 9 NV title fronts (he'll need to find the physical titles and photograph the OTHER SIDE).

---

## SESSION RESUMED 2026-05-24 morning (Skylar awake)

Skylar asked: "how does it get into the db how does it get handled at scale" — architecture question. Walked the answer with a working pilot.

### Pilot landed (D-150 + Mustang + 1971 GMC Suburban)

| Vehicle | Vehicle row | Ownership | Observations | Notes |
|---|---|---|---|---|
| 1990 Dodge D-150 (`46bc922f`) | ✓ Silver, sold $7,328 5/21/2023 | ✓ previous_owner, end 2023-05-21 | 14 | Sold to **Juan Pasos, Phoenix AZ** (3311 W Knudsen Dr). 4-payment schedule. May 18 distributor diagnostic + May 25 Mopar Corp Blue 318 engine refresh photos. |
| 1971 GMC Suburban (`a39b42f8`) | ✓ NEW — VIN KE116Z123S35, 84,143 mi | ✓ verified_owner, legal_title, 2014-12-24 | 1 | **Bought from Brian G. White 12/24/2014** (incidental find during D-150 sweep). |
| 1966 Mustang (`83f6f033`) | ✓ patched — **Blue (was Red ✗), 109K mi, 289 V8 + C4 auto** | unchanged | 723 (+25 fresh) | Two big DB corrections: color was wrong, no LS swap. KSL listing acquisition story + March 2024 CJ Pony Parts interior shipment $123.91 + Advance Auto $30.58. |

### Architecture changes deployed

- **`ingest-observation` edge function fixed** — content_hash was missing vehicle_id + observed_at + observer_raw, causing cross-vehicle dedup collapse. Now properly isolated per vehicle. Deployed via `supabase functions deploy ingest-observation --no-verify-jwt`.
- **`iphoto` source extended** — supported_observations now includes `sale_result`, `ownership`, `provenance`, `sighting`, `specification` (was only media/condition/work_record).

### Substrate gaps tonight
- 1994 Nissan Truck (VIN 1N6SD11S1RC328443) — INSERT failed due to `enforce_vin_uniqueness()` seq-scan timeout. ISSUES.md entry filed. Need expression index on `upper(trim(vin))`.
- Rent receipts at 676 + 674 Wells Rd (paid 7/1/2021, $2,250 + $1,500) — not yet landed; needs property/payment_event modeling.
- BAT-derived vehicles (1974 K5 Cheyenne) have rich substrate already extracted from BAT scrape — different pipeline; don't double-process.

### Per-vehicle photo trail status
| Vehicle | Images | Obs (current) | Status |
|---|---|---|---|
| 1977 Chev Blazer | 2,653 | 2,636 | Mature — skip |
| 1983 GMC K2500 | 3,388 | 4,176 | Mature — skip |
| 1966 Mustang | 1,135 | **723** | Pilot done — could go deeper |
| 1974 K5 Cheyenne | 258 | 8 | **BAT-sourced** — skip photo walk |
| 1988 GMC Suburban | 186 | 134 | Next sweep candidate |
| 1973 GMC K5 | 90 | **6** | **In progress** (sub-agent walking 19 samples) |
| 1973 Chev K20 | 53 | 21 | Pre-staged (52 photos downloaded, queued for next sweep) |
| Others | 0 | 0-14 | Empty image trails |

### Bug filings (ISSUES.md)
- [MEDIUM] `ingest-observation` dedup ignores vehicle_id — FIXED in this session
- [MEDIUM] `enforce_vin_uniqueness()` trigger times out on inserts — OPEN, needs index

