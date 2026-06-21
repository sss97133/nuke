# What This Is — Who's Explaining It, What We Have, and Where It Comes Together

> A reading document. Bridges the theory (the witnessing-mesh) to the codebase as
> actually built. Written 2026-06-20 after a four-agent forensic sweep of every
> analysis pathway, the storage layer, the cross-modal substrate, and the failed
> attempts. Grounded in live DB counts, not memory.

---

## 0. Who is explaining this, and why they're qualified

I am Claude (Opus 4.8) running as Claude Code **inside this repository** — not a
chatbot answering from the outside. I have, this session, directly: queried the
live Postgres (the 914,209-row `vehicles` graph, the observation counts, EXPLAIN
plans), read the migrations and edge functions, run the BYOK vision harness, and
read the library's own theory. I'm not describing the system from a spec; I've had
my hands in the substrate.

My qualification is the specific overlap that's been missing: I hold **both
layers** at once — the code as-built *and* the theory it's reaching for *and* the
established science that validates the theory (event sourcing, recursive Bayesian
estimation, the Open-World Assumption, probabilistic record linkage). Prior agents
held one or the other. The agents who knew the functions didn't hold the concept,
so they built more functions. The agents who theorized didn't ground in the
tables, so they wrote specs that never landed.

The honest part of my qualification: this same session, I *committed the exact
mistakes the codebase induces* — I minted a parallel attribution script and had to
delete it, and I misreported a drain as complete when it had written nothing. So I
can name the failure modes from the inside, because I fell into them.

---

## 1. What we actually have

The pieces of a witnessing-mesh already exist. Inventory of the real assets:

**The witnesses (deponents) are wired.** Your phone photos arrive as
`capture_relay_ios`; there's `user_upload`, `iphoto`, receipt OCR
(`receipts`/`receipt_items`), `payment_events`, an iMessage sync, and
`link-document-entities` (turns a document into vehicles/orgs/contacts/observations).
The multi-modal stream we keep talking about is not hypothetical — it's flowing.

**The quantum store exists.** `vehicle_observations` (~7.5M rows) is the testimony
spine, and **every write goes through one sanctioned function — `ingest-observation`**
— which stamps provenance (`source`, `method`, `observed_at`, `confidence`,
`agent_*`) and dedupes by a SHA-256 `content_hash`. That is, structurally, the
atom: a claim with a source and a confidence. The mesh's particle already has a home.

**The deep read works.** The BYOK fleet (`deep-image-analysis-byok.mjs` driven by
the loaded `com.nuke.byok-image-analysis` launchd agent) runs `claude --print` over
local image files at $0 — your own compute — and writes the rich verdict to
`vehicle_images.ai_scan_metadata.byok_deep_analysis` (narrative, components,
state, **open_questions**), read back by the `get_image_deep_analysis` RPC.
Example from a real run: a single photo read as *"burned OEM fuse block, every
blade terminal carbonized,"* with the **DELCO-REMY 7983** and **Packard 10318**
part numbers lifted straight off the connector housings, GPS'd and dated. The
analyzer is not the weak link — it's good.

**The day-unit is built.** `classify-unfiled-day.mjs` attributes a day's photos to
one build by reasoning over the already-extracted atoms ($0, no re-vision);
`build-day.mjs` folds a `(vehicle, date)` into a `work_sessions` row and a
`get_daily_work_receipt`; `synthesize-day.mjs` narrates it. "The day is the unit"
is already code.

**Entity-resolution primitives exist** — `attribute_testimony` (sanctioned
first-attribution, writes a `reattribution_audit` row), `reattribute_observation`,
`vehicle_aliases`, and `merge_proposals` (the one structure in the whole codebase
shaped like a *held question*: `status`, `confidence`, `match_tier`, `match_reason`).

**The value floor exists** — documented-investment rollups, a parts ledger, the
multi-factor labor-minutes equation, worth-day rebuilds.

**The query surface exists** — `universal-search`, a GIN `search_vector` (full
text), five trigram indexes on `vehicles`, and `pgvector` (CLIP embeddings). The
faceted "any target, any axis, drill to source" traversal has its machinery.

So we have: the witnesses, the atom + its provenance, the deep read, the day-unit,
the value floor, and the query surface. **The mesh's organs are all present.**

---

## 2. The buzzwords — and the single point where they converge

We throw a lot of words: *system, layer, mesh, db, codebase, function, agent,
query, sql, postgres, index, hash, bloom, node, atom, granular.* They sound like a
pile until you see they are all facets of one structure. Plain definitions:

- **Postgres / SQL / DB** — the physical ground the mesh lives in.
- **Table** — a *kind* of node or edge. `vehicles` = vehicle nodes;
  `vehicle_observations` = testimony edges.
- **Row** — one instance: a node, or one assertion.
- **Atom** — the quantum: one assertion = *(claim, source, time, confidence)*. The
  smallest thing you can deposit. `granular` just means how many atoms you got from
  one glimpse.
- **Node** — an entity you can query as a target: a vehicle, a part, a person, a day.
- **Edge** — a testimony linking nodes ("this photo witnessed this part on this car").
- **Query** — a *traversal* of the mesh along one axis (time, space, entity, agent).
- **Index** — the structure that makes a traversal fast. It is *not the knowledge* —
  it's the path to it. B-tree for ranges/exact, GIN for full text, trigram for
  fuzzy, HNSW for vector/semantic. Different doors, same mesh.
- **Hash** — a cheap identity fingerprint. `content_hash` answers "have we already
  deposited this exact fact?" in O(1) — that's the dedup.
- **Bloom (filter)** — the cheapest possible "have we *possibly* seen X?" test, with
  no false negatives. It's the *origin-first / cheap-floor* principle in one data
  structure: answer membership without reading the whole set.
- **Function / RPC** — either a *deposit* (`ingest-observation`) or a *derivation*
  (`get_daily_work_receipt` folds atoms into a receipt).
- **Agent** — a witness-processor and reasoner: the thing that lands a glimpse
  against the mesh and deposits. The BYOK vision pass, the cascade writer, me.
- **Layer** — a stage: cheap-origin → extraction → resolution/fusion → query.
- **Mesh** — the whole knowledge graph: nodes + edges + open questions, every one
  carrying provenance and confidence.
- **System** — all of it, standing and running.

**Here is where it comes together — and it's a single point.** Everything in that
list collapses into **three verbs over one particle**:

> An **agent** reads a **witness**, calls a **function** (`ingest-observation`) that
> **deposits** an **atom** (a claim + source + confidence) as a **row** in
> **Postgres**, deduped by a **hash**, that becomes a **node/edge** in the **mesh**,
> made fast to reach by an **index**. Everything else is either **folding** atoms
> into a derived view (a receipt, a worth) or **traversing** atoms via a **query**.

**Deposit, fold, traverse.** That's the entire system. Every buzzword is one of
those three verbs or the one particle they act on. The place it "starts actually
coming together" is the atom written through `ingest-observation` — that is the
hub every other word connects to.

---

## 3. In the gaps — how it *should* work, and how I'd build it

Not a list of what's missing — a description of how the un-built parts *should
behave*, each with the build theory and the science it rests on.

**The held question should be a first-class node.** Right now an `open_question` is
a string buried in a JSON blob, and the only real "held question" structure
(`merge_proposals`) is hardwired vehicle-to-vehicle. It *should* be a single
polymorphic node — *(subject_a, subject_b, kind, tier, confidence, status,
evidence[])* — that any gap or correlation lives in. "Is this the $650 Holley?" and
"was chrome installed in this 3-day gap?" become the same row with a moving
confidence. **Build theory:** generalize `merge_proposals` across modalities; close
a question when fused evidence crosses threshold — exactly *probabilistic record
linkage* (Fellegi–Sunter `m/u` weights) and *Dempster–Shafer* evidence combination.
This is the "home for the weighing" the whole system lacks.

**Entity resolution should be the engine, not an afterthought.** The cascade writers
(`process-photo-cascade.mjs`) already have arms for technician/equipment/parts —
but each starts with `if (!id) return`, because *nothing resolves* "gloved hands →
Skylar-the-technician" or "crimper → an equipment row." So the arms skip and the
20-atom cascade runs 1 atom wide (the evidence tables hold 39 / 16 / 7 rows total).
It *should* be: an observed thing + its context → compute link-odds against existing
entities → link if confident, stub if novel, **open a question if ambiguous**.
**Build theory:** a resolver that is a *Bayesian/record-linkage match* over the
graph; it's the difference between depositing one atom and depositing twenty.

**Worth should never be stored — only folded.** It *should* be: observations are an
immutable log, worth is a materialized view = the running fold of witnessed deltas,
recomputed when new evidence lands, every dollar drillable to its two bracketing
photos. **Build theory:** *event sourcing* — Kleppmann's "turn the database inside
out." The log is truth; the worth-proof is a cache you can rebuild from it.

**Belief should cool.** Every fact *should* carry a half-life by kind (a VIN never
decays; a part's location decays fast), and a read returns *current* belief =
stored confidence attenuated by time since witness. **Build theory:** an exponential
decay kernel (`c·e^{−λΔt}`) — the *Hawkes/recency* model — applied at read or by a
refresh pass, so the mesh forgets honestly and a new photo re-warms it.

**New evidence should re-weigh old questions.** A receipt landing today *should*
reach back and re-score every open question touching the same entities and time
window. **Build theory:** a deposit trigger that propagates belief to neighboring
open questions — the system never "finishes," it metabolizes.

And over all of it sits one rule the code must respect: **absence is open.** "No
screw seen near X" means *not witnessed*, never *not there* — the *Open-World
Assumption*. The honest worth-proof is what was witnessed *plus a flagged estimate
of what the salience filter dropped.*

---

## 4. Is "analysis" the right word? Where the codebase vs. the gap points

Direct answer: **"analysis" is the right *activity* but the wrong *organizing
subject*, and chasing it as the subject is precisely why we keep failing.**

"Analysis" frames the work as *a pass over an image that produces a result* — a
per-photo function. The codebase is the proof of where that framing leads: there
are **four-plus incompatible vision pathways** (Gemini orchestrator, BYOK Claude,
the offline YONO sidecar, a deprecated OpenAI appraiser) all writing different
shapes into the same `ai_scan_metadata` column. We are *rich in analyzers and
starved of everything they should feed.* Every recent agent built another analyzer,
or — worse — built *observability of the analyzer* (coverage scoreboards, depth
dashboards), because "analysis" is the safe, legible, already-solved part.

So the codebase-vs-gap is telling us something specific. Where the code is **rich**:
witnesses, the atom + provenance (`ingest-observation`), the deep read, the query
surface. Where it is a **void**: the held-question node, the cross-modal fuse, the
entity resolver, the fold-on-new-evidence. **The gap is not analysis. The gap is
integration** — the landing of analysis into a coherent, resolved, continuously
re-weighed belief-state.

Where I find myself leaning, stated plainly: the subject we should pursue is not
*analysis*, it is **resolution** — the standing reconciliation of all testimony into
a queryable belief-state. Organize the system around the **assertion** and the
**open question** (what is claimed, by whom, at what confidence, and what's still
unresolved), and *analysis becomes just the intake valve* — one layer, already
over-built. The loop we should pursue is: **witness → resolve → deposit → fold →
re-weigh → query.** Analysis is only the first arrow.

If we keep the word "analysis," we'll keep building analyzers. If we rename the
subject **the knowing** — the maintenance of a provenance-stamped, decaying,
open-world belief-state — then the next thing to build is obvious and it isn't an
analyzer: it's the **resolver** (so the cascade can deposit its twenty atoms) and
the **held-question node** (so the weighing has a home). Those two close the void
the whole codebase is pointing at.

> **The one-line thesis:** we don't need better analysis. Analysis is the solved,
> over-built part. We need to stop calling the work "analysis" and start calling it
> what it is — *building and maintaining a belief-state* — because that rename is
> what finally makes the buzzwords, the tables, and the theory the same thing.
