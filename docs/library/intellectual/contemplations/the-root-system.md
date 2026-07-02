# The Root System

> "If it doesn't have a root system below it propping it up, it probably is incorrectly built."
> — Skylar, 2026-06-14

## The gas station test

Explain a gas station backwards. The pump dispenses gasoline. Gasoline is refined
from crude. Crude is pumped from reservoirs found by seismic survey, drilled,
shipped through pipelines and tankers, cracked in towers, distributed through a
logistics network, priced against a global commodity market, and finally metered
out at a roadside canopy by a machine you operate without a second thought.

You never explain any of that. The gas station is **immediately legible** — a
child understands it — *because the entire root system beneath it is real and
bulletproof.* The pump is the tip. The supply chain is the tree. Legibility is
the dividend the root system pays at the surface.

A movie-set gas station has the same canopy and the same pumps and dispenses
nothing. It is a **facade**: the tip with no tree. It looks identical until you
try to use it.

**Every element on a Nuke surface is one or the other.** It is either the legible
tip of a complete, bulletproof root system — or it is a facade. There is no third
state, and "looks finished" is the facade's whole disguise.

## This is the same law the atelier already states

The root system is the drillable-atom contract seen from below:

- *"The vehicle profile is not a document. It is a query surface. Every visible
  data point is a compressed representation of underlying data. Clicking it
  decompresses... The chain always moves from inference toward ground truth."*
  (`design-book/09-click-through-chains.md`)
- The readiness rule is the facade detector, stated exactly: *"A data point can
  be made interactive when ALL of these exist: the value, at least one source, at
  least one piece of evidence. If only the value exists → it stays dead text.
  That's honest. An empty popup is worse than dead text."* (same) — an empty
  popup **is** a facade: a tip you can press that bottoms out into nothing.
- *"Nothing on any screen may exist that the data didn't call into existence...
  every pixel must answer the question: what data called you into existence?"*
  (`NUKE_DESIGN_CODEX.md` §0). That question **is** "show me your root system."
- *"Assets are Nodes, Observations are Edges. Each edge has a source, a trust
  weight, a timestamp, and a half-life."* (`contemplations/assets-accumulate-data.md`).
  A surface value with no edge beneath it is a node with no graph — a facade.

So "root system" is not a new doctrine. It is the **acceptance test** for every
other one: build the tree first; the surface is what the tree is allowed to show.

## Two natures, inherited

The root system is not a flat list of sources. It has the shape of living things,
because we adopt the **biology with computational power**:

- **Arborial** — the build is a tree. A vehicle branches into subsystems (engine,
  body, wiring, suspension), each subsystem into operations, each operation into
  parts and labor and photos. You can climb it: ENGINE → LS3 swap → Holley
  dressing kit → shipment 766317 → the receipt → the engine-bay photo. The tree
  is how a fact has *depth*.
- **Rhizomatic** — the same observation is present, with no home territory, in
  every view at once. The LS3-intake observation is simultaneously a node in the
  engine spec, a bar on the timeline, a line in the investment ledger, and an
  entry in the parts list. *"The observation is the Body without Organs... it
  distributes itself equally across all machines."* (`contemplations/the-rhizome.md`).
  The rhizome is how a fact has *reach*.

Depth (arborial) and reach (rhizomatic) are the two axes of a real root system.
A facade has neither: it doesn't go down and it doesn't connect.

## The barcode is the proof that this works

The barcode is the one element on the profile that already passes the gas-station
test, which is why it can be the **defining mark of Nuke** — the way the green
contribution graph is uniquely GitHub, a unique observation method that becomes
the signal of an era.

It is legible without explanation *because* its root system is bulletproof: it is
the temporal collapse of the observation rhizome (`get_vehicle_contribution_days`
over `vehicle_images` + `work_sessions` + `vehicle_timeline_events`), and every
bar decompresses — collapsed strip → heatmap → day-receipt → the day's atoms.
*"The barcode timeline already implements this exactly. Copy it; don't reinvent
it."* (`NUKE_DESIGN_CODEX.md` §3). *"The icon is the data structure."* (§4) —
the mark and the data are one object.

It is **earned, not issued.** A VIN barcode encodes a name the factory stamped on
every twin off the line. The Nuke barcode encodes a *biography* — and no two
biographies are identical, so it is the only mark that is genuinely one per asset.
*"The barcode timeline is the green squares for people who work with their hands.
A day under the Blazer is a commit. A receipt is a commit. A finished rocker
panel is a merged PR. You can't buy the graph — you can only do it."*
(`contemplations/proof-of-work-not-pay-to-play.md`).

**Barcode 2.0** is the barcode with its full root system finally shown at the
surface: bars ramped on *worth* (confirmed labor + parts), not raw count;
composed by *kind* (the chord — a welded-panel day reads differently from a
photo-walkaround day); and read end to end it shows the asset's *eras* — the K5's
sparse 2016–2020 owner-photo period vs. the dense 2021–2026 build — its
handwriting. It grows; it never resets; it accumulates context around its DNA
until, like the gas station, it needs no explanation.

## The lead image is a facade (the worked example)

> "Why is that image the lead image. That for me is a huge red flag. I see it
> missing its entire infrastructure. It's the facade of a gas station, not a gas
> station." — Skylar

The current hero is a single static `primary_image_url`, chosen by nothing,
sourced by nothing, dated by nothing. It is a movie-set canopy: it *looks* like
the asset, and props up no root system. It cannot answer "what data called you
into existence?" — so by §0 it should not exist in that position.

**The end-all-be-all of the lead is the live view of the asset.** The asset's
true face is its *current state*, not a frozen frame. Everything else is one of:

- a **decaying node** — an old photo whose value half-lifes as the asset changes
  beneath it (`contemplations/testimony-and-half-lives.md`); honest only when it
  carries its date and its decay,
- or a **creative curation** — a chosen, framed representation, honest only when
  it declares itself as curation, not as truth.

So the lead, in descending order of truth: a genuine live view → else the latest
owner-trust capture, *stamped with when it was true* (`feedback: restoration lead
image must be latest`) → and arguably the barcode itself is the most honest face
of all, because the data map is always current while every photograph is already
decaying.

## Pointed at every system on the vehicle profile

The principle is an audit, not a feature. For each element, ask: *where is its
root system, and does the surface tell the truth about it?*

| System | Root system | Verdict today |
|---|---|---|
| **Lead image** | the live/current state of the asset | **Facade.** Static, unsourced, undated. Must become live-view → latest owner capture (stamped) → barcode. |
| **Barcode** | observation rhizome → contribution days → day receipts | **Real, the exemplar.** 2.0 = surface its worth/kind/era depth; make it the defining mark. |
| **VIN** | door-jamb plate photo + spec observation | **Real.** The gold standard the rest must reach. |
| **Engine** | the LS3 swap event + Holley parts + receipt + engine-bay photo | **Facade + lie.** Shows "5.7 L98" (a projection) over real LS3 proof it never connected — a tier inversion (projection outranking proof). |
| **Other specs** | their sourcing atoms | **Weak.** Render as confident ink with no root; must drill or render honestly weak. |
| **ASSET / Title-verified** | the title document + permission grants | **Half-built.** Claims verification; doesn't drill to the document (ground truth). |
| **Investment ledger** | receipts / payments / confirmed work sessions | **Real.** Drills to backing rows; CONFIRM extends the root (owner signature = part of the tree). |
| **Photos strip** | each photo = a dated observation node | **Curation, unframed.** Pretty tiles presented as "the photos"; should declare recency/state and drill to analysis. |

## The test, restated

Before any element ships on a profile, it must pass:

1. **Does it have a tree?** (arborial — can you climb from it to ground truth in ≤2 taps?)
2. **Does it connect?** (rhizomatic — is the same atom honest in every view it appears?)
3. **Does the surface tell the truth about its root?** (a sourced fact in ink; an
   unsourced one in pencil or not at all; a decaying node stamped with its decay;
   a curation declared as curation.)

Fail any one and it is a facade — built incorrectly — no matter how finished it
looks. We are not in a rush to output finished pieces. We are in a rush to grow
root systems. The surface is the part that takes care of itself.

---
*Companion: [[the-drillable-atom]] (the read contract), [[assets-accumulate-data]]
(the ontology), [[the-rhizome]] (reach), [[proof-of-work-not-pay-to-play]] (the
earned mark), `design-book/09-click-through-chains.md` (the chain).*
