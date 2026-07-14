# Chapter 19: Temporal Change Ingestion (dT)

> **Status: session-tier operator VALIDATED end-to-end (2026-05-31); productionization pending.** The `cluster.work_transition` attribute is live in the deployed `mcp-connector` registry. A real transition was extracted by BYOK vision over the 1977 K5 teardown pair (work_sessions 2021-07-23 → 2021-08-21: interior teardown → surface-prep + structural rust perforation discovered), submitted through `submit_attribute_value`, and read back from `projection_event` with full provenance (id `0c13fde2-27d9-42f9-8256-d94d030de375`, caller `claude-opus-4-8-via-byok`, base_trust 0.30). What remains: cluster/work_session discovery in `find_subjects_needing_atoms`, a reliable session→photo resolver (`work_session_id` is unpopulated — see caveat below), broader state coverage, and owner-confirmation wiring before value reaches the ledger. The part-level (dT fine) tier is still unbuilt.

## The insight this is named after

In 1959, Hubel and Wiesel pushed a microelectrode into the visual cortex of an anesthetized cat and flashed dots on slides, expecting the neuron to fire at the dot. It barely responded. Then, while *swapping a glass slide* through the projector, the cell fired hard — it was responding not to the intended dot but to the moving shadow-edge of the slide sweeping across its receptive field at a particular orientation. That accident is the origin of orientation-selective simple cells, and the lineage runs straight to the Gabor-like edge filters in the first convolutional layer of every CNN (Fukushima's Neocognitron → LeCun → AlexNet).

The half everyone keeps is the *spatial* edge filter. The half we dropped is the rest of what that cell was actually tuned to: **a moving oriented edge — a change over time.** The signal was never in the static stimulus. It was in the transition.

## Why this matters for Nuke specifically

Our photo cascade today is a **dot detector.** One frame → butterfly node → ~20 atoms. Every atom describes a *state*: this panel is bare metal, this diff cover has surface rust, this assembly is partial. (See Chapter 18, `state_observations`.)

But labor never lives in a single frame. "Rusty diff cover" and "painted diff cover" are both just states. The **work** — the economically real thing — is the transition between them. That transition is the dT. The system currently cannot see it, because it treats every photo as an independent forensic specimen with no link to any other photo.

This is the same failure mode behind the $410-for-a-text-to-dad incident (see `feedback_photo_intent_must_be_confirmed_not_assumed`): we read value off a static frame instead of off a confirmed transition. dT ingestion is the structural fix — value should accrue from *observed change*, gated by owner confirmation, not from the existence of a pixel.

## Current state of the substrate (measured 2026-05-31, live DB)

| Capability | State | Evidence (measured) |
|---|---|---|
| Per-image state observations (rust_severity, paint_state, completeness) | ✅ live | `scripts/deep-image-analysis-byok.mjs` schema; lands in `ai_scan_metadata.deep_analysis` |
| Per-image build_phase_guess (teardown…show_finish) | ✅ live | same schema; **independent per photo, no comparison** |
| Chronological ordering | ✅ live | `build-day.mjs` sorts by `taken_at`; `vision-loop-daemon.mjs` chronological mode |
| Camera pose / angle | ⚠️ partial | `image_angle_observations` = **27,973 rows**; `image_pose_observations` = 58 (sparse); `angle_taxonomy` = 24. Plus a 3D subject-localization layer: `image_coordinate_observations` (79,424 rows), `image_subject_analysis`, `canonical_camera_positions`, `image_camera_position`. Populated, but not consumed for identity. |
| CLIP visual embedding | ⚠️ dormant | `image_observations.embedding_clip_vitb32` column **exists**, but only **335 / 2,593** rows populated (13%). **pgvector not installed** → no similarity search. |
| Same-subject linkage across photos | ⚠️ schema exists, dormant | hooks present — `image_observations.cluster_id`, `image_coordinate_observations.subject_id`/`subject_key` — but only **~12–14 subjects** linked across >1 image. Effectively unused. |
| Per-image subject flag + bbox | ✅ live | `image_observations.is_high_confidence_subject` = 1,100; `bbox`, `role`, `visual_signature` columns present |
| **Delta / state-transition between two photos** | ❌ **none** | no `image_state_transitions` table, no diff RPC, nothing consumes the above to compute change |

**Corrected verdict (supersedes the first-pass file audit):** the receptive field is **not** a green field and **not** done — its schema (`cluster_id`, `subject_key`, `embedding_clip_vitb32`, the coordinate/pose layer) **already exists and sits dormant.** What's missing is *population and operation*: embeddings on 87% of subjects, a similarity index (pgvector), and a linker that writes `cluster_id`/`subject_key` to thread one physical subject across its photos. The dT *operator* is genuinely absent. Per the library's exists-but-incomplete → complete-it rule, requirement 1 is a **completion**, not a build.

### The receptive field is two-tier — and the top tier is already the labor ledger

Two distinct "session" concepts exist, and only one is the labor substrate:

- `image_sets` (1,866 rows, 22,090 members) is a **photo auto-session** layer. It *does* carry `predecessor_session_id`/`successor_session_id`, but only ~10 rows are actually chained, and those chains are `road_trip_driving` / `casual_lifestyle` / `walkaround` bursts — **not shop work.** A red herring for labor.
- `work_sessions` (the labor ledger — *"work story lives in work_sessions"*) is the real unit: 34 sessions on the 1977 K5 alone, with `session_date`, `zones_touched`, even `stages_observed`/`stage_transitions` columns. It has **no** predecessor/successor columns — and needs none: **consecutive sessions = `ORDER BY session_date` per `vehicle_id`.** The ordering *is* the chain.

  ⚠️ **Linkage caveat (measured 2026-05-31):** the `vehicle_images.work_session_id` FK column exists but is **unpopulated** (0 of 2,686 images on the 1977 K5). In practice a session's photos are recovered by `taken_at` window (`vehicle_images.taken_at BETWEEN work_sessions.start_time AND end_time` for the same `vehicle_id`), which is how the auto-sessions were formed. And per-image `byok_deep_analysis.state_observations` is **sparse** (8 of 2,686 on this vehicle) — so the dT operator cannot rely on pre-computed state atoms; it must either run `deep-image-analysis-byok.mjs` on the pair first, or read the photos directly (the authentic BYOK path). Operationalizing the session tier therefore still requires (a) a reliable session→photo resolver and (b) state coverage — neither is a new table, both are population/wiring.

So the receptive field has two tiers:

| Tier | Unit | State | dT meaning |
|---|---|---|---|
| **Session** (coarse) | a `work_sessions` row (a day's work) | ✅ **built + populated**; chain = ORDER BY session_date | "what changed between this session and the prior one for this vehicle" — the pairing is a trivial date sort |
| **Part** (fine) | a physical subject across frames | ⚠️ schema ready, **empty** (`image_identities`/`image_appearances` = 0, `phash_distance`/`embedding` columns waiting) | "this specific diff cover, rusty → painted" — needs the embedding backfill + linker |

**This collapses the hard problem.** The dT operator's first, highest-value form does **not** need part-level re-ID at all — it diffs the `state_observations` of one `work_sessions` row against the prior session by date. Part-level identity (`image_identities`) is a later refinement for sub-session granularity, not a blocker. Requirement 1 at the session tier is *done*; what's missing is purely the **operator** (requirements 3–4) reading across an already-ordered session pair. This is exposed as the `cluster.work_transition` attribute in the laser-tag checklist (`subject_kind="cluster"`, `subject_id` = the later `work_session.id`).

## What we need — in dependency order

Each requirement is gated by the one above it. Building 3 before 1 produces confident garbage.

### 1. A stable receptive field (same-subject persistence) — THE HARD PART

The cat's eye was fixed; anatomy handed it clean registration and the edge moved across a stationary field. **We have none of that.** Our photos are handheld, different days, different angles, different parts in frame. Before any delta is meaningful we must be able to assert: *this is the same diff cover, roughly the same view, two points in time.*

This is part-identity persistence across frames. The schema exists but is dormant — so this is a **completion, do it first.** Everything downstream is worthless without it. Concrete steps, all on existing columns (no new tables):

1. **Backfill `image_observations.embedding_clip_vitb32`** — currently 335/2,593. Embed the rest (BYOK CLIP, $0).
2. **Install pgvector + an ANN index** on that column so "nearest images to this subject" is a query, not a scan. Today there is no similarity search at all.
3. **Write the linker** — for each subject (bbox-cropped region), find nearest neighbors by CLIP distance, gated by `image_angle_observations` angle_id + the `image_coordinate_observations` 3D pose, and write the result into the existing `cluster_id` / `subject_key` columns. That *is* the subject track — it already has a home; it's just empty (~12–14 subjects today).

### 2. Registration to cancel nuisance variation

Even with the same part identified, a naive pixel diff is dominated by camera pose and lighting, not state change. Normalize pose/light so the delta is signal, not parallax. This is exactly why verdicts already carry structured `camera_pose` (azimuth/elevation/distance/FOV/focal/exif_present/method — see `feedback_camera_pose_precision_over_3_4_view`) — that field is the input this stage consumes.

### 3. A difference operator in semantic space, not pixel space

The cat fired on a *structured* feature changing (oriented edge), not raw luminance. Our dT operator must run in embedding/feature space and emit **semantic transitions** — "primer applied," "bolt removed," "panel gap closed" — never a pixel diff. Implementation: diff the `state_observations` of two registered frames of the same subject, plus an embedding delta to catch what the enum doesn't name.

### 4. Transition atoms with source DNA

A delta is not a number; it is `(subject, state_before, state_after, observed_between t1…t2, method, trust)`. Same rule as every other atom — bare deltas are a schema failure (see `feedback_numbers_carry_source_dna`). Proposed: `image_state_transitions` table, written via `ingest-observation` (never a raw INSERT — see `feedback_agent_under_skylar_writes_through_ingest_observation`).

### 5. The confirmation gate stays

dT is a **hypothesis generator, never a value assertion.** The operator proposes "labor happened here between these two photos"; the owner confirms intent before value accrues to the `work_sessions` ledger. The transition makes the proposal sharper — it does not earn the right to skip the gate.

## Where it dies if we're careless

The cat had registration handed to it by anatomy. We don't. If requirement 1 (same-subject persistence) isn't solved first, requirements 3–5 produce confident garbage — every relit, reangled photo reads as a "transition," and we re-create the $410 bug at scale. **We do not have a pipeline problem. We have a tracking problem wearing a neuroscience costume.** Build the receptive field, prove it threads the same part through a day's photos, *then* the dT operator is nearly free on top of the embeddings and `state_observations` we already compute.

## Intellectual lineage

- **Hubel & Wiesel (1959)** — orientation-selective cells; the dropped temporal half.
- **Motion-energy models (Adelson & Bergen, 1985)** — formalize "change over time at an oriented feature" as a computable filter.
- **Two-stream / video networks (Simonyan & Zisserman, 2014)** — the modern split: a spatial (appearance) stream + a temporal (motion) stream. We've only built the spatial stream.
- **Attention (Vaswani et al., 2017, incl. Llion Jones)** — relevant to requirement 1: attention over a *sequence* of a subject's frames is the natural mechanism for "which earlier frame is the same part as this one," i.e. learned registration instead of hand-tuned pose matching.

### Bibliography (web-verified)

1. **[hubel-wiesel-1959]** D. H. Hubel, T. N. Wiesel (1959). *Receptive fields of single neurones in the cat's striate cortex*. The Journal of Physiology, 148(3), 574-591. https://doi.org/10.1113/jphysiol.1959.sp006308
2. **[fukushima-1980-neocognitron]** Kunihiko Fukushima (1980). *Neocognitron: A self-organizing neural network model for a mechanism of pattern recognition unaffected by shift in position*. Biological Cybernetics, 36(4), 193-202. https://doi.org/10.1007/BF00344251
3. **[lecun-1989-backprop]** Y. LeCun, B. Boser, J. S. Denker, et al. (1989). *Backpropagation Applied to Handwritten Zip Code Recognition*. Neural Computation, 1(4), 541-551. https://doi.org/10.1162/neco.1989.1.4.541
4. **[krizhevsky-2012-alexnet]** A. Krizhevsky, I. Sutskever, G. E. Hinton (2012). *ImageNet Classification with Deep Convolutional Neural Networks*. NeurIPS 25. https://papers.nips.cc/paper/4824-imagenet-classification-with-deep-convolutional-neural-networks
5. **[adelson-bergen-1985]** E. H. Adelson, J. R. Bergen (1985). *Spatiotemporal energy models for the perception of motion*. Journal of the Optical Society of America A, 2(2), 284-299. https://doi.org/10.1364/JOSAA.2.000284
6. **[simonyan-zisserman-2014-twostream]** K. Simonyan, A. Zisserman (2014). *Two-Stream Convolutional Networks for Action Recognition in Videos*. NeurIPS 27, arXiv:1406.2199. https://arxiv.org/abs/1406.2199
7. **[vaswani-2017-attention]** A. Vaswani, N. Shazeer, N. Parmar, J. Uszkoreit, L. Jones, A. N. Gomez, Ł. Kaiser, I. Polosukhin (2017). *Attention Is All You Need*. NeurIPS 30, arXiv:1706.03762. https://arxiv.org/abs/1706.03762
8. **[dosovitskiy-2020-vit]** A. Dosovitskiy, L. Beyer, A. Kolesnikov, et al. (2020). *An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale*. ICLR 2021, arXiv:2010.11929. https://arxiv.org/abs/2010.11929

*These eight are canonical, high-citation works; metadata is stable. Treat any future additions to this chapter under the same "verified-or-excluded" rule used across the library.*
