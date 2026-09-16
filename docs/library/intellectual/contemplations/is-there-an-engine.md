# Is There an Engine?

> "There's a lot of pieces of an engine. I don't know what an engine actually is, but I want this to work."
> — Skylar, June 2026

> "Facts only have one structure and they are usually cited in some kind of originating documentation — a published page, or better yet a canonical image provided by authenticated user patterns. Knowledge in the educational sense is not true/false providence-oriented."
> — Skylar, same conversation

---

## Abstract

Nuke has accumulated the *parts* of an engine — an intake choke point, a trust registry, an accumulation table, an arbitration layer, a supersession discipline — and on one fuel it runs as a true engine: auction text enters, materialized vehicle truth comes out, and no human hand-cranks the steps between. On another fuel — owner photographs, which are by our own epistemology the highest grade of fact available — the same parts exist but are not connected into an engine. This essay does three things. First, it states the test that distinguishes an engine from a parts pile: *fuel in, work out, no hand-crank.* Second, it draws the distinction the library has used implicitly but never named — **fact** versus **knowledge** — and shows they are different substances that the engine must convert between. Third, it locates the missing part precisely: not intake, not storage, but the **convergence chamber** — the mechanism by which accumulated facts become knowledge by surviving scrutiny. Truth-by-corroboration is the crankshaft. On the fuel we care about most, it is not yet turning.

---

## I. The Question Behind the Question

The honest question is not "is the architecture good?" The architecture is good; the contemplations that precede this one establish why. The honest question is colder: *is there an engine, or is there a workbench covered in well-machined parts that have never been bolted into a block?*

There is a clean test. An engine takes fuel in one end and produces work out the other **without a human turning the crank at each stroke.** A parts pile produces work only when a person picks up each piece, fits it to the next, and pushes. The difference is not the quality of the parts. It is whether the parts are connected into something that runs on its own.

This test is unforgiving and useful, because it cannot be passed by admiration. You can be genuinely impressed by a crankshaft, a set of pistons, a beautifully cast head — and still have no engine, because nothing is bolted together. Admiration of parts is the failure mode that feels like progress. The test ignores admiration and asks only: did fuel go in, did work come out, and did anyone have to hand-crank it?

---

## II. Two Engines, One Built

Apply the test honestly and Nuke splits in two.

**On auction and listing text, there is an engine.** A Bring a Trailer page enters through `ingest-observation` (the single choke point). The resolution cascade assigns it to an entity. Confidence is computed from the source's registered trust. The claim lands in `vehicle_observations` and never overwrites what was there. The Tetris write-layer (`batUpsertWithProvenance`) materializes the convergent value into the `vehicles` surface and quarantines conflicts instead of forcing them. 5.7 million observations, 449,000 vehicles, 160 trust-scored sources, 3.29 million field-evidence rows. Fuel in, work out, no hand-crank. This is an engine. It runs.

**On owner photographs, there is a parts pile.** Every part named above exists — but they are not connected on this fuel:

- *Intake bypasses the choke point.* The photo intake scripts write `vehicle_images` rows with a raw insert, taking the iPhoto album name as the vehicle, with no source, no method, no trust. The choke point that makes the text engine trustworthy is driven around entirely.
- *Combustion is offline.* The vision stage that should turn a photo into structured testimony is not running — the dedicated sidecar has been down for months, the fallback throws rate-limit errors, and the verdicts that exist are mostly failures.
- *There is no crankshaft.* Nothing drives a pending photo to a converged verdict on its own. When it happens at all, a human (or an agent acting as one) hand-cranks each image.

The result is measurable: on a single well-documented vehicle, roughly four out of five attached images were not that vehicle. That is not a broken engine. It is the absence of one — the predictable output of a parts pile asked to behave like a machine.

The danger is that the *text* engine's existence disguises the *photo* engine's absence. From a distance there appears to be "an engine." Up close, the fuel that matters most to the owner — photographs of his own assets — has none.

---

## III. Fact and Knowledge Are Different Substances

The library has always treated data as testimony (`testimony-and-half-lives.md`) and assets as containers that accumulate it (`assets-accumulate-data.md`). But it has used, without naming, a sharper distinction — one an owner of the system drew directly:

**A fact has one structure, and it is bound to its origin.** A VIN. A build sheet. A title transfer. A *canonical image provided by an authenticated user.* You cannot restructure a fact and have it remain the same fact; its form and its provenance are the fact. Facts are provenance-locked, single-form, and cited. They do not improve by being rewritten. They are either correctly cited to their origin or they are not facts yet — they are claims.

**Knowledge has many conforming structures, and it is not bound to a single origin.** A thesis, a model, a theory, a valuation method, a condition rubric — these can be expressed many ways and still be the same knowledge. Knowledge is not true-or-false against a single document; it is *more or less true* against scrutiny. It improves by being rewritten. It welcomes contribution. It becomes true the way a physical law becomes true: not because one page certifies it, but because everyone who tests it gets the same result and acts on it the same way, universally. That universality of behavior — not a citation — is what makes a law a law, and it is why laws are so hard to establish.

This distinction is not decoration. It tells you *where each kind of thing lives and how it is allowed to change*:

| | Fact | Knowledge |
|---|---|---|
| Structure | One | Many conforming forms |
| Bound to | An originating document / canonical image | No single origin |
| Becomes true by | Correct citation to provenance | Surviving scrutiny → consensus |
| Improves by | Being correctly captured, never rewritten | Being rewritten and re-tested |
| Lives in | `vehicle_observations` (atoms, immutable testimony) | the library (revisable, contributable) |
| Violation | Inventing a fact without provenance | Refusing to revise knowledge under new evidence |

The atoms are facts. The library is knowledge. **This very essay is knowledge, not fact** — it is a thesis offered for scrutiny, expected to be rewritten, true only to the degree it survives. Recording it as if it were a fact would be the same category error that produced the contamination: a claim wearing the costume of truth.

---

## IV. The Convergence Chamber Is the Missing Part

Now the diagnosis sharpens. The engine has a superb **fact intake** and almost no **knowledge convergence.**

The intake is real: provenance at write time, trust at the source, supersession instead of deletion. But the step that turns accumulated facts into knowledge — corroboration until everyone-and-everything agrees — barely runs. The evidence is in the system's own numbers: of 5.7 million observations, only about **half a percent** have ever reached the `verified` tier, the tier that requires independent corroboration. The decay functions that would let stale facts lose weight against fresh ones are documented as designed-but-unbuilt. The consensus methods (multi-model agreement, contradiction detection) exist in the hundreds of rows, not the millions.

This is the crankshaft. An engine's crankshaft is the part that converts many small linear strokes into continuous rotation — many individual combustions into usable, self-sustaining work. The convergence chamber does the same epistemic job: it converts many individual facts (strokes) into knowledge (rotation) by making them agree. Truth-by-scrutiny is not a feature to add later. It *is* the thing that makes the parts an engine. Without it, every fact is a single stroke that dies where it lands, and a human has to come along and decide what it meant.

This reframes "truth" the way the owner did. A fact is cited. A piece of knowledge becomes true the way a scientific law does — when independent observers converge and then *act the same on it.* The system already has the substrate for this (testimony with trust) and the philosophy for it (convergence, not storage). What it lacks is the running chamber that performs the convergence continuously, so that "verified" is the norm and not the 0.5% exception.

---

## V. The Canonical Image Is the Highest Fact-Grade — and It Has No Engine

There is a cruel symmetry in where the missing engine sits.

The owner named the strongest possible fact: *a canonical image provided by an authenticated user.* Not a seller's listing photo, not a scrape, not a model's guess — an authenticated owner's own image of his own VIN'd asset. In the fact/knowledge frame, this is near-bedrock: single-structure, provenance-locked to an authenticated identity, as close to "stamped in metal" as a photograph can be. It should sit at the very top of the visual trust ladder, the anchor that *other* observations converge toward.

And that exact, highest-grade fuel is the fuel with no engine. The text engine refines low-and-medium-trust public claims into materialized truth; the photo path leaves the highest-trust private facts unprocessed, mis-stamped by album name, displayed without convergence. We built the refinery for the cheaper ore and left the gold in the parking lot.

So the priority is not "make the analyzers smarter." Analyzers — cheap or expensive, local or in-session — are interchangeable **observation generators** of differing trust. The moat is never the analyzer; it is the convergence chamber that no single generator can corrupt, because no single stroke is allowed to be the crankshaft. The cheap-model contamination happened precisely because a low-trust generator was wired to write truth directly, with no chamber between it and the record. The fix is not a better generator. It is the chamber.

---

## VI. What an Engine Is

So, to answer the question plainly, for the next agent and for the owner who asked it:

An engine, here, is five connected parts:

1. **Intake** — one choke point where every claim enters carrying source, method, time, and trust. (`ingest-observation`. Built. The photo door must be moved behind it.)
2. **Combustion** — generators that turn raw fuel into structured testimony. (Extractors for text: running. Vision for photos: offline. Generators are commodities; their *trust weight* is what matters.)
3. **Accumulation** — the chamber where testimony piles up and is never overwritten. (`vehicle_observations`. Built.)
4. **Convergence** — the crankshaft: corroboration that turns many facts into knowledge by making them agree, with stale facts decaying and conflicts quarantined rather than forced. (Designed. Barely running. *This is the missing part.*)
5. **Governance** — supersession and provenance so the engine corrects itself and shows its uncertainty instead of hiding it, and so no single writer — not a cheap model, not an expensive one, not the agent writing this — is ever the oracle. (Disciplined on paper; bypassed by the photo intake.)

A system that has parts 1–3 and 5 but not 4 is not yet an engine. It is an intake manifold bolted to a fuel tank: it can receive and store, and a human can hand-build motion out of it, but it does not run on its own. That is where Nuke is on its most valuable fuel.

The good news is the diagnosis is mechanical, not mystical. There is no missing genius. There is a missing crankshaft, and we can name it, and the parts to bolt it to already exist. "I want this to work" has a concrete meaning: connect the photo intake to the choke point, put any honest generator behind it at its true trust weight, and — the real work — build the convergence chamber so that *verified* becomes the rule and the owner reads provenance instead of pixels.

An engine is not the parts. It is the connection that makes fuel become work without a hand on the crank. We have the parts. We have one engine. We do not yet have the second one — and now we know exactly which part is missing.

---

*This contemplation is knowledge, not fact: a thesis about the system's own shape, offered for scrutiny and expected to be revised as the convergence chamber is built and its behavior observed. It depends on `testimony-and-half-lives.md`, `assets-accumulate-data.md`, `the-validation-layer.md`, the encyclopedia's observation model (`reference/encyclopedia/02-observation-model.md`), and the image-as-butterfly-node chapter (`reference/encyclopedia/05-image-as-butterfly-node.md`). Where it asserts numbers (the `verified` fraction, contamination rate), those are facts and carry their origin in the system's own tables at the time of writing; re-measure before citing.*
