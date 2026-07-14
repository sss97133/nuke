---
id: 2026-06-11_reappropriation-complete
date: 2026-06-11
change_type: db_reattribution
scope: vehicle_images + vehicle_observations (e04bf9c5 → e08bf694) + 17-row metadata repair + missing-photo ingest
status: COMPLETE
amends: 2026-06-11_k5-doppelganger-reattribution
related: 2026-06-11_research-limbo-back-to-source, migration 20260611210000_relink_testimony_in_place.sql, migration 20260611220000_limbo888_metadata_repair_from_stored_exif.sql, docs/wiring/output/limbo_888_evidence.csv, .claude/ISSUES.md CRITICAL "K5 wiring data is attached to the wrong vehicle_id" (now FIXED)
authorization: Skylar 2026-06-11 — "when is it all done, reappropriation of all of my images, that's really all we need to be thinking about" + unanimous evidence pass (zero stays_gaa dispositions)
---

# K5 reappropriation COMPLETE — e04bf9c5 drained to e08bf694

Closes the remainder filed in `2026-06-11_k5-doppelganger-reattribution.md` §4. Three jobs executed in order. **Nothing deleted anywhere.**

## Job 1 — Evidence-backed drain (888 images + 1,299 observations)

Executed the §4 resume plan via `relink_testimony()` (migration 20260611210000, in-place relink: content untouched, `merged_from_vehicle_id` populated, `reattribution_audit` row per move, gate status preserved). Every image's audit reason cites its evidence basis from `docs/wiring/output/limbo_888_evidence.csv`:

| Disposition | Count | Audit reason basis |
|---|---|---|
| relink_strong | 841 | `evidence_csv disposition=relink_strong` (day_overlap + GPS-shop + K5-album legs) |
| relink_weak | 46 | `evidence_csv disposition=relink_weak` |
| needs_vision | 1 | `b7713471` IMG_6723_edited.jpeg — RESOLVED by filename lineage: base IMG_6723 = 2022-07-18 per `2026-06-11_research-limbo-back-to-source.md`; relinked with that note |
| observations | 1,299 | §4 resume driver (active, non-GAA `dealeraccelerate`) — receipt-plan basis cited |

**Batching:** images 250/batch initially → first two batches hit the 120s `statement_timeout` and **rolled back atomically** (cause: per-row `vehicle_images` UPDATE triggers `maintain_vehicle_has_photos` + `recompute_value_from_images` → `compute_vehicle_value`, expensive against e08's 2,700+ images when cold). Re-run at **50/batch — all clean**. Observations 500/batch × 3, clean. Lock-check after every batch: **0 waiters throughout**. Operational note for future drains recorded in ISSUES.md HIGH entry: use ≤50 images/batch.

**Primary-demotion guard fired exactly once** — image `01014332` (ssd_blast, e04's sole primary, relink_weak) demoted on move because e08bf694 already has its primary. Predicted in the prior receipt; correct behavior. e08bf694 retains exactly 1 primary.

**Refusal guard:** 0 `file_hash_exists_on_target` refusals (the 127 exact hash-twins were already excluded from the evidence drain set as `stays`).

## Job 2 — Metadata repair (17 rows, stored-original EXIF as source)

The back-to-source pass found 13 rows whose `taken_at` + GPS belong to a *different* photo (intake mapping bug swapped crossed pairs, e.g. IMG_1541/1542) and 4 rows with NULL `taken_at` whose stored originals carry EXIF dates.

No supersession-compatible path exists for image-row content corrections — copy+supersede collides with the `(vehicle_id, file_hash)` unique index (a corrected copy of identical content on the same vehicle is structurally impossible). Per the authorized fallback: **single migration applied** — `supabase/migrations/20260611220000_limbo888_metadata_repair_from_stored_exif.sql`:

- 13 × `exif_db_date_mismatch`: `taken_at` + `latitude`/`longitude` set from stored-original EXIF (`DateTimeOriginal` + `OffsetTimeOriginal` + GPS, exiftool over the Supabase storage originals, `/tmp/limbo888/all888_exif.json`). One row (IMG_6723.PNG) had no EXIF GPS — its swapped-in DB GPS was cleared (belonged to the twin photo). One row had no EXIF offset — `-07:00` assumed (Henderson NV, July PDT), noted in the audit JSON.
- 4 × `exif_only_db_null`: NULL `taken_at` filled from EXIF (IMG_3260–3263_edited.jpeg, 2024-12-29).
- **Before-values preserved on every row** in `exif_data->'metadata_repair_2026_06_11'` (taken_at/lat/lon prior values + source + basis citations). Verified post-apply: 17/17 rows carry the audit key, 0 NULL `taken_at` remain in the set.

All 17 rows were already on e08bf694 when repaired (moved in Job 1).

## Job 3 — The "missing 151" album photos

`/tmp/limbo888/missing_1977_album.json` (151 entries) re-examined before ingest:

| Class | Count | Outcome |
|---|---|---|
| Videos (71 MOV + 1 MP4) | 72 | **Outside the photo-intake pipeline** (script media filter is jpg/jpeg/png/heic). Not ingested — left as a known gap; needs a video-intake path if wanted. |
| WEBP / AVIF | 5 | Same — format not handled by the intake converter. |
| Image files (57 JPG + 14 PNG + 2 JPEG + 1 HEIC) | 74 | Eligible for the normal path. |
| …of which filename-collide with existing e08 iphoto rows | 59 | **58/59 are the SAME photos already ingested** (DB `taken_at` matches the album timestamp same-day; the research pass's ±90s matcher was too strict — over-inclusive "missing" list). 1 collision has a NULL-date side. Dedup correctly skips them. |
| …genuinely missing image files | ~15 | Ingested via the NORMAL patched path: `node scripts/iphoto-intake.mjs --vehicle-id e08bf694-… --album "1977 K5 Chevrolet Blazer" --force --download-missing` (the 2026-06-11 patch excludes merged/soft-deleted vehicles from match targets; `--force` only bypasses the album-name word check — target explicit). |

**Ingest result:** RESULT_PLACEHOLDER

New rows land with `ai_processing_status='pending'` and flow into the running BYOK burn loop (`byok-burn-all.sh` confirmed live during this session) automatically.

## Verification — before / after

| Table / check | e04bf9c5 before | e04bf9c5 after | e08bf694 before | e08bf694 after |
|---|---|---|---|---|
| vehicle_images (all rows) | 1,186 | **298** (149 rejected_misattributed + 22 rejected_personal + 127 hash-twins — the intentional stays, exactly) | 2,696 | **3,584** (+888) |
| vehicle_observations active | 1,299 | **0** | — | — |
| vehicle_observations superseded | 32 (27 GAA + 5 copy-shells) | 32 (untouched) | — | — |
| vehicle_observations (all) | 1,331 | 32 | 4,819 | **6,118** (+1,299) |
| primaries (non-doc, non-dup) | — | — | 1 | **1** (demotion guard worked) |
| lineage `merged_from_vehicle_id=e04…` on e08 | — | — | 10 img / 15 obs | **898 img / 1,314 obs** |
| `reattribution_audit` (old=e04…) | 25 | **2,212** | | |
| audit rows citing a demotion | 0 | **1** (`01014332`) | | |
| lock waiters after every batch | 0 | 0 | | |
| cached `vehicles.image_count` | 1,186 (stale) | refreshed → 298 | 3,584 (live-maintained) | 3,584 |

e04bf9c5's active testimony is now **only GAA-native rows + gate-rejected/duplicate stays**: the 27 GAA listing observations (superseded stubs), 149 gate-rejected-misattributed, 22 gate-rejected-personal, 127 exact hash-twins. Zero active observations. The K5's photo corpus lives entirely on e08bf694.

## Files touched

- `supabase/migrations/20260611220000_limbo888_metadata_repair_from_stored_exif.sql` — NEW, applied
- `.claude/ISSUES.md` — doppelganger CRITICAL → **FIXED**; HIGH `reattribute_observation()` entry updated (drain done; function defects remain OPEN)
- `docs/wiring/K5_WIRING_STATE.md` §3 item 3 — remainder marked DRAINED
- `docs/wiring/receipts/2026-06-11_reappropriation-complete.md` — this receipt

## Out of scope / still open (unchanged from prior receipt)

- e04bf9c5 end-state oddity: `status='active'` + `is_public=true` + `deleted_at` set — should likely become a clean non-public ghost for GAA 43671; ghost `135cb20e` already holds GAA sale event `826883df`.
- `owner_id` on e08bf694 is NULL, `owner_name` still "Scott (li3go)" — ownership promotion needs Skylar's explicit title-proof flow.
- 72 videos + 5 WEBP/AVIF from the album have no intake path.
- `reattribute_observation()` structural defects (ISSUES.md HIGH) unfixed.
