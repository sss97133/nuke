# Image keys: the consistency test

The owner, 2026-11-10: "The obvious problem of being able to write the data model side is if it writes too much and
wrong and new every time." And of what it takes: "a certain degree of intelligence and most importantly
consistency." This file measures that for the keys role (`skills/image-keys/SKILL.md`).

## What is tested

The same statements and the same registry snapshot are given to several independent runs of the brief.

- **No memory.** `decisions so far` is empty. Measured: on how many statements all runs name the same part, the
  same state, and both; how many part keys each run drafts; how many distinct keys the runs draft between them.
- **With decisions.** Every run is given the decisions the first run returned. Measured again.

A run fails outright if it drops a statement, stretches a key onto a statement no key is true of, or contradicts
a decision it was given.

The input of 2026-11-10 was one vehicle's capture day (`7176a5fc-24ae-4b42-9e65-0b96c4f9e50c`, the first vehicle
measured that day): 30 damage callouts and 22 part labels from a deep reading already paid for, with the registry
as read from production that day (three photo properties with their values, 106 `subject_taxonomy` keys, the
usable `condition_taxonomy` keys, three assemblies with their states). The statements are the owner's data and are
not in the repository.

## The same fold done by hand first

Before any agent ran, the lead folded the 30 callouts by hand. Thirteen claims came out. The part and condition
columns say whether the model had a key that is true of the claim on 2026-11-10.

| What the photos show | Photos | Part key | Condition key |
|---|---|---|---|
| Hood in red oxide primer, awaiting paint | 13 | none (no hood) | `image_visible_paint_stage` = primer, but it is a property of a photo, not of a part |
| Body in white sealer, awaiting paint | 1 and more | `vehicle` | sealer, with the same limit |
| Surface-rust flecks at the upper cab seam | 1 | none | `exterior.metal.surface_oxidation` |
| Rust bleed at a bedside molding stud | 1 | nearest is `trim.quarter.*`, which is not true of a bed side | `exterior.metal.surface_oxidation` |
| Rust bleed at the bed top-rail seam | 1 | none (no bed) | `exterior.metal.surface_oxidation` |
| Rust speckle along the rear-quarter reveal | 1 | `trim.quarter.*`, side not said | `exterior.metal.surface_oxidation` |
| Surface rust on the brake booster and brackets | 1 | nearest is `fluid.brake.reservoir`, not true | `exterior.metal.surface_oxidation` |
| Rust and grime on the inner fender and firewall | 1 | `engine.bay` | `exterior.metal.surface_oxidation` |
| Engine bay aged against a fresh exterior | 1 | `engine.bay` | none |
| Door-jamb label torn at its top edge | 1 | `document.vin.door` | none |
| Crazing on a red enamel emblem | 1 | `badge.emblem.*`, front or rear not said | `exterior.paint.oxidation` |
| Orange-peel, speckled sealer texture | 3 | `detail.texture` | none |
| Matte sealer on the bedside and tailgate top | 2 | none (no tailgate) | sealer, with the same limit |

Three of the thirteen have both a part key and a condition key that are true of them. Thirteen photos of one
primered hood are one claim, and before the fold they were thirteen sentences in thirteen places.

## Results, 2026-11-10 21:14 to 21:51 UTC

52 statements (30 callouts, 22 part labels). Every run accounted for every statement.

| | Runs | Same part | Same state | Same on both | New part keys drafted, per run | Distinct across the runs | Drafted by every run |
|---|---|---|---|---|---|---|---|
| No memory | 3 | 34 of 52 | 39 of 52 | 29 of 52 | 16, 18, 21 | 30 | 11 |
| Given the first run's decisions | 2 | 51 of 52 | 51 of 52 | 50 of 52 | 18, 18 | 18 | 18 |

New state and condition keys went the same way: 10 distinct across the three no-memory runs with 3 drafted by all,
then 8 distinct with 7 drafted by both.

What the runs did:

- With no memory, all three folded the thirteen primer-hood statements into one claim, on the same drafted part key
  and `image_visible_paint_stage` = primer. The fold is not where they differ.
- With no memory they named the same new thing differently: `engine.fender.inner` and `engine.bay.fender.inner`;
  `exterior.cab.bed.gap` and `exterior.gap.cab.bed`; `exterior.surface.dust` and `exterior.surface.soiling`. One run
  drafted a key for the door-jamb label where another used the existing `document.vin.door`.
- Given the decisions, every claim's part in both runs came from a decision it had been handed (46 of 46 and 45 of
  45). The two statements that still differ do not differ on a key: one run also returned a "seen" claim beside a
  wheel's state, and one also listed a statement under `not_a_claim`.

What this shows: the stored decisions carry the consistency, not the agent. An agent without them writes the model
"new every time", which is the owner's worry, measured; the same agent with them does not.

What it does not show:

- That the keys are right. The decisions handed to the second half were one run's unreviewed drafts. Agreement is
  not correctness; whether a drafted key is the right one is a curator's and the owner's call.
- Anything beyond one vehicle's capture day, one family of model for every run, and two runs in the second half
  (the third was still running when this was written).
- The trap case. No statement was planted that no key is true of, so "never stretch" was not tested.

Next rounds: the proof vehicle's statements; a planted trap; decisions that a person has approved; a cheaper
model given the same decisions.
