# PAPER: From Protege to Production — Why Formal Ontology Tools Failed the Physical Asset Domain

**Author:** Nuke Platform Research
**Date:** 2026-03-26
**Status:** Living Document
**Series:** Applied Ontology in the Collector Vehicle Domain (Paper 4 of 5)

---

## Abstract

Protege, OWL, RDF, and SPARQL represent a mature technology stack for ontology engineering. They have produced significant results in biomedicine, cultural heritage, and scientific knowledge management. Yet when we attempted to apply these tools to the collector vehicle domain — a $50B+ market with 3.3 million observations across 387,000 vehicles — every standard approach failed in predictable ways. This paper documents those failures, explains why they are structural rather than incidental, and describes the alternative architecture that emerged: a PostgreSQL-native knowledge graph where the schema IS the ontology, CHECK constraints ARE the axioms, views ARE the projections, and every INSERT is an ontological act. We argue that for domains characterized by contested assertions, adversarial sources, temporal decay, and individual-centric knowledge, the Semantic Web stack is not merely inconvenient but architecturally mismatched.

---

## I. What Protege Gets Right

Before cataloguing failures, we should acknowledge what the Semantic Web stack does well.

**Formal semantics.** OWL provides description logic foundations. Every class, property, and restriction has a precise interpretation. Reasoners can infer new knowledge from stated axioms. This is genuinely powerful for domains where the T-Box (terminological knowledge) is the primary deliverable — gene ontologies, disease classifications, chemical compound hierarchies.

**Portability.** OWL/RDF ontologies are platform-independent. An ontology built in Protege can be served by any triple store, queried by any SPARQL endpoint, validated by any SHACL processor. This enables the kind of knowledge sharing that Gruber (1993) originally envisioned.

**Community tooling.** Protege has 350,000+ registered users. WebProtege enables collaborative editing. The VOWL plugin provides instant visualization. The ecosystem is real and functional.

**Separation of concerns.** The ontology (the formal specification) is cleanly separated from the data store (the knowledge base). This enables versioning, comparison, and evolution of the ontology without touching the data.

These are genuine strengths. The question is whether they are the *right* strengths for the physical asset domain.

---

## II. Five Structural Failures

### II.A The T-Box / A-Box Imbalance

**The problem.** Classical ontology engineering assumes the hard work is defining classes, properties, and axioms (the T-Box). Once the T-Box is right, populating instances (the A-Box) is relatively straightforward.

In the vehicle domain, this assumption inverts. The T-Box is comparatively simple: vehicles have engines, transmissions, colors; auctions have dates, prices, bidders. A competent domain modeler could build this in Protege in an afternoon.

The complexity lives entirely in the A-Box — in the 3.3 million specific observations about specific vehicles from specific sources at specific times with specific confidence levels. And crucially, A-Box entries *conflict with each other*. Source A says the engine is a 350. Source B says it is a 327. Source C says it was a 350 originally but was swapped to a 383 in 1995. All three may be honest. The T-Box has nothing to say about which is correct.

**What we built instead.** The observation system (`vehicle_observations`) is the A-Box, but with metadata that OWL does not natively support: `source_id`, `confidence_score`, `observed_at`, `is_superseded`, `content_hash`, `lineage_chain`. Every A-Box assertion carries its epistemological credentials. The T-Box is the PostgreSQL schema — table definitions, column types, CHECK constraints — which is stable, versionable, and enforced at the database level.

**The structural mismatch.** OWL was designed for rich T-Box reasoning over relatively clean A-Box data. The vehicle domain requires thin T-Box reasoning over massively contested A-Box data. Using OWL for this is like using a telescope to examine bacteria — the tool is excellent, but it is pointed in the wrong direction.

### II.B The Open World Assumption

**The problem.** OWL operates under the Open World Assumption (OWA): the absence of a statement does not imply its negation. If the knowledge base does not state that Vehicle X has been repainted, OWL does not infer that Vehicle X has NOT been repainted — it simply has no information.

This is philosophically correct. But in a production system, the distinction between "we have no information" and "we checked and found nothing" matters enormously. A vehicle with no paint observations is different from a vehicle whose paint was professionally assessed and found to be original. The first is ignorance. The second is evidence of absence. OWA conflates them.

**What we built instead.** The surface coverage system (`vehicle_surface_coverage`) explicitly tracks which zones have been observed and which have not. The auction readiness score penalizes gaps — zones with zero observations lower the photo score. The system distinguishes between:

- **Unobserved** — no observations exist for this zone
- **Observed-normal** — observations exist and show expected condition
- **Observed-anomalous** — observations exist and show unexpected condition

This three-valued logic (unknown/normal/anomalous) is not expressible in standard OWL without awkward workarounds.

### II.C The Atemporal Assumption

**The problem.** OWL ontologies are fundamentally atemporal. A class hierarchy is true *now*. An individual's properties hold *now*. There is no native mechanism for expressing: "this assertion was true when it was made but may not be true anymore" or "this assertion decays in reliability over a 90-day half-life."

Temporal extensions to OWL exist (OWL-Time, Allen's interval algebra) but they are bolted on rather than native. They enable temporal *reasoning* (event A happened before event B) but not temporal *epistemology* (assertion A was more reliable when it was fresh).

**What we built instead.** Every observation carries `observed_at` (when the real-world event occurred) and `ingested_at` (when the system recorded it). The `observation_half_lives` table maps 14 observation kinds to decay rates. Three PostgreSQL functions compute temporal decay in real time:

```
compute_decayed_confidence(confidence, observed_at, kind)
observation_relevance(observed_at, half_life_days)
observation_effective_weight(trust, confidence, observed_at, kind)
```

The `vehicle_observations_decayed` view applies decay to every observation automatically. Queries against this view see confidence adjusted for the passage of time. A condition report from three years ago at original confidence 0.85 might show effective confidence 0.42 today. A VIN decode from 1969 shows effective confidence 0.85 forever.

This is not temporal *reasoning* (which OWL-Time handles adequately). It is temporal *epistemology* — the recognition that knowledge itself ages. This has no equivalent in the Semantic Web stack.

### II.D The Single-Authority Assumption

**The problem.** The Semantic Web was designed for knowledge *sharing* — authoritative sources publishing facts that others consume. The Gene Ontology is curated by experts. SNOMED CT is maintained by an international consortium. The assumption is that published knowledge, while possibly incomplete, is not *adversarial*.

The collector vehicle domain is adversarial by default. Sellers have financial incentives to misrepresent condition, history, and provenance. "Matching numbers" may be a genuine assessment, a hopeful interpretation, or a deliberate fraud. Forum commenters may be knowledgeable enthusiasts, paid shills, or trolls. Even professional appraisals reflect the appraiser's biases and limitations.

**What we built instead.** The source trust hierarchy (`data_source_trust_hierarchy`) assigns quantified trust levels to 18 source types, from NHTSA VIN decodes (trust: 100) down to pattern inference (trust: 30). Each source type has scoped override rules — a receipt can assert mileage and work performed but cannot override a VIN decode on engine specifications.

The observer trust system (`observer_trust_scores`) tracks individual observers (human and AI) over time: base trust, current trust, corroboration count, contradiction count, accuracy rate, and trust trend. An observer who is consistently corroborated by later evidence sees their trust rise. One whose claims are frequently contradicted sees it fall.

This is adversarial epistemology — reasoning about knowledge when some sources are unreliable or actively deceptive. OWL has no mechanism for this. It assumes all assertions in the knowledge base are honestly contributed.

### II.E The Schema-Data Separation

**The problem.** The Semantic Web cleanly separates the ontology (OWL file) from the data (triple store). This is architecturally elegant but creates a practical gap: the ontology can be internally consistent yet fail to match the actual data, and the data can violate the ontology without the triple store knowing (unless SHACL validation is separately configured and run).

In our experience, this separation led to three recurring failures:

1. **Schema drift.** The ontology was updated but the extraction pipeline was not, or vice versa. New fields appeared in the data that the ontology did not define. Old fields remained in the ontology after being deprecated in practice.
2. **Validation latency.** SHACL validation runs after data insertion, not during. Invalid data enters the system and must be cleaned up after the fact.
3. **Extraction misalignment.** The LLM-based extraction pipeline needed to know what fields to extract. Maintaining a separate ontology file synchronized with the extraction prompts was a constant source of bugs.

**What we built instead.** The schema IS the ontology. A PostgreSQL `CREATE TABLE` statement simultaneously defines:

- **What entities exist** (table names)
- **What properties they have** (column names and types)
- **What constraints hold** (CHECK constraints, NOT NULL, foreign keys)
- **What the extraction pipeline should look for** (the DDL serves as the LLM prompt)
- **What validation rules apply** (enforced at INSERT time, not after)

When we add a column to a table, the ontology is extended, the extraction template gains a new field, and the validation rules are updated — all in a single DDL statement. There is no synchronization problem because there is only one artifact.

The cost is portability. Our ontology is expressed in PostgreSQL, not OWL. It cannot be imported into Protege or served as a SPARQL endpoint. We believe this tradeoff is correct for a production system where enforcement reliability outweighs interoperability.

---

## III. The Equivalence Table

For practitioners who understand OWL/RDF and want to understand the Nuke architecture, here is a mapping:

| OWL/RDF Concept | Nuke Equivalent | Notes |
|----------------|-----------------|-------|
| **owl:Class** | `CREATE TABLE` | Each table defines an entity class |
| **owl:ObjectProperty** | Foreign key | Relationships between entities |
| **owl:DatatypeProperty** | Column with type | Typed attributes |
| **owl:Individual** | Row (INSERT) | Instance of a class |
| **rdfs:subClassOf** | Table inheritance / FK to parent | Taxonomic hierarchy |
| **owl:Restriction** | CHECK constraint | Property constraints |
| **owl:equivalentClass** | Normalization table | Synonym resolution (4x4 = 4WD = K) |
| **owl:disjointWith** | CHECK constraint pairs | C10 is disjoint with 4WD |
| **SHACL shape** | CHECK + trigger | Validation rules |
| **Named Graph** | `source_id` + `observed_at` | Provenance per assertion |
| **SPARQL query** | SQL + views | Query language |
| **OWL reasoner** | Materialized views + functions | Derived knowledge |
| **Ontology versioning** | Migration files | Schema evolution |
| **PROV-O provenance** | `vehicle_field_provenance` table | Full provenance chain |
| **SKOS vocabulary** | `condition_taxonomy` table | Controlled vocabulary with hierarchy |
| *No equivalent* | `observation_half_lives` | Temporal decay of assertions |
| *No equivalent* | `observer_trust_scores` | Source reliability tracking |
| *No equivalent* | `merge_proposals` | Deferred entity resolution |
| *No equivalent* | `vehicle_surface_templates` | Spatial condition mapping |

The last four rows are the most important. They represent capabilities that the Semantic Web stack does not natively provide and that are essential for the physical asset domain.

---

## IV. What We Lost

Honesty requires acknowledging what the PostgreSQL-native approach sacrifices.

**Formal reasoning.** OWL reasoners can infer that if every Corvette is a Chevrolet, and this is a Corvette, then this is a Chevrolet. Our system cannot perform this inference automatically. We handle it through explicit data (the VIN decode tells us both the model and the make) rather than logical inference. For our domain, this is adequate — the VIN carries the full classification hierarchy. For domains where inference chains are long and classification is the primary task, OWL remains superior.

**Interoperability.** We cannot share our ontology with other systems in a standard format. If a museum wanted to integrate our vehicle provenance data with their CIDOC-CRM-based collection management system, a custom mapping would be required. This is a real cost that grows with the number of integration partners.

**Visualization.** Protege's VOWL plugin renders an ontology in seconds. Our schema requires custom visualization. The entity-relationship diagrams we maintain are manually created and manually updated.

**Community.** The Semantic Web has 30 years of published research, established conferences (ISWC, ESWC, K-CAP), and a network of practitioners. Our approach does not benefit from this ecosystem.

These are real losses. We accepted them because the gains — enforcement reliability, temporal epistemology, adversarial source handling, spatial condition mapping — were more critical for our domain.

---

## V. When to Use What

This is not a polemic against the Semantic Web. It is an argument for domain-appropriate tool selection.

**Use OWL/RDF/Protege when:**
- The primary deliverable is a class hierarchy (T-Box)
- Data sources are authoritative and non-adversarial
- Temporal dynamics are not critical
- Interoperability with other knowledge systems is essential
- Formal reasoning (inference, subsumption, consistency checking) adds value
- The A-Box is relatively clean and uncontested

**Use a schema-native knowledge graph when:**
- The primary challenge is contested, multi-source A-Box data
- Sources are adversarial or unreliable
- Assertions decay in reliability over time
- Enforcement must be guaranteed at write time
- The schema serves double duty as extraction instruction
- Spatial, temporal, and epistemological metadata are first-class concerns
- Scale demands operational database performance

**Consider a hybrid when:**
- The T-Box is complex enough to benefit from formal reasoning
- But the A-Box requires provenance, trust, and temporal decay
- And interoperability is important enough to justify maintaining two representations

We have not attempted a hybrid approach. It may be the right answer for systems that need both formal reasoning power and adversarial epistemology. We note it as an open research direction.

---

## VI. The Deeper Argument

The failures we document are not bugs in the Semantic Web stack. They are consequences of the stack's founding assumptions:

1. **Knowledge is categorical.** (But physical assets are individual.)
2. **Sources are authoritative.** (But sellers lie.)
3. **Facts are atemporal.** (But testimony decays.)
4. **Absence is ignorance.** (But uninspected is different from inspected-and-clean.)
5. **Schema and data are separate concerns.** (But in production, synchronization is the concern.)

These assumptions were appropriate for the Semantic Web's original use cases: publishing scientific knowledge, linking government datasets, building biomedical ontologies. They are not appropriate for domains where the primary challenge is not *what categories exist* but *what do we actually know about this specific thing, who told us, and should we believe them*.

The collector vehicle domain is one such domain. We suspect it is not the only one. Any domain characterized by contested ownership claims (real estate, art, collectibles), adversarial disclosure (used goods markets, insurance), temporal degradation (infrastructure, equipment), or multi-source evidence integration (intelligence analysis, journalism, legal discovery) may encounter the same structural mismatch.

The ontology community's tools are excellent. They are not universal. And the domains where they fall short may be exactly the domains where ontological rigor matters most — because the cost of getting it wrong is measured in dollars, not in logical inconsistency.

---

## References

- Gruber, T.R. (1993). "A Translation Approach to Portable Ontology Specifications." *Knowledge Acquisition*, 5(2), 199-220.
- Horrocks, I. et al. (2003). "From SHIQ and RDF to OWL: The Making of a Web Ontology Language." *Journal of Web Semantics*, 1(1), 7-26.
- Knublauch, H. & Kontokostas, D. (2017). *Shapes Constraint Language (SHACL).* W3C Recommendation.
- Lebo, T. et al. (2013). *PROV-O: The PROV Ontology.* W3C Recommendation.
- Noy, N.F. & McGuinness, D.L. (2001). "Ontology Development 101: A Guide to Creating Your First Ontology." Stanford Knowledge Systems Laboratory Technical Report.
- W3C. (2012). *OWL 2 Web Ontology Language Document Overview.* W3C Recommendation.
