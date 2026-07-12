# PHOTOS — theory card

**The model:** A photo is testimony, not decoration: intake writes a `vehicle_images` row (SHA-256 file_hash for exact dupes, source recorded in `image_source_appearances`), then a pg_net trigger fires `photo-pipeline-orchestrator` per image — classify type via Gemini Flash, route to the right pipeline, match vehicle by GPS/metadata if unattributed, emit observations via `ingest-observation`. Labels (image_type, angle, medium) are projections of measurement: stored as evidence columns on `vehicle_images`, projected at render — never baked into categorical side-tables.

**The invariant(s):**
- `vehicle_images` is a TESTIMONY table: never DELETE, never UPDATE-overwrite — supersede or relink (`.claude/rules/agent-trust-invariants.md`). Wrong attribution forks to a ghost vehicle, never hides.
- Never mark `ai_processing_status='completed'` on a fake verdict — `classifier_ok:false` means rate-limited/errored stand-in, not a classification (2026-07-06 hollow-completion incident, orchestrator index.ts:57-64).
- ~32.7M rows are `pending`; any query on that predicate must use the indexed passes (`idx_vehicle_images_pending_user` / `_processing`) — an unindexed ORDER BY blows the statement timeout silently (orchestrator index.ts:92-103).
- Mac Photos library is truth; the capture relay is the suspect when profile photos are wrong. Photo intent is owner-confirmed, never assumed from pixels.

**Canonical entrypoints:**
- Pipeline drain → `photo-pipeline-orchestrator` (cron */5) + `reset_stuck_photo_pipeline_images` (cron */15)
- Upload intake → `image-intake` edge function
- EXIF → `derive-image-exif` (registry-routed via derive-dispatch)
- Mac Photos sync → `scripts/photo-sync-daemon.mjs` (launchd ag.nuke.photo-sync) → `image_identities` → `image_appearances`; manual album intake → `scripts/iphoto-intake.mjs`
- Image↔vehicle match validation → `check-image-vehicle-match`
- Auto-sorting → `auto-sort-photos`; bundles → `auto-create-bundle-events` + `suggest-bundle-label`
- Storage → `vehicle_images` (39.7M rows); angle = `vehicle_images.angle` COLUMN, not a table

**Do NOT:**
- Resurrect deleted assets: photo-sync-orchestrator, nuke-box-upload, reprocess-image-exif, ingest-photo-library, backfill-image-angles, match-vehicles-by-images, validate-bat-image, NukePhotoSync.app. `process-all-images-cron` has NO cron despite the name; trickle-backfill-images and dedup-vehicle-images (0 callers) are not the path.
- Create `vehicle_image_tags`/`likes`/`facts`/`assets` tables — they DO NOT EXIST by design (universal-search/tagService queries against tags are known-broken; a table needs a design decision first). `vehicle_image_angles` (0 rows) is the scar from baking a categorical into schema.
- Bulk-attribute recent camera-roll photos to one build (shop-mixed), or compute value/intent from pixels alone.

**Before you build here:** read `docs/ledger/CAPABILITY_MAP.md` PHOTOS section before minting anything (rule: a new thing means retiring an old one). Check `TOOLS.md` + `pipeline_registry` for field ownership. Writes go through `ingest-observation`, never raw INSERT.
