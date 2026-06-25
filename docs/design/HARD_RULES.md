# HARD RULES — the non-negotiables (TRACKED, propagates to every worktree)

**Why this file exists:** every `CLAUDE.md` is gitignored repo-wide, so the rules in
`apps/nuke-capture-ios/CLAUDE.md` are worktree-local and do **not** reach a fresh
checkout or a cold agent. This file is committed — it is the cross-worktree channel for
the rules that, if violated, destroy trust or data. A 2026-06-25 cold-read audit proved a
fresh session walks into these traps; read this before touching capture / vision /
ingestion / the local store / the reciprocal-confirmation engine.

Each rule: the imperative, then where it bit us.

1. **Develop from what exists — never greenfield a parallel app/view.** Extend the named
   file in place. Greenfield parallel artifacts have lost every time (MECH_SUIT). Before
   "porting" something, grep this branch first — it may already be here (the EXIF reconcile
   was, despite the directive saying "not on this branch").

2. **Network-off done-test.** A local-first surface is DONE only when it renders with
   Airplane Mode ON, from the local store, calling zero network. No airplane-mode proof =
   not done. (`LocalStore.dayCounts()` exists but is unwired; the day receipt still reads
   the cloud RPC — the loop is NOT closed yet.)

3. **Facts sacred.** Never fabricate a vehicle / money / atom value. Missing field → skip
   the row, never a fake "—". Query prod for truth (Mustang `83f6f033-a3c3-4cf4-a85e-a60d2c588838`,
   K5 `e08bf694-970f-4cbe-8a74-8715158a0f2e`, Skylar `0b9f107a-d124-49de-9ded-94698f63c1c4`).

4. **No fabricated OR mixed data in any surface** — even a mockup/jig is held to production
   data integrity. Never cross-associate one vehicle's data with another's. Contamination,
   not taste, is what gets a surface rejected.

5. **Supersede, never overwrite.** Every value is an append-only claim carrying
   `(source, method, trust, confidence, observed_at)`. Never `UPDATE`/`REPLACE` a fact in
   place; never `NULL` a prior verdict in a migration; write a new, higher-trust claim and
   let consensus weigh it. In `LocalStore`, three writers own **disjoint** columns
   (`ingest()`=EXIF/identity, `classify()`=auto verdict, `setOwnerVerdict()`=owner verdict);
   any new writer uses `ON CONFLICT DO UPDATE SET` on its OWN columns — never `.replace`.

6. **Source images only; stored images immutable.** Analysis reads the **raw source**
   object / on-device `PHAsset`, NEVER `large_url`/`medium_url`/render transforms, NEVER the
   DB's processed image as a shortcut. Never overwrite, re-encode, delete, or replace a
   stored image/render, and never mutate a `vehicle_images` row's pixels/paths. On device,
   never storage-re-download (egress) — read the local Photos library. Corrections are new
   claims/observations, not edits to the stored artifact.

7. **EXIF is the only trusted capture time.** Use the file's `DateTimeOriginal`. Never
   present `PHAsset.creationDate` as an authoritative "Taken" — it is the re-add date and
   has been proven ~6 months wrong (file 2019-04-29 vs stored 2019-10-25). `dayCounts()`
   correctly groups by `appearance.takenAt`; the info-sheet "Taken" row currently does not —
   source it from the EXIF ledger, fall back to `creationDate` only tagged "(device, unverified)".

8. **Owner-gated writes only.** Canonical/testimony writes go through SECURITY DEFINER RPCs
   (`record_owner_contribution`, `confirm_photo_intent`, `ingest_image_identity_first`) —
   never raw `INSERT`/`UPDATE` into testimony tables. The owner verdict (the Select tool) is
   the top of the trust hierarchy: never auto-clobbered, never blanket-reset in a migration.

9. **Two distinct predicates — do not merge.** BLUR/hide a library cell:
   `isPersonal = (prominentFace && !isVehicle)` (a vehicle photo with a face is SHOWN).
   UPLOAD pixels: `pixelsEligible = (isVehicle && !prominentFace)` (a vehicle photo with a
   face is HELD from auto-upload and routed to the Select tool). `classifyAsset()` fails
   OPEN (grid only, owner's eyes); the upload firewall is `contributorVerdict()`, fails
   CLOSED. Changing either predicate requires re-reading both.

10. **No bulk / cross-vehicle binding.** A photo binds to a vehicle only via the
    confirmed-membership gate (VIN-OCR definitive > confirmed work-session > album-as-prior,
    overridable by content). Never "recent camera roll = this build" (recent unalbumed ≈ the
    whole shop, ~20% the target). Owner-confirmed is the only ground truth.

11. **The old-hard-push resolution is ADDITIVE ONLY and owner-gated.** To reconcile old
    "hard-pushed" canonical DB values with the new measurement layer: ingest GPS / time /
    interval as **measurement-class claims** AND demote the old canonical values to claims
    carrying their true (often low) provenance — then the existing consensus
    (`project_attribute`, `nuke_evidence_weight`, `field_evidence`) weighs them. NEVER a
    destructive migration that "picks a side", never `DELETE`/overwrite. Surface conflicts
    drillable. (This is the OPEN next direction — un-ratified by Skylar; spec, don't build,
    until he says go.)
