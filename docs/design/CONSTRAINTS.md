# THE CONSTRAINT INVENTORY — NukeCapture launch surface

*Distilled from Skylar, 2026-06-10 night. This is the operating input for storyboard v2
and every design decision until launch. Per `design-is-constraints-not-rules.md`:
state the constraints first, then design freely inside them. Per the hermeneutics
clause: floors, not ceilings.*

The ultimate constraint stands: **the UI must convince the observer we are legitimate,
per-observer.** Everything below is that constraint refracted through tonight's
thinking.

---

## C0 — THE PROVENANCE LAW (supersedes all; the real jig)

*Ruled 2026-06-12 after a jig contaminated data — K5 photos under an R3500 header with
a fabricated AI caption. The cardinal violation of the platform's load-bearing axiom.*

**A design surface is held to the SAME data-integrity standard as production.** No
mockup, wireframe, jig, or visual may contain fabricated, stand-in, or cross-associated
data. Every value real and correctly associated to its entity, carrying its source.
Never mix entities. Never invent an analysis/caption/count/relationship — if the
analyst didn't produce it, it does not exist. Where data is absent, render the honest
absence, never a placeholder value. **If you cannot wire it to real correctly-associated
provenanced data, do not render it — improve the real product in place instead.** A
free-floating mockup can only contaminate; the real app/site is already wired to real
data, so improving it cannot. This is why design = developing what exists, not drawing
new pictures. This law outranks every aesthetic constraint below it.

## C1 — Influence precedes interaction

By the minute a person finds the App Store page, the convincing has already happened —
or it hasn't. In 2026 nobody browses 500 apps; they arrive pre-sold by whoever or
whatever introduced them. For a film that's 50% of the budget; for us with $0 it is
**the relationships established before going to market**. Design consequence:

- Frame zero — the introduction — is **its own deck** (`MARKETING_DECK.md`), separate
  from the product storyboard (Skylar, 2026-06-10: "it's basically the marketing
  deck"). The surfaces a prospect meets *before* download (a shared day-receipt link,
  an agent's recommendation, the App Store product page) are still codex-governed
  product surfaces — they just live in the marketing deck, while the product
  storyboard covers hit-the-ground-running.
- Every door makes a specific promise. The app must keep that exact promise within
  the first sixty seconds or the door was a lie.

## C2 — The observer is a black box; their data is the constraint

Every new user is unknown. Two moves, in order:

1. **The door is the first datum.** Which introduction they came through tells us who
   they are before they tell us anything: a shared receipt means they know a builder;
   an agent referral means they live in agent-land; an ASO search means they searched
   their trade. Instrument the doors (distinct link slugs / referral params) — this is
   the only "marketing analytics" we run.
2. **Use what arrives with them.** The hyperbolic time chamber: a user arrives carrying
   their data, their motivation, their culture. SIWA hands us their name. Their camera
   roll IS years of their own work history. **We never ask for what we can read.** The
   first conviction moment is the system showing the user their own life, organized —
   not copy about what we could do.

## C3 — Time-to-comprehension runs both directions

- **Them → us:** one screen, one sentence, one number. Comprehension in seconds.
- **Us → them:** first sync must reconstruct their work history from EXIF in minutes.
  The backfill is not a feature, it is the proof. The graph is never empty on day one.
- Wordiness is observer-dependent (some people need the words): the surface stays
  minimal, the explanation lives exactly one tap down. The three-shelf law already
  encodes this — depth on demand, never on the surface.

## C4 — Zero click anxiety = the system does exactly what it said

Trust compounds asymmetrically (one broken interaction costs the trust of four good
ones — see `click-anxiety-and-trust.md`). Early adopters spend their own reputation
introducing us (C1), so a broken first-run doesn't lose one user — it burns a door.
Design consequence, hard:

- **A frame may only exist in the storyboard if a working organ backs it today.**
  Every frame names its organ (the RPC, the pipeline, the table). No frame for
  vapor. This is the horsepower audit: walk the walk or cut the frame.
- Flawless is not reachable in ten days; **honest is.** Every number real, every
  failure visible (the FAILED row, the held-back gauge). Trust survives honest
  limitation; it does not survive one lie.

## C5 — Borrowed legitimacy, taken to its limit

The spec Skylar named: *how close can we feel to what was already on the iPhone when
they bought it?* The decay of the incumbents is the opening; Apple's grammar is the
trust we rent until NUKE-the-mark earns its own (see `design-is-constraints-not-rules.md`
§sign value). Design consequence — **this amends the codex's literal port:**

- **The body of the app is drawn in Apple's material.** System type scale, system
  grouped backgrounds, stock controls, untouched dialogs. The v1 failure was dressing
  iOS in the web costume; the seam ran the wrong way.
- **Nuke's signature appears only where the data is:** mono digits, square thumbnails,
  the barcode mark, and ONE signature artifact per surface — the receipt card
  (2px ink border, square), the same document the web testifies with.
- The web keeps the full square canon. The phone borrows; the web owns. The identity
  chain doctrine at pixel level: borrowed material must look borrowed — and on the
  phone, *we* are the guest.

## C6 — The agent is a door (the asymmetric one)

Introduction methodology is different now: agents recommend tools. Nuke is already
MCP-addressable — an agent can read and write the substrate today. No competitor in
the space can say that. Design consequence: the agent-referral door is a first-class
frame-zero panel, and the listing's review notes already speak agent (`demo account`,
auditable gate). This is the one channel where "the system has to function exactly as
stated" is checked by a machine before a human ever sees it.

## C8 — Assume the initiate (Skylar, 2026-06-10, after v3)

By the time someone is inside the app, the doors already did the convincing — they
arrive in a different state of mind. **It is not being handed to every human being; it
is supposed to feel like a sick tool that hopefully nobody else has.** Therefore:

- **The app never explains itself. It reports.** Every sentence whose job is to teach
  ("your photos become...", "the filter runs on...") is deleted. Copy is instrument
  register only: counts, names, timestamps, one-word imperatives. The privacy contract
  is proven by gauges (`UPLOADED 0` during the scan), not promised by paragraphs.
- **Assumed competence is the flattery.** MoTeC, Snap-On, Leica do not onboard; they
  power on. Explanation is for strangers; the initiate was vouched for at the door.
- **Scarcity is rendered, not claimed** — the soft-launch doctrine made visible
  (operator number / serialized instrument), never the word "exclusive."

## C9 — The darkroom (Skylar, 2026-06-11, retiring the storyboards)

The two highest-value design systems are **the timeline and its barcode** — because
they are powered by end-to-end data handling and they GROW: the minute the user taps
Allow, the timeline starts growing. What makes them cool is the data behind them, so
the design question collapses to **"how fast can we give them that information?"**
The hook is the darkroom: the emotion of watching the image appear in the tray —
the loading screen as proof of existence. Consequences:

- **Static mockups are retired.** From Allow onward it's an entirely new world that
  can only be designed live — develop the real pages/screens and watch them run;
  iterate on the running thing, not on pictures of it.
- The barcode is design language as *concept*, never to be literally pasted as
  decoration — a bar is cool because a real day of work powers it.
- Speed-to-first-proof is the ranking metric for all ignition work.

## C10 — The data end (Skylar, 2026-06-11: "define what data END means")

Every click path terminates at a **document**, never a dead-end. The depth contract:

- **Shelf 0** — a number/cell/bar (the day in the grid, the count in a pill)
- **Shelf 1** — the rows behind it
- **Shelf 2** — the document: the DAY RECEIPT (all photos, span, vehicle, work story,
  dollars) or the IMAGE-AS-EVIDENCE (the photo full-bleed + its provenance rail)
- **Shelf 3 / the end** — the original evidence itself: the full-resolution photo, the
  receipt scan, the source listing URL. The end of every chain is testimony + provenance.

Significance, defined: clicking a day answers "what happened that day" completely —
photos, hours, vehicle, money — in place (drawer/lightbox per the click-anxiety
contract: additive, reversible, ESC/click-out, URL-addressable). If a click opens
something that doesn't add a shelf of depth, the click shouldn't exist.

**Images are documentation that becomes strong visuals at depth.** The image viewer is
Instagram-grade in mechanics (instant, full-bleed, swipeable) and evidence-grade in
content: every photo carries its when/where/what (taken_at, site, day-link, vehicle,
extracted atoms). We are not showing curated content; we are showing documentation so
fluently it reads as content.

## C7 — The period: ten days

June 22 the window closes; submission targets Thu/Fri. The deadline is a material
constraint like any other: scope = frames with organs behind them, nothing else.
Cut, don't defer.

---

## Proposed codex amendments (per hermeneutics: the bend becomes the floor)

1. **Native body, signature artifact** (from C5): on iOS, Nuke-drawn-square applies to
   data artifacts only (receipt card, thumbnails, barcode); the application body uses
   stock Apple material including its geometry. Supersedes the literal zero-radius
   port in codex §4. SIWA button reverts to stock geometry (reverses Director's
   Reconciliation 1 — the legitimacy test outranks the squaring API).
2. **Frame zero is in scope** (from C1): the introduction surfaces (share card, agent
   referral, App Store page) are codex-governed product surfaces.
3. **The organ caption** (from C4): every storyboard frame carries a `RUNS ON:` line
   naming its backing system. A frame without one is a build failure.
