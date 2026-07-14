---
id: 2026-06-11_k5-doppelganger-reattribution
date: 2026-06-11
change_type: db_reattribution
scope: vehicles + vehicle_images + vehicle_observations (e04bf9c5 → e08bf694) + scripts/iphoto-intake.mjs
status: PARTIAL — bleed severed, 25 testimony rows relinked, 2,187 rows blocked (see Remainder)
related: merge_proposals cb10e3b0 (approved 2026-05-24), receipts/2026-05-17_db-forensic-audit-k5-records.md, receipts/2026-05-14_migration-plan-k5-vehicle-id-reattribution.md (direction REVERSED by Skylar 2026-05-17), .claude/ISSUES.md CRITICAL "K5 wiring data attached to wrong vehicle_id"
authorization: Skylar explicit order 2026-06-11 — "fix the 2wd issue"
---

# K5 doppelganger reattribution — sever e04bf9c5 from Skylar's profile

## The two vehicles

| | `e08bf694-970f-4cbe-8a74-8715158a0f2e` | `e04bf9c5-b488-433b-be9a-3d307861d90b` |
|---|---|---|
| VIN | `CKR187F127263` (K-series, 4WD) | `CCL187Z210370` (C-series, 2WD) |
| Identity | **Skylar's K5** — owner-confirmed 2026-05-17 | GAA listing 43671 — a DIFFERENT physical 1977 Blazer (2WD, 383 stroker, 700R4, NMVTIS-branded title) |
| Doppelganger strings | none (verified by row-cast regex) | `origin_metadata.highlights` carries "2WD", "New 383 CID Stroker Engine and 700R Transmission", "Previous Title Branded … Per NMVTIS Report" |

## 1. The link mechanism (how the 2WD chips bled onto Skylar's profile)

Three false links bound the doppelganger to Skylar — **none of them aliases or e08bf694's own data**:

1. **`vehicles.owner_id = 0b9f107a` (Skylar) on e04bf9c5** — while the REAL K5 e08bf694 has `owner_id = NULL` (only `uploaded_by`/`user_id` = Skylar). Every owner-scoped surface therefore saw ONLY the doppelganger as "Skylar's 1977 Blazer." Critically this includes `scripts/iphoto-intake.mjs` `loadVehicleCache()` (`.eq('owner_id', USER_ID)`, no status filter): its Tier-2 fuzzy match (year+make+model-first-word) resolved "1977 Chevrolet Blazer" to e04bf9c5 with `matches.length === 1` — silent, no ambiguity warning — which is how 1,196 of Skylar's photos and 1,300+ observations kept landing on the GAA record (writes observed as late as 2026-06-11).
2. **`vehicles.merged_into_vehicle_id = e08bf694` + `deleted_at = 2026-05-03` on e04bf9c5** — a false same-entity claim from the 2026-05-03 soft-merge ("was GAA scrape, harness work re-attributed"), made while still `status='active'`, `is_public=true`. Two different chassis must never be merge-linked.
3. **The misfiled testimony itself** — e04bf9c5 carried 1,196 images (1,025 iphoto + 171 ssd_blast, ALL Supabase storage, ZERO GAA-domain) and 1,314 active observations of Skylar's chassis. Any viewer of either profile saw Skylar's build photos under the 2WD/383/700R4/branded-title identity.

e08bf694's own row and source tables were **already clean**: the row-cast regex found nothing on the vehicles row; the only 2 "branded" hits in its 4,800+ observations are false positives ("branded Holley boxes" caption `2e647f8e`, an unrelated C20 title "branded REBUILT" `7d36642a`).

## 2. Testimony classification (audit re-run 2026-06-11)

e04bf9c5 footprint had GROWN since the 05-17 audit (1,196 images vs 1,026; 1,341 obs vs 874) — live contamination.

| Class | Count | Verdict |
|---|---|---|
| obs: GAA listing images (`cdn.dealeraccelerate.com/gaa/...`, Gemini-429 classification stubs, 2026-03-21) | 27 (all already superseded) | **STAY** — testimony of the OTHER Blazer. These are the "27 dangling observations" from the 2026-05-02 ghost-restoration issue. |
| obs: Skylar's build (storage-path media, 5 narrative rows: 2021-06-12 pre-build walkthrough, 2024-08-25 LS/4L80E install, 2025-10-05 receipt session, BaT-alert valuation, album phase analysis) | 1,314 | **MOVE** to e08bf694 |
| img: iphoto/ssd_blast, gate approved/review_needed/pending/null, no file_hash twin on target | 898 | **MOVE** to e08bf694 |
| img: `vision_gate_status='rejected_misattributed'` | 149 | **STAY** — the vision gate ruled these don't show this vehicle; moving would assert they're the K5 against the gate verdict |
| img: `vision_gate_status='rejected_personal'` | 22 | **STAY** — personal content (post-iMessage-incident class); never propagate to the public K5 |
| img: exact `file_hash` twin already on e08bf694 | 127 | **STAY** — content already on the target; `(vehicle_id, file_hash)` unique index forbids a second copy. (Prior agent also counted 203 basename+taken_at near-twins; only exact-hash twins were excluded.) |

Ambiguous-left-behind by conservative default: **298 images** (149+22+127) + **27 GAA obs**.

## 3. What was executed

1. **Relinked 15 observations + 10 images** e04bf9c5 → e08bf694, every row with `merged_from_vehicle_id='e04bf9c5…'` populated and a `reattribution_audit` row (25 audit rows total):
   - 10 obs + 10 images via `relink_testimony()` in-place (test batches, ~36 ms/image, locks 0, gate status preserved).
   - 5 narrative obs via pre-existing `reattribute_observation()` copy+supersede (the only 5 of 1,314 with a NULL in the `unique_observation` tuple — see §4).
2. **Severed the false links** on e04bf9c5's vehicles row (single-row update, prior values preserved in `notes` append): `owner_id` → NULL (was Skylar), `merged_into_vehicle_id` → NULL (was e08bf694). Per approved action recorded in merge_proposals `cb10e3b0` ("sever false merged_into link") + task order ("sever whatever links the two"). No DELETE anywhere; vehicles row, observations, images all preserved.
3. **Patched `scripts/iphoto-intake.mjs`** — `loadVehicleCache()` and the live-query fallback now exclude `status='merged'` and soft-deleted rows. Defense-in-depth: even if a ghost regains owner_id, the matcher won't target it.
4. **Shipped migration `supabase/migrations/20260611210000_relink_testimony_in_place.sql`** — `relink_testimony()`: in-place vehicle_id reassignment, content untouched, lineage + audit mandatory, guards for one-primary-per-vehicle and (vehicle_id,file_hash) indexes. Applied to prod; mass use pending Skylar's blessing (§4).
5. **Refreshed e04bf9c5's stale cached `image_count`** (1196 → 1186).

**Primary-image index:** no collision materialized — the doppelganger's sole primary (`01014332`, ssd_blast) was not in the moved set, and e08bf694 retains exactly 1 primary (verified). `relink_testimony()` carries the guard for the remaining drain: if a moved image is_primary and the target has a primary, the MOVED row is demoted (flag change = workflow state, not testimony content) and the demotion is recorded in the audit reason.

## 4. Why the bulk (1,299 obs + 888 images) is still on e04bf9c5

Both sanctioned paths are structurally broken for this corpus; per the order's rule ("if a sanctioned function can't handle a case, file it and skip — never improvise destructive SQL") the bulk was filed, not forced:

1. **`reattribute_observation()` copy+supersede cannot move 1,309/1,314 observations** — `unique_observation (source_id, source_identifier, kind, content_hash)` is NOT vehicle-scoped, so every copy collides with its own superseded original.
2. **It cannot move ANY image to e08bf694 in practice** — the INSERT side fires `auto_group_photos_into_events` → `trigger_update_primary_focus` → `analyze_organization_data_signals()` (the documented 35.8M-row JOIN, ISSUES.md MEDIUM) — a 10-image test batch timed out at 110 s and rolled back atomically (verified: no partial copies).
3. **It also copies `is_primary` verbatim** (one-primary unique-index hazard, the collision this task was warned about) and **cannot ever move the 171 ssd_blast images** (`idx_vehicle_images_ssd_blast_dedup` is a GLOBAL unique on file_hash for that source — a copy always collides with its original).
4. **`relink_testimony()` (the in-place fix designed around all three)** was applied and proven on 20 rows, but the mass drain was **denied by the Claude Code auto-mode classifier** (same-session function + mass testimony modification). Skylar's go on the drain is the unblock.

**Resume command (once Skylar blesses the drain)** — loop until both counts hit 0, lock-check between batches:

```sql
-- observations, 500/batch
SELECT count(*) FROM (
  SELECT public.relink_testimony('observation', id, 'e08bf694-970f-4cbe-8a74-8715158a0f2e',
    'K5 doppelganger reattribution per merge_proposals cb10e3b0 + Skylar order 2026-06-11',
    '0b9f107a-d124-49de-9ded-94698f63c1c4')
  FROM (SELECT id FROM vehicle_observations WHERE vehicle_id='e04bf9c5-b488-433b-be9a-3d307861d90b'
        AND COALESCE(is_superseded,false)=false
        AND (source_url IS NULL OR source_url !~ 'dealeraccelerate') LIMIT 500) t) x;
-- images, 250/batch (driver already excludes rejected_*, hash-twins)
SELECT count(*) FROM (
  SELECT public.relink_testimony('image', id, 'e08bf694-970f-4cbe-8a74-8715158a0f2e',
    'K5 doppelganger reattribution per merge_proposals cb10e3b0 + Skylar order 2026-06-11',
    '0b9f107a-d124-49de-9ded-94698f63c1c4')
  FROM (SELECT a.id FROM vehicle_images a WHERE a.vehicle_id='e04bf9c5-b488-433b-be9a-3d307861d90b'
        AND COALESCE(a.is_superseded,false)=false
        AND coalesce(a.vision_gate_status::text,'x') NOT IN ('rejected_misattributed','rejected_personal')
        AND NOT EXISTS (SELECT 1 FROM vehicle_images b
                        WHERE b.vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e' AND b.file_hash=a.file_hash)
        LIMIT 250) t) x;
-- after each batch:
SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';  -- stop if > 0
```

In-place relink preserves `vision_gate_status` (no re-gating of the 793 approved photos — unlike copy mode, which resets every copy to 'pending').

## 5. Verification (2026-06-11, post-execution)

| Check | Result |
|---|---|
| e08bf694 vehicles row regex `2wd\|700r4\|nmvtis\|383 cid\|383 stroker\|branded` | **clean** (f) |
| e08bf694 observations / images / events / timeline regex | **0 hits** on doppelganger patterns; 2 pre-existing "branded" false positives only (documented above) |
| `vehicles WHERE owner_id=Skylar AND id=e04bf9c5` | **0 rows** |
| e04bf9c5 `owner_id` / `merged_into_vehicle_id` | NULL / NULL |
| e08bf694 primaries | exactly **1** (unchanged) |
| Lineage: e08bf694 rows with `merged_from_vehicle_id=e04bf9c5` | 10 images + 15 observations |
| `reattribution_audit` rows (old=e04bf9c5) | 25 |
| Lock waiters after every write batch | **0** throughout |

Counts before → after:
| Table | e04bf9c5 before | e04bf9c5 after (active) | e08bf694 before | e08bf694 after |
|---|---|---|---|---|
| vehicle_images | 1,196 | 1,186 (888 to-move + 298 stay) | 2,686 | 2,696 |
| vehicle_observations | 1,341 (1,314 active) | 1,299 active to-move + 32 superseded (27 GAA + 5 copy-shells) | 4,793 | 4,808 |

## 6. Follow-ups filed

- ISSUES.md: doppelganger CRITICAL updated to IN_PROGRESS with exact remainder; new HIGH filed for the `reattribute_observation()` structural defects (unique_observation scope, ssd_blast dedup, is_primary copy, INSERT-trigger timeout chain).
- e04bf9c5 end-state oddity (out of approved scope, untouched): `status='active'` + `is_public=true` + `deleted_at` set. As a now-unlinked ghost for the GAA truck it should likely become a clean non-public ghost record; note that ghost `135cb20e` already holds the GAA sale event `826883df` — the two GAA records may themselves deserve resolution.
- `owner_id` on the REAL K5 e08bf694 is NULL and `owner_name` still says "Scott (li3go)" (the 2026-04-28 A/R-sweep error flagged in the 05-17 audit). Ownership promotion requires Skylar's explicit signal + title-proof flow — NOT done here by design.
