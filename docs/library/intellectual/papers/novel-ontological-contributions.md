# PAPER: Novel Ontological Contributions from a Production Vehicle Knowledge Graph

**Author:** Nuke Platform Research
**Date:** 2026-03-26
**Status:** Living Document
**Companion to:** applied-ontology-vehicle-domain.md, applied-ontology-evidence-map.md
**References:** Contemplations: the-rhizome.md, testimony-and-half-lives.md, assets-accumulate-data.md; Theoreticals: observation-half-life-model.md, signal-calculation.md, entity-resolution-theory.md

---

## Abstract

Production knowledge systems, by virtue of their relentless contact with messy reality, sometimes arrive at formalizations that the academic ontology community has not yet addressed. This paper identifies seven contributions from the Nuke vehicle knowledge graph that extend beyond current practice in applied ontology: (1) a spatial condition ontology that maps image evidence through named zones to three-dimensional physical coordinates, (2) a lifecycle state model borrowing from manuscript studies to formalize layered material histories, (3) recursive epistemological decay where even the methodology citations justifying design decisions are subject to temporal relevance loss, (4) disagreement-as-data where contradictions between sources are first-class observations rather than errors to be resolved, (5) executable domain axioms implemented as database constraints encoding ontological rules, (6) a nine-category decomposition of photographic evidence into structured fact types, and (7) component-level total resolution tracking individual parts at the casting-number level through independent provenance chains. Each contribution is demonstrated with production evidence and connected to open questions in the formal ontology literature.

---

## I. The Spatial Condition Ontology

### I.A The Problem: Condition is Spatial, Not Global

Standard vehicle condition assessments — Hagerty's 1-4 scale, CCCA's 100-point system, Bring a Trailer's photo-based crowd judgment — treat condition as a property of the whole vehicle. A vehicle "is" a #2 condition car. But condition is not a global property. It is a *field* over the vehicle's body: the driver's door may show different wear than the passenger's door; the engine bay may be concours while the undercarriage is corroded.

The Nuke platform formalizes this with a multi-layer spatial ontology that bridges three coordinate systems.

### I.B Three Coordinate Spaces

**Image Space.** Every observation from a photograph carries a bounding box (`bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`) in normalized image coordinates. This locates the observation within its source evidence.

**Zone Space.** The platform defines ~42 named zones spanning exterior (front driver, front passenger, rear, sides, quarters, roof, undercarriage), interior (dashboard, steering, gauges, seats, headliner, door panels, cargo), mechanical (engine bay, exhaust, suspension, transmission), and detail regions (badges, VIN plate, odometer). Each observation maps from image space to zone space through classification.

**Physical Space.** The `vehicle_surface_templates` table stores actual body dimensions in inches for specific year/make/model/body-style combinations, with per-zone three-dimensional bounding boxes. The coordinate system uses: **u** (length axis, bumper-to-bumper), **v** (width axis, driver-to-passenger), **h** (height axis, ground-up). A 1971-1989 Mercedes-Benz 350SL (180" x 71" x 51") has 41 zone bounds, each specifying the physical envelope in inches from the vehicle's datum points.

This means an observation like "paint oxidation on the front driver quarter panel" is not merely a label. It occupies a specific region in image space (from which photo), a named zone (ext_front_driver), and a physical envelope (u: 0-36", v: 0-35.5", h: 10.2-43.4" on this specific body type).

### I.C Resolution Levels: Fractal Zoom

The `resolution_level` field enables progressive precision:
- **Level 0**: Zone (entire panel or area)
- **Level 1**: 6x6 grid within the zone (~36 sub-regions per zone)
- **Level 2**: 2x2 sub-grid within Level 1 (~144 sub-regions per zone)
- **Level 3**: 1x1 precision (individual observations at sub-inch resolution)

Currently 373,069 observations across 4,793 vehicles operate at Level 0. The schema supports fractal zoom to sub-inch precision when evidence quality warrants it.

### I.D Camera Angle as Ontological Filter

The `angle_spectrum_zones` table maps camera viewing angles (in spherical coordinates) to which body zones are visible from that perspective. A front-three-quarter-driver photograph (x: -90 to -45, y: -45 to -15) sees different zones than a straight-side passenger view (x: 60-90, y: -15 to 15). This formalizes a relationship that human appraisers use implicitly but that no assessment system makes explicit: the *angle from which evidence was gathered* constrains *what the evidence can tell you*.

### I.E Multi-Pass Analysis

Observations accumulate through progressive analysis passes:
1. **zone_classify** (326,794 observations): What zone does this image region belong to?
2. **damage_scan** (46,133 observations): What condition phenomena are present?
3. **mod_scan** (142 observations): What modifications are visible?

Each pass deepens the analysis without overwriting previous passes. The surface coverage view (`vehicle_surface_coverage`) aggregates per vehicle per zone: image count, observation count, maximum resolution achieved, observation types present, severity statistics, and lifecycle states observed.

### I.F Relation to Existing Work

GIS (Geographic Information Systems) provides spatial ontologies for geographic data. BIM (Building Information Modeling) provides spatial ontologies for architectural elements. DICOM provides spatial ontologies for medical imaging. No equivalent formalization exists for vehicle body condition mapping. The closest analog is the CIDOC-CRM model for cultural heritage objects, which tracks physical modifications over time but does not map them to spatial coordinates on the object's body.

The Nuke spatial condition ontology contributes a domain-specific formalization: condition as a scalar field over a three-dimensional body envelope, sampled through photographs at known camera angles, accumulated through progressive analysis passes, and queryable at multiple resolution levels.

---

## II. The Palimpsest Lifecycle Model

### II.A Beyond Grading Scales

Every existing vehicle condition system uses a linear scale: mint to parts-car, 1 to 4, 100 to 0. These scales assume condition is a single dimension — a vehicle is *more* or *less* well-preserved. This assumption fails for vehicles with complex material histories.

A 1969 Camaro that was drag-raced in the 1970s, repainted in the 1980s, partially restored in the 2000s, and then sat in a barn for a decade does not occupy a point on a linear scale. It occupies a *state* that is qualitatively different from either a well-preserved original or a recently restored car. Its surfaces carry simultaneous evidence from multiple eras. It is, in the vocabulary of manuscript studies, a *palimpsest*.

### II.B Seven States

The platform defines seven lifecycle states, each a distinct ontological category:

| State | Definition | Ontological Character |
|-------|-----------|----------------------|
| **fresh** | New or recently restored to as-new condition | Temporal unity — one era dominates |
| **worn** | Normal use-related aging; patina developing | Gradual departure from fresh; single continuous process |
| **weathered** | Extended exposure beyond normal wear | Environmental interaction has produced irreversible change |
| **restored** | Intentional return toward original condition | Human intervention to reverse temporal effects |
| **palimpsest** | Layered history visible — multiple eras simultaneously legible | Temporal multiplicity — several eras coexist as physical evidence |
| **ghost** | Severe deterioration; vehicle barely recognizable as its original form | Identity persists but physical manifestation is attenuated |
| **archaeological** | Salvage/ruin; more evidence than vehicle | The object has become primarily an evidence source rather than a functional artifact |

### II.C Lifecycle Affinity: The Bidirectional Map

Each condition descriptor in the taxonomy declares which lifecycle states it belongs to. This creates a bidirectional relationship between conditions and states:

- `exterior.paint.oxidation` affiliates with `worn`, `weathered`
- `exterior.paint.delamination` affiliates with `weathered`, `ghost`
- `exterior.body.filler` affiliates with `restored`, `palimpsest`
- `provenance.numbers.matching` affiliates only with `palimpsest`

The last entry is revealing: "matching numbers" — the verification that a vehicle's major components are factory-original — only becomes a meaningful descriptor for vehicles with layered histories. A fresh-from-factory vehicle trivially has matching numbers. The concept only acquires ontological weight when the vehicle has accumulated enough history that the *question* of matching becomes non-trivial.

### II.D The Palimpsest as Ontological Category

The term "palimpsest" is borrowed from medieval manuscript studies, where it describes a parchment written on, scraped off, and written on again, with earlier layers still partially visible through the new text. Applied to vehicles, this captures a specific state where:

- A 1960s factory paint job shows through a 1980s respray that has been partially sanded in a 2020 restoration attempt
- Body filler from a 1975 accident repair is visible beneath current paint
- An engine block carries both its original casting date code and evidence of a 1990s rebuild

All temporal layers are simultaneously present as physical evidence. The vehicle is not in any one "condition" — it is in a state of temporal superposition where multiple eras coexist in the material record.

Standard grading systems have no vocabulary for this state. They would call it "driver quality" or "#3 condition" — losing the critical information that the vehicle is legible as a multi-layered historical document. The palimpsest state is not a point on a linear scale; it is a qualitatively distinct mode of being that requires its own descriptive apparatus.

### II.E Archaeological and Ghost States

Equally novel are the terminal states. A "ghost" vehicle — barely recognizable as its original form — and an "archaeological" vehicle — more evidence source than functional object — are categories that standard systems refuse to engage with. They would be "parts cars" at best, ungraded at worst. But for provenance research, these are often the most informative states: the archaeological vehicle reveals construction details invisible on preserved examples, and the ghost vehicle preserves evidence of modification histories that restored vehicles have obliterated.

### II.F Production Evidence

Live data shows lifecycle distribution across 373,069 surface observations:
- worn: 144,005 (38.6%)
- ghost: 86,823 (23.3%)
- weathered: 35,067 (9.4%)

The high proportion of ghost-state observations (23.3%) confirms that the platform encounters vehicles in states that standard grading systems refuse to classify — and that formalizing these states is not academic exercise but operational necessity.

---

## III. Recursive Epistemological Decay

### III.A The Standard Claim: Data Has Provenance

Every knowledge graph platform acknowledges that data has sources. Most track provenance — where a fact came from. Some weight facts by source authority. A few apply temporal decay to reduce the influence of stale observations.

The Nuke platform goes further: it applies the same decay framework to the *methodology citations that justify its own design decisions*.

### III.B The Methodology Citations System

The `methodology_references` table tracks 17 academic papers that inform platform design. Each paper has:
- A `relevance_half_life_days` value (548-1095 days)
- A `superseded_by` field (pointing to the paper that replaces it)
- A computed `relevance_pct` via `methodology_relevance_score()`

The decay function is identical to the observation decay function:

```
relevance = 100 * 0.5^(age / half_life)
```

Superseded papers are capped at 25% maximum relevance. Retracted papers drop to 0%.

### III.C The Recursive Structure

This creates a three-level recursive epistemology:

1. **Observations about vehicles** decay based on observation kind (listing: 90 days, condition: 365 days, specification: permanent)
2. **Trust scores for sources** adjust based on whether their observations are corroborated or contradicted over time
3. **Methodology papers that justify how trust scores work** decay based on the age and supersession status of the research

The system's justification for *how it reasons about data* is itself subject to temporal scrutiny. A 2024 paper on hallucination detection is currently at 91.4% relevance — but in three years, if not superseded, it will be at ~45%. If a newer paper contradicts its findings, it drops to 25% maximum.

### III.D The Methodology-to-Pipeline Bridge

This is not merely a citation tracking system. The `_shared/methodology.ts` module:
1. Queries the `methodology_active` view for papers above 50% relevance
2. Builds a compressed text block (~800-1200 tokens)
3. Prepends this to every extraction system prompt

The AI models that extract data from vehicles are *literally instructed by temporally-decaying academic citations*. When a paper's relevance drops below 50%, it stops influencing extraction behavior. When it is superseded, its influence attenuates to 25% and continues declining.

### III.E The `methodology_benchmarks` Table

The schema includes a `methodology_benchmarks` table designed to track the delta between paper-reported metrics and the platform's measured metrics. Columns include `paper_reported_value`, `measured_value`, and `delta_from_paper`. This is a built-in replication tracking system — the platform can empirically evaluate whether the academic claims it relies on hold up in production.

### III.F Relation to Existing Work

Meta-epistemology — reasoning about the foundations of one's own reasoning — is well-established in philosophy (Sosa 2007, Greco 2010). But implementations in production systems are vanishingly rare. Most systems trust their design assumptions permanently. The Nuke platform's recursive decay model acknowledges that even its own epistemic foundations are time-bound claims subject to revision.

---

## IV. Disagreement as Data

### IV.A The Standard Approach: Resolve Conflicts

When two sources provide conflicting values for a field, standard practice is to pick the more authoritative value and discard or archive the loser. Conflict is treated as a problem to be solved — an error state to be resolved into a single correct value.

### IV.B The Alternative: Contradiction as Observation

The Nuke platform treats contradiction itself as evidence. When the multi-model extraction pipeline produces divergent values:

```javascript
const corroborationFactor = Math.min(1.5, 1.0 + 0.15 * (models.length - 1));
// Agreement boosts confidence: 2 models = 1.15x, 3 models = 1.30x, cap at 1.50x

// Disagreement creates a new observation
if (contradiction) {
    insertObservation({
        extraction_method: 'contradiction_detection',
        confidence: 0.30,
        structured_data: { claims: divergentValues }
    });
}
```

The contradiction observation persists in the graph with its own confidence score (0.30). It is not an error to be resolved — it is a datum about the *state of knowledge*. The fact that Claude says "V8 350" and Gemini says "V8 327" for engine displacement is itself informative: it suggests the source text is ambiguous, or that the distinction requires domain expertise that one model has and the other lacks.

### IV.C The Three-Table Field Model

The evidence/consensus/provenance triple makes this explicit:

- **`vehicle_field_evidence`** (747,229 rows): Every claim, from every source, preserved with its original confidence and source attribution. Multiple claims about the same field coexist.
- **`vehicle_field_consensus`**: The resolved value — but crucially, the resolution carries `supporting_count`, `conflicting_count`, and `resolution_method` (which may be `unresolved`). Unresolved disagreements are a valid state, not a bug.
- **`vehicle_field_provenance`** (121,148 rows): The authoritative record tracks both `supporting_sources` and `conflicting_sources` as parallel arrays. The provenance of a field includes the record of who disagreed.

### IV.D Mileage Inconsistency as Automatic Ontological Validation

The timeline event system includes automatic conflict detection:

```sql
conflict_type IN ('date_mismatch', 'mileage_inconsistency', 'duplicate_event', 'contradictory_info')
resolution_status IN ('unresolved', 'resolved', 'accepted_discrepancy', 'merged_events')
```

The system knows that mileage is monotonically increasing. When an observation reports lower mileage than a previous observation at a later date, a `mileage_inconsistency` conflict is automatically created. Critically, `accepted_discrepancy` is a valid resolution — the system can acknowledge that the inconsistency is real and unresolvable, rather than forcing a false resolution.

### IV.E Relation to Existing Work

Paraconsistent logics (da Costa 1974, Priest 2006) formalize reasoning in the presence of contradictions. Belief revision theory (Alchourron, Gardenfors, Makinson 1985) studies how to update beliefs when new information conflicts with existing beliefs. The Nuke platform's approach is closer to paraconsistent logic: contradictions are tolerated as data rather than triggering belief revision. The `accepted_discrepancy` status is an explicit commitment to living with contradiction rather than resolving it prematurely.

---

## V. Executable Domain Axioms

### V.A Ontological Rules as Database Constraints

Most ontology engineering separates the ontology (the formal specification) from the data store (the database). The ontology is expressed in OWL; the database stores instances; a reasoner checks consistency. This separation has benefits (formality, portability) but costs (the database can violate the ontology without the reasoner's knowledge).

The Nuke platform collapses this separation. Domain axioms are expressed as CHECK constraints, trigger functions, and normalization rules that execute at the database level. The ontology is not a separate artifact — it is embedded in the DDL.

### V.B Examples of Executable Axioms

**Series-drivetrain consistency.** In the Chevrolet truck taxonomy, "C" designates conventional (2WD) and "K" designates four-wheel-drive. These are not arbitrary labels — they are ontological categories that constrain what other properties are valid:

```sql
-- C-series trucks MUST be 2WD
-- K-series trucks MUST be 4WD
-- If 4WD is detected on a C-series, auto-correct to K-series
```

**Temporal naming validity.** Chevrolet renamed its trucks twice: in 1988 (C10 → C1500) and in 1999 (C/K → Silverado). The database encodes these transitions as executable rules:

```sql
-- C10 designation only valid 1960-1987
-- After 1987, auto-correct to C1500
-- Silverado name only valid 1999+
-- Before 1999, Silverado is a trim level, not a model
```

**Price type epistemology.** Six price types are defined, each with a different ontological status:

```sql
price_type IN ('sale_price', 'asking_price', 'market_listing',
               'current_value', 'purchase_price', 'msrp')
```

A `sale_price` is a historical fact (a transaction occurred). An `asking_price` is a claim (a seller's assertion). A `current_value` is an estimate (a model's output). An `msrp` is a factory specification (an institutional assertion). The database enforces that these categories cannot be confused.

### V.C Normalization as Ontological Alignment

The cascading field validation system maintains normalization tables that map surface variants to canonical forms:

```
"4x4" = "4WD" = "four wheel drive" = "4 wheel drive" = "K"
"C10" = "C-10" = "c10"
"350" = "5.7L" (when referring to engine displacement)
```

This is not merely string normalization. It is ontological alignment — the system recognizes that different surface forms refer to the same concept and maps them to a canonical representation. The normalization rules embody domain knowledge about what terms are synonymous in the vehicle domain.

### V.D Relation to Existing Work

SHACL (Shapes Constraint Language) provides a W3C standard for validating RDF graphs against constraints. The Nuke platform's CHECK constraints serve the same function but are co-located with the data store rather than expressed as a separate validation layer. This has the advantage of guaranteed enforcement (the database cannot contain an invalid state) at the cost of portability (the axioms are expressed in PostgreSQL, not a standardized constraint language).

---

## VI. The Image Fact Fabric

### VI.A Photographs as Structured Evidence Documents

Standard vehicle databases treat images as attachments — binary blobs associated with a vehicle record. The Nuke platform treats photographs as structured evidence documents that contain multiple types of facts.

### VI.B Nine Fact Categories

The `image_fact_type` enum decomposes what a photograph can contain:

| Category | What It Captures | Downstream Consumer |
|----------|-----------------|-------------------|
| **component** | A specific part is visible (engine, transmission, wheel) | Valuation, timeline |
| **damage** | Physical damage evidence | Condition scoring, valuation |
| **document** | A readable document appears in the photo (title, receipt, build sheet) | Timeline, provenance |
| **measurement** | A measurable quantity is visible (odometer reading, paint meter) | Field evidence |
| **person** | A person is present in the image | Actor identification |
| **tool** | Tools or equipment visible (implying work in progress) | Work record evidence |
| **instruction** | Written instructions or diagrams visible | Technical knowledge |
| **environment** | The setting (garage, show field, auction block) | Provenance, sighting |
| **anomaly** | Something unexpected or inconsistent | Conflict detection |

Each fact extracted from a photograph carries a bounding box, confidence score, and routing to specific downstream analysis pipelines. A single photograph of a vehicle at an auction might contain: a component fact (engine visible through open hood), a document fact (auction tag visible on windshield), an environment fact (auction block setting), and a person fact (auctioneer visible).

### VI.C The Evidential Chain

The image fact fabric creates an evidential chain from pixels to knowledge:

1. **Image** → raw pixels from a source (listing, photo library, inspection)
2. **Surface observation** → spatial facts with bounding boxes and zone assignments
3. **Image facts** → typed evidence extraction (component, damage, document, measurement...)
4. **Field evidence** → structured claims derived from image analysis
5. **Observation** → formal observation with provenance, confidence, and decay

A photograph of a VIN plate becomes: an image → a surface observation in the `detail_vin_plate` zone → a document-type image fact → a field evidence entry for the VIN field → an observation of kind `specification` with permanent half-life.

### VI.D Relation to Existing Work

Computer vision research produces object detection and segmentation models. Scene graph generation (Johnson et al. 2015) extracts structured relationships from images. The image fact fabric operates at a higher level of abstraction: not "what objects are in this image" but "what evidence types does this image contribute to the knowledge graph." This is closer to document analysis (decomposing a document into structured elements) than to object detection — but applied to photographs of physical objects rather than textual documents.

---

## VII. Component-Level Total Resolution

### VII.A The Standard: Vehicle-Level Data

Standard vehicle databases — Carfax, AutoCheck, Hagerty, KBB — model vehicles as atomic entities. A vehicle has a VIN, a year, a make, a model, a mileage, and a price. Components (engine, transmission, differential) may be listed as properties of the vehicle, but they are not independently tracked entities.

### VII.B The Alternative: Components as First-Class Entities

The Nuke platform models 63 component types as first-class entities with their own identity, provenance, and condition:

**Engine subsystem (16 tables):** blocks, heads, pistons, connecting rods, crankshafts, camshafts, carburetors, fuel injection systems, distributors, intake manifolds, exhaust manifolds, oil systems, cooling interfaces, accessories, hardware, and cylinder measurements.

**Transmission subsystem (8 tables):** cases, gears, internals, clutch systems, torque converters, shifters, coolers, and controllers.

**Body subsystem (11 tables):** panels, structure, glass, lighting, mirrors, bumpers, trim/chrome, weatherstripping, emblems/badges, and convertible tops.

Each component table carries:
- **Identity** (`casting_number`, `part_number`, `date_code`): The component's own constitutive identity, independent of the vehicle it is installed in.
- **Condition** (`condition_grade`, `condition_notes`): The component's individual physical state.
- **Provenance** (`is_original`, `provenance`: original/nos/reproduction/aftermarket/unknown, `provenance_detail`): Whether this is the factory-original part and how that was determined.
- **Domain-specific measurements**: bore, stroke, displacement for engine blocks; thickness for brake rotors; gauge range for wiring harnesses; paint thickness in mils for paint systems.

### VII.C The Polymorphic Event Bridge

The `component_events` table uses a polymorphic foreign key pattern (`component_table` text + `component_id` uuid) to connect any component from any of the 63 tables to an event:

```
WHO (actor_id → actors)
did WHAT (event_type: installed, removed, rebuilt, inspected, tested, measured...)
to WHICH PART (component_table + component_id → any of 63 tables)
on WHICH VEHICLE (vehicle_id → vehicles)
WHEN (event_date)
WHERE (location)
with EVIDENCE (evidence_ids uuid[] → field_evidence)
at WHAT COST (cost_cents, currency)
per WHAT WORK ORDER (work_order_id)
```

This is a fully reified event ontology. Every interaction between an actor and a vehicle component is recorded as a structured event with full provenance.

### VII.D Component Identity Independence

A critical ontological consequence: components have identity independent of the vehicle they are installed in. An engine block with casting number 3970010 and date code J169 (October 16, 1969) *exists as an entity* whether it is in a 1969 Camaro, sitting on a shelf in a machine shop, or listed for sale on eBay. The component's identity follows it across vehicles and contexts.

This means the system can answer questions that vehicle-level databases cannot:
- "Where is the original engine from VIN 124379N600123?" (It may be in a different vehicle.)
- "How many vehicles have been through this shop?" (Count distinct vehicle_ids from component_events where actor_id = shop.)
- "What is this mechanic's track record with small-block Chevy rebuilds?" (Aggregate component_events by actor, filter by component table and event type.)

### VII.E Relation to Existing Work

Parts ontologies exist in manufacturing (IOF, International Organization for Standardization). Product lifecycle management (PLM) systems track components through manufacturing and assembly. The Nuke platform extends these concepts into the *post-factory* lifecycle — tracking components through decades of ownership, modification, rebuilding, and re-installation. The component is not just a manufactured item; it is a persistent entity with a biography that may span multiple vehicles and multiple human actors.

---

## VIII. Open Questions and Research Agenda

### VIII.A Spatial Condition Aggregation

How should zone-level condition observations be aggregated into vehicle-level condition scores? Simple averaging loses the spatial structure. Weighted averaging requires justifying the weights (is the engine bay worth more than the trunk floor?). The relationship between spatial condition distributions and market valuation is an open empirical question that the platform's data could help answer.

### VIII.B Lifecycle State Transitions

Are lifecycle states strictly ordered (fresh → worn → ... → archaeological), or can vehicles skip states or transition non-linearly? A vehicle that goes from ghost directly to fresh (a complete rotisserie restoration) skips several intermediate states. The formal structure of the transition graph is an open question.

### VIII.C Decay Function Calibration

The current half-life values (listing: 90 days, condition: 365 days, etc.) are based on domain expertise, not empirical measurement. The platform accumulates the data needed to calibrate these empirically: when a new observation contradicts an older one, the age of the older observation at the point of contradiction is a data point about its actual half-life.

### VIII.D Component Provenance Across Vehicles

When an engine is removed from Vehicle A and installed in Vehicle B, how should the provenance chain be modeled? The current system tracks this through component_events (removed from A, installed in B), but the formal semantics of component identity transfer are underspecified.

### VIII.E Cross-Modal Evidence Fusion

The platform holds text testimony, photographic evidence, VIN decode data, and structured measurements about the same vehicles. Formalizing how these different evidence modalities should be combined — especially when they conflict — is an open problem that connects to multi-modal fusion research in AI and to evidence combination theory in epistemology.

### VIII.F Adversarial Epistemology

Sellers have incentives to misrepresent vehicle condition and history. The trust decay framework handles honest disagreement but does not explicitly model deception. Formalizing adversarial epistemology — reasoning about knowledge when some sources are deliberately unreliable — would strengthen the platform's evidential framework and contribute to the broader literature on trust in knowledge systems.

---

## IX. Conclusion

These seven contributions did not emerge from a research program. They emerged from the operational demands of building a production knowledge graph for a domain where standard approaches failed. The spatial condition ontology was built because flat condition grades lost information. The palimpsest lifecycle model was introduced because linear grading scales could not describe the vehicles the platform actually encountered. The recursive epistemological decay was necessary because the AI extraction pipeline needed to be told *which research to trust this month*.

We present these contributions not as finished formalizations but as working solutions that may benefit from engagement with the formal ontology community. The platform's 3.3 million observations, 373,000 spatial condition assessments, 747,000 field evidence entries, and 63 component tables constitute both a testbed and a challenge: can formal ontology tools handle the scale, heterogeneity, temporal complexity, and adversarial conditions of a real-world physical asset domain?

The code is the ontology. The database is the knowledge graph. The constraints are the axioms. The views are the projections. Every INSERT is an ontological act. We invite the community to examine whether production systems like this have something to teach formal ontology — and whether formal ontology has tools that could make systems like this better.

---

## References

- Alchourron, C., Gardenfors, P., & Makinson, D. (1985). "On the Logic of Theory Change." *Journal of Symbolic Logic*, 50(2), 510-530.
- da Costa, N.C.A. (1974). "On the Theory of Inconsistent Formal Systems." *Notre Dame Journal of Formal Logic*, 15(4), 497-510.
- Greco, J. (2010). *Achieving Knowledge: A Virtue-Theoretic Account of Epistemic Normativity.* Cambridge University Press.
- Johnson, J. et al. (2015). "Image Retrieval Using Scene Graphs." *CVPR 2015.*
- Priest, G. (2006). *In Contradiction: A Study of the Transconsistent.* Oxford University Press.
- Sosa, E. (2007). *A Virtue Epistemology: Apt Belief and Reflective Knowledge.* Oxford University Press.
- Nuke Platform. (2026). "Observation Half-Life Model." Internal Theoretical.
- Nuke Platform. (2026). "Signal Calculation." Internal Theoretical.
- Nuke Platform. (2026). "Entity Resolution Theory." Internal Theoretical.
