# Ontological Lexicon — The Vocabulary of the Nuke Knowledge Graph

**Author:** Nuke Platform Research
**Date:** 2026-03-26
**Status:** Living Document
**Series:** Applied Ontology in the Collector Vehicle Domain (Paper 5 of 5)
**Purpose:** Defines every ontological concept used in the platform, mapping each to its formal precedent, its database implementation, and its operational meaning.

---

## How to Use This Lexicon

Each entry follows the format:

**Term** — *Formal origin.* Platform definition. `database_implementation`. Operational example.

Terms are grouped by ontological layer. Cross-references use **bold**.

---

## Layer 0: Identity Ontology

**Constitutive Fact**
*Aristotelian essentialism; Kripke's rigid designators.* A property that defines what an entity IS, not what has happened to it. Cannot change without the entity ceasing to be itself. `vehicles.vin`, `vehicles.year`, `vehicles.make`, `vehicles.model`. A 1969 Camaro cannot become a 1970 Camaro. The year is constitutive.

**Immutable Identity**
*Perdurantism (four-dimensionalism).* The commitment that a physical asset's identity is fixed at origin and persists through all subsequent changes. Changes are **accumulations**, not mutations. `vehicle_observations` (INSERT-only, never UPDATE). The vehicle does not "change color" — it accumulates a repaint event.

**VIN (Vehicle Identification Number)**
*Legal/institutional identity.* The strongest **constitutive fact** — a 17-character code stamped into the chassis that encodes make, model, year, plant, and sequence. Treated as permanent identity with infinite **half-life**. `vehicles.vin`, `vin_decode_cache`, `vin_plates_tags`. Confidence: 0.99 in **entity resolution**.

**Entity**
*Formal ontology (Guarino 1998).* A persistent individual in the knowledge graph. In Nuke, three entity types share the same ontological structure: Vehicle, Actor, Organization. `vehicles`, `actors`, `organizations`. Each accumulates **observations** independently.

---

## Layer 1: Observation Ontology

**Observation**
*Empiricism; PROV-O (W3C).* A single assertion about an entity from a specific source at a specific time. The atomic unit of knowledge. Not a fact — a **claim** with **provenance**. `vehicle_observations` (3.3M+ rows, 14 kinds). "BaT listing #142857 states the mileage is 47,000 on 2026-01-15."

**Observation Kind**
*Category theory.* The fundamental type of an observation, determining its **half-life**, trust ceiling, and downstream routing. 14 kinds: listing, comment, bid, sale_result, media, condition, specification, ownership, work_record, sighting, provenance, social_mention, expert_opinion, valuation. `vehicle_observations.kind` (enum). A listing decays in 90 days; a specification is permanent.

**Supersession**
*Belief revision (AGM theory).* The relationship between a newer observation and an older one from the same source about the same entity. The older observation is not deleted — it is marked `is_superseded = true` with `superseded_by` pointing to the replacement. Both persist for audit. `vehicle_observations.is_superseded`, `vehicle_observations.superseded_by`. A seller updates their listing description; the old description remains in the record.

**Lineage Chain**
*PROV-O derivation.* The sequence of observations that gave rise to a derived observation. When an AI analysis produces a discovery from raw observations, the discovery's lineage chain points back to its inputs. `vehicle_observations.lineage_chain` (uuid[]). A sentiment analysis cites the 200 auction comments it was derived from.

**Content Hash**
*Information theory; deduplication.* SHA-256 hash of an observation's structured data, used to prevent duplicate insertion. If the same source says the same thing twice, the system recognizes it as the same observation rather than a new one. `vehicle_observations.content_hash`.

---

## Layer 2: Epistemological Ontology

**Testimony**
*Social epistemology (Goldman 1999).* Every observation is testimony — a statement by a source, not a fact about reality. The distinction matters: testimony can be wrong, biased, outdated, or fraudulent. The platform never stores "facts" — only testimony with metadata. All of `vehicle_observations`. "The seller says matching numbers" is testimony. Physical measurement of matching stamps is higher-grade testimony, but still testimony.

**Half-Life**
*Nuclear physics metaphor.* The time it takes for an observation's **effective confidence** to decay to 50% of its original value. Different **observation kinds** have different half-lives. `observation_half_lives` (14 rows). A listing (half-life: 90 days) loses half its reliability in 3 months. A specification (half-life: permanent) never decays.

**Effective Confidence**
*Bayesian epistemology.* The current reliability weight of an observation, computed as: `source_trust * extraction_confidence * temporal_decay`. Three independent, composable factors. `observation_effective_weight()` (SQL function). An observation from a trusted source (0.85), extracted with high confidence (0.90), but 2 years old with a 1-year half-life, has effective confidence: 0.85 * 0.90 * 0.25 = 0.19.

**Source Trust**
*Testimony epistemology.* The base reliability of a data source, quantified 0.0-1.0. Reflects the source's institutional authority, track record, and domain scope. `observation_sources.base_trust_score` (158 sources). NHTSA: 1.00. Auction house: 0.74. Forum: 0.55. Social media: 0.39.

**Observer Trust**
*Virtue epistemology (Sosa 2007).* The reliability of an individual observer (human or AI), computed from their historical accuracy. Adjusts over time as claims are **corroborated** or **contradicted**. `observer_trust_scores`. A mechanic who consistently reports accurate compression readings builds trust. One whose estimates are regularly contradicted loses it.

**The Four Layers of Certainty**
*Platform-specific epistemological framework.* Claims (cheapest, most abundant) → Consensus (independent agreement) → Inspection (physical examination) → Scientific Test (physics-based measurement, bedrock). Each layer costs more and proves more. `data_source_trust_hierarchy` encodes this as trust levels 30-100.

**Corroboration**
*Social epistemology.* When multiple independent sources agree on a claim. Boosts **effective confidence** multiplicatively: 2 sources = 1.15x, 3 sources = 1.30x, cap at 1.50x. `vehicle_field_consensus.supporting_count`. Claude and Gemini both extract "V8 350" → confidence boost.

**Contradiction**
*Paraconsistent logic (da Costa 1974).* When sources disagree. Treated as evidence, not error. A contradiction observation is created with `extraction_method: 'contradiction_detection'` and confidence 0.30. Both positions are preserved. `vehicle_field_evidence` where `flagged_as_incorrect = false` on both sides. Claude says 350, Gemini says 327 → both claims persist; a contradiction observation records the disagreement.

**Accepted Discrepancy**
*Platform-specific.* A **contradiction** that has been reviewed and determined to be genuinely unresolvable with available evidence. Neither claim is rejected. The system lives with the uncertainty rather than forcing a false resolution. `timeline_conflicts.resolution_status = 'accepted_discrepancy'`. Mileage went down between two dated observations — this is physically impossible but both sources may be honest (odometer replacement, transcription error).

**Freshness**
*Platform-specific.* A categorical label for an observation's temporal state relative to its **half-life**: fresh (< 25% of half-life elapsed), aging (< 100%), stale (< 200%), expired (> 200%). `vehicle_observations_decayed.freshness`. A condition report 6 months old with a 1-year half-life is "aging."

---

## Layer 3: Spatial Ontology

**Zone**
*Spatial ontology; mereology.* A named region of a vehicle's body, one of ~42 canonical zones spanning exterior, interior, mechanical, and detail regions. The fundamental spatial unit for condition assessment. `surface_observations.zone`. `ext_front_driver`, `int_dashboard`, `mech_engine_bay`, `detail_vin_plate`.

**Surface Observation**
*Platform-specific spatial epistemology.* A condition observation located in both image space (bounding box) and zone space (named region), optionally with physical coordinates (inches from datum). `surface_observations` (373,069 rows). "Paint oxidation observed in zone ext_front_driver, bounding box [0.12, 0.34, 0.45, 0.67] in image #4857."

**Resolution Level**
*Multi-scale analysis; fractal geometry.* The precision of a surface observation: Level 0 = zone (entire panel), Level 1 = 6x6 grid within zone, Level 2 = 2x2 sub-grid, Level 3 = 1x1 (sub-inch). `surface_observations.resolution_level`. Currently all observations at Level 0; schema supports fractal zoom to sub-inch.

**Surface Template**
*Computational geometry.* The physical dimensions and zone boundaries of a specific body type in inches. Maps zone names to 3D axis-aligned bounding boxes. `vehicle_surface_templates.zone_bounds` (jsonb). 1971-1989 Mercedes 350SL: 180" x 71" x 51", 41 zone bounds.

**Angle Spectrum**
*Computer vision; viewpoint geometry.* Maps camera viewing angles (spherical coordinates) to visible zones. Formalizes which zones a photograph from a given angle can provide evidence about. `angle_spectrum_zones`. Front-three-quarter-driver photo sees zones that straight-rear photo cannot.

---

## Layer 4: Lifecycle Ontology

**Lifecycle State**
*Process ontology; material science.* One of seven qualitatively distinct modes of being for a physical artifact. Not a position on a linear scale — a categorical state with its own descriptive apparatus. `surface_observations.lifecycle_state`, `condition_taxonomy.lifecycle_affinity`.

**Fresh** — Temporal unity. One era dominates. New or recently restored to as-new condition.

**Worn** — Gradual departure from fresh through a single continuous process (use).

**Weathered** — Environmental interaction has produced irreversible change beyond normal wear.

**Restored** — Human intervention to reverse temporal effects. Intentional return toward original condition.

**Palimpsest** — *From medieval manuscript studies.* Temporal multiplicity. Multiple eras coexist as simultaneously legible physical evidence. A 1960s factory paint job showing through a 1980s respray partially sanded in a 2020 restoration. The defining characteristic of vehicles with complex, visible material histories.

**Ghost** — Identity persists but physical manifestation is severely attenuated. Barely recognizable as its original form.

**Archaeological** — The object has become primarily an evidence source rather than a functional artifact. More informative about construction details than preserved examples, precisely because deterioration has exposed hidden structure.

**Lifecycle Affinity**
*Platform-specific.* The set of **lifecycle states** in which a condition descriptor is expected or meaningful. Creates a bidirectional map between conditions and states. `condition_taxonomy.lifecycle_affinity` (text[]). `exterior.paint.oxidation` affiliates with [worn, weathered]. `provenance.numbers.matching` affiliates only with [palimpsest] — matching numbers only matters when the question is non-trivial.

---

## Layer 5: Condition Ontology

**Condition Descriptor**
*Controlled vocabulary; SKOS-like.* A formal term from the 202-entry condition taxonomy, identified by a dot-notation **canonical key**. Carries domain, descriptor type, severity scale, and **lifecycle affinity**. `condition_taxonomy`. `exterior.paint.oxidation` (domain: exterior, type: adjective, severity: 0-1 continuous, affinity: [worn, weathered]).

**Canonical Key**
*Hierarchical naming; Dublin Core.* Dot-notation identifier for a condition descriptor: `{domain}.{component}.{phenomenon}`. Enables structured queries across the taxonomy. `condition_taxonomy.canonical_key`. `mechanical.engine.matching_numbers`, `structural.frame.corrosion`, `interior.upholstery.patinated`.

**Descriptor Type**
*Linguistic ontology.* How a condition descriptor functions semantically:
- **Adjective** — a continuous quality with severity 0.0-1.0 (e.g., oxidation, wear, hazing)
- **State** — a binary fact (e.g., original paint: yes/no, matching numbers: yes/no)
- **Mechanism** — a mechanical operation or phenomenon (e.g., leak, fade, compression loss)

**Severity**
*Quantitative assessment.* For adjective-type descriptors, a continuous value 0.0-1.0 measuring intensity. For state-type descriptors, binary (present/absent). `surface_observations.severity`. Paint oxidation at 0.3 (light) vs. 0.9 (severe).

**Condition Domain**
*Mereological decomposition.* One of five top-level divisions of vehicle condition: exterior, interior, mechanical, structural, provenance. `condition_taxonomy.domain`, `vehicle_condition_scores` (five sub-scores). The same vehicle may be exterior-excellent but mechanical-poor.

---

## Layer 6: Actor Ontology

**Actor**
*CIDOC-CRM (E39 Actor).* A person or organization that participates in events affecting entities. Carries **trust score**, specialties, certifications, and evidence-based capabilities. `actors` (30 columns). A mechanic who rebuilds small-block Chevys is an actor with specialty `small_block_chevy` and demonstrated capability from **component events**.

**Component Event**
*CIDOC-CRM (E5 Event); reified relationship.* A fully specified interaction between an **actor** and a vehicle component: WHO did WHAT to WHICH PART on WHICH VEHICLE WHEN WHERE with EVIDENCE at WHAT COST. `component_events` (22 columns, polymorphic FK to 63 component tables). "John Smith (actor) rebuilt (event_type) engine block #3970010 (component) on VIN 124379N600123 (vehicle) on 2024-03-15 (date) at Smith's Garage (location) with photo evidence (evidence_ids) for $3,500 (cost)."

**Actor Capability**
*Virtue epistemology applied to skills.* A demonstrated ability, grounded in **component event** evidence. Not self-reported — computed from the actor's event history. `actor_capabilities`. "This mechanic has performed 47 small-block rebuilds rated average 0.92 spec compliance over 8 years."

**Provenance Chain**
*PROV-O; art historical provenance.* The sequence of **actors** and **organizations** through which an entity has passed over time. Each link carries dates, evidence, and confidence. `vehicle_field_provenance`, `component_events`. Factory (1969) → First owner (1969-1982) → Dealer (1982) → Second owner (1982-2001) → Shop/restoration (2001-2003) → Third owner (2003-present).

---

## Layer 7: Resolution Ontology

**Entity Resolution**
*Record linkage; data integration.* Determining whether two data records refer to the same physical object. In Nuke: does this BaT listing, this Facebook post, and this forum thread all describe the same truck? `ingest-observation/index.ts` (three-tier cascade). The central challenge of multi-source knowledge graphs.

**Resolution Tier**
*Platform-specific confidence stratification.* Three levels of entity resolution confidence:
- **Tier 1** (≥ 0.95): VIN match, same source URL. Auto-link.
- **Tier 2** (0.80-0.94): Normalized URL match across platforms. Auto-link.
- **Tier 3** (0.50-0.79): Y/M/M fuzzy match with signal boosters. Does NOT auto-link — creates **merge proposal**.

**Merge Proposal**
*Deferred commitment; evidence-based resolution.* A suspected entity match that requires verification before execution. Carries evidence, confidence, AI reasoning, and dual verification flags (ai_verified + human_verified). `merge_proposals`. "Vehicle A (BaT listing) and Vehicle B (Facebook post) may be the same truck. Confidence: 0.72. Evidence: same year/make/model, similar mileage, overlapping location. Status: pending review."

**False Merge / False Split**
*Entity resolution error taxonomy.* A false merge (two different vehicles treated as one) corrupts both records and is hard to undo. A false split (one vehicle treated as two) merely means incomplete data that can be merged later. The asymmetry drives the design: Tier 3 matches are proposed, not executed. "False splits are acceptable. False merges are catastrophic."

---

## Layer 8: Meta-Ontology

**Schema-as-Prompt**
*Platform-specific.* The principle that the database DDL serves simultaneously as ontological specification (what entities and properties exist), extraction instruction (what the LLM should look for), and validation constraint (what values are valid). A `CREATE TABLE` statement IS the prompt. `extract-vehicle-data-ai/index.ts`, `nlq-sql/index.ts`.

**Executable Axiom**
*Platform-specific.* An ontological rule enforced by the database at write time rather than checked by an external reasoner after the fact. `CHECK constraints`, `trigger functions`, normalization tables. "C10 and 4WD are contradictory" is not a logical axiom — it is a CHECK constraint that prevents invalid data from entering the system.

**Recursive Epistemological Decay**
*Platform-specific; meta-epistemology.* The application of the **half-life** framework to the academic papers that justify the platform's design decisions. Even the system's own epistemic foundations are time-bound claims subject to revision. `methodology_references.relevance_half_life_days`, `methodology_relevance_score()`.

**Ontological Pluralism**
*Philosophical pluralism (Quine, Putnam).* The commitment that multiple ontological frameworks coexist without a single unifying hierarchy. The same vehicle is simultaneously a physical object, a manufactured artifact, a legal entity, a market instrument, a cultural object, and a mechanical system. No single framework captures all perspectives. 150+ database views project the same entity through different ontological lenses.

**Digital Twin with Quantified Uncertainty**
*Digital twin (manufacturing); Bayesian epistemology.* The recognition that the digital representation of a physical asset is not a mirror of reality but a probabilistic model built from heterogeneous **testimony**. The twin does not *know* the vehicle's mileage — it has a distribution over possible mileages weighted by source trust and temporal decay. `vehicle_current_state` (computed view), `vehicle_observations_decayed`.

---

## Appendix: Quick Reference

| Concept | Table/Function | Row Count |
|---------|---------------|-----------|
| Observation | `vehicle_observations` | 3.3M+ |
| Field Evidence | `vehicle_field_evidence` | 747K |
| Field Provenance | `vehicle_field_provenance` | 121K |
| Surface Observation | `surface_observations` | 373K |
| Condition Descriptor | `condition_taxonomy` | 202 |
| Observation Source | `observation_sources` | 158 |
| Field Consensus | `vehicle_field_consensus` | 4 (early) |
| Half-Life Tier | `observation_half_lives` | 14 |
| Trust Level | `data_source_trust_hierarchy` | 18 |
| Component Table | various | 63 tables |
| Zone | zone vocabulary | ~42 |
| Lifecycle State | enum | 7 |
| Observation Kind | enum | 14 |
| Methodology Paper | `methodology_references` | 17 |
