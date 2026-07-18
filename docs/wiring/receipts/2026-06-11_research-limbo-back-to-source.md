---
id: 2026-06-11_research-limbo-back-to-source
date: 2026-06-11
change_type: research
scope: READ-ONLY evidence pass — zero DB writes, zero vision-API calls
related: receipts/2026-06-11_k5-doppelganger-reattribution.md (the pending drain this informs), merge_proposals cb10e3b0
outputs: docs/wiring/output/limbo_888_evidence.csv (per-image evidence + disposition)
status: COMPLETE
---

# Back-to-source evidence pass — the 888 limbo images on e04bf9c5

**Question:** do the 888 active images stranded on doppelganger `e04bf9c5-b488-433b-be9a-3d307861d90b` actually belong to Skylar's 1977 K5 `e08bf694-970f-4cbe-8a74-8715158a0f2e`, judged from the source artifacts only (stored originals' EXIF, chronology, GPS, user photo stream) — no vision, no DB-column trust?

**Answer: yes — 841/888 relink_strong, 46 relink_weak, 1 needs_vision, 0 stays_gaa.** The pending drain in the 2026-06-11 reattribution receipt is supported as-classified.

## Method (cheapest-evidence ladder, as executed)

1. **Inventory** — the exact drain-set query from the reattribution receipt §4 (active, non-rejected, no hash-twin on target) returned exactly **888** rows: 844 iphoto (`vehicle-photos/e04bf9c5…/iphoto/*`) + 44 ssd_blast (`vehicle-photos/unassigned/ssd-blast/<hash>.jpg`).
2. **Stored originals** — range-fetched the first 256 KB of every storage object (888/888 read; 37 transient storage-429s retried serially) and ran `exiftool -fast` on the bytes: DateTimeOriginal, CreateDate, GPS, Make/Model. JPEG EXIF lives in the head, so 256 KB is the full EXIF signal at ~1/15th the bandwidth.
3. **Chronology** — clustered on EXIF DateTimeOriginal (local wall-clock = the day-context unit); fallback DB `taken_at`−7h flagged `db_degraded` (75 rows). Day-overlap tested against e08bf694's own image timeline (`taken_at AT TIME ZONE 'America/Los_Angeles'`, 122 distinct days).
4. **GPS** — EXIF GPS first (761 rows), DB lat/lon fallback (16 more). Matched (<250 m) against known shop locations resolved from the Nuke `businesses` table + OSM.
5. **User stream** — `osxphotos` dump of Skylar's Photos library (92,125 items), matched by capture-time window ±90 s on the same local day (filename matching is useless — `IMG_NNNN` names recycle across years).

## Finding 1 — how much the DB lies (quantified)

| class | n | % | meaning |
|---|---|---|---|
| `exif_confirms_db_tz` | 792 | 89.2% | DB `taken_at` = stored-original EXIF local→UTC, exact to the second (PST/PDT offsets consistent) |
| `db_only_no_exif_in_original` | 75 | 8.4% | stored original has **no EXIF at all** — DB date is unverifiable from source. All 44/44 ssd_blast (EXIF stripped, hash-named) + 31 iphoto (5 PNG screenshots, 26 stripped/exported JPEGs) |
| `exif_db_date_mismatch` | 13 | 1.5% | **DB taken_at belongs to a different photo.** Crossed pairs (e.g. IMG_1542 EXIF 2023-11-06 / DB 2024-10-11 while IMG_1541/43/44 carry the inverse) — an intake mapping bug that swapped taken_at AND GPS between rows. All 12 GPS>50m disagreements are this same set. EXIF is the truth; both sides of every swap are still K5 shop days. |
| `exif_only_db_null` | 4 | 0.5% | DB taken_at NULL but original carries EXIF (IMG_3260-3263_edited.jpeg, all 2024-12-29 17:55) — recoverable |
| `exif_db_minor_offset` | 3 | 0.3% | the 2016-04-23 trio: EXIF tz −04:00 (Adobe Camera Raw-processed pro shots), DB applied a 3 h-wrong offset |
| `no_date_either` | 1 | 0.1% | IMG_6723_edited.jpeg — undated edited export (its base IMG_6723.PNG is in the set, 2022-07-18) |

**Verdict on the doctrine:** for the corpus itself the DB columns do NOT lie — 97.5% of EXIF-bearing originals confirm `taken_at` to the second, and 761/761 GPS pairs agree except the 12 swapped rows. The real lies are structural: (a) the `exif_data` JSONB column contains **Apple Photos curation scores, not EXIF** — DateTimeOriginal/GPS/Model are absent from it everywhere; (b) 8.4% of rows have dates with no source backing; (c) 13 rows carry another photo's timestamp+GPS. Back-to-source was still required to know which 96 rows are the soft ones.

## Finding 2 — chronology: 109 day-clusters, near-total overlap with the K5's own timeline

- **883/887 dated images (99.5%) fall on days where e08bf694 ALREADY has images.** Only 2 days don't exist on the K5 timeline: 2022-02-22 (2 PNG screenshots, both in the K5 album) and 2025-10-07 (2 photos, matched in the K5 album).
- Camera chain is one user's phone upgrade path: iPhone 11 Pro (2021) → 13 Pro (late 2021–2023) → 15 Pro (2023–) + iPad Pro. 802/888 carry Model.
- GPS: **606 at 676 Wells Rd** (35.9773,−114.8541; the task brief's Ernie's Upholstery address) and **117 at 707 Yucca St** (35.9727,−114.8553 — `businesses` rows "Viva! Las Vegas Autos" AND "Ernies Upholstery" both sit at 707 Yucca). 51 more at Canyon Rd, Boulder City (35.980,−114.8533, the 2021-09-01 session, ~300 m from Wells Rd) and 1 at Meineke/Railroad Museum Rd. Only 2 frames outside Boulder City (Essex Ave, Henderson, 2021-06-15). The location story moves Wells Rd (2021–early 2024) → Yucca St (mid-2024–2026), one coherent build narrative.
- The 1,299 limbo observations carry `observed_at` = ingestion dates (2026-03-22: 832, 2026-06-10/11: 466) — useless for chronology; 1,294 are kind='media' riding on these images. The images ARE the chronology.

<details><summary>Full day-cluster table (109 clusters)</summary>

| day | n | iphoto | ssd | exif-dated | dominant GPS | K5 imgs same day | K5 obs same day |
|---|---|---|---|---|---|---|---|
| 2016-04-23 | 3 | 3 | 0 | 3 |  | 13 | 8 |
| 2021-04-12 | 9 | 9 | 0 | 9 | Wells Rd 676 | 29 | 26 |
| 2021-04-13 | 25 | 25 | 0 | 25 | Wells Rd 676 | 56 | 49 |
| 2021-04-14 | 11 | 11 | 0 | 11 | Wells Rd 676 | 22 | 20 |
| 2021-04-26 | 3 | 3 | 0 | 3 | Wells Rd 676 | 6 | 1 |
| 2021-04-29 | 3 | 3 | 0 | 3 | Wells Rd 676 | 6 | 2 |
| 2021-05-02 | 1 | 1 | 0 | 1 | Wells Rd 676 | 2 | 2 |
| 2021-05-06 | 16 | 16 | 0 | 16 | Wells Rd 676 | 37 | 20 |
| 2021-05-07 | 18 | 18 | 0 | 18 | Wells Rd 676 | 54 | 49 |
| 2021-05-14 | 1 | 1 | 0 | 1 | Wells Rd 676 | 3 | 3 |
| 2021-05-15 | 24 | 24 | 0 | 24 | Wells Rd 676 | 61 | 61 |
| 2021-05-19 | 13 | 13 | 0 | 13 | Wells Rd 676 | 38 | 21 |
| 2021-05-26 | 14 | 14 | 0 | 14 | Wells Rd 676 | 14 | 7 |
| 2021-05-27 | 1 | 1 | 0 | 1 | Wells Rd 676 | 3 | 3 |
| 2021-06-12 | 80 | 80 | 0 | 80 | Wells Rd 676 | 222 | 223 |
| 2021-06-14 | 1 | 1 | 0 | 1 | other(35.9712,-114.8514) | 2 | 1 |
| 2021-06-15 | 4 | 4 | 0 | 4 | other(36.0639,-114.9416) | 6 | 6 |
| 2021-06-16 | 2 | 2 | 0 | 2 | Wells Rd 676 | 4 | 4 |
| 2021-07-18 | 5 | 5 | 0 | 5 | Wells Rd 676 | 10 | 10 |
| 2021-07-19 | 2 | 2 | 0 | 2 | Wells Rd 676 | 9 | 4 |
| 2021-07-23 | 45 | 45 | 0 | 45 | Wells Rd 676 | 100 | 88 |
| 2021-07-24 | 6 | 6 | 0 | 6 | Wells Rd 676 | 13 | 12 |
| 2021-08-20 | 9 | 9 | 0 | 9 | Wells Rd 676 | 18 | 18 |
| 2021-08-21 | 18 | 18 | 0 | 18 | Wells Rd 676 | 40 | 40 |
| 2021-08-23 | 26 | 26 | 0 | 26 | Wells Rd 676 | 80 | 68 |
| 2021-08-24 | 25 | 25 | 0 | 25 | Wells Rd 676 | 55 | 47 |
| 2021-08-27 | 5 | 5 | 0 | 5 | Wells Rd 676 | 15 | 15 |
| 2021-09-01 | 64 | 64 | 0 | 64 | other(35.9800,-114.8533) | 203 | 196 |
| 2021-09-21 | 16 | 16 | 0 | 16 | Wells Rd 676 | 44 | 41 |
| 2021-09-22 | 6 | 6 | 0 | 4 | Wells Rd 676 | 10 | 9 |
| 2021-10-05 | 4 | 4 | 0 | 4 | Wells Rd 676 | 12 | 12 |
| 2021-10-06 | 4 | 4 | 0 | 4 | Wells Rd 676 | 12 | 12 |
| 2021-10-12 | 6 | 6 | 0 | 6 | Wells Rd 676 | 21 | 0 |
| 2021-11-29 | 8 | 8 | 0 | 8 | Wells Rd 676 | 24 | 2 |
| 2021-11-30 | 3 | 3 | 0 | 3 | Wells Rd 676 | 9 | 5 |
| 2021-12-07 | 10 | 10 | 0 | 10 | Wells Rd 676 | 33 | 27 |
| 2021-12-08 | 13 | 7 | 6 | 7 | Wells Rd 676 | 23 | 14 |
| 2021-12-10 | 1 | 1 | 0 | 1 | Wells Rd 676 | 4 | 0 |
| 2021-12-11 | 3 | 3 | 0 | 3 | Wells Rd 676 | 12 | 4 |
| 2021-12-16 | 6 | 6 | 0 | 6 | Wells Rd 676 | 27 | 27 |
| 2022-01-10 | 1 | 1 | 0 | 1 | Wells Rd 676 | 3 | 0 |
| 2022-01-14 | 3 | 3 | 0 | 3 | Wells Rd 676 | 10 | 4 |
| 2022-01-17 | 1 | 1 | 0 | 1 | Wells Rd 676 | 3 | 0 |
| 2022-01-21 | 3 | 3 | 0 | 3 | Wells Rd 676 | 8 | 0 |
| 2022-02-21 | 5 | 0 | 5 | 0 |  | 1 | 1 |
| 2022-02-22 | 2 | 2 | 0 | 2 |  | 0 | 0 |
| 2022-03-01 | 2 | 2 | 0 | 2 |  | 10 | 4 |
| 2022-03-27 | 5 | 5 | 0 | 0 |  | 3 | 0 |
| 2022-06-07 | 2 | 2 | 0 | 2 | Wells Rd 676 | 7 | 7 |
| 2022-07-18 | 2 | 2 | 0 | 1 | Wells Rd 676 | 1 | 1 |
| 2022-07-29 | 6 | 0 | 6 | 0 |  | 69 | 30 |
| 2022-09-22 | 3 | 3 | 0 | 3 | Wells Rd 676 | 3 | 0 |
| 2022-12-05 | 1 | 1 | 0 | 0 |  | 12 | 5 |
| 2022-12-23 | 3 | 0 | 3 | 0 |  | 4 | 0 |
| 2023-11-06 | 1 | 1 | 0 | 1 | Wells Rd 676 | 12 | 0 |
| 2023-11-07 | 4 | 4 | 0 | 4 | Wells Rd 676 | 18 | 16 |
| 2023-11-08 | 9 | 9 | 0 | 9 | Wells Rd 676 | 27 | 26 |
| 2023-11-13 | 8 | 8 | 0 | 8 | Wells Rd 676 | 24 | 3 |
| 2023-11-24 | 1 | 1 | 0 | 1 | Wells Rd 676 | 3 | 0 |
| 2023-11-25 | 1 | 1 | 0 | 1 | Wells Rd 676 | 3 | 0 |
| 2023-11-26 | 4 | 4 | 0 | 4 | Wells Rd 676 | 12 | 10 |
| 2023-11-27 | 15 | 15 | 0 | 15 | Wells Rd 676 | 45 | 31 |
| 2023-12-26 | 3 | 3 | 0 | 3 | Wells Rd 676 | 9 | 0 |
| 2024-01-19 | 8 | 8 | 0 | 8 | Wells Rd 676 | 24 | 0 |
| 2024-03-28 | 1 | 1 | 0 | 1 | Wells Rd 676 | 1 | 0 |
| 2024-04-26 | 1 | 1 | 0 | 1 | Wells Rd 676 | 3 | 3 |
| 2024-05-04 | 7 | 7 | 0 | 7 | Wells Rd 676 | 21 | 21 |
| 2024-05-09 | 1 | 1 | 0 | 1 | Yucca 707 (Viva/Ernies) | 1 | 0 |
| 2024-05-11 | 5 | 5 | 0 | 5 | Yucca 707 (Viva/Ernies) | 5 | 4 |
| 2024-05-12 | 1 | 1 | 0 | 1 | Yucca 707 (Viva/Ernies) | 1 | 0 |
| 2024-05-13 | 2 | 2 | 0 | 2 | Yucca 707 (Viva/Ernies) | 2 | 0 |
| 2024-05-21 | 1 | 1 | 0 | 1 | Yucca 707 (Viva/Ernies) | 1 | 0 |
| 2024-05-26 | 1 | 1 | 0 | 1 | Yucca 707 (Viva/Ernies) | 1 | 1 |
| 2024-05-28 | 6 | 6 | 0 | 6 | Yucca 707 (Viva/Ernies) | 3 | 2 |
| 2024-05-30 | 6 | 6 | 0 | 6 | Wells Rd 676 | 18 | 18 |
| 2024-08-23 | 6 | 6 | 0 | 6 | Wells Rd 676 | 28 | 31 |
| 2024-08-24 | 14 | 14 | 0 | 14 | Wells Rd 676 | 60 | 55 |
| 2024-08-25 | 6 | 6 | 0 | 6 | Wells Rd 676 | 102 | 74 |
| 2024-08-30 | 4 | 4 | 0 | 3 | Wells Rd 676 | 36 | 25 |
| 2024-09-21 | 4 | 1 | 3 | 0 |  | 4 | 4 |
| 2024-09-22 | 6 | 6 | 0 | 6 | Wells Rd 676 | 23 | 18 |
| 2024-09-28 | 1 | 1 | 0 | 1 | Wells Rd 676 | 3 | 3 |
| 2024-09-29 | 4 | 4 | 0 | 4 | Wells Rd 676 | 17 | 17 |
| 2024-09-30 | 8 | 5 | 3 | 5 |  | 29 | 27 |
| 2024-10-01 | 5 | 5 | 0 | 5 | Wells Rd 676 | 42 | 42 |
| 2024-10-02 | 1 | 1 | 0 | 1 |  | 13 | 13 |
| 2024-10-03 | 17 | 17 | 0 | 17 | Wells Rd 676 | 57 | 57 |
| 2024-10-10 | 9 | 9 | 0 | 9 | Yucca 707 (Viva/Ernies) | 27 | 24 |
| 2024-10-11 | 6 | 6 | 0 | 6 | Yucca 707 (Viva/Ernies) | 21 | 17 |
| 2024-10-12 | 3 | 3 | 0 | 3 | Yucca 707 (Viva/Ernies) | 21 | 15 |
| 2024-10-18 | 2 | 2 | 0 | 2 |  | 6 | 6 |
| 2024-10-23 | 7 | 7 | 0 | 7 | Yucca 707 (Viva/Ernies) | 22 | 15 |
| 2024-11-29 | 6 | 6 | 0 | 6 | Yucca 707 (Viva/Ernies) | 22 | 18 |
| 2024-12-01 | 2 | 2 | 0 | 2 | Yucca 707 (Viva/Ernies) | 6 | 5 |
| 2024-12-09 | 7 | 7 | 0 | 7 | Yucca 707 (Viva/Ernies) | 21 | 15 |
| 2024-12-11 | 2 | 2 | 0 | 2 | Yucca 707 (Viva/Ernies) | 6 | 6 |
| 2024-12-12 | 10 | 10 | 0 | 10 | Yucca 707 (Viva/Ernies) | 30 | 22 |
| 2024-12-29 | 22 | 22 | 0 | 4 |  | 18 | 16 |
| 2025-01-16 | 7 | 7 | 0 | 7 | Yucca 707 (Viva/Ernies) | 21 | 13 |
| 2025-01-20 | 2 | 2 | 0 | 2 | Yucca 707 (Viva/Ernies) | 6 | 5 |
| 2025-01-23 | 8 | 8 | 0 | 8 | Yucca 707 (Viva/Ernies) | 24 | 19 |
| 2025-01-24 | 2 | 2 | 0 | 2 |  | 6 | 6 |
| 2025-10-05 | 35 | 35 | 0 | 35 | Wells Rd 676 | 49 | 46 |
| 2025-10-07 | 2 | 2 | 0 | 2 |  | 0 | 0 |
| 2025-10-10 | 1 | 1 | 0 | 0 |  | 1 | 0 |
| 2025-10-18 | 4 | 4 | 0 | 4 | Yucca 707 (Viva/Ernies) | 4 | 1 |
| 2025-10-31 | 1 | 1 | 0 | 0 |  | 1 | 1 |
| 2026-01-31 | 34 | 16 | 18 | 16 | Yucca 707 (Viva/Ernies) | 6 | 15 |
| UNDATED | 1 | 1 | 0 | 0 |  | 0 | 0 |

</details>

## Finding 3 — user-stream provenance: 93% sit in Skylar's own "1977 K5 Chevrolet Blazer" album

- **827/888 (93.1%)** time-match (±90 s) a photo in Skylar's Photos library that is a member of the album **"1977 K5 Chevrolet Blazer"** (1,133 photos). 3 more match library photos outside K5 albums. 58 no-match (mostly the EXIF-stripped ssd_blast rows whose DB-only dates can't be matched precisely, and old screenshots).
- Album is a prior, not ground truth — but time-coincident capture in HIS library is user-stream provenance regardless of album naming.

## Finding 4 — missing images: ~151 K5-album photos were never ingested at all

Matching the 1,133-photo "1977 K5 Chevrolet Blazer" album against everything ingested (e08bf694's 2,625 existing images + the 888 limbo set, ±90 s): **151 album photos have no ingested counterpart**, concentrated on a handful of days:

| day | photos in album, never ingested |
|---|---|
| 2021-07-18 | 39 |
| 2022-07-30 | 35 |
| 2024-12-29 | 19 |
| 2021-10-05 | 8 |
| 2021-06-15 | 5 |
| 2024-10-02 | 4 |
| 2022-07-07 | 3 |
| 2026-01-31 | 3 |
| 2022-05-19 | 3 |
| 2021-07-19 | 3 |
| 2022-05-13 | 3 |
| 2021-07-24 | 2 |
| 2022-07-06 | 2 |
| 2025-01-23 | 2 |
| 2024-09-09 | 2 |
| 2023-11-27 | 2 |
| 2022-12-24 | 2 |
| 2021-10-12 | 2 |
| 2024-08-30 | 2 |

2021-07-18 (39 photos) and 2022-07-30 (35) are whole missed work-sessions — both days exist on the K5 timeline but thin (limbo has 5 and 6 frames; the library holds the rest). List: `/tmp/limbo888/missing_1977_album.json` (capture-time + original filename). These are ingest candidates AFTER the drain settles, via the existing iphoto-intake path — not part of this pass.

## Dispositions (evidence legs: EXIF-day overlap with K5 timeline / GPS at known shop / K5-album user-stream hit)

| disposition | rule | n | iphoto | ssd_blast |
|---|---|---|---|---|
| **relink_strong** | ≥2 independent legs | **841** | 820 | 21 |
| **relink_weak** | exactly 1 leg (mostly ssd_blast day-overlap on degraded dates, or album-only) | **46** | 23 | 23 |
| **needs_vision** | 0 legs | **1** | 1 (IMG_6723_edited.jpeg, undated) | 0 |
| **stays_gaa** | any GAA-side evidence | **0** | — | — |

708 images carry all three legs. Zero images show GAA/dealeraccelerate provenance, non-Boulder-City GPS patterns inconsistent with Skylar, or foreign camera hardware.

## Does the evidence support the pending drain as-classified?

**Yes — drain all 888 + 1,299 as planned.** Nothing in the source artifacts contradicts the reattribution receipt's classification; 99.9% of the set has at least one positive K5 leg and 94.7% has two or more. Caveats to carry into/after the drain:

1. **The doppelganger's primary `01014332` (IMG_0465.JPG, 2021-12-08, relink_weak) IS in the drain set** — the `relink_testimony()` demotion guard will fire since e08bf694 already has its primary. Expected, not a blocker.
2. **13 swapped-timestamp rows** (listed in the CSV as `exif_db_date_mismatch`) should get their `taken_at`/GPS corrected from stored-original EXIF in a follow-up write pass — relink first, fix metadata second.
3. **4 NULL `taken_at` rows** are recoverable to 2024-12-29 17:55 from EXIF.
4. **IMG_6723_edited.jpeg** (`b7713471`) is the lone needs_vision row — or simply inherit its base image's day (2022-07-18) by filename lineage.
5. The 298 conservatively-excluded images were NOT examined here (out of scope per task order).

## Provenance of this receipt

- Working set: `/tmp/limbo888/` (inventory.csv, all888_exif.json, master.csv, day_clusters.csv, photos_dump.csv, missing_1977_album.json)
- Evidence CSV: `docs/wiring/output/limbo_888_evidence.csv` — image_id, day, day_confidence, exif_vs_db_verdict, gps_match, day_overlap_with_k5, user_stream_hit, evidence_legs, recommended_disposition
- DB access: read-only SELECTs (drain-set query verbatim from prior receipt; day histograms; `businesses` lookups). Zero writes to any table.
- Stored originals: HTTP range-reads of public storage objects only.
- Photos library: osxphotos read-only dump; no exports, no edits.
