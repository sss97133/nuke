# AI / VISION (YONO) — theory card

**The model:** Vision is a zero-cost tier-0 gate: edge functions proxy to a local YONO Python sidecar (port 8472, `YONO_SIDECAR_URL`) that returns what TEXT cannot — make/model, condition, damage, zone. Results are MEASUREMENTS written onto `vehicle_images` rows (condition_score, damage_flags, vision_model_version) with the model version as provenance. Labels are projections of measurement: store the evidence, project categoricals at render/query time, never bake a new categorical column or table into the schema (see `docs/library/intellectual/contemplations/rhizomatic-labels-and-crystallization.md`).

**The invariant(s):**
- Every vision output carries source DNA: `(value, model, confidence, analyzed_at)`. If the sidecar is down, return `{available:false}` — never fabricate or fall back silently.
- NEVER mint a new label/sentiment/tag store. `vehicle_sentiment` exists; `vehicle_images.angle` is a COLUMN (the `vehicle_image_angles` table is a 0-row corpse).
- Vision compute for external callers is BYOK — Nuke owns the checklist/harness, the caller owns the compute.
- Photo intent must be owner-confirmed before value accrues; pixels alone never set value.

**Canonical entrypoints (from CAPABILITY_MAP.md, all verdict=CANONICAL):**
- Make/model classify (tier-0) → `yono-classify` (sidecar `/classify`)
- Condition/damage/zone analysis → `yono-analyze` (sidecar `/analyze`; writes `vehicle_images` if `image_id` given)
- Upload-triggered analysis → `auto-analyze-upload` → yono-analyze
- Analysis engine / signals → `analysis-engine-coordinator` (drains `analysis_queue` → `analysis_signals`)
- Comment sentiment → `analyze-comments-fast` + `batch-comment-discovery`; ledger = `comment_discoveries`
- Description mining → `discover-description-data`; ledger = `description_discoveries`
- User-billed AI chat (BYOK funnel) → `analyze-with-claude` (+ `set-ai-provider`)
- Public vision API → `api-v1-vision`
- Image validation → `validate-vehicle-image`
- Training-data export → `yono/` root scripts (`export_nuke_training_data.py`)

**Do NOT:** resurrect `analyze-image`, `vision-analyze-image`, `yono-batch-process`, `batch-analyze-vehicle`, `export-training-batch`, `update-live-sentiment`, `analyze-vehicle-description` (all deleted). `identify-vehicle-from-image` is cloud/external-MCP only — not the pipeline gate. `ai_training_exports` table DOES NOT EXIST — don't create it. Don't write loose bbox rectangles or "3/4 view" strings — tight ellipses respecting 3D occlusion, structured camera_pose fields. Don't quote Anthropic API cost as a constraint — the workshop has own vision/DeepSeek/Lambda.

**Before you build here:** read `docs/ledger/CAPABILITY_MAP.md` (AI/VISION + PHOTOS sections) before minting anything; read the memory image-pipeline pickup (`image-pipeline-consolidated-2026-06-25.md`) — the pipeline exists, operate it. Check `pipeline_registry` before writing any computed field. A "sidecar down" error from Bash is usually the sandbox blocking the network, not a dead sidecar.
