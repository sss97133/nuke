# BYOK Analysis Drain Loop — `/loop` prompt

Paste this into a fresh Claude Code session with `/loop` (no interval — let the agent self-pace):

```
/loop drain the BYOK deep-image-analysis backlog for Skylar's vehicles, one batch at a time. each tick:

1. cd /Users/skylar/nuke
2. pick the vehicle with the most pending images:
   dotenvx run -- node scripts/analysis-queue/pick-next-vehicle.mjs
3. if it prints EMPTY (exit 1), report "queue drained" and stop the loop (do not ScheduleWakeup).
4. otherwise: parse <vehicle_id> <pending_count> <label>. mkdir -p /tmp/dia/queue/$vehicle_id and prepare a worklist of 15 images:
   dotenvx run -- node scripts/deep-image-analysis-byok.mjs prepare --vehicle-id $vehicle_id --limit 15 --worklist /tmp/dia/queue/$vehicle_id/work.jsonl
5. read each row of the worklist. for each image:
   - Read the image via the Read tool (the image_url is a supabase storage url; download to /tmp/dia/queue/$vehicle_id/imgs/ if needed)
   - write a verdict line into /tmp/dia/queue/$vehicle_id/verdicts.jsonl following the verdict shape documented in the header of scripts/deep-image-analysis-byok.mjs
   - obey the rules in:
     * ~/.claude/projects/-Users-skylar/memory/feedback_bbox_verdicts_must_respect_3d.md (occlusion + ellipse bboxes)
     * ~/.claude/projects/-Users-skylar/memory/feedback_camera_pose_precision_over_3_4_view.md (precise camera_pose, never "3/4 view")
     * ~/.claude/projects/-Users-skylar/memory/feedback_look_at_images_first.md (look first, asset names lie)
     * ~/.claude/projects/-Users-skylar/memory/feedback_supabase_render_default_crops.md (append &resize=contain or use raw image_url)
   - confidence honest. needs_review=true if the image is ambiguous.
6. when all 15 verdicts written, ingest:
   dotenvx run -- node scripts/deep-image-analysis-byok.mjs ingest --sink /tmp/dia/queue/$vehicle_id/verdicts.jsonl
7. ScheduleWakeup 60s for the next batch. one batch per tick keeps each tick focused and the cache warm.

write nothing to vehicle_observations via raw INSERT — the PreToolUse hook ~/.claude/hooks/block-god-writes.sh will reject that. atom writes happen via the deep-image-analysis-byok.mjs ingest command, which goes through the canonical path. corrections supersede, never UPDATE. respect the trust invariant.

stop the loop only when pick-next-vehicle.mjs prints EMPTY twice in a row, or when Skylar interrupts.
```

## One-liner to start it

```bash
cd /Users/skylar/nuke && claude
# then paste the /loop ... block above
```

## How this composes with the rest of the mill

- **Layer 2 (ingestion)** — `com.nuke.photo-sync` launchd plist, hourly. Drops new vehicle_images rows.
- **Layer 4 (deep analysis)** — THIS loop, self-paced Claude Code session. Drains the un-deep-analyzed vehicle_images one vehicle batch at a time, writes byok_deep_analysis atoms via the canonical ingest path.
- **Layer 5 (day-projection)** — `scripts/daily-receipt/build-day.mjs --date YYYY-MM-DD`. Run when atoms accumulate; produces work_session rows + value statements.
- **Layer 6 (inferred-metric RPC)** — not built. The 80-line PL/pgSQL `compute_inferred_value(vehicle_id, date)` from the May 23 working paper. That's what closes the worth-proof loop.
