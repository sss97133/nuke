-- Describe the image status columns on vehicle_images from the code that writes and reads them.
-- Findings 2026-10-03 (owner account, 28,271 images): is_approved is true on all of them while
-- approval_status is pending on 25,089 and auto_approved on 3,182. No code in supabase/, scripts/,
-- nuke_frontend/ or apps/ sets approval_status to 'approved'; only importers set 'auto_approved'.
-- Metadata only: COMMENT takes no table rewrite. The lock timeout guards the busy table.
set lock_timeout = '5s';

comment on column public.vehicle_images.approval_status is
  'Content moderation status (enum content_approval_status: pending, auto_approved, approved, rejected). Importers (extract-bat-core, extract-*, backfill-images) insert auto_approved. Owner uploads default to pending. As of 2026-10-03 no code path moves a row from pending to approved, so pending rows stay pending; photo-pipeline-orchestrator classifierAssay treats only approved and auto_approved as eligible. Independent of vision_gate_status and is_approved.';
comment on column public.vehicle_images.is_approved is
  'Boolean companion to approval_status. True on every owner image checked (28,271), including those with approval_status pending, so the two disagree; read sites decide which they honor. classifierAssay requires both is_approved = true and approval_status in (approved, auto_approved).';
comment on column public.vehicle_images.vision_gate_status is
  'Pre-filter before deep analysis: is the frame fit for its attributed vehicle? (enum vision_gate_status). pending = not yet gated (column default for new owner photos; its promoter, scripts/vision-gate-classify.mjs run by the com.nuke.vision-gate-approver launchd job, was not loaded on 2026-10-03). approved = cleared by the layered classifier (L0 caption/filename, L1 source rules, L2 Apple ML labels, L3 explicit flags, optional L4 vision), by an owner day-confirmation (scripts/timeline/apply-day.mjs), by photo-pipeline-orchestrator when it resolves the image to a vehicle (enqueueDeepByok, which also queues the frame for deep analysis), or by owner bulk approval (migrations 20260623180000 and 20260623190000). rejected_personal = personal, kept as testimony but gated out of vehicle surfaces. rejected_misattributed = belongs to a different vehicle. review_needed = ambiguous, held for human or L4 review. NULL = legacy row never gated. approved means the evidence found no contradiction, not that the vehicle assignment was verified from pixels. Tier 0 of image_coverage_by_vehicle counts approved rows.';
comment on column public.vehicle_images.vision_gate_attribution_confidence is
  'Classifier confidence, 0 to 1, that the image belongs to its vehicle, written with vision_gate_status by scripts/vision-gate-classify.mjs.';
comment on column public.vehicle_images.vision_gate_agent_reasoning is
  'The evidence layer and reason behind the gate verdict, written with vision_gate_status.';
comment on column public.vehicle_images.vision_gate_processed_at is
  'When the gate last wrote its verdict (UTC). Ingest time.';
comment on column public.vehicle_images."position" is
  'Undocumented ordering of the image within its vehicle. Values are distinct per vehicle but do not start at 0 (observed vehicle minimums include 1, 48, 66, 104 and 135), so this is not gallery order. The per-listing gallery index for BaT is stored in exif_data -> listing_positions, keyed by canonical listing URL (written by extract-bat-core). No writer of this column was found in extract-bat-core; do not use it as a gallery order until a writer is documented.';
