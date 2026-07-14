# The Make/Model Subject & the Cohort Terminal

*Working paper — 2026-06-16*
*Status: design, pre-build. Companion draft migration: `draft_make_model_subject.sql` (DO NOT APPLY).*

> Search "1966 Ford Mustang" and you should land on **one rich entity** — a Bloomberg
> terminal for the cohort — not a grid of vehicle rows. This paper makes the
> year-make-model a **first-class subject** in the system Nuke already has, and
> defines the metrics terminal that renders it.

This is **develop-from-what-exists**. The platform already has the subject machine:
`projection_event` keyed by `(subject_kind, subject_id)`, the weighted-consensus
engine `project_attribute()`, the per-attribute checklist in
`_shared/cockpit/attribute-registry.ts`, and the finite-asset renderer
`vehicle_wiki()`. We are **adding a sixth subject kind**, not minting a parallel
island. Every primitive below already exists; the work is extension and wiring.

---

## a. The two layers: the SUBJECT vs the INDEX

Skylar's articulated distinction. Keep them separate or the design rots into a
financial product masquerading as a knowledge base.

### Layer 1 — the KNOWLEDGE SUBJECT (always on)

A year-make-model (or make-model-generation) is a **finite, discoverable,
maintainable entity** in the projection/consensus system. It exists the moment
the cohort is namable. It is the same kind of thing a `vehicle` subject is — a
peg that `projection_event` rows hang off, whose canonical fields are the
weighted consensus of evidence-cited claims. It is **never** "activated"; it
simply IS, the way `vehicle_wiki(uuid)` is always renderable for any VIN.

- Subject kind: `make_model` (new, sixth value alongside vehicle/image/person/cluster/user).
- Truth model: identical to a vehicle. Each cohort attribute is
  `project_attribute(cohort_subject_id, 'make_model.X')` — weighted consensus,
  conflict-surfaced, append-only, every line cited.
- Maintained by agents, the same laser-tag harness that fills vehicle atoms:
  `find_subjects_needing_atoms(subject_kind='make_model')` →
  `get_attribute_checklist` → `submit_attribute_value`.

This is a **Wikipedia page for a cohort**, the cohort-scale analog of the
finite-asset wiki. It is the substrate. It carries no capital, no coordination,
no money.

### Layer 2 — the FINANCIAL INDEX (an activation on top of a subject)

The capital/coordination wrapper — a tradable index, a fund, a pooled-build
vehicle, a sponsor-funded campaign — is **NOT a subject**. It is an **activation
that switches on over an existing subject** once one of two gates is crossed:

1. **Mass threshold** — the cohort accumulates enough live substrate
   (N owned vehicles + N active builds + N events/quarter + sentiment volume)
   that an index over it is meaningful, OR
2. **Sponsor ("whale") funding** — a backer explicitly funds the index for a
   cohort regardless of organic mass.

The subject **always exists**; the index is the rare, gated event. This mirrors
the existing repo split: a `market_segment` (the curated, coordination-bearing,
fund-mappable object in `market_segments_index` / `market_segment_stats`) is the
**index layer** that already exists for hand-curated segments. The `make_model`
subject is the **always-on substrate layer** that every segment is eventually
*projected from*. We do not build the index in this paper. We build the subject
and the read terminal, and we leave a single, explicit activation hook
(`make_model_profiles.index_status`) so the index can later switch on without
re-architecting.

**Rule for this build:** ship Layer 1 (subject + terminal). Stub Layer 2
(`index_status` column defaulting `none`). Never let the financial wrapper leak
into the knowledge subject — a cohort with zero index activation is a complete,
correct, maintainable entity, not a "cold" or "failed" one.
(Per `feedback_valuation_block_when_not_defensible.md`: empty signal is OUR
intake gap, never a market verdict.)

---

## b. Keying & registration

### The keying decision

**Backbone: `canonical_models`** (factory-correct nomenclature —
`make_canonical`, `canonical_name`, `display_name`, `year_start`, `year_end`,
`body_styles[]`, `aliases[]`). This already exists, is seeded (C10/K10/K20/K30/
K5 Blazer…), and is the alias-resolution layer (`'c-10' → 'C10'`). It is the
natural registry for the *model* axis and it solves the nomenclature problem the
`vehicles` free-text `make`/`model` columns do not.

**A `make_model` subject is keyed by a normalized triple/quad and given a stable
UUID `subject_id`:**

```
canonical_make   := canonical_models.make_canonical        (e.g. 'FORD')
canonical_model  := canonical_models.canonical_name        (e.g. 'Mustang')
grain            := one of {year, generation}
year             := 1966          (when grain='year')
generation_id    := canonical_models.id + year_start/end   (when grain='generation')
```

The subject row lives in **`make_model_profiles`** (new — the cohort analog of a
denormalized vehicle header), with `subject_id uuid` as PK and a
`UNIQUE(canonical_make, canonical_model, year, grain)` natural key. `subject_id`
is what goes into `projection_event.request_envelope->>'subject_id'`.

### Why two grains, not one

There are ~100 model-years × makes × models, cascading into trims/body-styles/
engines — **finite but large** (tens of thousands of `(year, make, model)`
cells; the seed `vehicle_production_data` already keys at
`(make, model, year, body_style, trim_level, engine_option)`). We do **not**
materialize the full Cartesian product up front (that's backfilling data nobody
will look at — the autonomous-work gate says stop). Instead:

- **`grain='year'`** is the headline subject a search resolves to
  ("1966 Ford Mustang"). Created **lazily on first search/registration**.
- **`grain='generation'`** rolls up a model's `year_start..year_end` span for
  cohorts where the year granularity is too thin to have its own substrate
  (most of them). The terminal falls back to the generation subject when the
  year subject is sparse.

This keeps the registry **demand-driven**: a `make_model` subject is registered
when (a) a user searches the YMM, (b) `vehicles` rows accumulate past a floor for
that cell, or (c) an agent fills atoms for it. Same discipline as the supply-side
rule ("scrape from demand, not from supply").

### Relationship to individual `vehicles` rows

A `make_model` subject is the **cohort**; the `vehicles` rows are its
**members**. The membership join is **not** a new FK on `vehicles` (no schema
churn on the hot table). It is a **resolver** — `cohort_members(subject_id)` —
that matches on `lower(make)`/`lower(model)`/`year` via the existing
`idx_vehicles_lower_make_model` index (the same index `get_comps_combined`
already rides) plus `canonical_models.aliases` for nomenclature normalization.
The cohort is a **query**, not a stored edge set, so it stays correct as vehicles
are added/merged/superseded. This is the same pattern `query_market_history`'s
cohort branch already uses ("get vehicle IDs first, then query events").

---

## c. Cohort attributes for the registry

Add a `MAKE_MODEL` block to `_shared/cockpit/attribute-registry.ts`, in the exact
shape of the existing `USER`/`CLUSTER` blocks: `subject_kind: "make_model"`,
`result_kind`, `layer`, `modalities`, `prompt`, `expected_shape`,
`admissible_evidence`. These are **projections about a population**, so the
dominant evidence class is `context_atoms` (Nuke's own graph), with `document`
admissible for sourced production/registry figures. Per the anti-laundering rule,
an `image` may never cite a cohort statistic.

| attribute | result_kind | layer | shape | admissible evidence | source of truth |
|---|---|---|---|---|---|
| `make_model.production_count` | substrate | 2 | number | `document`, `context_atoms` | `vehicle_production_data.total_produced` |
| `make_model.survival_estimate` | projection | 4 | structured | `context_atoms`, `document` | `survival_rate_estimates` (sparse) + member-VIN count |
| `make_model.price_distribution` | projection | 4 | structured | `context_atoms` | `vehicle_events.final_price` over cohort + comps |
| `make_model.market_trend` | projection | 4 | structured | `context_atoms` | `vehicle_events` time-series (flow over quarters) |
| `make_model.sentiment` | projection | 4 | structured | `context_atoms` | `comment_discoveries` aggregated over members |
| `make_model.active_builds` | substrate | 3 | number | `context_atoms` | members in restoration/build state (sparse) |
| `make_model.parts_availability` | projection | 4 | structured | `context_atoms` | `parts_catalog` ⋈ `parts_fitment` (sparse) |
| `make_model.rarity_tier` | projection | 3 | enum | `document`, `context_atoms` | `vehicle_production_data.rarity_level` |

`enum_values` for `rarity_tier`: `ULTRA_RARE | RARE | UNCOMMON | COMMON | MASS_PRODUCTION`
(mirror `vehicle_production_data.rarity_level`'s CHECK so it can be projected
directly).

Each entry's `prompt` instructs the caller agent to compute the statistic **from
the cohort's substrate**, cite the rows (`context_atoms`), and refuse to answer
from training-data memory — the same discipline `vehicle.horsepower` uses to
reject photo-cited specs. The dollar-bearing ones (`price_distribution`,
`market_trend`) carry source DNA per `feedback_numbers_carry_source_dna.md`:
every figure is `(amount, source, method, observed_at, trust)`.

These attributes flow through the **identical** consensus machinery: a claim is a
`projection_event` row; the canonical value is `project_attribute()`; the page is
assembled like `vehicle_wiki()`. The registry's `getChecklist("make_model")` just
works once the entries exist and `SubjectKind` includes `"make_model"`.

---

## d. The terminal RPC — `get_make_model_terminal(make, model, year)`

A single STABLE RPC that **assembles** the cohort page from data that already
exists, the cohort analog of `vehicle_wiki(uuid)`. It does **two things**:

1. **ASSEMBLE** the live aggregates straight from substrate (no consensus
   needed — these are deterministic SQL over rows we own).
2. **PROJECT** the curated/agent-maintained fields via
   `project_attribute(subject_id, 'make_model.X')` (consensus, conflict-surfaced),
   exactly as `vehicle_wiki` projects `cited_fields`.

### Inputs — what EXISTS vs what's SPARSE/EMPTY

| terminal block | source | status |
|---|---|---|
| `cohort_count` | `vehicles` ⋈ lower(make/model)+year (resolver) | **ASSEMBLE** — populated (~18k vehicles) |
| `price_distribution` + median by condition tier | `vehicle_events.final_price` over member ids; condition tier from `vehicles.data_quality_score`/condition atoms | **ASSEMBLE** — `vehicle_events` ~170k rows, well populated |
| `market_flow` / trend over time | `vehicle_events` grouped by quarter (`ended_at`/`sold_at`) | **ASSEMBLE** — populated |
| `comps` | existing path — `get_comps_combined(p_make,p_model,p_year_min,p_year_max,…)` | **ASSEMBLE** — the comps RPC `api-v1-comps` already calls |
| `sentiment` | `comment_discoveries` (overall_sentiment, sentiment_score) over members | **ASSEMBLE** — populated where comments extracted; thin for cold cohorts |
| `production` / `rarity` | `get_vehicle_rarity_data(make,model,year,…)` → `vehicle_production_data` | **PARTIAL** — only seed rows exist (Camry, Mustang '65, K5 '77, exotics). Most cells empty. |
| `dealer_behavior` | `get_seller_analytics(p_seller_username)` per top seller in cohort | **ASSEMBLE** — function exists (connector calls it); sellers derived from `vehicle_events.seller_identifier` |
| `survival_estimate` | `survival_rate_estimates(make,model,year_start,year_end)` | **SPARSE/EMPTY** — table exists, near-empty. Fall back to member-VIN count as a floor. |
| `active_builds` | members in build/restoration state | **SPARSE** — depends on owner-confirmed `vehicles.status` / build atoms |
| `parts_availability` | `parts_catalog` ⋈ `parts_fitment` on YMM | **SPARSE/EMPTY** — scoped scraping only; mostly cold |
| `cited_fields` | `project_attribute(subject_id,'make_model.*')` | **BUILD** — empty until agents fill cohort atoms; renders `[]` cleanly |

The RPC returns a structured envelope where **every block carries its own
populated/sparse flag** so the UI shows "Not enough data yet — N members" rather
than a fabricated number. **Empty is an intake gap, never a market verdict.**
A sparse block is dark, not "cold."

### Skeleton (full version in `draft_make_model_subject.sql`)

```
get_make_model_terminal(p_make text, p_model text, p_year int default null,
                        p_grain text default 'year')
  → resolve subject_id via make_model_profiles (lazy-create if absent)
  → cohort_ids := cohort_members(subject_id)              -- the resolver
  → assemble: count, price_distribution, market_flow over vehicle_events(cohort_ids)
  → comps    := get_comps_combined(p_make,p_model,p_year-2,p_year+2,…)
  → sentiment:= agg comment_discoveries over cohort_ids
  → production:= get_vehicle_rarity_data(p_make,p_model,p_year)
  → dealers  := get_seller_analytics over top seller_identifiers in cohort
  → survival := survival_rate_estimates lookup (nullable)
  → cited_fields := jsonb_agg(project_attribute(subject_id,'make_model.*'))
  → return jsonb_build_object(... each block + {populated:bool, source, observed_at})
```

The denormalized header (`make_model_profiles` columns) is the cache, refreshed
by a `project_make_model_canonical(subject_id)` projector that mirrors
`project_vehicle_canonical()` — write a column only when a non-conflicted
consensus backs it.

---

## e. Search resolution & MCP exposure

### Search → subject

`universal-search` already classifies input (`detectInputType`: vin/url/year/
text) and already parses `^(\d{4})\s+(.+)$` (year + rest) and an
`and(make.ilike,model.ilike)` pattern. **Extend it**: when a text query parses to
a recognized YMM (year + a `canonical_models` make/model or alias hit), the
top-ranked result becomes a **`make_model` subject card** (kind `make_model`,
linking to the terminal) ABOVE the individual-vehicle grid — the grid stays as
"members of this cohort." No new function; a new result type in the existing one.
Resolution order: VIN → URL → YMM-subject → year → text. The YMM-subject card is
the "land on one rich entity" behavior.

### MCP connector → cohort tool

The connector already speaks the subject language (`subject_kind` enum,
`get_attribute_checklist`, `query_subject_atoms`, `find_subjects_needing_atoms`,
the `query_market_history` cohort branch). Add:

- **`make_model` to every `subject_kind` enum** in the connector tool schemas
  (so checklist/atoms/needing-atoms all accept cohorts).
- **One new tool `get_make_model_terminal`** (make, model, year?) → calls the RPC
  → returns the assembled terminal as a queryable resource. This is the
  "Perplexity with live cohort data" surface: an external agent asks
  "what's the market doing on 1966 Mustangs" and gets cited, live substrate
  instead of a hallucination.
- Expose the subject as an MCP **resource** (`make_model://{make}/{model}/{year}`)
  so the connector can list and read cohorts the way `ListMcpResources` lists
  other subjects.

---

## f. Build sequence (dependency cascade)

Marked **ASSEMBLE** (data exists, just plumb it), **BUILD** (scaffolding/cold —
write the structure, accept it starts empty), **RESEARCH** (genuinely unknown).

1. **`SubjectKind` += `"make_model"`** in `attribute-registry.ts` and the connector
   enums. — **BUILD** (one-line type + enum edits, no data).
2. **`make_model_profiles` table** (subject_id PK, canonical key, header cache,
   `index_status` stub) + indexes. — **BUILD**. *(Schema change → needs Skylar's
   sign-off per universal invariant #4 / hygiene table rule.)*
3. **`cohort_members(subject_id)` resolver** over `vehicles` via lower-index +
   `canonical_models.aliases`. — **ASSEMBLE** (rides existing index).
4. **`register_make_model_subject(make,model,year,grain)`** — lazy upsert into
   `make_model_profiles`, returns subject_id. — **BUILD**.
5. **`MAKE_MODEL` attribute block** in the registry (the 8 attributes in §c). —
   **BUILD** (definitions; consensus machinery already exists).
6. **`get_make_model_terminal()` RPC** — assembles §d blocks. — **ASSEMBLE** for
   count/price/flow/comps/sentiment/dealers; **BUILD** for the cited_fields +
   sparse-flagging wrapper.
7. **`project_make_model_canonical()`** — mirror of `project_vehicle_canonical`,
   syncs header cache from consensus. — **BUILD**.
8. **`universal-search` YMM-subject result type**. — **ASSEMBLE** (extends
   existing parse/rank).
9. **MCP `get_make_model_terminal` tool + `make_model` resource**. — **BUILD**
   (one tool registration + handler calling the RPC).
10. **Backfill substrate the terminal exposes as sparse:**
    - `survival_rate_estimates` population method — **RESEARCH** (the decay/
      listing-frequency model isn't defined; `estimation_method` enum exists but
      the estimator doesn't).
    - `parts_catalog`/`parts_fitment` coverage for live cohorts — **BUILD**
      (supply-side scrape, demand-scoped).
    - `vehicle_production_data` beyond the seed — **RESEARCH** (where do
      authoritative production figures come from per make? Marti for Ford,
      registries for others — sourcing is unsolved).

**Critical-path minimum to "search resolves to one rich entity":** 1 → 2 → 3 →
4 → 6 → 8. Steps 5/7/9 make it maintainable and externally queryable; step 10 is
the long-tail enrichment that the autonomous-work gate says happens on demand or
when Skylar asks, not speculatively.

---

## What we are NOT doing

- Not minting a new "cohort layer" / "terminal engine" / named island. This is
  `projection_event` + `project_attribute` + the registry, extended by one
  `subject_kind`. (Per `feedback_dont_mint_new_structures_use_the_repo.md`.)
- Not building the financial index. `index_status` is a stubbed activation hook,
  defaulting `none`.
- Not materializing the full YMM Cartesian product. Subjects are demand-created.
- Not fabricating sparse blocks. A dark block is an intake gap, shown honestly.

---

## Section 5 (drilled): the index as the great invention — economic theory

*Appended 2026-06-16 after a precedent sweep (collector-car lending, Reg A+
fractional platforms, freeports, provenance economics, survival curves,
collectible indices). Five of six pillars are de-risked by operating precedent;
the thesis is largely an **assembly** play, not an invention play. The two
genuinely-novel pieces both reduce to one thing.*

### 5.1 The trust inversion — why this is buildable now and wasn't before

The historical barrier to securitizing distributed physical assets was never
multiplicity. McDonald's is investable across 40,000 locations; a cohort across
40,000 garages is the same topology. The barrier was **trust**: institutions
could not verify that distributed individual title-holders actually hold clean,
maintained, present assets. So capital demanded physical centralization — the
Fort Knox, the freeport, the vault — as a *proxy for trust*.

Nuke's provenance graph is **synthetic centralization**: it makes distributed
custody *verifiable* at institutional trust levels without physically moving the
cars. The freeport then becomes optional — the top-tier convenience, not the
precondition. This is the McDonald's-vs-Fort-Knox resolution: you don't need one
building if you can compute the trust state of ten thousand garages.

The precedent confirms this is the strongest, most defensible pillar. RM
Sotheby's and Sotheby's Financial already lend $1M–$250M against collector cars
at 50–60% LTV **with no borrower credit check — underwritten purely on the
asset's appraised value, provenance, condition, comps.** The trust machine
already exists at the ultra-high end; it runs on hand-built per-marque
certificates (Marti for Ford, Kardex for Porsche, auction catalogs for art) —
**siloed human-mediated PDFs.** The novelty is not the concept of
provenance-as-collateral. It is making provenance **computable and cross-marque**
at portfolio scale. That is exactly the data asset this subject system produces.

### 5.2 The oracle is the keystone — everything reduces to it

Two independent analyses (the schema design and the precedent sweep) converged
on the same gate: a YMM cohort cannot be priced, lent against, indexed, or
securitized without a **defensible price / provenance / survivor oracle.** Every
proven financial wrapper already exists off the shelf:

- **Lending:** asset-based, no-credit-check collateral lending — *exists* (RM
  Sotheby's, Sotheby's Financial, J.P. Morgan collection lines).
- **Securitization:** Delaware **series LLC**, each asset its own series, selling
  fractional interests under **SEC Reg A+ Tier 2**, broker-of-record **Dalmore
  Group**, secondary trading on a registered **ATS (PPEX / North Capital)** —
  *exists and is SEC-qualified* (Rally `RSE Collection, LLC`; Masterworks
  `Vault 1, LLC`; Collectable; Otis — all verifiable on EDGAR).
- **Custody:** tax-suspended freeport vaulting with **title-transfer-in-situ** —
  *exists at ~$100B scale* (Geneva Freeport, Le Freeport).

None of those are the moat. The moat is the **oracle** — the thing none of them
have and Nuke is uniquely positioned to produce. Build the oracle and the
wrappers snap on. Skip it and there's nothing to wrap.

### 5.3 Finiteness as the asset property — the survivor denominator

A YMM cohort has a **fixed production ceiling** (1966 Mustang = 607,568) and a
**monotonically declining survival curve** (1960s survivors attrite ~1–2%/yr;
~350,000 1965–66 Mustangs remain). This is not a weakness — it is a *depleting
finite asset*, which is more investable, not less. The novel first-class number
is the **survivor denominator**: surviving count out of fixed production, per
cohort, kept live. Today this exists only as coarse aggregate attrition rates or
hand-curated halo registries (Shelby, Hemi). No one maintains a per-VIN survivor
census for an *ordinary* cohort. `make_model.survival_estimate` over the cohort
member VINs is the floor of that number; the decay model that completes it is the
one **RESEARCH** node in the cascade.

Two value vectors, both captured by the cohort subject: **maintenance preserves
the individual unit** (removes it from the decay curve — this is what
proof-of-maintenance attests), while **depletion raises the survivor's scarcity
value**. The index NAV rides both.

### 5.4 The index is a restoration-coordination engine, not a price wrapper

The sharpest line in Skylar's articulation: *"indexes essentially become the
systems for people to restore all the vehicles in the index."* This is the part
with **no precedent anywhere** and it is the actual invention. Existing
collectible vehicles (Rally, Masterworks) are passive per-asset holdings —
buy a share, wait. A managed fund (Hetica, Cult Wines) is discretionary and
opaque. A measurement index (Hagerty, Knight Frank) is untradeable by
construction.

A YMM cohort index fuses three things nobody has fused: **(1) cohort/basket
structure, (2) direct tradability, (3) an underlying that the index's own capital
improves.** Capital into the index funds the restoration and maintenance of its
constituents → raises the cohort floor → raises NAV. The index *appreciates its
own underlying.* "Prime-to-subprime grouping" is quality-tranching within a
cohort: an unrestored numbers-matching original (higher ceiling than a repro)
and a driver-grade example are different tranches of the same subject.

### 5.5 Demand — corrected

The earlier claim "nobody wants exposure to a 1966 Mustang" was wrong, and the
correction matters for what we build. The demand is not cold financial exposure.
It is three real, currently-homeless behaviors:

1. **De-risking a passion asset.** A solo build becomes "a boat" — the two best
   days are buy and sell — because of error, downtime, and isolation. People
   still love the object; what fails them is the *process*. The index/cohort is a
   coordination layer that de-risks the heartbreak.
2. **The build-in-public economy.** People fund and participate in others' builds
   *right now*, on YouTube, with **zero provenance tracking and no path from
   donation to stake.** That infrastructure does not exist anywhere. Native
   provenance-tracked builds + donation→equity conversion + follower→stakeholder
   is greenfield with a proven behavioral base.
3. **The role economy.** Not everyone is a mechanic. The system can model every
   node-role (builder, documenter, financier, curator, audience) and *project
   potential viewer/market share per node position* — then route labor tickets
   and audience to value nodes and push users toward their goals. This is the
   "value-node matching" that replaces buildings-of-people with servers.

### 5.6 Activation thresholds — define the gate

The index is a gated activation (`make_model_profiles.index_status`), not an
always-on. Two triggers, to be specified:

- **Mass:** cohort accumulates N owned vehicles + N active builds + N
  events/quarter + sentiment volume above a defined floor. (Numbers TBD from
  real distribution once the terminal is populated — do not guess them now.)
- **Sponsor ("whale"):** a backer funds the index for a cohort regardless of
  organic mass. This is how real funds start (anchor LP). It is the more likely
  first path.

The **minimum viable index** is one cohort, one whale, a defensible oracle, and
the proof-of-maintenance attestation. Everything else scales from there.

### 5.7 The one gated action — and what is NOT gated

"I don't have to pay $500K to a securities lawyer to start drafting this" is
**true**, with one precise caveat. The *substrate* — the subject, the oracle,
the provenance graph, a cap-table-ready / series-LLC-ready schema,
proof-of-maintenance attestation — is **legally neutral to build.** None of it is
an offer or sale of a security. The single gated action is **issuing
fractional interests to investors.** That one button needs counsel before it is
pushed, and the path is already mapped (series LLC + Reg A+ + Dalmore BOR + ATS).
Per platform hygiene, we do **not** rebuild the deleted exchange/vault/betting
scaffolding now. We build the substrate that the deleted layer lacked, and the
financial layer drops in as activation when the oracle is trustworthy — which is
the sequencing the deletion already taught us.

### 5.8 Verdict on Section 5

The thesis survives scrutiny. Five of six pillars (lending, securitization
wrapper, freeport custody, provenance-as-value, finite-supply economics) are
de-risked by operating precedent — assembly, not invention. The two genuine
frontiers are **(a) the cohort as a tradable entity** (zero precedent — the real
invention) and **(b) the cross-marque computable provenance/oracle** (the moat).
Both reduce to the oracle. The oracle is the cohort terminal in this paper,
matured. **Build the oracle. The rest is already proven and waiting to snap on.**

### 5.9 Companion papers (the two frontiers, drilled)

The two frontiers each got a dedicated working paper this session:

- **`2026-06-16_proof_of_maintenance.md`** — the load-bearing primitive the
  lending/freeport layer has zero schema for. Shows proof-of-maintenance is a
  **projection over existing testimony** (`work_orders`/`work_order_labor`/
  `work_order_parts`/`work_sessions`/`timeline_events`/`vehicle_images`/
  `projection_event`), mirroring `vehicle_wiki()` — not a new island. Owner-
  confirmed labor (`confirm_work_session`) is the high-trust tier. Open question:
  *will a real lender accept a computed ledger in place of inspection?*
- **`2026-06-16_the_oracle.md`** — the defensible price/provenance/survivor oracle,
  the keystone every wrapper snaps onto. Shows the oracle is the **maturation** of
  `compute-vehicle-valuation` (8 signals) + `get_make_model_terminal` +
  proof-of-maintenance, not a greenfield. Three outputs (price, provenance,
  survivor); three genuine RESEARCH nodes (survivor decay model, cross-marque
  provenance normalization, per-marque production-figure sourcing).
