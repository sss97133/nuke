# Mustang Profile — Pipeline Audit & Service Log

**Date:** 2026-06-20
**Subject vehicle:** 1966 Ford Mustang, canonical record `83f6f033-a3c3-4cf4-a85e-a60d2c588838` (VIN `6F07C219593`, ~1,408 images)
**Owner:** `0b9f107a-d124-49de-9ded-94698f63c1c4`
**Status:** 🟡 IN PROGRESS — **this job is incomplete by design.** The Mustang is the acceptance test for a set of pipeline fixes; profiles are not hand-edited. Open items are tracked in §6.

---

## 0. Thesis

A correct vehicle profile is not authored — it is **emitted by a pipeline that handles raw data correctly.** Every flaw below is treated as a *symptom*; the work is to find its *cause* in the ingest/derive/attribute pipeline and service that, then let the profile regenerate. The hand-built ground truth (exiftool dates, vision classification) is kept as the **regression answer key** the serviced pipeline must reproduce — it is not the fix.

Governing rule discovered this session: **capture date = the file's embedded EXIF `DateTimeOriginal`, nothing else.** Not `PHAsset.creationDate` (the OS re-add date), not a `::date` cast in UTC, not upload-now. The file is the only witness that survives the source→DB transition intact.

---

## 1. Flaw register

Each flaw: **symptom → evidence → root cause → pipeline service → status.**
Severity: 🔴 corrupts data/profile · 🟠 user-visible wrong · 🟡 gap/incomplete.

### F-1 🔴 Capture-date fabrication on the write path
- **Symptom:** Old photos (2018, 2019) appear in the timeline stamped with today's date; they get swept into "today" and mis-attributed.
- **Evidence:** exiftool vs DB — `IMG_1382` true `2018-07-09` (iPhone X), DB `taken_at = 2026-06-20`; `IMG_1420`/`IMG_1462` true `2019-06-16` (iPhone XS), DB `2026-06-20`. The genuinely-today frame (`IMG_1380`, iPhone 15 Pro) was correct.
- **Root cause:** the iOS capture relay sent `PHAsset.creationDate` as `taken_at`. For re-added photos (iCloud restore / shared album / AirDrop) that value is the *re-add* date, not capture. The file's embedded `DateTimeOriginal` was correct and ignored — the relay already parsed EXIF for camera make/model and had the date one field away.
- **Pipeline service:** ✅ DONE (forward). `CameraEXIF.captureDate(from:)` now reads embedded `DateTimeOriginal` (+`OffsetTimeOriginal`); `taken_at` sources from it, falling back to `creationDate` only when EXIF is stripped. Build green. **Not yet shipped — reaches devices on next TestFlight.** Web path (`imageUploadService.ts`) de-fabricated separately (no longer stamps upload-now).
- **Files:** `apps/nuke-capture-ios/Sources/NukeCapture/CameraEXIF.swift`, `SyncEngine.swift`, `SupabaseService.swift`; `nuke_frontend/src/services/imageUploadService.ts`.

### F-2 🟠 UTC date-rollover on the read path ("+1 day")
- **Symptom:** Evening photos display/bucket one day late across ~40% of the library.
- **Evidence:** stored instant `2018-08-27 02:11 UTC` renders `pacific_day = 2018-08-26` (matches EXIF) but `utc_day = 2018-08-27` (what we showed). 15/40 random sample mismatched, ~14 of them exactly +1 day.
- **Root cause:** the **instant is correct**; readers derive the day with `taken_at::date` evaluated in UTC instead of the photo's local zone. This is a read/logic flaw, NOT data corruption.
- **Pipeline service:** 🟡 OPEN. Constraint: a correct local day needs the photo's offset, which lives in the file's EXIF, not the DB. So fixing *historical* rows requires materializing a per-photo local capture date (see F-7 backfill). No global-timezone fallback (owner rule: the timezone is the photo's own testimony). Forward, the relay should also emit the local wall-clock date.
- **Read paths to fix:** _pending Audit A — list of `::date` UTC-truncating RPCs/components._

### F-3 🔴 Attribution with no lock — multi-vehicle bulk-dump
- **Symptom:** A whole multi-vehicle shop day (Mustang + IH Scout + red Chevy + Honda motorcycle) was auto-attributed to one "Mustang" record (`8bde1dda`).
- **Evidence:** vision classification of today's 77 frames: ~10 Mustang, ~51 IH Scout (NV plate BE5363), 4 Honda motorcycle, 2 red Chevy, 7 ambiguous. A legible foreign plate is a hard disqualifier the engine drove past.
- **Root cause:** attribution assigns on a thin signal (recency/active-record) with no provenance partition and no convergence test. Live owner-authored EXIF-complete photos compete in the same pool as unrelated records; absence of a match resolves to "best guess" instead of "hold open."
- **Pipeline service:** 🟡 OPEN (the larger build). Design: a multi-tumbler lock — GPS-in-shop-cluster + capture-time continuity + visual continuity to the vehicle's existing worldline + hard disqualifiers (plate/VIN) + the *real* local candidate set — that **holds a frame unattributed when tumblers don't converge.** Materially easier once F-1/F-2 make dates honest (much of the contamination was mis-dated old photos landing in the wrong day).

### F-4 🟠 Split identity — duplicate Mustang record
- **Symptom:** Today's real Mustang frames + the lead-image payoff stranded on a VIN-less duplicate while the canonical VIN'd build shows a stale lead.
- **Evidence:** two `owner=` 1966 Mustang records — canonical `83f6f033` (VIN, 1,408 imgs) and `8bde1dda` (no VIN, ~315 imgs, contaminated catch-all).
- **Root cause:** _pending Audit B — is `8bde1dda` a dup fragment of the same chassis or a genuinely separate car; how many true-Mustang frames are stranded._
- **Pipeline service:** 🟡 OPEN. Resolution is **per-photo vision-verified relink** to canonical (never a bulk merge — that would pour Scout/Chevy frames into the clean record), via the sanctioned `relink_testimony` / `reattribute_observation` RPC, lineage preserved. Depends on F-3 lock.

### F-5..F-n — _pending audits (attribution contamination of the canonical set, valuation/investment ledger, timeline coherence, identity, empty widgets)._

---

## 2. Sanctioned write paths (for the service steps that mutate testimony)

`vehicle_images` is a testimony table — **no raw `UPDATE`/`DELETE`.** Confirmed RPCs:
- `reattribute_observation(p_observation_type, p_observation_id, p_target_vehicle_id, p_reason, p_actor_user_id)`
- `relink_testimony(p_observation_type, p_observation_id, p_target_vehicle_id, p_reason, p_actor_user_id)`
- `unmerge_vehicle(p_proposal_id)` (reversal)
Merges go through `merge_proposals` + AI verification, never blind. Date corrections must preserve lineage / supersede, not overwrite silently.

---

## 3. Regression answer key (what a serviced pipeline must reproduce)

- Today's 77 frames re-sort to: **10 → Mustang `83f6f033`**, **~51 → an IH Scout entity (to be created)**, **2 → a red Chevy crew cab**, **4 → a Honda motorcycle**, 7 ambiguous held open.
- Fabricated dates snap back: the IH Scout frames to **2018–2019**, today's true Mustang frames to **2026-06-20**.
- Lead image of `83f6f033` becomes the genuinely-latest *verified-Mustang* photo.

---

## 4. Service log (chronological)

- 2026-06-20 — F-1 forward fix landed (relay reads embedded EXIF date). iOS build green. Web path de-fabricated.

---

## 5. Equal-entity principle

The Scout, the red Chevy, and the Honda are **equal-level entities**, not "noise on the Mustang." Servicing the pipeline means each gets its own correct record and timeline as an automatic output — the Scout currently has **no entity at all** and must be created (owner-gated) as part of resolving F-3/F-4.

---

## 6. Open items (this job is incomplete)

- [ ] F-2 read-path list + local-date materialization
- [ ] F-3 attribution lock design + implementation
- [ ] F-4 duplicate resolution (per-photo relink) + Scout entity creation
- [ ] F-5+ valuation/investment ledger, timeline, identity, widgets — from audits
- [ ] Backfill: re-derive historical `taken_at` from embedded EXIF (the source of truth), validated against §3
- [ ] Ship the relay fix to TestFlight

_Audit findings (A: dates, B: attribution/duplicate, C: completeness/valuation) fold into §1 and §6 as they land._
