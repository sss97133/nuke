# Timeline Walk — Schema Observations (atelier-master view)

> Running log from the chronological day-walk (started 2016-04-23). Per encyclopedia
> ch. 8 (Schema Proposal Workflow) and ch. 1 (Unified Asset Layer): the schema is the
> guide; the agent deposits against existing shelves and **files a schema proposal**
> when valuable data has no shelf. **No unilateral `ALTER TABLE`** (AX-032, ch.8 §12).
> This log is therefore framed as *what already has a shelf* vs *what proposal to file*.

## Operating model (corrected against the library)
- The **vehicle is the entity** (ch.1). 828K vehicles exist independent of ownership.
  The "210 vehicles under this user_id" are graph entities linked to the account, NOT
  proof of ownership. Ownership is separate and certified: `vehicle_ownerships`,
  `ownership_verifications`, `calculate_possession_score()` (title > possession >
  custody > claimed). A VIN makes a profile *bonafide*, not *owned*.
- Every image is **testimony** → `vehicle_observations` (kind=`media`, structured_data,
  confidence, source, provenance triple). Signals coalesce → VIN → bonafide profile (ch.2/4).
- **Collected/reference ("Pinterest") images are signal too.** Existing shelf for
  "interested, not owned" = `discovered_vehicles` (discovery_source, interest_level).
  Do not discard scraped/collected entities — organize them as the user's interest graph.

## Already has a shelf — USE IT (don't propose, don't build)
| Need | Existing slot |
|---|---|
| Non-vehicle record (painting, surfboard render) | `vehicles.listing_kind` (≠'vehicle') / `status='rejected'`; for images, gate `rejected_personal` |
| Owned vs not | `vehicle_ownerships` (is_current, ownership_type) + `ownership_verifications`; possession via `device_attributions`/EXIF + `calculate_possession_score()` |
| Collected / watchlist / interest | `discovered_vehicles` (interest_level, discovery_source) |
| Per-image content (who/what/where/when/why) | `vehicle_observations.kind='media'` + cascade JSON (scene_class, area, action, parts_visible, fabrication_stage, person_visible, tools_visible, ml_labels) + EXIF on `vehicle_images` |
| Image→correct vehicle move | `reattribute_observation()` (supersede + lineage + audit) |

## Candidate proposals to FILE (ch.8) — valuable data, no clean shelf yet
Each is a `schema_proposals` filing with evidence (rejected/needing-shelf rows, scope query,
backward-compat). NOT a migration I write. Curator approves; trigger materializes it.

1. **`add_property: ownership_class`** (or surface the existing ownership join as a
   materialized signal). Evidence: deriving "operator builds vs collected" today requires
   scanning 38.9M `vehicle_images` rows and times out at 120s — there's no cheap answer to
   "which of this account's entities are the operator's builds." `discovered_vehicles` +
   `vehicle_ownerships` exist but aren't populated for this account's 210 entities, so the
   distinction isn't queryable. Proposal: populate/justify a derived ownership_class signal
   (operator_build / collected_reference / watchlist / shared) keyed off ownership +
   owner-photo density, OR backfill `discovered_vehicles`/`vehicle_ownerships` for the account.
2. **`add_category` + `add_property: aesthetic_theme`** (multi, enum) — the interest-graph
   axis the collected images express: `flames`, `patina`, `lifted`, `lowrider`, `restomod`,
   `survivor`, etc. This is the "boards" need expressed *in schema*, not a bespoke board table.
   Evidence: the ~176 collected listings + reference renders cluster on aesthetic themes that
   no current property captures; this is predictive of the user's taste/intent.
3. **`add_property: depicts_role`** on `kind='media'` — distinguishes *documentation of a
   possessed vehicle* from *collected reference* from *concept render* from *non-vehicle*.
   Today the binary vision_gate (approved/rejected) collapses these distinct roles.

## Day-card narrative gap (not schema — pipeline)
Rebuilt cards have correct photos but empty `work_description` because confirmed photos have
null/poisoned captions. Needs the cascade *enrichment* pass (real per-photo caption/operation
as `kind='media'` observations) on approved photos before `build-day` rolls them up.

## Pre-2018 / off-iPhoto provenance (per Skylar)
Earliest activity (e.g. the **1968 black Mustang**) was shot on regular cameras; its build
context lives in **Gmail + non-iPhoto folders**, not in `vehicle_images`. The walk only sees
DB-ingested photos. Full "user coming into being" requires ingesting those external sources as
observations with provenance. Coverage is consistent ~2020; 2016–2019 is sparse by source.

---

## Progress log
- **2016-04-23** (manual proof): 14 photos. K5 Blazer renders confirmed to `e08bf694`;
  standalone surfboard renders → `rejected_personal`. Day card rebuilt.
- **2017-09 (12-day workflow batch)**: 79 photos, 0 errors — all the red **1989 R3500
  Cheyenne dually** (`b1edd5c1`). 59 confirmed, 12 personal (door-jamb spec stickers,
  dog-as-subject, bare engine blocks), 8 ambiguous (other vehicles not in candidate set —
  correctly not guessed). Day cards rebuilt.
- **Schema realization (this session)**: stop unilateral builds; classify as observations,
  use existing ownership/discovery shelves, file proposals for the 3 gaps above.
