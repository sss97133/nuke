# THE RUNNER — a BaT URL → a live due-diligence dossier

*Proven end-to-end 2026-07-15: `bringatrailer.com/listing/1965-ford-mustang-896`
imported → read → landed → dossier live at `nuke.ag/vehicle/ec9f5015…/dossier`
in ~45 min, untouched by hands after launch. Second car (f0b67b3e) reproduced it.*

This is the **manual/subscription lane** runner — the first-dollar due-diligence
product. It runs the Eye (the blind 3-pass appraisal, see `THE_EYE.md`) on the
BYOK/subscription agent lane, not a metered edge function. The self-serve
metered version (edge function calling the vision API) is a later step; this is
what produces a real dossier today.

**Scope: 1965-66 Mustangs only.** The canon (`canon_v2.md`,
`condition_knowledge` `MUSTANG_APPRAISAL_CANON_1965-66`) is Mustang-specific;
other makes need their own canon before a read means anything.

## The four stages

```
BaT URL ──①prep──▶ vehicle + imgs/<image_id>.jpg ──②read──▶ pass1/2/3 JSON ──③land──▶ DB ──④refresh──▶ dossier
```

### ① Prep — `scripts/appraise/prep_from_bat_url.sh <bat_url> [out_base]`
Calls the deployed `complete-bat-import` (extract-bat-core → vehicle + full
gallery + story + comments), then downloads every `vehicle_images` row to
`<out>/read_<vid>/imgs/<image_id>.jpg`. **Files are named by `image_id` — that
is the linkage** the landing step uses to tie each observation back to its frame.
Prints `VEHICLE_ID=` and `READ_DIR=`.

### ② Read — the `appraise-vehicle` Workflow (`wf_appraise_vehicle.js`)
Run via the Workflow tool (needs the agent harness; not a shell cron):
```
Workflow({ scriptPath: "…/wf_appraise_vehicle.js", args: {
  carId, imgDir: <READ_DIR>/imgs, outDir: <READ_DIR>/out,
  storyPath: <READ_DIR>/story.txt, chunkSize: 10 } })
```
Fans out ~N/10 observer agents (sonnet, blind — pixels only, price sealed) →
one cross-examiner (story as testimony) → one appraiser (price-blind). Writes
`out/pass1_chunk*.json`, `pass2_crossexam.json`, `pass3_appraisal.json`.
No DB writes — safe to re-run. (248 imgs ≈ 25 agents ≈ ~40 min, ~5M tokens.)

### ③ Land — `node scripts/appraise/land_read.mjs <READ_DIR> <vehicle_id> <bat_url>`
(under `dotenvx run --` for the service key.) Maps each observation's
`image_file` → `image_id`, POSTs every layer through **`ingest-observation`**
(source `nuke-vision`, kind `condition`, one row per image + one each for
cross-examine/appraise — the only write door, dedups by content_hash), then
upserts the `vehicle_condition_scores` band row (what the value block + dossier
read). Idempotent.

### ④ Refresh + surface
`REFRESH MATERIALIZED VIEW appraisal_canon_checks;` (via MCP/SQL) so the drill +
dossier see the new checks. Then `nuke.ag/vehicle/<vid>/dossier` renders the
full read; the vehicle-profile value headline drills into the same ledger.

## Gotchas that bit (don't rediscover)
- **Workflow `args`**: the script does `typeof args==='string'?JSON.parse(args):args`.
  Drop that guard and a stringified arg makes every path `undefined` → silent no-op.
- **Appraiser output shape drifts by method version.** canon_v2 (v1.4) emits
  `top_value_drivers/risks` as `{driver|risk, findings[]}` objects, `flip_plan`
  as an object, and `if_it_verifies` as `{band_low,band_high,condition,cap_reason}`;
  the older v1.3 cohort emitted strings + `{band_usd,note,condition_precedent}`.
  The frontend reads both via `hooks/eyeShape.ts`. New payload fields → extend it.
- **BaT galleries commingle vehicles.** The 1965-ford-mustang-896 set held the
  subject fastback AND a second notchback coupe; the cross-examiner detected it
  and scoped the appraisal to the plate-confirmed car. The per-image observations
  still land honestly (each cites its own frame); the appraisal excludes the coupe.
- **complete-bat-import lock-timeouts** under DB contention (idle-in-transaction
  holding vehicle locks). Transient — check `pg_stat_activity` and retry.

## What's owed to productize (self-serve MVP)
Standalone runner (no session): port the read to a metered vision edge function
+ a queue; full-gallery ingest is already handled (complete-bat-import pulled
248 frames); the condition_score formula is currently mean-grade→0-100 (approx)
while the band is exact — settle the score formula against the cohort.
