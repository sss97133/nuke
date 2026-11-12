# Garage presence: deriving stays from what exists, and the backfill plan

Status: **DRAFT, nothing applied, nothing executed.** PRESENCE lane, 2026-11-12 (AST, UTC-4), against the SPEC lane's
`docs/garage-model/SPEC.md` and the live project `qkgaybvrernstplzjaam` (read-only: GET proxy, catalog snapshot of 2026-11-12 ~10:50 AM AST).
Files: `supabase/drafts/garage-model/migrations/20261112100100_garage_presence_signals.sql`, `…100110_garage_stays_fold.sql`,
`…100120_garage_now_timeline.sql`; contract `supabase/sql/test_garage_presence.sql` (103 assertions, passes with
`PG_BINDIR=/workspace/claude-swarm/pgbin bash scripts/ci/run-db-contracts.sh test_garage_presence.sql`, and `test_garage_core.sql` still passes).

**Labels.** `[live]` = I read it from production on 2026-11-12 through the GET proxy (counts only). `[study]` = from the prior photo-truth
study (`presence.json`, `MODEL.md`), re-computed from that file by me where I say so. `[repo]` = repo or draft file only. `[inferred]` = my
reading. A count with no label is not in this document. People other than Skylar are not named. No coordinates of his sites are written here:
site geometry is described in words and cells of about 1 km only, and the shop's exact position goes in the database, by id.

---

## 1. What was built

| Layer | Object | Does |
|---|---|---|
| Signals (read-only) | `garage_presence_signals(garage, as_of, version, vehicle)` | One row per signal, one shape: `garage_id, vehicle_id [terminal], signal, signal_class A/B/C, observed_at, source_table, source_id, originator_user_id / originator_external_identity_id, weight, relationship_hint, organization_id, note`. service_role only. |
| | `garage_terminal_map`, `garage_org_link_hint`, `garage_distance_m` | Follow `merged_into_vehicle_id`; map an org link to a relationship; haversine. |
| | `garage_derivation_versions` | The thresholds as a versioned row (v1: gap 180 d, here ≤ 90 d, probably ≤ 365 d, date floor 2000-01-01), each with who decided it. |
| Fold | `garage_stays_dry_run(garage, version, as_of)` | Returns the stays and their citations. Writes nothing. |
| | `garage_fold_stays(garage, version, as_of, allow_past)` | The writer. Idempotent (deterministic stay ids, unchanged rows untouched, `recorded_at` never rewritten); writes only `garage_vehicle_stays` and `garage_stay_evidence`; refuses a past `as_of` unless allowed; advisory lock per garage. |
| Readers | `garage_state_at` (internal), `garage_now`, `garage_timeline`, `garage_stay_evidence_read` | State is computed at read time from stays + citations as of a date, never stored. Non-members get `42501`, never an empty garage. |

Additions beyond the core DDL (additive, garage-only): table `garage_derivation_versions`; columns `garage_stay_evidence.signal_class`, `.note`,
`.relationship_hint`. The class lets a reader tell a photo at a confirmed site (A) from one at a site nobody confirmed (B); the hint lets
`garage_now` recompute a stay's relationship *as of a date* from the citations in force then, so an as-of read carries no hindsight. They are
a one-line change to the core migration if the SPEC lane prefers them there.

### Signal classes as implemented

| Signal | Source | Class | Weight | Notes |
|---|---|---|---|---|
| `site_photo` | `vehicle_images` | **A** if the point is inside a **confirmed** `garage_sites` circle valid on the photo's own date; **B** (weight 0.5, note `site_unconfirmed`) inside an unconfirmed one | 1.0 / 0.5; ×0.6 when `taken_at` is within 2 min of `created_at` | Any author, not only Skylar. Originator = `documented_by_user_id`, else `user_id`. Not superseded, not duplicate, not a document, not sensitive, gate NULL or `approved`, terminal vehicle, GPS present and not 0,0. |
| `contributor_link_upload` | `vehicle_images.source='contributor_link'` outside a site or without GPS | B | 0.2 | Originator = the contributor's user or **external identity**; tied only if a member made the invite. 0 rows live today `[live]`. |
| `work_session` | `work_sessions` | B | 0.3; 0.6 owner-confirmed; 0.1 for `capture_derived`/`auto_detected` | Only sessions by an ever-member. 1,720 of his 1,914 sessions are one of those two derived types `[live]`, hence 0.1. |
| `org_link` | `organization_vehicles` at an org of this garage | B, with a hint | 0.5 active, 0.15 pending, 0.1 other | `owner`@operator → owned; `owner`@hosted → dealer_inventory; `consigner` → consignment; `service_provider` and active `work_location` → customer_work; pending `work_location` and everything else → no hint. Relationship evidence, never presence. |
| `org_link` (permission / contributor) | `vehicle_user_permissions`, `vehicle_contributors` by a member | B, 0.4 / 0.1 | | **Contribution never implies owned**: only an `owner` permission held by a manager-or-above member hints owned (0.4, below an org link). A contributor row hints only `consigner → consignment`. |
| `receipt` | `receipts` (not superseded, not duplicate) by a member | B | 0.2 | Purchase, not location. |
| `member_assertion` | `garage_stay_assertions` in force at `as_of` | here = A; left / not_here = C; relationship = hint | 1.0 | Outranks derivation. |
| `sale_event` | `vehicle_events` with `event_status='sold'` (`sold_at`, else `ended_at`); `organization_vehicles` `sold_by`/`owner` with status sold/past **only when it carries a date** | C | 1.0 / 0.8 | Undated sales are not guessed. |
| `listing` | `vehicle_events` `event_type` in listing/auction/classified, status active/ended/unsold (`started_at`) | C | 0.4 | A weak exit; always printed with its basis. |
| `record_deleted_or_merged` | `vehicles.deleted_at`; a merge chain that ends in a deleted record, a cycle, a missing row or > 10 hops | C | 1.0 | A merge into a live record is **not** an exit: history moves to the terminal record. |

**A car appears only if the garage has a tie to it** (a photo in a site, an org link at one of its orgs, a member assertion, a record authored by a member,
or a contributor upload on a member's invite). Without that rule a receipt or a sale on any car in the database would put it in every garage.

### Placeholder dates and the `taken_at` fallback (decisions, tested)

| Case | Treatment | Why |
|---|---|---|
| `taken_at` or `session_date` before 2000-01-01 (the 1978-01-01 and 1985-01-01 placeholders) | **Excluded** | A stand-in date says nothing about when the car was here. Live: 1 of his photos is before 2000 and 2 sessions are (1978-01-01: 1, 1985-01-01: 1) `[live, all users for sessions]`. |
| Dated after `now() + 1 day` | **Excluded** | A clock error is not an observation. |
| `taken_at` NULL | **Excluded** from site evidence | `created_at` is the upload time. 43 of his 29,749 photos `[live]`. |
| `taken_at` within 2 min of `created_at` | **Kept, ×0.6, note `taken_at_equals_upload_time`** | The repo does not record whether `taken_at` came from EXIF or a fallback `[study]`; a live capture legitimately has both equal. Weight moves confidence, never state. |
| GPS NULL, or exactly 0,0 | Not site evidence | 5,034 of his photos have no GPS `[live]`. |

---

## 2. Rules the fold applies (and where each is tested)

* **Stay boundaries.** Class A sightings per terminal vehicle, ordered. A new stay starts at an unseen gap > 180 d **or** when an exit (sale, listing,
  "left", "not here") falls between two sightings. A returning car is a second stay. Tested: V07 (two stays), V04 (sale), V12 (listing).
* **Departure.** First exit dated at or after the stay's last sighting and before the next stay. None, but a later stay exists: `unseen_gap`, at the stay's own last
  sighting (the earliest it could have left). A sale dated years before the first sighting is not an exit (V01).
* **Gone.** The car's last stay ends with `record_deleted_or_merged` (departed_at clamped up to `last_seen_at`; the citation keeps the real date).
* **Relationship per stay.** Hints in force at the stay's end. Assertion (3) > org link (2) > permission/contributor (1); ties by weight, then latest. None: `unknown`.
  Tested: owned, consignment, customer_work, dealer_inventory (with `organization_id`), unknown for a contributor-"owner", an assertion overriding a derivation.
* **Confidence** (`numeric(3,2)`) is a labelled **judgment** of the v1 fold, not a measurement: with location evidence
  `0.30 + 0.50·(1 − 1/(1 + ΣA weights)) + 0.10 (>1 originator) + 0.05 (relationship known) + 0.05 (member asserted here)`, capped 0.99; without it
  `0.10 + 0.15·(1 − 1/(1 + ΣB weights))`. It must never be shown as a probability.
* **State at read time**, SPEC 4.3's order: member "here" newer than all else → here; member "left" newer than the last A → left; gone; exit ≥ last A → left; no A → never_seen_here;
  then ≤ 90 d here, ≤ 365 d probably_here, else stale. The *newest stay begun by `as_of`* is read. An `unseen_gap` close is **not** known before the next stay arrives, so a read inside a gap
  still sees the earlier stay open (tested for V07 at 2024-12-31).
* **As-of replay** (tested): V04 reads here on 2024-04-01 and left on 2024-04-16 (sale 2024-04-15); a record deleted 2024-08-01 reads here before and gone after; 2019 has no known car.
* **Timeline buckets** (tested against hand-computed values for Jan–May 2024): `here_count` = here + probably_here at the bucket's last instant; `arrivals` = stays whose first A fell in it;
  `departures` = stays ended there at a **dated** exit; `unknown_count` = stale + never_seen_here. `basis` carries the as-of instant, derivation versions, a per-state breakdown,
  `site_known` (false before any confirmed site: those counts are what the evidence says, not "the garage was empty"), `scope`, `departures_by_basis`, `unseen_gap_closures`.
  An unseen-gap closure is deliberately **not** a departure: its date is the last sighting, not a date the car left.

---

## 3. What live data says about his sites (all `[live]` unless marked, 2026-11-12 AST)

* `user_sites`: 5 rows, 3 users. His three, all `source = ignition`, none linked to an organization location: one 150 m, one 221 m, one **1,771 m**. Another user has two test rows (not his).
* `organization_locations` for his Viva and marketplace orgs: one primary location each, city-grain "boulder city, nv" (created 2025-11-01/02); the upholstery org's has no city. The
  GPS below sits in the same town. `organization_locations` is public, so it never becomes a garage site by copying; a `garage_sites` row only *points at* it (nullable).
* **Where his photo GPS actually clusters, by year.** Method: per year 2017..2026, up to 1,000 of his non-superseded photos with GPS (a *sample*, capped at 1,000 per year, from `vehicle_images` by `user_id` and `taken_at`), grouped on a 0.01° grid (~1 km), plus the share inside his two narrow confirmed circles and inside the wide one:

| Year | Sample | Top cell (share of sample) | Inside the 150 m site | Inside the 221 m site | Inside either narrow | Inside the 1,771 m site |
|---|---|---|---|---|---|---|
| 2017 | 1,000 | cluster C 60% (a trip abroad is 16%) | 0 | 37 | 37 (3.7%) | 662 |
| 2018 | 1,000 | cluster C 77% | 0 | 22 | 22 (2.2%) | 827 |
| 2019 | 1,000 | cluster C 95% | 42 | 3 | 45 (4.5%) | 1,000 |
| 2020 | 936 | the 150 m site's cell 96% | 898 | 0 | 898 (96%) | 898 |
| 2021 | 1,000 | same 95% | 953 | 0 | 953 (95%) | 968 |
| 2022 | 514 | same 85% | 437 | 0 | 437 (85%) | 437 |
| 2023 | 850 | same 66% | 571 | 66 | 637 (75%) | 646 |
| 2024 | 1,000 | cluster C 51%, the 150 m site's cell 18% | 179 | 81 | 260 (26%) | 799 |
| 2025 | 1,000 | cluster C 41%, a neighbouring cell 28% | 9 | 139 | 148 (15%) | 831 |
| 2026 | 1,000 | cluster C 80% | 139 | 8 | 147 (15%) | 1,000 |

  Cluster C = a cell about 1 km south-south-west of the 150 m site, inside the wide circle and **outside both narrow ones**. `[inferred]`: the shop appears to have used at least three nearby
  positions: C in 2017–2019, the 150 m site in 2020–2023, C again plus both narrow sites in 2024–2026. Whether C is one place or two, and whether any is the shop, is **his** to say (SPEC Q7).
* **Consequence for the numbers, stated plainly.** Seeded with only the two narrow circles, the derivation would find 2020–2023 well and almost nothing of 2017–2019 or 2024–2026. The study's baseline
  almost certainly counted against the wide circle (10,453 of 14,156 related-car photos "inside a site" `[study]`). So **the choice of site geometry moves the answer more than any rule in the fold**, and it is
  not mine to make. The plan below seeds the geometry he confirms, and reports the result under each candidate set side by side so his choice is informed.

---

## 4. Backfill plan (NOT executed; every step is a separate gated change with its own acceptance)

Order follows SPEC 10.1. Nothing below runs until Skylar approves moving the core migration, and every write goes through a sanctioned path (`create_garage` as him, then service-role data steps under `dotenvx`).

| # | Step | How | Acceptance (counts before / after) |
|---|---|---|---|
| 0 | This PR: drafts and contracts only | n/a | `test_garage_presence.sql` and `test_garage_core.sql` pass |
| 1 | Core migration moved in by Skylar's approval (SPEC step 1) | one migration, one commit | 8 tables, RLS on; `garage_my_garages()` empty for everyone |
| 2 | **He** calls `create_garage('<the shop's own name>', <operator org>)` signed in; owner is `active`. Operator org is SPEC Q1 (marketplace org, Viva, or none) | RPC as him | one `garages` row, one active owner member |
| 3 | Add `garage_organizations`: Viva as `hosted`; the upholstery org as `tenant` **only if he says it is the same building** (SPEC Q2); read `location_collaborations` (2 rows) to *propose*, not decide | data step | 1–3 rows; each with a source |
| 4 | **Seed `garage_sites`**: for each of his `user_sites` rows he confirms, one `garage_sites` row with `user_site_id`, `confirmed_by/at` = his own confirmation, `source='ignition'`. The 1,771 m row is **not** auto-accepted (SPEC Q7 default: ≤ 300 m auto, ask about the rest). For the eras the table above shows, he names C and any earlier position; each becomes a row with `valid_from`/`valid_to` he states. Unconfirmed candidates go in with `confirmed_at NULL` so they yield class B (related, location unconfirmed), never `here` | data step, his word per site | rows = confirmed sites + unconfirmed candidates; `site_known` true for the months they cover |
| 5 | **Dry run, per candidate site set**, read-only: `garage_stays_dry_run(garage,'v1')` for (a) the two narrow circles, (b) narrow + C, (c) the wide circle. Report, per set: stays, state counts at today's as-of, the per-year "present at some point" and gap-split arrivals, unresolved members, each with n and the as-of date | service-role RPC (never q.sh) | the three result sets side by side; he picks |
| 6 | **First fold** on the chosen set: `garage_fold_stays(garage,'v1')` by hand, once. Re-run and require 0 inserted / 0 updated / 0 deleted | service-role RPC | 2nd run changes nothing; non-garage tables unchanged (the contract's fingerprint test, run on live as row counts of the source tables) |
| 7 | **Index the photo arm** before step 5 on live: `vehicle_images (latitude, longitude) WHERE latitude IS NOT NULL` (concurrently, off-hours, its own migration; **not in this draft**). Without it the site-containment scan over ~64M rows is unbounded `[repo; not measured, the function is not deployed and I have read-only access]`. Measure with `EXPLAIN` on a clone, not production | separate gated migration | `EXPLAIN` shows the box prefilter used |
| 8 | Seed *proposals* only: 3 technician rows of `organization_contributors` and `technician_phone_links` rows as `pending` `garage_members`/identity members for him to approve (SPEC 3.2). Never auto-promote a self-claim | JOIN lane | pending rows only |
| 9 | Run the fold by hand weekly for a month, compare with his own statements; only then consider one cron (liveness rules: one workflow per organ, and a check that rows moved) | | decision recorded |

### Expected results compared with the earlier rough numbers (MODEL.md §7–8, SPEC 4.5–4.6)

I re-ran the study's arithmetic on `presence.json` (130 vehicles, as of 2026-11-12, thresholds 90/365 d): **14 here · 10 probably here · 11 stale · 41 left · 5 gone · 49 never seen at a confirmed site**
(reproduced exactly), and the per-year upper bound **2017: 6, 2018: 11, 2019: 5, 2020: 6, 2021: 10, 2022: 11, 2023: 18, 2024: 42, 2025: 38, 2026: 25** (first seen 6/6/0/1/4/2/7/27/14/10). That is a re-computation of a file, not a live run of the new fold.
I cannot run the fold live (read-only, nothing deployed), so the table is what to *expect* and why, not a result:

| Quantity | Study (`[study]`) | What the draft fold changes | Expected direction |
|---|---|---|---|
| here + probably here | 24 of 130 | Photos of **any** member count (only 1 other user has photos on his org cars, 30 photos `[study]`); `documented_by_user_id` credits a technician; site validity is **per photo date** | Slightly up if member photos exist; **down** if sites are narrow (§3) |
| left | 41 | A listing is an exit only after the last A; sale via `vehicle_events` `sold`; `sold_by` links only when dated | Close, but listings now split stays: **more stays than cars** (109 of 130 have some listing `[study]`) |
| never seen | 49 | Class B-only cars stay as `never_seen_here`; no-GPS photos stay out; photos at *unconfirmed* sites become B | Same or smaller as sites are confirmed |
| gone | 5 | Merge chains followed to the terminal record; a merge into a live record is **not** gone | Smaller if some of the 5 merged into live records |
| per-year present | 6 … 42 … 25 | The 180 d gap split turns one long span into several stays and **lowers** "present" in years the car was away | Lower than the upper bound in every year with a gap |

**Acceptance for step 6:** each difference from the study is explained by one of the rows above, with a count. A number the fold produces that I cannot trace to a rule is a bug, not a result.

---

## 5. Every reason the derived count will undercount his stated 40–80 cars

Measured where I could (counts, `[live]`, 2026-11-12 AST). His photos by `user_id`: **29,749**. Funnel through the rules above:

| Step | Photos | Share of 29,749 | What it means |
|---|---|---|---|
| All of his photos | 29,749 | 100% | |
| **Placed on a vehicle** (`vehicle_id` not null) | 16,345 | 55% | **13,404 (45%) are attached to no vehicle**, so they cannot make a stay at all. The largest single loss |
| …and with GPS | 14,392 | 48% | 5,034 of all his photos have no GPS (17%); 1,953 of the placed ones |
| …not superseded, duplicate or a document | 12,375 | 42% | 850 superseded, 3,173 flagged duplicate (overlapping sets) |
| …`taken_at` set, gate NULL or approved | 11,873 | 40% | 1,136 `review_needed`, 1,255 `rejected_personal`, 2,126 `rejected_misattributed` held out, as the repo's own visibility check does `[repo: work_order_evidence_image_visible]` |
| …inside a confirmed site valid that day | **not measured** | | Depends entirely on the sites he confirms (§3): sample shares run from 2% (2018) to 96% (2020) with the narrow circles |

The reasons, in the order I'd expect them to matter:

1. **Photos with no vehicle** (13,404 of his, 45%). Not "no GPS": unplaced. The capture pipeline holds many for review (8,598 of 8,891 sets held `[study]`). A stay needs a car.
2. **Unconfirmed or missing sites.** Narrow circles cover 2% of the 2017–2019 sample and 15% of 2025–2026 (§3). Until he confirms where the shop was, those sightings are B at best or absent.
3. **No-GPS photos** (5,034, 17%; 1,766 of 14,156 on his 130 related cars `[study]`). 5 of the 130 related cars have *only* no-GPS photos `[study, recomputed]`.
4. **53 of 130 related cars have photos but none inside the study's sites** (`n_site = 0`); the study's 49 never-seen cars are among them `[study, recomputed]`. Some of these are cars at other places, not the shop.
5. **Cars not photographed by any member.** The backend only knows cars someone uploaded or linked. Anything in the building nobody photographed is invisible: expected, and exactly why `garage_record_assertion` ("here") and the join link exist.
6. **Duplicate vehicle records** split one car's history (three 1966 Mustang records, two K20 records `[study]`). Merges are followed (42,078 vehicles carry `merged_into_vehicle_id` `[live]`, global), but *unmerged* duplicates stay separate stays, each smaller than the true car's.
7. **Stays are closed by listings** (weak exit). A car listed while it stayed on the lot reads `left` until a later photo; one more reason the count can sit low *and* the number of stays high.
8. **Relationship evidence is mostly undated.** Only 5 of Viva's 243 org links carry a `start_date` `[live]`, so an `org_link` is observed at its `created_at` (bulk-linked, 2025-11). A stay that ended before that gets `unknown`, by design: the link may not describe it.
9. **Photos held out by the gate or flagged sensitive/document** (4,517 of his by the three non-approved statuses above), conservative on purpose.
10. **His statement is a number of cars; the data is a number of cars someone photographed at a confirmed place recently.** The screen must show "N here of ?" and the *related, not yet located* count, never 40–80 until evidence earns it.

---

## 6. Problems and questions I found in SPEC.md (not changed there; a "see also" link was added)

1. **Rule 1 never ages.** SPEC 4.3 rule 1 says a member's "here" outranks everything below it, so an old assertion keeps a car at `here` until something newer arrives. Implemented literally. I recommend aging it like a sighting (it is class A) and asking him, or capping it; Skylar's call (extends SPEC Q12).
2. **Core table needs three columns** for what 4.2 describes: `signal_class`, `note`, `relationship_hint` on `garage_stay_evidence` (added additively here; fold into the core if accepted).
3. **Listing as exit creates many stays.** SPEC 4.3 closes a stay at any exit and a later sighting opens a new one, so a car listed and still on the lot becomes two stays with a fictional gap. Q4's `left?` wording does not fix the stay count. Option: a listing closes a stay only if no sighting follows within the gap window; I kept SPEC's rule.
4. **A tie rule is missing from SPEC.** Which cars belong to a garage at all (photo in a site, org link at a garage org, assertion, member-authored record, member's contributor invite) is not specified; I added it (§1). Without it any receipt or sale puts any car in every garage.
5. **As-of replay has two limits.** Cars first seen *after* the date but related *before* it (an org link from 2024, first photo 2025) read "absent" as of 2024 from the stored fold, while a dry run at that date shows them as `never_seen_here` (tested, 6 vs 5 stays at 2024-12-31); and a superseded assertion is not replayable from a fold written after its supersession. Both go away only with the as-of dry run (`garage_stays_dry_run`) or a stored `known_at`.
6. **`relationship_change` is not derived.** SPEC 4.1 closes a stay when the relationship changes ("customer buys the car"); v1 takes one relationship per stay from the hints in force at its end and does not split. Needs dated relationship intervals, which `organization_vehicles` does not have (§5.8).
7. **`garage_now` for ranks 10–79** returns only cars the VISIBILITY helper allows (fails closed today), so a technician sees nothing until that lane lands; counts from `garage_timeline` are computed over the same visible set and say `scope: visible_to_viewer`. SPEC 9.2 lists a viewer as "counts only"; VISIBILITY owns whether that count may include hidden cars.
8. **`garage_stay_assertions` kind `not_here`** has no SPEC state: treated as an exit (→ `left`). Confirm.
9. **Soft-deleted vehicles are huge** (`deleted_at` set on 355,436 vehicles, `merged_into_vehicle_id` on 42,078 `[live]`, both global). Harmless for the garage (only tied cars are read) but anyone reading `vehicles` as "live cars" should know.
10. **`vehicle_images.user_id` is the uploader**, not always the photographer; I credit `documented_by_user_id` first. How often they differ was not measured.

## 7. Not done

* No live run of the derivation (read-only access; nothing deployed). All "expected" numbers are projections labelled as such.
* No index was created or measured for the photo arm (§4 step 7); performance on 64M rows is untested.
* `garage_inbound_feed` is still the core's stub (the task did not include it).
* No coordinates of any site are in this repo; sites are seeded from his confirmation, by id.
