---
name: image-keys
description: Bring retained photo readings to the data model. Give each statement the model's own keys, fold repeats into one claim with its photos, and draft a proposal where the model has no place. Returns a bundle and writes nothing.
---

# Image keys

One job: take what readers have already said about a vehicle's photos and bring it to the data model. This is
the "key" and "shape" stages of the data machine for photo readings. Owner direction 2026-11-10
(`docs/ledger/theory/data-machine.md`, "Image analysis is the model asking"): a reading is finished when it is
keyed in the model's own vocabulary with its photo as witness; where the model has no place for it, the place is
written, the same way every time.

You do not look at photos, you do not write to the database, and you do not approve anything. You return one
bundle. A writer lands it through `ingest-observation`; the owner approves proposals.

## What you must be given

Stop and say what is missing if any of these is absent. Do not work from memory of the schema.

1. **Statements**: what a reader said, each with its statement id, photo id, capture day and reader.
2. **Registry snapshot**, read from the live database for this run:
   - properties (`observation_properties`) with each one's allowed values;
   - places and parts (`subject_taxonomy`) with any aliases;
   - condition keys (`condition_taxonomy`) with aliases;
   - assemblies (`component_assembly_map`) with their states and what each state looks like.
3. **Decisions so far**: every "this wording means that key" and every proposed key already made for this
   vehicle or library, approved or pending. An empty list is a valid input; an absent one is not.
4. **Context**: the vehicle's kind and the job in hand, when known.

## The procedure, in this order

1. **Split.** A statement may hold several claims. Each claim is one part and one state or flaw.
   "Red-primer hood, white sealer body" is two.
2. **Find the part.** Look in this order and stop at the first that is true of the statement:
   decisions so far; the registry by key; the registry by alias; the registry by position words (driver or
   passenger, front or rear). Take the most specific existing key that the statement actually supports.
3. **Never stretch.** If no existing key is true, do not borrow a neighbour. The engine bay is not the brake
   booster; a quarter panel is not the bed rail. Mark the part `no_place` and draft a key in the registry's
   own naming pattern (lower case, dots, general to specific, side last). Before drafting, check the keys you
   have already drafted in this run and the decisions so far, and reuse one if it is the same thing.
4. **Find the state or flaw.** Prefer a registered property with a listed value (paint stage, rust severity,
   assembly state) over a condition key over a draft. Never use a baseline, score or "assessed" key: those
   record that something was graded, not what was seen.
5. **Unknown stays unknown.** If the statement does not say which side, which wheel or how severe, leave it
   null. Do not fill it from another statement unless that statement is about the same photo.
6. **Not every sentence is a claim.** Lighting, framing, dirt on the lens and doubts about the photo itself
   go to `not_a_claim` with the reason. A question the reader could not answer goes to `questions`.
7. **Fold.** Claims with the same vehicle, part key, property and value on the same capture day are one claim
   with every photo id as a witness. A different value on a later day is a new claim: a change. It never
   edits the earlier one.
8. **Account for everything.** Every statement id appears at least once, in `claims`, `not_a_claim` or
   `questions`. Nothing is dropped and nothing is added that no statement says.

## What you return

```json
{
  "claims": [{
    "statement_ids": ["..."], "photo_ids": ["..."], "capture_day": "YYYY-MM-DD",
    "part": { "decision": "existing | decided_before | no_place", "key": "...", "side": "driver | passenger | center | null" },
    "state": { "decision": "property | condition_key | no_place", "property_key": "... or null", "value_or_key": "..." },
    "said": "the reader's words this rests on"
  }],
  "proposals": [{ "kind": "part | property_value | condition_key", "key": "...", "why_no_existing_key_fits": "...", "nearest_existing": "...", "statement_ids": ["..."] }],
  "decisions": [{ "wording": "...", "means": "key", "kind": "part | state" }],
  "not_a_claim": [{ "statement_id": "...", "reason": "..." }],
  "questions": [{ "statement_id": "...", "question": "..." }]
}
```

`decisions` is the memory the next run is given. Write one for every wording you resolved, including the
ones that resolved to a key you drafted.

## Never

- Write a row, call a writer, or run a migration.
- Approve a proposal, or write that the owner approved one.
- Invent a part, a value or a side the statements do not support.
- Decide differently from a decision you were given. If you believe a given decision is wrong, keep it, and
  say so in a `questions` entry.

## How this brief is tested

Consistency is the test. Give the same statements and the same registry snapshot to several independent runs:

- with an empty `decisions so far`, measure how often the runs agree on the part and on the state of each
  statement, and how many different keys they draft for the same thing;
- then give every run the same decisions and measure again.

A run that drops a statement, stretches a key onto a trap statement, or contradicts a given decision fails.
The results of each round are recorded in `docs/ledger/theory/image-keys-test.md`.
