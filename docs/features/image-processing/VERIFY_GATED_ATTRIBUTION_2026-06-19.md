# Verify-Gated Attribution — spec & runbook (2026-06-19)

**Problem:** 9,563 unlinked photos (no `vehicle_id`) can't enter the analysis drain
(`analyze-capture-photos` per-vehicle mode needs an anchor) and never reach a build
profile. Bulk auto-attribution is the failure mode that causes doppelganger
contamination (the shop-mixed camera roll — ~20% of a "recent" burst is *other*
vehicles) and the $410-class mis-attribution. This pass attributes them **safely**.

## Governing principle

> Free compute is spent on a **panel of skeptics**, not on throughput. A photo's
> link is **committed only when independent verifiers fail to refute it AND ≥2
> independent hard signals corroborate.** Everything else is *suggested*
> (forkable, owner-reviewable) or *held*. Nothing is ever deleted — a wrong link
> **forks** to a ghost.

The scarce, expensive thing is a wrong link on a profile — not the compute. So we
drive false-positives toward zero by raising the agreement bar, which free BYOK
infra lets us do without rationing.

## This is an EXTENSION, not a new system

It reuses, does not mint:

| Need | Existing piece |
|---|---|
| Write path (first-attribution) | `attribute_testimony(obs_type, obs_id, target_vehicle_id, confidence, signal, reason, actor)` — sets `vehicle_id` + `vehicle_confidence` + `vehicle_source` + mirrors `auto_suggested_vehicle_id`, writes a `reattribution_audit` row, **refuses if already attributed**, sets `user_confirmed_vehicle=false`. (migration `20260614090000`) |
| Cheap-first classifier (L0–L4) | `scripts/vision-gate-classify.mjs` — caption/source/apple_ml/flags/affinity layers, writes `vision_gate_status`, `vision_gate_attribution_confidence`, `vision_gate_agent_reasoning`. Runs FIRST; resolves NOISE/personal/doc for free. |
| Single vision vote (L4) | `check-image-vehicle-match` (Haiku). **The refuter panel replaces this single vote with N diverse skeptics.** |
| Free compute | `claude --print --model … --add-dir <imgdir>` reading local image files (the same harness draining captures — no metered API). |
| Lanes (columns, already on `vehicle_images`) | committed: `vehicle_id` + `vehicle_confidence` + `user_confirmed_vehicle`; suggested: `auto_suggested_vehicle_id` + `auto_suggestion_confidence`; gate: `vision_gate_status` + `vision_gate_attribution_confidence`; signals: `latitude` / `longitude` / `taken_at` / `exif_data` / `location_confidence` |
| Ghost discipline | ghost vehicles are **never** drained/attributed — reattribute first (`vision-gate-drain.sh` GHOSTS list; the GAA-43671 K5 incident) |

**No new tables.** The owner-review queue is a *query* over `vision_gate_status`,
not a table (platform-hygiene: 1,013 tables already).

## Unit of work: the day-cluster

A co-located burst is one session of one subject — and the unit at which shop-mix
outliers get caught. Cluster the orphans by **stored-original EXIF** (exiftool the
storage object — DB columns lie) → day + temporal burst + GPS. Reuse `build-day.mjs`
and the temporal-burst clustering from the labor-minutes work. Resolve a dominant
subject per cluster; re-check outliers individually (the 20%).

## The pipeline

### Stage 0 — Cheap layers first (free, may resolve without pixels)
Run the existing `vision-gate-classify` L0–L3 on the orphan rows. Personal/sensitive
→ `rejected_personal` (NOISE). Document/receipt → approved-as-document (kept, routed
to acquisition-context, not a build). Only rows that need *vehicle disambiguation*
fall through to the panel.

### Stage 1 — Candidate generation (which vehicle could this be?)
For each surviving orphan/cluster, build a candidate vehicle set from hard signals:
1. **GPS + temporal siblings** — already-attributed images in the same GPS cell within
   the time window. If they point to exactly ONE vehicle → strong candidate (the
   backfill's proven `gps_temporal:single_vehicle` pattern, conf 0.96). Home-base
   cells (Boulder City, 46+ vehicles) → many candidates → must disambiguate by pixels.
2. **VIN / plate** read off the photo → checksum-validate → exact chassis (strongest).
3. **Visual identity** — cross-compare against each candidate vehicle's *confirmed*
   photo set (color/body/era/distinctive mods).
4. **Album name** = a prior only — flags disagreement, never decides.

No candidate survives → HOLD (orphan with no plausible home).

### Stage 2 — The refuter panel (where free compute goes)
For each `(candidate vehicle, photo)` above NOISE, run **N independent refuters** via
`claude --print`, each prompted to *argue the match is WRONG* and **default to
refuted if unsure**. Perspective-diverse:
- refuter A checks VIN/plate/badge legibility vs the candidate,
- refuter B checks visual continuity vs the candidate's known photos,
- refuter C checks GPS/time plausibility.

A refuter that names a *better-matching* candidate routes there (fork) or, if it
splits the panel, drops to AMBIGUOUS.

### Stage 3 — Adjudicate into the existing lanes

| Outcome | Trigger | Write |
|---|---|---|
| **COMMIT** | checksum-VIN match, **or** unanimous fail-to-refute + ≥2 independent hard signals | `attribute_testimony(...)` — high `vehicle_confidence`, `user_confirmed_vehicle=false`, signal string carries basis |
| **SUGGEST** | strong visual + 1 corroborator, panel majority, no VIN | `auto_suggested_vehicle_id` + `auto_suggestion_confidence`; `vehicle_id` stays NULL |
| **HOLD** | panel split / signals conflict / matches 2 vehicles | `vision_gate_status='review_needed'`, conflict in `vision_gate_agent_reasoning` |
| **NOISE** | non-vehicle (receipt/screenshot/person/landscape) | `vision_gate_status='rejected_personal'` (doc/title → acquisition-context); kept, never deleted |

### Stage 4 — Owner surface (batched to scale)
Reviewed **by day-cluster**, never 9,563 photos: *"Nov 2017, Boulder City — 14
photos, reads as the K5 fuse-block job → confirm / reject / split."* One thumb
resolves a cluster. Only **HOLD + SUGGEST** reach him; **COMMIT auto-flows** with
provenance (agentic confidence *is* the product — his review can't scale the pool).
His signature is reserved for: promoting SUGGEST → confirmed
(`user_confirmed_vehicle=true`), ownership promotion, and conflict resolution.

## Safety rails (trust-invariants)
- Every write through `attribute_testimony` → `reattribution_audit` row + stamped
  `(confidence, signal, reason)`. Never a raw UPDATE (the block-god-writes hook
  refuses it anyway).
- Nothing is `user_confirmed` until he signs; COMMIT stays agentic
  (`vehicle_confidence < 1.0`).
- A wrong COMMIT **forks** — `reattribute_observation` to a ghost, never delete.
- **No value or labor accrues** from SUGGEST or unconfirmed COMMIT — intent stays
  owner-gated (the photo-intent rule).
- **Ghosts are never attributed** — skip the GHOSTS list, reattribute first.

## Tunable parameters (defaults, owner-overridable)
- **COMMIT bar:** unanimous fail-to-refute + ≥2 independent hard signals. Panel size **5**.
- **SUGGEST visibility:** shows on the profile as a dim "likely" tile (forks-not-hides),
  excluded from value/labor until confirmed.

## Orchestrator
`scripts/daily-receipt/vision-gate-refute.mjs` — the candidate-gen + refuter-panel
layer. **Defaults to `--dry-run`** (computes lanes, writes nothing — produces an
adjudication report to inspect before anything commits). `--commit` gates all writes.
Registered in `package.json` as `attribution:refute`.

```bash
# dry-run: report the lanes for a batch of orphans, write nothing
npm run attribution:refute -- --user-id <uuid> --limit 200 --panel 5
# commit, after inspecting the dry-run report
npm run attribution:refute -- --user-id <uuid> --limit 200 --panel 5 --commit
```

## First-iteration scope vs. follow-ups
- **v1 (this build):** GPS+temporal candidate gen → N-skeptic visual refuter panel →
  COMMIT/SUGGEST/HOLD adjudication → `attribute_testimony` writes, `--dry-run` default.
- **Follow-ups:** VIN/plate OCR signal; cross-profile visual-compare against confirmed
  sets; the day-cluster owner-review surface in the app (query over `vision_gate_status`).
