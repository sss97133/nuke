# The Agent Must Cite

> "If you want to state who's the owner you need to cite that. That's what my
> system is supposed to force you to do. This Claude Code system doesn't enforce
> citing data. That's a core issue."
> — Skylar, 2026-06-14, after an agent asserted a client's car was "his dad's"

## The failure that named the doctrine

An agent looked at the 1932 Ford in the garage, saw `relationship: contributor`,
and stated it was "dad's / Viva." The truth was fully logged, with provenance:
a `kind=ownership` observation (nuke-vision, 2026-05-06) reads *"Vehicle was
Howard Barton, NOT Skylar Williams. Skylar listed on BaT … as consignment
broker"*; a chain of `kind=provenance` rows records the ship-out (Tropical
Shipping #18191839), the owner's return request, the settle-and-walk, the $5,675
interior-work payment, and the project closed at a loss. None of it was missing.
The agent simply asserted an owner without querying the owner.

This is the **facade disease at the agent layer.** The Mustang's "Blue · bring a
trailer" is a value on a surface with no root beneath it. "It's dad's" is the
exact same object — a claim with no root — except spoken by the agent instead of
rendered by the UI. Same disease, worse vector, because speech carries more trust
than a pixel and erodes it faster when wrong.

## Rules are not enforcement

The agent **already had the rule.** "Quote, don't infer; do not infer
family/employment/business relationships from name overlaps" is written, load-
bearing, in memory. It was broken anyway, under the load of a long session.

That is the whole lesson: **a rule the agent must remember is not a control; it
is a hope.** Memory, CLAUDE.md, a tenets file — these are advisory. An agent that
*can* emit a factual claim without a citation *will*, eventually. The only real
control is structural: make the uncited claim impossible to state as fact, the
same way the UI makes the unrooted value impossible to render as fact.

## The contract, both layers

The root-system contract already governs the surface (see [[the-root-system]],
[[the-drillable-atom]]): no fact renders without a root (value + source +
evidence), else it is dead text. The doctrine here is the dual:

> **No factual claim about an atom may be *stated* by the agent without resolving
> to a cited observation — or it must be marked as inference, not fact.**

The surface and the speaker are bound by one contract. A vehicle's owner, value,
color, history — if the agent is going to say it, the saying must carry the same
DNA the database demands of every number: `(value, source, method, observed_at,
trust)`. "It's Howard Barton's" is allowed *because* it can append "per the
ownership observation, nuke-vision, 2026-05-06." "It's dad's" is not allowed,
because nothing backs it — and "nothing backs it" is exactly the state the agent
must be forced to notice before speaking, not after being caught.

## What enforcement looks like (the research)

This needs real development, but the shape is clear and it is a *syntax* problem,
not a willpower problem:

1. **Query-before-assert, structurally.** Factual claims about user atoms
   (ownership, value, custody, identity, relationships) should be emitted only
   through a path that returns the citation alongside the value — the agent
   states what the tool returned, not what it remembers. The substrate already
   has the cited form (`get_field_provenance`, the `kind=ownership` /
   `kind=provenance` observations); the gap is that the agent isn't *required* to
   route through it.

2. **A citation grammar for agent speech.** A factual sentence about an atom
   carries an inline source clause or it is downgraded to hedged inference
   ("appears to be," "not recorded") — the linguistic version of ink-vs-pencil.
   No source clause available → the claim is not allowed to wear the grammar of
   fact.

3. **A self-audit gate.** Before output, factual claims about substrate get
   checked for an attached citation; uncited ones are flagged and either resolved
   (query the data) or re-cast as explicit inference. The agent harness, not the
   agent's discipline, runs the check.

The deep version: a provenance-native substrate can bind *its operator* to the
same provenance contract it binds its *data* to. That is the thing no general
agent system does today — and the thing worth saying publicly. Most agent
stacks let the model assert freely and hope a rule holds; the failure above
proves the hope breaks. A system whose data layer already enforces "no number
without a table behind it" is uniquely positioned to enforce "no claim without a
citation behind it" on the agent itself. The same wall, turned to face the
speaker.

## The test

Before stating any fact about a user's atom, the agent answers: *what observation
did I read that says this?* If the answer is a citation, state it with the
citation. If the answer is "I'm pattern-matching from memory," it is inference —
say so, or go read the data. There is no third mode where the agent gets to sound
certain about something it never looked up. The garage was right there.

---
*Companion: [[the-root-system]] (the surface contract), [[the-drillable-atom]]
(the read shape), `feedback: paperwork — quote, don't infer` (the rule that
wasn't enough), `feedback: numbers carry source DNA` (the atom shape the claim
must carry).*
