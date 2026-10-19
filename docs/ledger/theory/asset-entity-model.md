# Asset entities: the shape in what already exists (design note, 2026-10-16)

Owner direction, 2026-10-16: non-vehicle items (Road Art, memorabilia, parts, artwork) land as **asset entities** that a user or
an organization holds. A part on a car is an asset; an artwork is an asset under a holder. The goal is to help the holder justify
developing the asset. This note finds the shape in the existing schema. It mints nothing. Every table fact below was read from
prod on 2026-10-16 between 18:05Z and 18:30Z (catalog reads and `pg_stats`, no scans of the large tables) unless marked
"not verified". Vocabulary: market event, blip, bridge (`data-machine-cases.md` section 1); "a listing ID identifies a source
presentation; a physical-asset link needs separate evidence" (`data-machine.md`, Facebook acquisition section).

## What exists

| Object | Fact | Read |
|---|---|---|
| `assets` | 1 row ever (a `shoot`, 07-07). Columns: `id, asset_type, title, description, creator_id, owner_id, organization_id, status, visibility, vehicle_id, image_identity_id, garment_id, publication_id, attributes jsonb, created_at, updated_at`. `asset_type` is CHECKed to `image, vehicle, garment, publication, issue, article, shoot`. `status` and `visibility` are CHECKed. The catalog lists no foreign key on it (`owner_id`, `organization_id`, `creator_id`, `vehicle_id` are bare uuids). | `pg_constraint`, 10-16 |
| `asset_observations` | Empty. Comment: "DEPRECATED 2026-06-17: empty, zero code refs. Candidate for DROP after owner signoff." Columns `asset_id (FK, cascade), source_id, kind, observed_at, content_text, structured_data, content_hash, confidence, source_url, source_identifier, extraction_method, agent_model, superseded_by, supersedes`. No FK on `source_id`. | catalog, 10-16 |
| `asset_grants` | Outbound provenance: `asset_id, grantee_name, grantee_contact, scope, terms, delivery_url, expires_at, status`. | catalog, 10-16 |
| `vehicle_observations` | Polymorphic subject since migration `20260617000000` (approved by the owner 2026-06-17): `subject_type`, `subject_id`, CHECK `vehicle, organization, user, asset, external_identity`, `NOT VALID`, not validated. `vehicle_id` is nullable. Effective subject = `(subject_type, COALESCE(subject_id, vehicle_id))`. `pg_stats` (last analyze) shows only `vehicle` in use. No index on the subject: the migration deferred it "once non-vehicle rows actually exist". | catalog + `pg_stats`, 10-16 |
| `ingest-observation` | Already accepts `subject: {type, id}` and writes `subject_type` / `subject_id` (`supabase/functions/ingest-observation/index.ts`, lines 73-77 and 858-862). | repo |
| Parts, type level | `catalog_parts` (10,853 rows; the CANONICAL parts catalog per CAPABILITY_MAP: `part_number, name, category, fits_models, year_start, year_end`), `part_catalog` (7), `part_assemblies` (15, an assembly recipe), `vehicle_part_locations` (10). These say what a part is and where it fits. None is an instance. | atlas + catalog, 10-16 |
| Parts, instance level | `part_observation_evidence` (952 rows by atlas, 1,077 by its comment): one part seen in one photo, `catalog_part_id, vehicle_id, derived_from_image_id, matched, bbox, confidence`. `work_order_parts` (80), `work_session_parts` (1). Presence testimony tied to a vehicle, with no asset id. | atlas + comments, 10-16 |
| Holder side | `vehicle_ownerships` (`vehicle_id, owner_profile_id, role, is_current, start_date, end_date, verification_id`), `ownership_transfers` (`vehicle_id, from_/to_user_id, agreed_price, sale_date`). All keyed to a vehicle. The general bridge (asset x party x share x as-of) is described in `data-machine-cases.md` (line 407) and not built. | catalog, 10-16 |
| Non-vehicle items today | They land as `vehicles` rows with `listing_kind = 'non_vehicle_item'`: 0.55% of `vehicles` in `pg_stats` (statistics date not stated; an estimate, not a count). `MARKET_MEASUREMENT_UI_CONTRACT.md` keeps them off the calendar. The Mecum intake skips Road Art on purpose: `INDEX_VEHICLE_TYPES` in `extract-mecum/indexLot.ts` leaves `lot_type = "Road Art"` out, and the upcoming path marks it `skipped / NOT_A_VEHICLE` in `import_queue`. | repo + `pg_stats` |
| Lot tables | `vehicle_events.vehicle_id` is NOT NULL. `auction_events.vehicle_id`, `vehicle_observations.vehicle_id`, `vehicle_images.vehicle_id` and `timeline_events.vehicle_id` are nullable. | catalog, 10-16 |
| Road Art population | 79,494 Road Art lots among 312,381 in Mecum's public index (Algolia `wp_posts_lot`, pulled 2026-10-14 21:15 PT; `20261017130000_census_by_year_houses.sql`). None are landed as assets. | repo |

## 1. One asset row for a Road Art lot, a memorabilia lot, a part and an artwork?

Yes, with two honest qualifications.

- **Type.** `assets.asset_type` today lists media and publishing kinds, and its CHECK is the only blocker. Smallest change: widen
  the CHECK by four values: `part`, `artwork`, `memorabilia`, `automobilia` (signs, pumps, neon, pedal cars: what Mecum calls
  Road Art). Our type is ours and small. The house's own label is a claim and goes in `attributes`:
  `attributes.house_category` (Mecum `lot_type`, Bonhams' department), plus the raw taxonomy under `attributes.source_taxonomy`.
  A house category never becomes the type, because houses disagree.
- **Identity.** A lot is a presentation, not the asset: the same sign recurs across sales. The first slice therefore creates one
  asset per lot with `attributes.identity_basis = 'lot_presentation'` and resolves recurrences later by supersession, the way
  vehicles do. This is unresolved identity retained, not a claim that the lot is the asset.
- `attributes` holds descriptors at creation (title, maker, house_category). Anything that can change or be disputed lands as an
  observation with a source and a date, not in `attributes`.

## 2. Revive `asset_observations`, or reuse `vehicle_observations` with a subject type?

**Reuse `vehicle_observations` with `subject_type = 'asset'`.** Evidence:

- It is the keystone the owner approved on 2026-06-17 (`engineering-manual/20-polymorphic-subject-build-guide.md`): lift the
  subject so an org, a user or an asset accumulates testimony "the same way a vehicle does". The column, the CHECK value `asset`,
  the nullable `vehicle_id` and the writer's `subject` input all exist today.
- The trust machinery is there, not in `asset_observations`: source FK (`source_id` to `observation_sources`), `observed_at`
  with `observed_at_confidence`, `confidence_score`, `is_superseded` / `superseded_by`, protected admission and write receipts.
  `asset_observations` has none of the FKs and zero code references.
- One log means one fold, one audit and one reader family for vehicles, assets and, later, organizations.

Leave `asset_observations` deprecated. Dropping it is the owner's call, per the liveness rule. If the owner would rather keep a
table named for assets, the cost is a second writer and a second trust path.
The name `vehicle_observations` is a misnomer for a polymorphic log. Renaming is out of scope.

Missing for this choice: (a) the partial index on `(subject_type, subject_id) WHERE subject_type <> 'vehicle'`, built
`CONCURRENTLY` outside a migration transaction, as the 06-17 migration planned; (b) a check that `subject_id` names an existing
`assets` row. The guide proposes "a trigger or partial FKs"; whether a trigger exists is **not verified**.

## 3. Composition: part of, component of

- **A part on a car** already has its link: `assets.vehicle_id` names the host vehicle. No new column.
- **Part of a part, or a work in a collection** has none. Smallest change: one nullable column,
  `assets.parent_asset_id uuid REFERENCES assets(id)`. `check-capability-before-mint` was clear for the name on 2026-10-16.
- **History of a host** (a part moves from car A to car B) is not a column. It is observations of kind `installed_on` /
  `removed_from`, each with a source and a date; the column is the current fold of the latest one. Promote to an
  `asset_components(parent, child, from, to)` bridge only when the data shows parts changing hosts. Do not build it now.
- **What kind of part it is** is a match, not a column: an observation of kind `catalog_match` carrying
  `catalog_parts.id`, as `part_observation_evidence.catalog_part_id` and `matched` already do for photos. 987 of its 1,077 rows
  are unmatched, so a nullable, evidenced link is the honest form.
- **The holder.** `assets.owner_id` / `organization_id` stay empty until a claim is signed. Auctions state sellers and buyers, not
  holders. A holder claim lands as an observation with its own trust; a fold sets the columns. The bridge in
  `data-machine-cases.md` (asset x party x share x as-of) is the place for fractional or group holding and stays closed for now.

## 4. A lot becomes an observation of an asset

A lot is a market event of an asset (one act of bringing it to a room). For vehicles the pipeline writes `vehicle_events`
(`vehicle_id` NOT NULL) and `auction_events`. For assets, the first slice writes **one `vehicle_observations` row per lot**:

| Column | Value |
|---|---|
| `subject_type`, `subject_id` | `asset`, the lot's asset id (`vehicle_id` NULL) |
| `source_id` | the house's `observation_sources` row (`mecum`) |
| `source_url`, `source_identifier` | the lot permalink, the lot id |
| `observed_at` | the sale day the index states |
| `kind` | a market-event kind from the existing vocabulary (the exact value is **not verified**; pick it from `vehicle_observations.kind` before coding) |
| `structured_data` | `house_category`, `sale_key`, `sale_name`, `lot_number`, `result` (sold or bid goes on), `price`, `currency`, and the price basis (hammer or high bid, as the index states it; buyer's premium is not adjusted) |

`auction_events` could hold such a lot with `vehicle_id` NULL, but it has no asset column and every vehicle fold joins through
`vehicles`. Slice 1 leaves the events tables alone; a later fold can derive asset-level market events from the observations,
as the vehicle pipeline derived days on market from blips. Landing assets as `vehicles` rows (the `non_vehicle_item` path) is
what already exists, and it puts non-vehicles into every vehicle join and count. The asset route removes that.

**Justifying development.** The question is answered the way the Build ROI stack (S15, case ledger section 13) answers it for a
car: the holder's cost basis (receipts, work sessions) against the market events of comparable assets, cohort by `asset_type`
and house category, with sell-through and the count of lots behind each figure. Comparable cohorts need lots; slice 1 supplies
them for Road Art.

## 5. First slice: Mecum Road Art, existing intake only

Source: the index records `extract-mecum` already reads (`indexLot()`; fields it uses include `taxonomies.lot_type`,
`permalink`, `sold`, `highest_bid_or_price`; a Road Art record's other fields are **not verified**, so sample 20 hits before
coding). Writer: `ingest-observation` with `subject`. Denominator: 79,494 Road Art lots in the 2026-10-14 index pull.

Smallest changes, in order, each a separate PR:

1. **Widen `assets_asset_type_check`** by `part, artwork, memorabilia, automobilia` (migration; no row touched).
2. **A sanctioned asset writer**, one SQL function that upserts an asset by an identity key and returns its id (receipted,
   `service_role` only). Needed because `assets` has no writer today. The key is
   `attributes->>'identity_key'` (`mecum:<lot_id>`) under a partial unique expression index. `check-capability-before-mint` was
   clear for `upsert_asset` on 2026-10-16.
3. **`extract-mecum`**: where `indexLot()` returns `not_a_vehicle_type` for `Road Art`, produce an asset-lot record instead (a new
   pure reader beside `indexLot`) and call the writer, then `ingest-observation` with `subject: {type: 'asset', id}`. The
   existing `NOT_A_VEHICLE` skip in `import_queue` stays: Road Art never enters the vehicle queue.
4. **The subject index** (item 2a above), built concurrently once rows exist.
5. **A reader with its denominator**: Road Art lots landed over 79,494, by sale and year. A Road Art lot lands as an observation,
   so the landed count is a count of observations of `subject_type = 'asset'` per source, not a coverage percentage of vehicles.

Not in the slice: holder claims, composition, images, Bonhams memorabilia, parts. Each needs the slice's asset writer first;
the Bonhams lot is the second test of the type list. Mecum's calendar and map keep excluding `non_vehicle_item`; asset lots do
not appear on the vehicle calendar by design.

## What is missing, smallest first

1. `assets_asset_type_check` widened by four values.
2. An asset writer function and a unique identity-key index.
3. `assets.parent_asset_id` (only when a composition case lands; not needed for the first slice).
4. A concurrent partial index on `vehicle_observations (subject_type, subject_id)`.
5. A check that an observation's `subject_id` exists in `assets` (trigger or writer-side).
6. The Road Art branch in `extract-mecum`.

No table is minted. `asset_observations` stays deprecated unless the owner revives it.
