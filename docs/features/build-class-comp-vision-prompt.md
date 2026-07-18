# Execution prompt — comp-vision build-class → class-stratified comps

_Ready-to-run prompt for the next steps of the build-class valuation unlock. Hand to a
fresh agent or a workflow. Grounded in live prod `qkgaybvrernstplzjaam` as of 2026-06-23._

---

**OBJECTIVE.** Unblock defensible build pricing: classify comp (scraped-listing) vehicles'
build class via BYOK vision over their listing photos, fold that into `nuke_build_class`,
then wire **class-stratified comps** so a built vehicle is priced against builds — not stock
— and the iOS "Not priced yet" block lifts. Pricing real assets: a wrong class mis-prices a
car, so every wiring step is gated on validation.

**WHY THIS IS THE GATE.** iOS `VehicleValuation.isThin` blocks the market price until
`comp_method == 'class_stratified'`. `nuke_build_class(uuid)` (live, migration 080000)
already classifies owner-documented builds correctly — the K5 → `documented_build` via
receipts+work, ignoring the lying `is_modified=false` — but returns `unknown` for scraped
comps (no docs, stub descriptions, no clean keywords). Comps carry **images, not docs**, so
vision is the only signal that can classify them. Until comps are classified, class-stratified
comps have nothing to stratify against.

**GROUNDING (verify each against live prod before relying on it — the repo is not prod).**
- Reference build to validate against: K5 `e08bf694-970f-4cbe-8a74-8715158a0f2e` (restomod).
- `nuke_build_class(uuid)` → `{build_class, confidence, source_dna}`; classes
  `documented_build | modified | stock | unknown`.
- `compute-vehicle-valuation` edge fn: `getBasePrice()` selects comps and sets `comp_method`;
  `getConditionMultiplier()` clamps condition to 1.0 (teardown-inclusive — a finished build
  scores "project"). 
- iOS block: `struct VehicleValuation.isThin` (`VehicleDetailView.swift`) — `guard comp_method
  == 'class_stratified' else { blocked }`.
- Observation system: `ingest-observation` → `vehicle_observations`; BYOK image pipeline
  (`process-photo-cascade` / `byok-image`); `vehicle_condition_scores` has
  `lifecycle_state` / `descriptor_summary` (sparse 373/18k, **no live writer**).

**STEPS — each gated; do not advance past a failing gate.**
1. **Vision build-class pass.** For comp vehicles in a target cohort (start: 1977 K5 Blazer),
   run BYOK vision over their listing photos → build_class (`stock|driver|restomod|project`)
   + confidence + the visual evidence (engine bay = swap? suspension, body/paint, interior).
   Land each as a `vehicle_observation` (kind `build_class`) via `ingest-observation` with
   full provenance — supersede, never overwrite. Reuse the existing BYOK pipeline; don't mint.
2. **Fold into `nuke_build_class`.** Consume the vision observation as a high-trust comp signal
   so a scraped restomod returns `modified`/`restomod`, not `unknown`. Keep the documented-
   investment path for owner cars. `unknown` only when neither fires.
3. **Validate the classifier BEFORE wiring to value.** Hand-check ~20 cohort comps against
   their actual photos. Gate: ≥90% agreement, else stop and report. Tune keywords/thresholds.
4. **Class-stratified comps.** In `getBasePrice`, when subject and ≥5 comps share a build
   class, select only class-matched comps and set `comp_method='class_stratified'`. Below the
   floor → leave blocked (honest). This flips iOS `isThin` → the price shows, defensibly.
5. **Validate end-to-end.** Re-run `compute-vehicle-valuation` for the K5: confirm
   `comp_method='class_stratified'` and a defensible price from restomod comps (NOT the stock
   median). Confirm a known stock cohort member still prices off stock comps. Report
   before/after numbers for the K5 + 2 contrast cases.

**HARD CONSTRAINTS (no mistakes — this prices Skylar's and everyone's assets).**
- NEVER wire an unvalidated classifier to value. Unknown / low-confidence stays **blocked**
  ("Not priced yet"), never guessed into a price. Empty signal = our intake gap, never a
  market verdict.
- Validate against the K5 (restomod) and ≥1 known stock car at every wiring step.
- BYOK vision only (caller owns compute; no Anthropic-spend framing). Run un-sandboxed /
  launchd if the Bash sandbox drops network.
- Testimony discipline: vision results land via `ingest-observation`; never raw INSERT,
  never overwrite — supersede.
- Don't mint: reuse the observation system, the BYOK pipeline, `nuke_build_class`. Check
  `TOOLS.md` before any new edge function; retire one to add one.
- Honest confidence + source DNA on every output. Mirror every prod change into a local
  migration (repo ≠ prod drift).

**DONE-TEST.** A built K5 shows a defensible market price from class-matched comps (not the
stock median), each comp drillable, with build_class + its visual evidence visible; stock and
unknown vehicles remain honestly handled (blocked, not guessed).
