# 2026-05-24 — Killer Query Substrate Roadmap

**Status:** working paper / substrate maturity map
**Spawned from:** 2026-05-24 UI/substrate discourse (`discourses/2026-05-24_ui-substrate-rhizomatic-labels.md`)
**Companion:** `contemplations/rhizomatic-labels-and-crystallization.md`

---

## Why this paper exists

In the 2026-05-24 conversation, Skylar named three concrete killer queries that the substrate-backed UI must answer:

1. **"Show me the shop that uses the most 3M tape."**
2. **"Show me the best painter in Las Vegas."**
3. **"Show me the best screwdriver user in the USA."**

These are not throwaways. They are progressively harder substrate demands, and the gap between query #1 and query #3 maps cleanly onto the four-tier substrate readiness model. This paper enumerates what the substrate has today, what it lacks, and which tier of addition unlocks each query.

Premise from the discourse: **"ui the data to infer and then call to action confirm, coordinate and deliver"** — the UI's job is to project the substrate honestly into a query response, not to interpret. If the substrate cannot answer the query, the UI cannot fake it.

---

## The four substrate tiers

| Tier | What it adds | Existing peer system |
|------|-------------|----------------------|
| **T1: Existing tables, joinable** | The query is already answerable; no new substrate, just SQL | Standard BI on transactional DB |
| **T2: pgvector backfill on observation free-text** | Discrete labels become cosine-similarity queries over embedded testimony | Wikidata claim/reference/rank as a centroid system |
| **T3: `(x,y,z)` spatial anchor + 0-100 condition** | Geometric ground truth per volumetric measurement; crystallized facts emerge | FHWA National Bridge Inventory; DICOM longitudinal imaging |
| **T4: Real-time tool-event substrate** | Per-action atomic events from connected tools, observed at fleet scale | Industrial IoT (Predix/Mindsphere) |

Each tier is a strict superset of the prior; T2 is impossible without observation-as-substrate (T1), T3 is impossible without per-observation embedding (T2), T4 is impossible without per-zone geometric anchoring (T3).

---

## Killer Query #1 — "Show me the shop that uses the most 3M tape"

### Substrate maturity: ~60% answerable today

The pieces that exist:

- **`receipts` / `receipt_items`** — line-item OCR from invoices, with vendor SKU, quantity, and unit price. 3M tape products (Scotch-Brite, 233+, 401+, blue painter's tape) are identifiable by SKU stem when the OCR is clean.
- **`shops` / `actors`** — shop identity is modeled as a tier-1 actor in the entity-resolution model ([04-entity-resolution.md](../../reference/encyclopedia/04-entity-resolution.md)).
- **`work_orders` / `component_events`** — link a receipt to a shop and a vehicle, via the polymorphic event bridge ([novel-ontological-contributions.md](../../intellectual/papers/novel-ontological-contributions.md) §VII.C).

The query in SQL today:

```sql
SELECT s.id, s.name, SUM(ri.quantity) AS tape_units
FROM shops s
JOIN actors a ON a.shop_id = s.id
JOIN receipts r ON r.actor_id = a.id
JOIN receipt_items ri ON ri.receipt_id = r.id
WHERE ri.vendor_sku ILIKE '3M%'
  AND ri.product_name ILIKE ANY (ARRAY['%tape%', '%scotch%'])
GROUP BY s.id, s.name
ORDER BY tape_units DESC
LIMIT 10;
```

### Why only 60% today

1. **OCR coverage is sparse.** Most shops do not yet have receipt OCR enabled; the `receipt_items` table is heavy on Skylar's own shop and thin elsewhere. Coverage is selection-biased, not population-representative.
2. **SKU normalization is unfinished.** 3M's product line uses overlapping naming: "blue tape" can be 2090, 2080, or 233+, and the same product appears under different SKU stems across vendors (Amazon vs. Home Depot vs. local jobber).
3. **"Tape used" ≠ "tape purchased."** A shop with high tape purchases might also be reselling. The substrate currently conflates inventory acquisition with inventory consumption.

### Unlock: Tier 1 — run the query

The substrate is structurally sufficient. The work is operational, not architectural:

- Backfill OCR on the existing receipt corpus
- Normalize 3M SKUs against a curated 3M product catalog (already a known taxonomy, not a discovery problem)
- Add a `consumption_event` source to disambiguate purchase from use (when a tape SKU appears in a `component_events` row's evidence chain, it counts as consumed)

Estimated effort: 1-2 weeks at one agent's full attention. **The query is shippable in 2026 Q3 with the current substrate shape.**

---

## Killer Query #2 — "Show me the best painter in Las Vegas"

### Substrate maturity: ~30% answerable today

The pieces that exist:

- **`actors` with `role = 'painter'` and geographic attribution** — exists in the entity model; sparse in the data.
- **`vehicle_observations` with `damage_scan` operation** — produces 46,133 condition observations today ([novel-ontological-contributions.md](../../intellectual/papers/novel-ontological-contributions.md) §I.E).
- **`vehicle_surface_templates`** — zone-level 3D envelopes for ~50 body styles, providing the partial spatial anchor needed for condition attribution.

The query the founder is asking is, formally: "rank actors whose attributed paint work has the highest condition score per measured zone, normalized by elapsed time since the work was performed."

The bones:

```sql
SELECT a.id, a.name,
       AVG(o.condition_score) AS avg_condition,
       COUNT(*) AS measured_zones
FROM actors a
JOIN component_events ce ON ce.actor_id = a.id
JOIN vehicle_observations o ON o.vehicle_id = ce.vehicle_id
WHERE a.role = 'painter'
  AND a.location_metro = 'Las Vegas'
  AND ce.event_type = 'painted'
  AND o.observation_type = 'paint_condition'
  AND o.observed_at > ce.event_date
GROUP BY a.id, a.name
HAVING COUNT(*) >= 5
ORDER BY avg_condition DESC;
```

### Why only 30% today

1. **Painter attribution is shallow.** Most vehicles in the corpus do not have a paint event linked to a painter actor; the work was done by "someone, somewhere." The `component_events` table has the schema but lacks the data.
2. **Paint condition score is not yet `(x,y,z)`-anchored.** Today's `damage_scan` produces zone-tagged observations with bbox in image space (§I.B), not coordinates in physical space. The same paint condition at the front-passenger-quarter can be summarized correctly at zone resolution, but cannot yet be addressed at a sub-zone coordinate — which is required to detect things like "low orange peel except near the door handle" that distinguish painters.
3. **Time-decay is not applied to paint quality.** A paint job assessed as 92/100 three years ago is not the same evidence today as the same job assessed last month. The [testimony half-life](../../intellectual/contemplations/testimony-and-half-lives.md) model needs to be wired into the painter-ranking query.

### Unlock: Tier 3 — `(x,y,z)` spatial anchor

Tier 2 (embedding free-text observations like "smooth gloss" vs. "heavy orange peel") helps with the rhetorical layer but does not close the gap. The query needs the geometric layer.

Concretely:

- Build the per-vehicle volumetric reconstruction (3D Gaussian Splatting, Kerbl et al. SIGGRAPH 2023 is the current state of the art for phone-photo input).
- Project the `damage_scan` bbox observations from image space into the reconstructed 3D envelope, producing `(x,y,z)` anchors per observation.
- Treat each anchored observation as a crystallized fact per `contemplations/rhizomatic-labels-and-crystallization.md`.
- Backfill painter attribution via the existing `receipts` + `work_orders` chain.

Estimated effort: 1-2 quarters with photogrammetry tooling. **The query is shippable in 2026 Q4 / 2027 Q1 if `(x,y,z)` anchoring is prioritized.**

---

## Killer Query #3 — "Show me the best screwdriver user in the USA"

### Substrate maturity: ~5% answerable today

This is the hardest query Skylar named, and it is hard for a structural reason: the substrate has no per-fastener evidence. The current event grain is `component_event` ("installed alternator") — not `fastener_event` ("torqued the third bolt of the alternator bracket to spec").

The pieces that exist (barely):

- **`component_events`** — captures who did what to which part, on which vehicle, when. The grain is wrong for screwdriver-level work.
- **Tier 1 actor attribution** — when a shop or tech is attached to a vehicle session, every event in that session is attributable to that actor. But the events are work-session-grained, not action-grained.
- **Image evidence** — photographs of installed fasteners exist for some vehicles, and could in principle be analyzed for installation quality (clocking, marring, paint damage). But this analysis is not wired up.

### Why only 5% today

The query is asking for a population-scale ranking on a per-action quality signal that the substrate does not yet collect. It is the IoT version of the painter question: instead of "the best painter in Vegas" (a localized, low-volume query), it is "the best screwdriver user in the USA" (a fleet-scale, high-volume query). It requires:

1. **Per-tool event capture.** A screwdriver session emits events (torque applied, angle achieved, slippage detected). This is what the high-end automotive industrial assembly world already does with smart torque tools (Atlas Copco, Ingersoll Rand) — and what the maker/restoration shop world does almost not at all.
2. **Tool-to-actor binding.** The event must carry "who is holding the tool" — a hardware identity (Bluetooth pairing, RFID, login) or a vision-based attribution chain.
3. **Tool-to-component binding.** The event must carry "which fastener on which vehicle" — usually via the shop's work-order context plus the tool's spatial position.
4. **Population scale.** "Best in the USA" implies the substrate sees enough actors using tools on enough vehicles that the ranking is statistically meaningful. The Nuke marketplace coordination layer (Skylar's "infer, confirm, coordinate, deliver, cut" framing) is what would generate this scale — every coordinated job becomes substrate.

### Unlock: Tier 4 — real-time tool-event substrate at fleet scale

This is not a query the substrate can answer with refactoring. It is a query that requires *new substrate kinds* and *new ingestion paths*. The closest peer system is industrial IoT — Predix, MindSphere, AWS IoT TwinMaker — which already operates at this grain in factory and energy contexts. The work is to bring it down-market into the restoration and repair shop world.

Concretely:

- Define the `tool_event` table grain: `(actor_id, tool_id, vehicle_id, fastener_id, event_type, measurement_jsonb, observed_at)`.
- Pilot with one shop, one tool category (smart torque drivers are the lowest-friction entry).
- Build the marketplace coordination layer in parallel so that participating in Nuke's coordinated work generates the substrate as a side effect, without requiring shops to adopt new tooling for non-Nuke work.
- Population scale arrives via marketplace adoption, not via direct data acquisition.

Estimated effort: 2-3 years from substrate definition to population scale. **The query is shippable in 2028+ if the marketplace coordination layer ships and a tool-event substrate is defined.**

---

## Tier-by-tier summary

| Query | Today | Tier needed | Concrete unlock | Shippable by |
|-------|-------|-------------|-----------------|--------------|
| 3M tape per shop | 60% | T1 | OCR backfill + SKU normalization | 2026 Q3 |
| Best painter in Vegas | 30% | T3 | `(x,y,z)` anchoring via Gaussian splat reconstruction + painter attribution | 2026 Q4 / 2027 Q1 |
| Best screwdriver user in USA | 5% | T4 | `tool_event` substrate definition + marketplace-driven adoption | 2028+ |

---

## What this implies for sequencing

Three things follow.

**T1 is the immediate win.** The 3M-tape query is shippable this quarter with operational work — OCR backfill, SKU normalization, consumption-vs-purchase disambiguation. It produces a working demo of the "infer → confirm → coordinate → deliver → cut" UI on a low-stakes query. Ship it.

**T2 is the substrate refactor that unblocks everything else.** Adding pgvector embeddings to `vehicle_observations` plus the existing testimony tables is the lowest-cost, highest-leverage substrate change. It is what makes labels-as-projections work ([rhizomatic-labels-and-crystallization.md](../../intellectual/contemplations/rhizomatic-labels-and-crystallization.md)) and what makes the "find similar" UI queries possible. It should land before any new label-driven features. Hamilton, Leskovec & Jurafsky's diachronic embedding methodology (ACL 2016) gives a free observability layer: vocabulary drift becomes a measurable property of the platform's corpus, not a hidden tax on data quality.

**T3 is the bet that defines 2027.** `(x,y,z)` spatial anchoring is the geometric layer that the founder named as the only ground truth he will commit to. It unlocks the painter query, the insurance-defeating coordination layer, the per-volumetric-measurement condition rating that the marketplace UX needs. The path is Gaussian Splatting from phone-photo input (technology exists, calibration is the open work) plus painter-attribution backfill. This is the load-bearing 2027 substrate investment.

**T4 is a marketplace-driven future, not an engineering project.** The screwdriver-user query is unanswerable until Nuke is coordinating enough physical-world work that the substrate falls out as a byproduct. This is not a substrate task to ship — it is a business motion that produces the substrate. The engineering work is to define the grain (the `tool_event` schema) and the API so that when adoption arrives, the data lands cleanly.

---

## What this is not

This is not a roadmap for the platform — it is a substrate-maturity map for three queries the founder named. The platform roadmap (PROJECT_STATE.md) carries the prioritized work. This paper exists to make explicit which tier of substrate addition unlocks which class of query, so that "build feature X" can be evaluated against "does this advance T1/T2/T3/T4?"

This is not a claim that all queries reduce to these three. It is a claim that *these three are diagnostic*: a substrate that answers the 3M-tape query has demonstrated T1 maturity; one that answers the painter query has demonstrated T3 maturity; one that answers the screwdriver-user query has demonstrated T4 maturity. The progression is real.

---

## Open questions

1. Does the 3M-tape SKU normalization belong in `parts_catalog` (the [supply side](../../intellectual/contemplations/the-supply-side.md) substrate) or in a vendor-product taxonomy layer? Probably the former; verify before shipping.
2. What is the minimum geometric reconstruction quality for `(x,y,z)` anchoring to support the painter query? Likely the reconstruction needs <2cm absolute scale error per surface; phone-photo Gaussian splats today achieve 5-10cm without fiducials.
3. How does the `tool_event` substrate integrate with the existing `component_events` polymorphic event bridge? Either as a finer-grain peer table or as a sub-event nested under work-order context — both work, but the choice changes the SQL surface for "actor's track record" queries.
4. What is the half-life of a paint-condition crystallized fact? The geometric layer is more permanent than the rhetorical layer (per [rhizomatic-labels-and-crystallization.md](../../intellectual/contemplations/rhizomatic-labels-and-crystallization.md) §V) — but paint fades, oxidizes, gets re-sprayed. The painter query needs a calibrated half-life for paint condition before its ranking is meaningful.
