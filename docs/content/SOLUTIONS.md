# Solutions to Big Problems

Concise solutions to big problems, drawn from the subjects nested in the Nuke system.
Aspirational register. Editor-vetted for overclaim (framed as approach/discipline, not "we shipped it").
No em-dashes. No borrowed authority. Value is the bar.

---

**Hallucination is a representation problem, not a discipline problem.**
The defining flaw of today's AI is that a machine can state a fact it has no source for, and nothing stops it. Everyone treats this as a matter of discipline: cite better, detect the fakes after the fact. They are aiming at the wrong layer. A claim with no source should not be expressible in the first place. Make provenance part of the type, so an unsourced value is not a low-quality output but an illegal one. You stop asking the model to be honest and start building a system where dishonesty cannot be constructed.

---

**A number is not a number.**
Most systems store a price as a price and a valuation as a valuation. That is the bug. Each figure is really a small bundle: the value, its source, the method behind it, the time it was true, and how much to trust it. Strip those away and you get a database full of confident numbers nobody can stand behind, where a figure typed by accident outranks a sourced estimate. The discipline is simple and absolute. A number does not enter the system without its origin attached, and every figure can answer one question on demand: who said so, how, and when.

---

**The answer was never missing. It was scattered.**
The hard part of real-world data is not that the truth is absent. It is that the truth is spread across a hundred places and nobody assembled them. The instinct is to clean the data first. That is backwards. You lay all of it down at once, messy, and let it resolve against itself. The gaps that survive are not failures, they are a precise map of where to look next. You do not need perfect data to begin. You need all of it in one room.

---

**The goal of software should be to get people off the computer.**
Most software is built to capture your attention and keep you inside it. The right ambition is the opposite. A person should touch a machine for exactly two reasons: to sign their name, and to tell the truth. The forms, the logging, the reconciliation, all of it is the machine's job. Build the system that does the clerical work invisibly, so people can go do the real work in the world.

---

**Stop building features. Build one engine.**
An auction house listing a car and a mechanic turning a wrench on it are the same kind of thing: an entity providing a service to a vehicle. Once you see that, the special cases collapse. You do not need a listings feature and a service-records feature and a parts feature. You need one engine that records who did what to which thing, with what evidence. Generality here is not abstraction for its own sake. It is what lets a single system absorb a world that refuses to sort itself into neat categories.

---

**Never delete the record of what was observed.**
This sounds bureaucratic and is actually load-bearing. When you merge two things and get it wrong, the original must remain recoverable, because tomorrow's discovery may prove it right. Systems that overwrite the past optimize for a tidy present and quietly destroy the thing that makes them trustworthy over decades. Correction is not deletion. You supersede, you relink, you keep the chain intact. An archive built to outlive its makers cannot afford a clean slate.

---

**A photograph is testimony, not a memory.**
An image is the densest evidence you own. One photo of a vehicle on a given day, read properly, settles a dozen questions: what was done, by whom, where, when, which parts, what condition. The mistake is treating photos as keepsakes to store. They are evidence to read. Point a system at twenty years of images nobody ever parsed and you do not get an album. You get the verified history of an asset, reconstructed from the truth that was sitting in the pixels the entire time.
