# Per-image cohort graph: spec (DRAFT, NOT APPLIED)

Owner ask, 2026-11-23: "Every image in the entire database is supposed to have keys edges folds tables cohorts etc", and they should be "triggered on a per image basis".

SQL drafts live in `supabase/drafts/image-cohort-graph/`. None of it is applied. Applying needs the owner's explicit yes.

## 1. What exists today (measured 2026-11-23, read-only)

`vehicle_images` holds about 65M rows (planner estimate 66.1M, a 0.01% block sample gives about 64.8M) and 76 GB. Only **32,394 rows have an uploader** (`user_id`), and 30,350 of those are Skylar's. Everything else is external listing photos (99.1% `is_external`), each carrying `vehicle_id`.

### Edge coverage

Skylar's photos: 29,500 rows, not superseded. Whole DB: 6,484-row block sample.

| Edge | Skylar | Whole DB | How it's stored |
|---|---|---|---|
| vehicle profile | 15,892 (53.9%) | 99.9% | **per image**: `vehicle_images.vehicle_id` |
| uploader profile | 100% | ~0% (no uploader) | **per image**: `user_id` |
| make / model | 15,880 / 15,882 (53.8%) | 99.8% / 99.6% | **derived from the vehicle only**. The per-image `vehicle_make` is set on 2 rows |
| organization | 15,479 (52.5%) | 71.5% | **derived from the vehicle only** (`organization_vehicles`). `organization_images` (644 rows) is a separate table |
| GPS point | 24,515 (83.1%) | ~0% | per image: `latitude/longitude` |
| ZCTA place cell | 22,484 (76.2%) | ~0% | `geo_cell_zcta`, joined by a rounded point. No per-image key stored |
| named place / garage | 0 | 0 | `known_places` has 3 rows, and the garage model (#3448–#3452) isn't applied |
| work session | 13,472 (45.7%) | 0.03% | per image: `work_session_id` |
| capture session / image set | 10,023 (34.0%) | ~0% | `image_set_members` |
| timeline event / task | 26,477 (89.8%) | 16.1% | per image: `timeline_event_id/event_id/task_id` |
| content identity | 21,055 (71.4%) | 0.05% | per image: `image_identity_id` |
| keys (observations witnessed) | 13,559 (46.0%) | ~0.05% | `observation_witnesses.image_id` |
| data-set membership (#3729) | **6** | 19 image members in the whole DB | `data_set_members member_type='image'` |
| garage derivation evidence | 10,613 (36.0%) | n/a | `garage_derivation_evidence.image_ids` (aggregate rows citing image arrays) |
| listing link | n/a | 26.5% | `vehicle_image_listing_links` |
| work order | 0 | n/a | `work_order_evidence_images` |

**Triggers.** `vehicle_images` has 49 triggers, and none of them writes a cohort edge. GPS-to-org tagging (`trg_auto_tag_org_from_gps`) is the only one that links an image to a group. Make, model, generation, place cell, garage and data-set membership are computed only in aggregate readers or one-off planners, never per image on insert or update.

## 2. Design

Three layers, so "every image has every edge" holds without writing 65M × k rows:

1. **Column edges** are already per image: `vehicle_id`, `user_id`, `work_session_id`, `image_identity_id`, the event ids, and the GPS point. Nothing new is stored.
2. **Vehicle folds** (`vehicle_cohort_edges`): one row per vehicle per cohort it belongs to. Cohorts are make, model, year-model, generation and series, plus each active organization link with its role. That's about 1.5M vehicles × ~5 = ~8M narrow rows. Every external photo inherits these through its `vehicle_id`, which is the fold: the image's cohorts are its vehicle's cohorts.
3. **Image edges** (`image_cohort_edges`): edges that are facts of *this* photo and are not a `vehicle_images` column. These are the place cell (0.001°) and ZCTA, the garage and site affiliation (once the garage model lands), and any future per-image cohort. The memberships that live in link tables (capture session or image set, work order, data set) are mirrored here too, so one index answers "which photos are in this cohort" for every kind. Today that's about 32k native photos × ~4 = ~130k rows, and it grows with uploads, not with scraping.

One reader, `image_cohorts_read(p_image_id)`, unions the column edges, the vehicle fold, `image_cohort_edges`, keys (`observation_witnesses` → `observation_properties`) and listing links. The entry point is SECURITY INVOKER, so the caller's `vehicle_images` RLS decides whether the photo is readable at all. The definer worker lives in the unexposed `private` schema. This replaces the 5 client reads in `PhotoCohorts.swift`.

### Originator vs place (garage model)
Every `image_cohort_edges` row stores:
- **who made the evidence** (`originator_user_id`, or `originator_external_identity_id`);
- **which place it belongs to** (`place_garage_id`, nullable until the garage model is applied);
- **the originator's rank there when it was observed** (`originator_rank`, from `garage_member_rank`).

These three are never merged. A technician's photo at Viva stays the technician's evidence that is affiliated with Viva. It doesn't become Viva's or the owner's. This matches `garage_stay_evidence` in #3448.

### Privacy
- An edge never widens access. The reader returns an edge only when the caller can read the image row under the existing `vehicle_images` RLS. Organization names come only from public orgs, and private ones are counted.
- `visibility = 'private'` marks edges derived from a sensitive photo. They're readable by the uploader only.

### Incremental: triggers enqueue, a free cron drains
There's no paid compute. Everything runs inside the existing Postgres through pg_cron, which is already installed.
- `image_cohort_queue(image_id pk, reason, enqueued_at, attempts)` is filled by **statement-level** triggers with transition tables: one `INSERT ... SELECT ... ON CONFLICT DO NOTHING` per statement, never per row.
  - Inserts on `vehicle_images` where `user_id IS NOT NULL`.
  - Updates of `vehicle_id, latitude, longitude, work_session_id, is_sensitive, vision_gate_status, user_id`.
  - Inserts and deletes on `image_set_members`, `data_set_members (image)` and `work_order_evidence_images`.
  - External listing photos never enqueue, because they get their cohorts from the vehicle fold.
- `vehicle_cohort_queue(vehicle_id pk, ...)` is filled when `vehicles.make/model/year/generation/series` change, or when an `organization_vehicles` row is inserted, updated or deleted. That's statement-level too.
- `image_cohort_drain(p_batch int default 500, p_budget_ms int default 2000)` runs every minute under pg_cron:
  - claims rows `FOR UPDATE SKIP LOCKED`;
  - runs with `statement_timeout 5s` and `lock_timeout 1s`;
  - re-derives each image's edges as a diff (insert the missing ones, supersede the stale ones, never delete);
  - stops at the budget;
  - **backs off** when `platform_config.image_cohort_graph.paused` is true, or when more than 40 backends are active.
- `vehicle_cohort_drain` is the same pattern for folds.

### Backfill
This is sized to the real data, not to 65M.
- **Native images**: 32,394 rows, enqueued in keyset batches of 2,000 ids (`id > last`) by `image_cohort_backfill_enqueue(p_after uuid, p_limit int)`. The cron drains 500 a minute, so it takes about 65 minutes and never holds a long transaction.
- **Vehicle folds**: about 1.5M vehicles, enqueued in keyset batches of 5,000 by `vehicle_cohort_backfill_enqueue`. They drain at 2,000 per minute through the vehicle drain, about 12.5 hours at the default throttle.
  - Each batch is one short statement under a 5-second statement timeout.
  - It pauses with one flag. Progress is the queue depth.
- External photos need **no per-image backfill**. Their edges come from the folds, and the existing 17.9M listing links stay where they are.
- Revert: supersede the rows by `rule_version`. Drop the triggers first, then the tables. Nothing in `vehicle_images` changes.

### What this does not do
- It doesn't create organization or place memberships. It projects only links that already exist.
- It doesn't apply the garage model. `place_garage_id` stays null until #3448 lands.
- It doesn't backfill data-set membership. That's `data_set_membership_plan_v1` (#3729), which has its own runs.

## 3. Rollout (each step needs an explicit yes)
1. Apply `01_tables.sql` and `02_derive.sql`. They're inert: there are no triggers yet.
2. Run `image_cohort_drain` by hand on 50 of Skylar's photos, compare the results with the iOS strip, and check the timing.
3. Apply `03_triggers_and_cron.sql`, then enqueue the native backfill.
4. Apply `04_reader.sql` and switch `PhotoCohorts.read` to `image_cohorts_read`.
5. Enqueue the vehicle-fold backfill overnight.

## Free-first: device reads before any paid pass (added 2026-11-23, draft `05_device_tags.sql`)

The phone has already run Apple Vision on a photo before the photo leaves it. Those reads become per-image metadata at upload, and they produce the first cohort edges. A paid pass runs only for the question the free reads can't answer.

### What exists today (Skylar, 30,399 rows, read-only, 2026-11-23)
| Measure | Count |
|---|---|
| Any on-device label stored (`apple_ml_labels`) | 17,210 (56.6%): 7,559 from the phone's capture relay, 9,229 from the Mac Photos import (`iphoto`) |
| Full phone verdict (`ai_scan_metadata.on_device_vision`) | 6,930 (22.8%), capture-relay rows only |
| Phone says vehicle / not vehicle / personal | 4,018 / 2,912 / 193 |
| Label vocabulary | 1,115 distinct strings, mixed casing ("Machine" 9,478 and "machine" 2,005) |
| Label confidences stored | 0. The phone computes them and drops them |
| `has_person` stored | 0. The phone computes it and the push doesn't send it |
| PhotoKit facts stored (favorite, screenshot, burst, Live/HDR/depth) | 0 |
| Device OCR or identity reads in `image_observations` (`device_privacy_v1`) | 0 |
| `vehicle_score` set (the only free gate in the orchestrator) | 231. Never 0, so the free skip has never fired |
| Paid classification ran | 18,556 OK + 473 failed. 12,943 also got the deep pass |
| Phone said not a vehicle, paid classifier ran anyway | 2,460 (247 of them also deep) |

The legacy push `sync_local_vision_tags` matches only `source in ('capture_relay_ios','capture_relay')`. 1,675 `iphoto` rows carry the phone uuid and are never reached.

### Layer
1. **Reads (`image_device_reads`, `image_device_tags`).** One row per image, with the model, revision and OS stamped. Labels are normalized to lower snake case. These are written by `record_device_tags`, which iOS #3747 calls behind a flag.
2. **Free edges (`image_device_edges`)**, each with a rule version and a confidence:
   - `photo_kind`: owner verdict, then screenshot, then document-like labels, then the device vehicle gate;
   - `person_present`: always `private`, and feeds the Library privacy cover;
   - `burst`.
   - Place and capture session come from GPS and time, already in 02.
3. **Paid gate (`paid_vision_question`).** It returns null when the free reads settle the photo: owner-hidden, personal, or the device says not a vehicle. Otherwise it returns `vehicle_detail` (filed, so only angle, parts and text remain) or `which_vehicle`. The orchestrator would call it before `classifyImageRouted`. That edge change isn't drafted as a deploy.

Originator and place stay separate: every device edge's originator is the uploader, and place is a separate `place_cell`/`garage` edge.
