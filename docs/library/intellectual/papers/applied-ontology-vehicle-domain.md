# PAPER: Applied Ontology in the Collector Vehicle Domain

**Author:** Nuke Platform Research
**Date:** 2026-03-25
**Status:** Living Document
**References:** Contemplations: assets-accumulate-data.md, the-rhizome.md, testimony-and-half-lives.md; Papers: entity-resolution-design.md, trust-scoring-methodology.md

---

## Abstract

Formal ontology research has produced rich frameworks for representing knowledge — from Gruber's foundational definition of ontology as "a formal, explicit specification of a shared conceptualization" to contemporary work in applied ontology across biomedicine, manufacturing, and cultural heritage. Yet the collector vehicle domain remains largely unformalized: a $50B+ market where knowledge lives in forum posts, auction commentary, seller testimony, and the memories of enthusiasts. This paper examines how the Nuke platform operationalizes ontology engineering principles in a production knowledge graph for physical assets, arguing that the vehicle domain presents unique ontological challenges that existing frameworks address incompletely. We describe three contributions: (1) an immutable identity ontology for physical assets that distinguishes accumulation from mutation, (2) an epistemological trust layer that treats all assertions as testimony with quantified decay, and (3) a schema-as-prompt methodology where relational DDL serves as both the ontological specification and the instruction set for automated extraction. We connect these contributions to established work in formal ontology, knowledge representation, and the philosophy of information.

---

## I. Introduction: The Ontological Gap in Physical Asset Domains

The Semantic Web vision produced a generation of ontology tools and standards — OWL, RDF, SPARQL, Protege — designed primarily for categorical knowledge: taxonomies, class hierarchies, property restrictions. These tools excel at answering questions like "is a sports car a subclass of automobile?" or "does the property *hasEngine* have domain *Vehicle* and range *Engine*?"

What they handle less naturally is the epistemological dimension: not *what categories exist* but *what do we actually know about a specific individual, who told us, when, and how much should we trust it?*

In the collector vehicle domain, this epistemological dimension is primary. The ontological question "what is a 1967 Chevrolet Corvette 427/435?" has a factory answer (RPO codes, production records, VIN decode). But the questions that matter to the market — Is this *particular* car matching-numbers? Has it been repainted? Is the mileage accurate? Was the engine rebuilt? — are questions about the state of knowledge regarding a specific physical individual, not questions about class membership.

This paper argues that building a production knowledge system for physical assets requires moving beyond classical ontology engineering (defining classes and relations) into what we call *evidential ontology*: a framework where every assertion carries provenance, trust weight, temporal position, and decay characteristics.

---

## II. Background: Ontology Engineering and Its Limits

### II.A Classical Ontology Engineering

Gruber (1993) defined ontology as "an explicit specification of a conceptualization," establishing the field's foundational vocabulary. Guarino (1998) refined this by distinguishing between the conceptualization itself (the intended models of a logical language) and the ontology (the logical theory that constrains those models). Borst (1997) added the "shared" qualifier, emphasizing that ontologies are social artifacts requiring community agreement.

In practice, ontology engineering has followed a pattern: domain experts define classes, properties, and axioms using tools like Protege; the resulting OWL/RDF artifacts are deployed in knowledge bases; reasoners perform inference over the formalized knowledge. This pattern has produced significant results in biomedicine (the Gene Ontology, SNOMED CT), cultural heritage (CIDOC-CRM), and manufacturing (IOF).

### II.B Where Classical Approaches Fall Short

Three characteristics of the collector vehicle domain challenge this pattern:

**1. Individual-centric, not class-centric knowledge.** The Gene Ontology describes what genes *are*. A vehicle knowledge graph must describe what *this specific vehicle* has experienced. The T-Box (terminological knowledge) is relatively stable — vehicles have engines, transmissions, colors. The A-Box (assertional knowledge about individuals) is enormous, contested, and temporally layered. Classical ontology engineering focuses on T-Box design; the collector vehicle domain's complexity lives almost entirely in the A-Box.

**2. Contested assertions with no ground truth authority.** In biomedicine, peer-reviewed literature provides a (imperfect but functional) ground truth. In the vehicle domain, a seller says "matching numbers," an inspector says "engine stamp doesn't match VIN decode," and a forum commenter says "those stamps were re-done at the factory for warranty claims." All three may be honest. There is no authoritative resolution without physical examination — and even physical examination produces testimony, not certainty.

**3. Temporal accumulation, not state mutation.** Standard database ontologies model entities as having current states that replace previous states. Physical assets do not work this way. A vehicle that was painted red in 1967 and blue in 1995 is not a blue vehicle — it is a vehicle with two paint events. Both facts coexist. The ontology must accommodate accumulation rather than replacement.

---

## III. The Immutable Identity Ontology

### III.A Two Models of Change

We distinguish two ontological models of change, following the analysis in "Assets Accumulate Data" (Nuke Contemplations, 2026):

**Mutable identity** (the social media model): An entity *is* its current state. Updates replace previous states. History is optional metadata. The system optimizes for presenting the current state. This correctly models entities whose identity is constituted by their current attributes — user profiles, preferences, account settings.

**Immutable identity** (the physical asset model): An entity is constituted by its origin event and accumulates observations over time. No observation replaces a previous observation. Current state is *computed* from the full observation stack, not *stored* as a snapshot. History is not metadata — it is the primary data.

This distinction maps onto established philosophical territory. The immutable identity model is essentially a four-dimensionalist (perdurantist) ontology: the vehicle is the sum of its temporal parts, and its identity persists through all of them. Each observation adds a temporal slice. The mutable identity model is closer to endurantism: the entity is wholly present at each moment, and its properties are the properties it has *now*.

### III.B Formal Structure

In Nuke's implementation, the immutable identity ontology takes the form of a relational schema where:

- **Identity layer** (~15 columns): VIN, year, make, model, factory data. These are stamped into existence at manufacturing and never change. They are not observations — they are constitutive facts.
- **Observation layer** (unlimited rows): Every assertion about the vehicle — from any source, at any time, with any confidence level — is recorded as an observation with full provenance. The observation schema includes: `source_type`, `source_url`, `source_trust_score`, `observed_at`, `extracted_at`, `extraction_method`, `confidence`, `raw_text`.
- **Computed state** (materialized views): "What color is this car?" is answered by querying the observation stack, weighting by trust and recency, and returning the highest-confidence current answer. This is computation, not storage.

This architecture means the system never overwrites. A correction does not delete the previous value — it adds a new observation with higher authority that outweighs the old one in the computed state. The provenance chain is preserved. Mistakes are visible. The full epistemic history of every claim is recoverable.

### III.C Relation to Existing Work

This approach has precedent in several formal frameworks:

- **CIDOC-CRM** (the ICOM conceptual reference model for cultural heritage) models events rather than states, and tracks the participation of actors in events over time. Nuke's observation system is structurally similar to CIDOC-CRM's event-centric approach, applied to the vehicle domain.
- **PROV-O** (the W3C provenance ontology) formalizes the relationships between entities, activities, and agents. Nuke's observation provenance chain (source → extraction → assertion) maps directly onto PROV-O's Entity-Activity-Agent triad.
- **Allen's temporal interval algebra** informs how overlapping and competing observations are resolved temporally, though Nuke's current implementation uses point-in-time timestamps rather than full interval reasoning.

---

## IV. The Epistemological Trust Layer

### IV.A Testimony, Not Fact

The epistemological framework described in "Epistemology of Truth" (Nuke Research, 2026) treats all data as *testimony* — statements made by sources with varying authority, at specific times, subject to predictable decay.

This is not merely a data quality heuristic. It is an ontological commitment: the knowledge graph does not contain facts about vehicles. It contains *claims about vehicles, attributed to sources, with quantified uncertainty*. The distinction matters because it determines what operations are valid. You cannot "correct" a fact (facts are true by definition). You can add a higher-authority claim that supersedes a lower-authority one in the computed state, while preserving both in the observation record.

### IV.B Four Layers of Certainty

The framework defines four epistemological layers, each with increasing cost and authority:

**Layer 1: Claims.** Seller descriptions, forum posts, casual assertions. The cheapest and most abundant form of testimony. Citation verification checks whether the claim was accurately transcribed, not whether it is true.

**Layer 2: Consensus.** Multiple independent sources agree. A factory manual, a listing description, and three forum commenters all state the same horsepower figure. Consensus is stronger than individual claims but can be systematically wrong — the canonical example being manufacturer-stated horsepower figures, which are political numbers (set for insurance and marketing purposes) rather than measured values.

**Layer 3: Inspection.** Physical examination by a qualified observer. Paint meter readings, compression tests, visual matching of casting numbers. Better than claims but subjective, momentary, and dependent on inspector competence.

**Layer 4: Scientific test.** Dynamometer measurements, metallurgical analysis, spectroscopic paint analysis. Physics-based evidence that does not depend on testimony. The most expensive and most authoritative layer.

This hierarchy has formal parallels in epistemology. It resembles Goldman's (1999) social epistemology framework, where the reliability of testimony depends on the competence and honesty of the testifier, the independence of corroborating sources, and the availability of physical evidence. It also connects to Shapin's (1994) historical analysis of how scientific communities establish trust — through institutional authority, demonstrated competence, and reproducibility.

### IV.C Decay Functions

Testimony does not age uniformly. The framework assigns half-lives to categories of observation:

| Category | Half-Life | Rationale |
|----------|-----------|-----------|
| VIN, production records | Permanent | Constitutive identity; does not decay |
| Professional inspection | 3-5 years | Condition changes; inspector's observation becomes stale |
| Auction estimate | 6 months | Market moves; estimate reflects a moment |
| Forum consensus | 3-12 months | Community knowledge evolves; old threads are not updated |
| Marketplace listing price | 1-4 weeks | Seller adjusts to market feedback |

The decay formula:

```
current_weight = base_trust × source_authority × 0.5^(age / half_life) × corroboration_factor
```

This produces a continuous, queryable trust surface over the observation stack. "What do we know about this vehicle's engine?" returns not a single value but a weighted distribution of claims, ranked by current authority.

---

## V. Schema as Prompt: Ontology-Driven Extraction

### V.A The Problem of Schema-First vs. Discovery-First

Classical knowledge engineering follows a schema-first approach: define the ontology, then populate it. This assumes the domain expert knows what knowledge exists before encountering it. In the vehicle domain, this assumption fails reliably — a study of Nuke's own extraction pipeline found that a predefined schema of 344 reference fields applied to Porsche listings produced a 66.7% fabrication rate, because the LLM attempted to fill fields for which no source evidence existed.

The corrected approach inverts the process: discover what fields actually exist in the source material, then extend the schema to accommodate them. This is schema discovery — letting the data define the ontology rather than imposing the ontology on the data.

### V.B DDL as Ontological Specification

The key architectural insight is that relational DDL (Data Definition Language) serves simultaneously as:

1. **Ontological specification** — Column names, types, constraints, and foreign keys formally define what entities exist, what properties they have, and how they relate.
2. **Extraction instruction** — When an LLM is given a CREATE TABLE statement and asked to extract data from a document, every column becomes a question: "Does this source contain information about [column_name]?" The schema *is* the prompt.
3. **Validation constraint** — CHECK constraints, NOT NULL requirements, and foreign key relationships enforce ontological commitments at the database level. A vehicle cannot have a year of 1066; an observation cannot lack a source.

This triple role means that ontology engineering, extraction engineering, and data validation are the same activity expressed in different registers. Extending the schema (adding a column) simultaneously extends the ontology, creates a new extraction target, and defines a new validation rule.

### V.C Multi-Model Consensus as Ontological Validation

The platform's multi-model extraction architecture — handing the same schema and source document to multiple LLMs (Claude, GPT, Gemini) and diffing their outputs — functions as an ontological validation mechanism:

- **All models agree on a value** → The field is unambiguous in the source. High confidence.
- **Models diverge on a value** → The source is ambiguous or requires domain expertise. Flag for human review.
- **No model can fill a field** → The information is not present in the source. Do not fabricate.

This is structurally analogous to inter-annotator agreement in corpus linguistics and knowledge engineering — a well-established method for validating ontological categories.

---

## VI. The Actor Layer: From Asset Ontology to Social Ontology

### VI.A Components, Events, Actors, Organizations

A vehicle's history is not a sequence of states but a network of events involving actors. An engine swap is not "engine changed from X to Y" — it is "actor A, employed by organization B, at location C, on date D, removed engine X and installed engine Y, documented by photographs E and invoice F."

This event-actor-organization structure extends the asset ontology into social ontology. The vehicle record becomes connective tissue linking:

- **Actors** (mechanics, owners, dealers, inspectors) with demonstrated competence in specific domains
- **Organizations** (shops, auction houses, dealerships, registries) with institutional authority
- **Locations** (factories, garages, show fields) with geographic and temporal context
- **Documents** (invoices, titles, photographs, build sheets) with evidentiary weight

The resulting graph is not a vehicle database with some actor metadata. It is a social-material knowledge graph where vehicles, people, organizations, and documents are co-constitutive. Understanding a vehicle requires understanding its network. Understanding an actor requires understanding the vehicles they have touched.

### VI.B Relation to Upper Ontologies

This structure maps onto several established upper ontologies:

- **DOLCE** (Descriptive Ontology for Linguistic and Cognitive Engineering) distinguishes between endurants (objects) and perdurants (events). Vehicles are endurants; their observations are perdurants. Actors participate in perdurants.
- **BFO** (Basic Formal Ontology) distinguishes between continuants (entities that persist through time) and occurrents (processes and events). The vehicle is a material continuant; its history is a sequence of occurrents; observations are information content entities that are *about* the continuant.
- **SUMO** (Suggested Upper Merged Ontology) provides a Process ontology that accommodates the event-centric recording of vehicle history.

Nuke does not implement these upper ontologies formally (there is no OWL export, no DL reasoning). But the relational schema embodies their commitments: the distinction between persistent entities and temporal events, the requirement for actor participation in events, and the treatment of information as a first-class entity with its own provenance.

---

## VII. Rhizomatic Architecture and Ontological Pluralism

### VII.A Against Taxonomic Hierarchy

Classical ontology engineering privileges taxonomic hierarchy: Thing → Vehicle → Automobile → Sports Car → Corvette. This is a useful organizational principle but a poor model of how knowledge actually connects in the domain.

In practice, a 1967 Corvette connects to: a specific Holley carburetor model (parts ontology), a specific episode of Barrett-Jackson (event ontology), a specific issue of Road & Track (publication ontology), a specific owner in Scottsdale (actor ontology), a specific dyno run at a specific shop (measurement ontology), and a specific LS3 swap kit (modification ontology). These connections are heterogeneous — they cross ontological boundaries freely, linking material objects to social events to documentary evidence to institutional authorities.

The Deleuzian analysis in "The Rhizome" (Nuke Contemplations, 2026) argues this is not a deficiency to be resolved by better taxonomy. It is the essential structure of knowledge in this domain. The knowledge graph is a rhizome — any point connects to any other, and the connections are more informative than the categories.

### VII.B Ontological Pluralism in Practice

This means Nuke operates under ontological pluralism: multiple ontological frameworks coexist in the same system without a single unifying hierarchy. The vehicle is simultaneously:

- A **physical object** (material ontology: weight, dimensions, materials)
- A **manufactured artifact** (production ontology: factory, date, specifications)
- A **legal entity** (title ontology: VIN, registration, liens)
- A **market instrument** (valuation ontology: comparable sales, condition adjustments)
- A **cultural object** (provenance ontology: ownership history, exhibition history, media appearances)
- A **mechanical system** (engineering ontology: components, tolerances, wear patterns)

No single ontological framework adequately captures all of these. The system accommodates pluralism by treating the observation layer as ontologically neutral — any assertion from any framework can be recorded with its provenance — while the schema layers (identity, specification, state, market, evidence) provide organizational structure without enforcing ontological monism.

---

## VIII. Implications and Future Directions

### VIII.A For Applied Ontology Research

The collector vehicle domain offers several properties that make it valuable as an applied ontology testbed:

1. **Bounded but deep.** The domain has clear boundaries (vehicles) but enormous internal complexity (tens of thousands of specifications per generation, millions of individual histories).
2. **Naturally adversarial.** Sellers have incentives to misrepresent. The ontology must accommodate deception, not just honest disagreement.
3. **Multi-modal evidence.** Claims come from text, photographs, physical inspection, and instrumented measurement. The ontology must integrate across modalities.
4. **Long temporal horizons.** A vehicle's history spans decades. The ontology must handle temporal reasoning at scales from seconds (auction bidding) to centuries (provenance chains).
5. **Real economic stakes.** Ontological errors have dollar costs. A misidentified engine option can represent a six-figure difference in valuation. This provides a natural evaluation metric for ontological precision.

### VIII.B For Knowledge Graph Engineering

The schema-as-prompt methodology suggests a tighter integration between ontology engineering and LLM-based extraction than current practice assumes. Rather than treating the ontology as a passive schema that extraction fills, the DDL becomes an active instruction set. This has implications for:

- **Ontology evaluation**: Schema quality can be measured by extraction precision/recall, not just logical consistency.
- **Iterative refinement**: Schema discovery from data → extraction → evaluation → schema revision is a continuous cycle, not a waterfall.
- **Multi-agent validation**: Divergence between extraction models identifies ambiguous or poorly-specified schema elements.

### VIII.C For Digital Twin Architectures

The immutable identity ontology, combined with the epistemological trust layer, constitutes a *digital twin with quantified uncertainty*. This extends the digital twin concept (widely discussed in manufacturing and IoT) by acknowledging that the twin is not a mirror of reality but a *probabilistic model* built from heterogeneous testimony. The twin does not know the vehicle's current mileage. It has a distribution over possible mileages, weighted by the trust and recency of the sources that have reported mileage figures.

This honest accounting of uncertainty is, we argue, more useful than the false precision of a single "current mileage" field — and more formally defensible as an ontological commitment.

---

## IX. Conclusion

Building a production knowledge graph for the collector vehicle domain has required engaging with questions that formal ontology research identifies but that few production systems address: the distinction between class-level and individual-level knowledge, the epistemological status of assertions, the temporal structure of accumulation rather than replacement, the integration of heterogeneous evidence types, and the accommodation of ontological pluralism.

The Nuke platform's architecture — immutable identity, evidential observations, schema-as-prompt extraction, and rhizomatic connectivity — represents one set of answers to these questions, grounded not in theoretical elegance but in the practical demands of a domain where ontological precision has direct economic consequences.

We believe the collector vehicle domain, with its natural adversarialism, multi-modal evidence, and long temporal horizons, deserves attention from the applied ontology community as a challenging and illuminating testbed. And we believe that production knowledge systems, with their relentless exposure to messy reality, have contributions to make back to the formal theory.

---

## References

- Borst, W.N. (1997). *Construction of Engineering Ontologies for Knowledge Sharing and Reuse.* University of Twente.
- Crofts, N. et al. (2011). *Definition of the CIDOC Conceptual Reference Model.* ICOM/CIDOC.
- Deleuze, G. & Guattari, F. (1987). *A Thousand Plateaus: Capitalism and Schizophrenia.* University of Minnesota Press.
- Goldman, A. (1999). *Knowledge in a Social World.* Oxford University Press.
- Gruber, T.R. (1993). "A Translation Approach to Portable Ontology Specifications." *Knowledge Acquisition*, 5(2), 199-220.
- Guarino, N. (1998). "Formal Ontology and Information Systems." In *Proceedings of FOIS'98*, 3-15. IOS Press.
- Lebo, T. et al. (2013). *PROV-O: The PROV Ontology.* W3C Recommendation.
- Masolo, C. et al. (2003). *WonderWeb Deliverable D18: Ontology Library (DOLCE).* LOA-ISTC-CNR.
- Niles, I. & Pease, A. (2001). "Towards a Standard Upper Ontology." In *Proceedings of FOIS'01*, 2-9.
- Shapin, S. (1994). *A Social History of Truth.* University of Chicago Press.
- Smith, B. et al. (2015). "Basic Formal Ontology 2.0." *Applied Ontology*, 10(3-4), 219-244.
- Nuke Platform. (2026). "Assets Accumulate Data: The Ontology of Physical Objects in a Digital System." Internal Contemplation.
- Nuke Platform. (2026). "The Rhizome: A Deleuzian Analysis of Nuke's Architecture." Internal Contemplation.
- Nuke Platform. (2026). "Testimony and Half-Lives." Internal Contemplation.
- Nuke Platform. (2026). "Epistemology of Truth." Internal Research Document.
- Nuke Platform. (2026). "Entity Resolution Design." Internal Paper.
