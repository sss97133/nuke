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

## Results, 2026-11-10 21:14 to 21:56 UTC

52 statements (30 callouts, 22 part labels). Every run accounted for every statement.

| | Runs | Same part | Same state | Same on both | New part keys drafted, per run | Distinct across the runs | Drafted by every run |
|---|---|---|---|---|---|---|---|
| No memory | 3 | 34 of 52 | 34 of 52 | 29 of 52 | 18, 16, 21 | 30 | 11 |
| Given the first run's decisions | 3 | 50 of 52 | 49 of 52 | 49 of 52 | 18, 18, 18 | 18 | 18 |

A statement counts as the same only when every run returned the same set of claims for it; a run that also listed
it under `not_a_claim`, or returned one claim more, counts as different. New state and condition keys went the same
way: 10 distinct across the three no-memory runs, 3 of them drafted by all.

What the runs did:

- With no memory, all three folded the thirteen primer-hood statements into one claim, on the same drafted part key
  and `image_visible_paint_stage` = primer. The fold is not where they differ.
- With no memory they named the same new thing differently: `engine.fender.inner` and `engine.bay.fender.inner`;
  `exterior.cab.bed.gap` and `exterior.gap.cab.bed`; `exterior.surface.dust` and `exterior.surface.soiling`. One run
  drafted a key for the door-jamb label where another used the existing `document.vin.door`.
- Given the decisions, all three runs drafted the same 18 part keys. The three statements that still differ do
  not differ on a key: twice one run also listed a statement under `not_a_claim`, and once one run also returned a
  "seen" claim beside a wheel's state.

What this shows: the stored decisions carry the consistency, not the agent. An agent without them writes the model
"new every time", which is the owner's worry, measured; the same agent with them does not.

What it does not show:

- That the keys are right. The decisions handed to the second half were one run's unreviewed drafts. Agreement is
  not correctness; whether a drafted key is the right one is a curator's and the owner's call.
- Anything beyond one vehicle's capture day and one family of model for every run.
- The trap case. No statement was planted that no key is true of, so "never stretch" was not tested.

Next rounds: the proof vehicle's statements; a planted trap; decisions that a person has approved; a cheaper
model given the same decisions.

## One photo at a time, then the whole proof vehicle: dry run, 2026-11-10 22:48 to 23:50 UTC

The owner, the same day: "the best type of batch is one at a time, unfortunately and then figuring out how to speed
things up beyond one at a time ... if they can't do one, they definitely can't do [many] ... the thing kind of
changes when you have to analyze batch contextual information but that's like a different approach a different
harness." This round tests that on the proof vehicle (`20d21fb0-4651-4469-a0ba-e751309a1e54`), with the harness in
[`scripts/photo-pipeline/keys-dry-run/`](../../../scripts/photo-pipeline/keys-dry-run/README.md). Everything below is a
count over that run's files, not over database rows: the run read stored readings (at 22:48 UTC: 444 owner photos
with a deep reading, 433 of them carrying 1,157 statements; 488 witnessed observations with no key on any) and wrote
nothing back.

**What failed first.** One agent was handed 119 statements and 115 receipt lines at once. It ran 21 minutes, hit its
output limit and produced nothing.

**One photo.** One agent, one photo (two statements), the registry and the earlier vehicle's drafted keys: 17 seconds,
and the result passed the code check (`check_units.py`: every statement accounted for once; the quoted words are in
the reading; an existing key is in the registry; a drafted key follows the pattern and has a proposal; a value is on
its list). It drafted a part key where none was true and did not borrow a neighbour.

**One at a time against a batch, the same photos.**

| | Photos passing the code check | Agree on claim or no claim | Where both made a claim: identical | Drafted part keys used |
|---|---|---|---|---|
| No shared decisions, 15 photos, 46 statements: one at a time | 14 of 15 | 45 of 46 | 11 of 32 | 18 claims |
| the same, one batch | 15 of 15 | | | 9 claims |
| Given the first batch's decisions, 15 other photos, 43 statements: one at a time | 15 of 15 | 41 of 43 | 21 of 27 | 3 claims |
| the same, one batch | 15 of 15 | | | 4 claims |

The one rejected photo carried a drafted key outside the registry's pattern; the check refused it. One photo took
about 20 seconds and about 90,000 tokens, nearly all of it re-reading the brief, the registry and the decisions; a
batch of 15 photos took about 3 to 4 minutes and about 8,000 tokens a photo.

What this shows: the unit works alone. What makes units agree is the shared decisions, not the batch: identical
keying went from 11 of 32 to 21 of 27 when both sides were given them. A batch is then a way to pay for the shared
context once, and it is safe only with the same check on every photo. The faster form of one at a time is to keep
the brief, the registry and the decisions as a fixed, cached prefix and send one photo after it.

**The whole vehicle.** 30 batches of about 15 photos, each bound by the first batch's decisions (122 part decisions,
49 state decisions, 24 conventions, kept as `decisions.pending.2026-11-10.json`); 28 of them ran in about nine
minutes.

| Measure | Count |
|---|---|
| Photos passing the code check | 433 of 433 |
| Statements accounted for exactly once | 1,157 of 1,157 |
| Statements with a claim / reader could not tell / question only | 724 / 425 / 8 |
| Claims | 958 |
| Part: a registry key / a registry key with the side not said | 384 / 105 |
| Part: a key drafted in this run's decisions / drafted in a batch / not named | 268 / 48 / 153 |
| State: a registered property value / a registry condition key / drafted | 118 / 462 / 378 |
| Claims the registry can hold today, part and state both | 304 of 958 |
| Folded claims (same part, side, state and capture day) / carried by two or more photos | 360 / 126 |
| Folded claims that are a flaw / parts they are on | 255 / 92 |

The largest things with no place: paint or coating loss and chips (145 claims), "no break or tear visible" (62),
glossy finish with the layers unknown (24), "no leak visible" (19). Colour has no property and was not keyed.

**The steps that need the whole set.** A reconciler read every name drafted in the parallel batches: 73 names became
55 by 17 merges and one removal, leaving 44 proposals (24 parts, 20 states). No part was merged. Receipt lines were
keyed with the same part vocabulary: 115 lines, no new key needed.

**Three skeptics, each told to refute when in doubt, 70 rows each.**

| Lens | Held | Refuted, and how |
|---|---|---|
| The part key | 61 of 70 | 6 too vague (a named part left unknown), 3 stretched (a host inferred for an unnamed small piece), 0 invented |
| The state | 61 of 70 | 5 said more than the reader did (a severity or a diagnosis not given), 4 borrowed across material (a body-panel key on upholstery), 0 hedges keyed as findings |
| Statements keyed as no claim | 54 of 70 | 16 dropped a real observation, about half borderline: a located mark whose cause alone was hedged, and "no perforation visible", which has no value in the registry |

**The three acceptance questions, in this vehicle's shape.** These are joins over the dry run's files and one live
store, shown to prove the method; none is a query the database can answer yet.

- *Replaced, with photographic proof.* `evidence_judgment_requests` already holds the question "is the part on this
  receipt line visible, installed, in a candidate frame" for this vehicle: 115 receipt items answered (31 visible and
  installed with a named photo, 8 visible only, 34 not visible, 42 cannot tell; 22:48 UTC). The model had already
  asked; no reader of those answers is in this record.
- *A specific imperfection.* 255 folded flaw claims on 92 parts, each with its photos.
- *That imperfection repaired.* 26 parts have both a flaw claim from a photo and a receipt line, joined only by the
  part key. One chain, by id: photo `7c257513-719d-4c9c-8587-48806f12a287` (2025-10-06) reads a torn headliner;
  receipt item `09515326-8cca-4e49-b9f5-9cdecd71f342` is a headliner board; four photos of 2026-10-28 read no tear,
  and the stored answer names photo `af015c1f-99e9-44ba-aa9c-b66eb52e4a87` as the board installed. Its limits are in
  the readings themselves: the board cannot be told from an original, and "no tear" is a drafted value.

**Limits.** One run, one vehicle, one family of model for keyer, reconciler and skeptics. The first batch's decisions
were made by an agent and are pending. A printed photo inside a receipt frame was keyed on the day the print was
photographed, not the day it shows. Nothing was landed: the keyed count in the database is still 0 of 488.
