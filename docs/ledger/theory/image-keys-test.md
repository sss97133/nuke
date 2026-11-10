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

## Results

Round 1 started 2026-11-10 21:14 UTC. Its numbers are added here when it finishes.
