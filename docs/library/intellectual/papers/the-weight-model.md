# The Weight Model — Tuning Points for the Volumetric Analysis Instrument

> **Status:** theory paper, authored 2026-07-11 from the owner's dictated framing
> ("how do we weight the scalar field? that is something we should be able to look
> at — that's a tuning point"). Per the owner's mandate the same day: *"you have to
> start taking over and defining the theory and the programmatic shape and size of
> that. You can just start building that right now even off of theory."* Theory →
> prototype → production is the sanctioned path here (the xyz-anchor paper went
> theory 2026-05-24 → prod migration 2026-07-02).
>
> **Prerequisites:** `novel-ontological-contributions.md` §I (spatial condition
> ontology), `2026-05-24_substrate_xyz-spatial-anchor-design.md` (the field),
> `design-book/18-deep-image-analysis.md` (depth ladder), `technical/
> work-order-intelligence.md` (labor_operations flat-rate book),
> `working/2026-07-11_sighting-ledger-schema-proposal.md` (sightings + organism
> metrics), `contemplations/testimony-and-half-lives.md`.

---

## 1. The problem this paper solves

The condition of a vehicle is a scalar field over its body, sampled by
photographs (the volumetric axiom). But raw samples are not the field: every
sample must be **weighted** before it composes, and today those weights are
implicit — buried in prompts, hardcoded bumps, and vibes. The owner's diagnosis:
image analysis is the backbone, *and* it is impossible for an agent to tell if
it's working, because the tuning points are not observable. This paper makes the
weight structure explicit, inspectable, and tunable — the precondition for
measuring accuracy, running ensembles, and repairing the instrument without
prompt surgery.

## 2. The four weight classes (never collapse them)

The corpus rule "a value axis and a depth axis must never be unified into one
number" (design-book 18 §C) generalizes: there are FOUR weight classes, each
answering a different question, each with its own inputs and its own update
loop. Conflating any two reproduces the historical four-disagreeing-markers
wound at the weighting layer.

### W1 — Sample weight: how much does THIS photo move the field HERE?

Inputs, per sighting (photo × coordinate):
- **vantage_fit** — from the angle-spectrum filter (§I.D): can this camera pose
  even see this zone/coordinate? A claim about a zone the vantage cannot see has
  vantage_fit = 0 regardless of model confidence.
- **observer_trust** — W3 of whoever shot it (owner ≠ passerby ≠ scraped listing).
- **environment_quality** — lighting, distance, motion; from workshop_signals +
  camera_pose.
- **pixel_basis** — did the pixels show the fact (OCR/visible) or did context
  supply it (dossier/prior)? Pixels ≫ context; context-only claims are priors,
  not observations (the 2026-07-11 insulation-board incident is the type case).
- **burst_redundancy** — the Nth near-duplicate frame of a burst adds sub-linear
  weight (√N, not N). A burst is ONE look from one vantage, not N witnesses.

v1 accuracy bar (owner, verbatim intent): for a '77 Blazer frame photo, the
first success is *any* semi-accurate low-confidence (x,y,z) localization of the
frame on the vehicle's coordinate frame. Coarse-with-honest-ε beats
precise-fiction; the fractal-resolution ladder exists exactly so precision can
scale with confidence.

### W2 — Claim weight: what kind of evidence backs this assertion?

The evidence-basis hierarchy, with the first measured calibration points
(2026-07-11 K5 audit):

| Basis | Weight class | Measured survival |
|---|---|---|
| Paper + pixels (receipt PN read in-frame, ocr_text) | highest | — |
| Paper-anchored (roster PN on visible part) | high | 100% (0 failures) |
| Cross-library corroboration (part photographed alone in adjacent timeframe; adjacent technician's / parts-manager's library) | high, multiplies per independent chain | — |
| Cross-frame inference (state-delta across a day) | medium | — |
| Prose/prior-anchored (dossier echo, earlier verdict text) | LOW — capped below citation-backed | 2 failures @ stated 0.7–0.75 |

Rule extracted from the incident: **prior verdicts are priors, never
observations.** A claim inherited from context must carry a lower ceiling than a
claim the pixels independently support, and the sanitizer/validator should
enforce the ceiling structurally.

**Second adjudication harvest (same day — the 8-agent adversarial audit,
wf_08c427aa-2d3):** accounting layer 0 failures (12/12 PNs traced to real
receipts across 877 component rows); narrative layer 2 over-closures (trans
"mated" vs staged) + 1 template bleed (paint_state='aged' stamped 7/7 on a fresh
build — a copy-through prior, not an observation); **geometry layer 7/7 failed**
(bboxes wrong in per-frame-inconsistent encodings). Weight-model readings: (a)
the claim hierarchy held again — paper-anchored 0 failures, prose/template
claims failed; (b) GEOMETRY is its own weight lane below all semantic lanes and
currently near zero until the annotate/teacher pass is wired (engineering-manual
18) — W1 sample weights must include a geometry_trust term, and xyz projection
must gate on it; (c) subject-level state fields (paint_state) need a
subject-vs-background disambiguation rule before they may feed the condition
field.

Corroboration chains ("how do you know the parts are new?"): receipt +
part-alone-photo + install-photo + technician's-library echo = independent
chains that MULTIPLY. One chain = plausible; three chains = deposition-grade.
And each resolved chain accrues to the ORGANIZATION's W3 ("that eventually
becomes a weight of the organization in charge of the build").

### W3 — Entity weight: the recursive trust of people and orgs

Technician / observer / organization trust is COMPUTED from evidence history,
then FED BACK as a prior on their future claims. Inputs:
- documentation density (do they photograph process, tools, receipts?)
- tool/equipment documentation (access + correct use, observed over time)
- outcome quality (condition field of their past work, sampled later — paint
  that still rates 90 at year 3 outweighs paint that rated 95 at week 1;
  half-life-aware)
- corroboration behavior (do their claims survive audit?)

**The craftsmanship→brand handoff (the Foose/Ringbrothers threshold):** at some
accumulation point a technician becomes an entity whose NAME adds value
independent of measured quality. This handoff is *empirically detectable in the
comps corpus we already hold*: fit name-attributed premium vs
quality-attributable premium on sold builds; the handoff is where the name term
dominates. Below it, W3 is craftsmanship-weighted; above it, market-weighted.
The system is supposed to KNOW where the handoff happened — it's a changepoint
in the entity's premium decomposition, not an editorial decision.

### W4 — Value priors: the diamond rule (floor / ceiling / name)

The vehicle's intrinsic value structure that condition modulates but cannot
escape:

```
value = max( floor,  condition_factor(field) × platform_ceiling ) × name_multiplier
  floor            = documented parts/materials value (exists: documented_investment_floor)
  platform_ceiling = comps corpus for the platform (exists: bat_listings et al.)
  condition_factor = the weighted volumetric field, integrated over the body
  name_multiplier  = W3 brand term (≈1.0 below the handoff)
```

- Condition ASYMPTOTES to the ceiling: no polish makes a '77 Blazer transcend
  what '77 Blazers cap at.
- Parts/materials value adds as a FLOOR regardless of platform: the
  gold-and-diamonds car is worth its gold even with zero platform premium.
- The name term shifts the curve itself (post-handoff entities).
- "What outweighs what" = which regime the vehicle is in; the system should
  report the ACTIVE regime alongside every valuation.

## 3. Image groups are the observation unit (and a tunable)

Condition is not read from single photos: "the observable condition is more like
a set of photos that can accurately drill down the condition observation." A
GROUP (burst × vantage-sweep × subject continuity) is one observation event; its
members are correlated, not independent witnesses (W1 burst rule).

Group formation parameters — time-gap, GPS radius, visual similarity, subject
continuity — are today manually tunable by the user. That is not the long-term
answer, but it IS the training set: **every manual regroup is a labeled example
of what a group should be.** The agent learns the grouping parameters from the
correction stream; the manual UI is the labeling instrument, not a stopgap to
delete.

## 4. The tuning registry — weights as rows, not constants

The programmatic shape. Every weight above becomes DATA:

```
analysis_weight_configs (
  id, version, created_at, created_by,
  weights jsonb,          -- {w1:{vantage_fit:..,burst_alpha:..}, w2:{basis_caps:..},
                          --  w3:{doc_density:..,halflife:..}, w4:{regime_blend:..}}
  notes text
)
-- every analysis run / composition pass stamps: weight_config_id
-- every adjudication lands as a labeled row:
analysis_adjudications (
  id, subject_kind,       -- claim | grouping | localization | valuation
  subject_ref,            -- the claim/sighting/group being judged
  verdict,                -- upheld | overturned | adjusted
  adjudicator,            -- owner | auditor-agent | market(comps)
  stated_confidence, correct, observed_at
)
```

This is what "tuning points we should be able to look at" means concretely: the
weight function is inspectable per-version, every output is traceable to the
config that produced it, and calibration is a query (stated confidence vs
adjudicated correctness, grouped by basis/config).

## 5. The ensemble loop (how models compete)

Once weights are rows: run the SAME corpus under multiple configs ("different
agents running analysis based on different tuning positions"), score each
against the shared adjudication set on the organism metrics —
reconciliation, consistency, calibration — and promote the winner. Hard
constraint: **ensembles without a shared adjudication set are noise.**
Adjudications are the scarce fuel; the design must harvest every one
automatically (owner confirms, auditor catches, manual regroups, market
outcomes) into `analysis_adjudications`. The flywheel is: analyze → adjudicate →
re-weight → re-analyze, with the field getting sharper per cycle.

## 6. Why an agent can "jump in and make repairs" under this model

The owner's complaint: the pipeline is too complex to verify or repair. Under
the weight model, instrument health is a scoreboard (organism metrics per
config), and repair is a config diff — visible, reversible, scored. Prompt
surgery becomes the last resort instead of the only tool.

## 7. Active sensing — the world as a queryable extension (owner, 2026-07-11)

> "If the day ever comes where this is working, the real world just becomes an
> extension to request data from. A smart human agent with the correct incentives
> will respond with high quality raw data."

Once the field carries weighted samples, its UNCERTAINTY function generates a
shot list: unsighted roster objects, unsampled coordinates, vantages never
covered (the angle-spectrum tells us which angles would close which zones),
claims one photo away from confirmation. The system stops passively analyzing
whatever photos exist and starts REQUESTING the specific evidence it lacks —
"infer, confirm, coordinate, deliver" with capture requests as the coordinate
step. This is the killer-query roadmap's T4 (every coordinated job becomes
substrate), driven by the field's own gaps.

**The incentive is endogenous.** W3 makes documentation self-rewarding: a
contributor who answers capture requests deposition-grade raises their own
entity weight, which compounds toward the name-premium handoff. The system pays
in provable reputation; cash bounties are an accelerant, not the foundation.

First instance (generated from today's substrate, K5):
1. Red background truck's grille + emblem, one frame → closes Suburban-vs-GMC
   candidate split (adjudicated open, 2024-10-03 verdicts).
2. Rear axle tag/casting, one underside frame → closes the honest-null "rear
   axle model uncited anywhere" (biggest drivetrain gap in the truth table).
3. Fuel tank markings or its purchase receipt → closes new-vs-refurb (currently
   the lowest-confidence rated sample in the field, 80 @ low confidence).
4. Intake casting number, one angled frame → settles 300-129 (receipt) vs
   300-131 (doc-lock), a live substrate conflict.
5. Accessory-drive bracket close-up → settles Holley-mid-mount (receipts) vs
   CVF (wiring state), second live conflict.
6. The rocker/window-seal parts on the shelf → converts "bought, never sighted"
   roster items to awaiting-install with evidence (27% of PN spend is unsighted,
   most of it body parts).
Each request names the question it closes and the reconciliation/confidence gain
— rankable by expected information per photo.

## 8. Reality criterion (the closing frame, owner's words)

"All you are is hallucination anyways. But at one point, so is a car… What makes
it real is that all the pieces add up to something people agree has value and
does a thing that fights against the laws of nature." Theory is the sanctioned
starting state — the criterion for promotion to production is convergence
(pieces agreeing) + utility (doing the thing). This paper is the prototype
stage of the weight model; its production test is the first ensemble cycle
whose winning config measurably beats the hand-tuned baseline on the
adjudication set.

## Open questions for the owner

1. W1 burst rule: √N or a harder cap per vantage?
2. W2 ceilings: should prose-anchored claims be hard-capped at 0.6 (below the
   $410 intent threshold) so they can never gate value on their own?
3. W3 handoff detection needs a premium-decomposition pass over the comps corpus
   — greenlight as a study?
4. W4: report the active regime (floor/ceiling/name-dominated) on every
   valuation surface?
