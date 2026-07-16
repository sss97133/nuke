# 17 — Daily Receipt Processor

## What it is

The end-to-end pipeline that takes a day's photos from the user's camera roll and produces a **billable daily receipt** for a specific vehicle profile. Closes the long-running gap between *photos on phone* and *what does my vehicle profile say I did today*.

## Why it exists

Established conversationally over sessions `5d0848ba` (Apr 26) → `f9e0cd84` (May 3) → `9fcdd38f` (May 17–23). Each prior session ended at the same gap: `vehicle_images` rows are missing for un-albumed camera-roll photos, so `get_daily_work_receipt` returns empty. The downstream (RPC + DayCard.tsx) was built but starved. This module is the upstream that feeds it.

Recurring user statements driving the spec:
- "all images should trickle down into vehicle profile daily receipts" (May 2)
- "everything is user_profile / org_profile and all receipts are daily" (May 2)
- "are vehicle profiles substantial — do they have daily receipts for the last 8 years" (May 3)
- "daily receipts becoming real and accurate" (May 22)
- "one day at a time, contextually... billable receipts basically" (May 23)

## The chain

```
camera roll (osxphotos)
  ↓ export
local JPEG
  ↓ caller-BYOK vision (Claude in session reads, classifies)
classification JSON {scene_class, area, action, parts_visible, caption, ...}
  ↓ scripts/daily-receipt/process-photo.mjs
vehicle_images row (with area/part/operation/image_type/category/caption populated)
  +
vehicle_observations atom (via ingest-observation, full provenance)
  ↓ scripts/daily-receipt/build-day.mjs
work_sessions row (computed from photo span + labor rate)
  ↓ get_daily_work_receipt RPC (already existed)
billable daily receipt JSON
  ↓ DayCard.tsx (already existed)
rendered receipt UI
```

## The two scripts

### `process-photo.mjs` (per-photo intake)

For one photo + caller-provided classification:
1. SHA-256 hash → dedup check against `vehicle_images.file_hash`
2. If new: upload to `vehicle-photos` bucket at `{vehicle_id}/daily-receipt/{hash12}_{filename}`
3. INSERT `vehicle_images` row with classification fields populated (`area`, `part`, `operation`, `image_type`, `category`, `caption`, `fabrication_stage`)
4. POST atom to `ingest-observation` (canonical write path, full provenance)
5. Returns `{vehicle_image_id, observation_id, storage_path}`

Idempotent. Re-running on the same photo hits the dedup branch and exits clean.

### `build-day.mjs` (per-day rollup)

For one `(vehicle_id, date)`:
1. Query `vehicle_images` for that vehicle on that date
2. Compute time bounds (start/end from `taken_at` min/max)
3. Compute labor estimate (70% of span as conservative active work)
4. Compute cost at provided labor rate
5. Upsert `work_sessions` row with title, duration_minutes, total_labor_cost
6. Call `get_daily_work_receipt` RPC to verify receipt materializes
7. Print human-readable billable receipt

Idempotent. Re-running refreshes the work_session stats.

## The vision step is caller-BYOK

These scripts are **plumbing only**. The vision/classification step is intentionally deferred to a caller LLM with subscription compute (per `feedback_vision_is_caller_byok_laser_tag.md`).

The caller produces a JSON like:
```json
{
  "scene_class": "engine_bay",
  "area": "engine",
  "action": "wiring_install_or_trace",
  "parts_visible": ["chrome MUSTANG valve cover", "distributor"],
  "fabrication_stage": "wiring",
  "caption": "Gloved hand on Mustang valve cover holding small-gauge wires",
  "confidence": 0.9,
  "vehicle_match_basis": "MUSTANG embossed valve cover",
  "ml_labels": ["Cord","Machine","Vehicle","Vehicle Engine"]
}
```

…and pipes it to `process-photo.mjs` via `--classification-file` or `--classification`. The same scripts work with any future vision provider (YONO sidecar revival, paid Claude API, GPT, etc.) — only the upstream JSON producer changes.

## Why this respects the trust invariant

- `vehicle_images` insert is single-shot; no overwrites of testimony.
- `vehicle_observations` atom carries `(source, model, method, confidence, raw_source_ref)` — re-derivable from the photo on disk.
- Corrections happen via NEW supersession atoms with `supersedes: <prior_id>`, not UPDATE. See live precedent in session `9fcdd38f` where atom `750e5e34` was superseded by `ad0e380b` (the X-pipe correction).

## How to run a day

```bash
# Per photo (loop in caller side):
dotenvx run -- node scripts/daily-receipt/process-photo.mjs \
  --photo /tmp/apr14-start/20260414_120933_IMG_9419.jpg \
  --vehicle-id eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f \
  --taken-at 2026-04-14T12:09:33+00:00 \
  --source-identifier iphone:IMG_9419.HEIC \
  --classification-file /tmp/classifications/IMG_9419.json

# Once all photos for the day are processed, build the rollup:
dotenvx run -- node scripts/daily-receipt/build-day.mjs \
  --vehicle-id eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f \
  --date 2026-04-14 \
  --title "Pickup + initial teardown and inspection" \
  --labor-rate 85
```

## Anti-patterns (do not regress to)

- **Album-scoped ingest** (`iphoto-intake.mjs --all`) — too narrow; recent work photos sit in the camera roll, not in albums. The user does not file as they work.
- **YONO sidecar dependency** — offline 5+ months; replaced by caller-BYOK vision.
- **API-credit dependency** — Anthropic API balance is $0; use subscription compute via the caller LLM.
- **Inventing a new "composer"** — `get_daily_work_receipt` + `DayCard.tsx` already render the receipt. Feed them; don't replace them.
- **One-off atom writes without `vehicle_images` rows** — atoms in `vehicle_observations` are derivations; the RPC primary query is on `vehicle_images`. Both layers are needed.

## Open work

- **Seven-Level narrative composer** in `DayCard.tsx` per `docs/library/prompts/P10-day-card-seven-level-analysis.md` — adds the ANALYSIS section above the raw receipt. Template logic, not LLM.
- **Receipt line-items integration** — when a `receipt` scene_class photo is processed, route to `process-receipt` edge function for OCR + total → `work_sessions.total_parts_cost`.
- **Transport/delivery costs** — separate `work_session_line_items` table OR an "external_costs" array on `work_sessions`. The Apr 14 delivery driver photo is a real billable line.

## Cross-references

- `docs/library/technical/engineering-manual/05-image-pipeline.md` — broader image pipeline (intake, classification, vision-gate)
- `docs/library/technical/engineering-manual/04-observation-system.md` — observation atoms & ingest-observation contract
- `docs/library/prompts/P10-day-card-seven-level-analysis.md` — narrative composer spec
- `docs/library/reference/encyclopedia/03-timeline-architecture.md` — how the per-day data composes into a vehicle's timeline
- `TOOLS.md` — existing tools (do not duplicate)
