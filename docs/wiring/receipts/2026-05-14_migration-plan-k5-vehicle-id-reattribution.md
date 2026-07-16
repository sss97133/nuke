---
id: 2026-05-14_migration-plan-k5-vehicle-id-reattribution
date: 2026-05-14
change_type: migration_plan
scope: vehicle_build_manifest + vehicle_wiring_overlays (+ vehicle_images / vehicle_observations TBD)
status: PROPOSED — needs Skylar approval; NO db writes executed
related: .claude/ISSUES.md CRITICAL entry "K5 wiring data is attached to the wrong vehicle_id"
---

# K5 vehicle_id reattribution plan — move wiring data from `e08bf694` → `e04bf9c5`

## Roles confirmed 2026-05-14

- **Skylar = owner + builder** (NUKE LTD, 676 Wells Rd, Boulder City NV)
- **Scott = client + soon-to-be-owner** (buys the completed K5 from Skylar)
- The Utah title on e04bf9c5 (under "Pulgam Martinez" name) is Skylar's title (or Skylar's predecessor's, transferring to Skylar)
- The K5 physically lives at NUKE LTD shop — Skylar has direct access

## Confirmed canonical record

**`e04bf9c5-b488-433b-be9a-3d307861d90b`** / VIN `CCL187Z210370` = the physical K5.

Evidence:
- `chapters/appendix-d-k5-build.md` line 7 names it canonical
- Image set on e04bf9c5 includes title document showing Utah jurisdiction (matches NUKE LTD location — Boulder City NV / regional Utah area)
- Maroon paint shots present (matches the build car color metadata)

## Confirmed non-canonical record (wiring data sits here in error)

**`e08bf694-970f-4cbe-8a74-8715158a0f2e`** / VIN `CKR187F127263`

Evidence of error:
- Created 2025-09-20 by user `0b9f107a-d124-49de-9ded-94698f63c1c4` — predates the customer-facing record
- VIN is distinct (CKR187F127263 vs CCL187Z210370) — different chassis serial
- Image set is mixed: a white K5 on a lift + a Christmas parade truck + assorted unrelated content
- 793 of its 2,653 images live in storage folder `21501c21-22a7-4f97-9a3a-84823bd1c6b3` (a THIRD K5 record's folder)
- Likely origin: auction-listing scrape that someone started building wiring against in Sept 2025, before the proper customer record was created

## Migration scope (DB rows that move)

| Table | Count on e08bf694 | Action |
|---|---|---|
| `vehicle_build_manifest` | 141 | reattribute → e04bf9c5 |
| `vehicle_wiring_overlays` | 1 | reattribute → e04bf9c5 |
| `vehicle_custom_circuits` | unknown — has no `vehicle_id` column, joins differently | needs schema audit |

## Migration scope (case-by-case, NOT mass-moved)

| Table | Count on e08bf694 | Why not bulk-move |
|---|---|---|
| `vehicle_images` | 2,653 | Image set is contaminated — includes non-K5 photos. Bulk move would pollute e04bf9c5 with garbage. Each image needs visual verification or fingerprint match. |
| `vehicle_observations` | 709 | Some may be auction-scrape testimony from e08bf694's original life as an auction listing. Those belong WITH e08bf694 (it really was an auction listing, separate physical truck). Don't move auction-scrape observations to Skylar's truck. |

## Procedure (per agent-trust-invariants.md)

**NEVER use raw `DELETE FROM` or `UPDATE` on testimony tables.** The correct procedure:

1. **Open `merge_proposals`** with `vehicle_a_id = e08bf694`, `vehicle_b_id = e04bf9c5`, `ai_decision = 'reattribute'`, `preferred_primary = 'e04bf9c5'`, `evidence` JSON listing this receipt as the source. Status `pending_human_review`.
2. **Skylar reviews + approves** the proposal (sets `human_verified = true`, `status = 'approved'`).
3. **Execute via `reattribute_observation()`** (or equivalent stored procedure) for each row category, populating `merged_from_vehicle_id` on every moved row per the trust invariant.
4. **Leave e08bf694 record in place** with its auction-scrape testimony intact (it represents a real different physical K5 that someone listed for auction). Don't delete it; it's not a duplicate, it's a different truck whose record got hijacked for wiring work.
5. **Audit images and observations separately** before any move. Don't bulk-relocate 2,653 images blindly.

## What I do NOT have authority to execute

- Raw SQL UPDATE/DELETE on `vehicle_id` columns
- Mass reattribute_observation() without approved merge_proposals row
- Deletion of e08bf694 vehicle record (it's not a duplicate; it's a different chassis with its own scrape data)

## What this unblocks once executed

- The DB has Skylar's actual K5 with wiring data on it
- The frontend (`WiringTechView.tsx`, `K5MissionControl.tsx`) renders Skylar's K5 with content instead of empty
- The compute engine reruns produce a `vehicle_wiring_overlays` row on e04bf9c5
- The 162 wires from `K5_cut_list_v2.txt` can be inserted as `wire_specifications` or equivalent rows
- The PDM Manager .pdm regeneration runs against the right vehicle

## Things still unresolved after this migration

- **Image attribution audit:** which of the 2,653 images on e08bf694 are actually Skylar's K5 vs different K5s vs random shop content vs auction scrapes. Needs fingerprint comparison + visual review, possibly per-image.
- **The 793 images stored under 21501c21's folder:** is 21501c21 also Skylar's truck (a duplicate record) or a third different K5? Needs investigation.
- **The 16+ other 1977 K5 Blazer records in the DB:** are any of them ALSO entangled with Skylar's data?
- **Whether e08bf694 should keep the "K5 build" label at all** — if it's a separate auction K5, it should stay as a clean auction-scrape record without confusion that it's "Skylar's build."

## Approval needed from Skylar

- Approve the migration scope as defined above (141 manifest + 1 overlay; images and observations TBD per case-by-case audit)
- Authorize creation of the merge_proposals row
- Authorize execution of reattribute_observation() once proposal is approved

If approved, the actual DB writes still need to be done via the proper functions, not raw SQL. I'll surface the exact SQL/RPC calls before running them.
