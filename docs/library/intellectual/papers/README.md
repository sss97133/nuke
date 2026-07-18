# Papers

Index of the intellectual papers in this directory. The works below are the scholarly literature that grounds the claims made across these papers.

## Scholarly Foundations

These works ground the section's claims about applied ontology, entity resolution, provenance, immutability, layered defense, and social epistemology for the vehicle-data domain; all citations below are web-verified against primary sources.

- **Ontology as a formal, explicit specification of a shared conceptualization** → `applied-ontology-vehicle-domain.md` opens on Gruber's foundational definition and grounds its "applied ontology for the vehicle domain" framing on it, distinguishing an evidential ontology from classical class-and-relation engineering (Protégé/OWL/RDF). [gruber1993]
- **Entity resolution / record linkage with link / non-link / possible-link decisions and asymmetric error costs** → `entity-resolution-design.md` frames the core problem as deciding whether a BaT, Craigslist, and FB listing describe the same physical truck, weighs false-merge vs false-split cost asymmetry, and contrasts a cascade with a weighted composite score (VIN=0.50, URL=0.30…) — the modern restatement of the Fellegi–Sunter weighted-agreement linkage model. [fellegi_sunter1969]
- **Swiss-cheese defense-in-depth / layered barriers against latent failure** → the multi-pass entity-resolution cascade and the enrichment guard rules (test-before-blast, never-overwrite, pollution checks) are framed as multiple independent thin layers, each catching what the prior missed — Reason's system (not person) approach to error. [reason2000]
- **Immutability / append-only data: never overwrite, accumulate observations, compute current state from full history** → `applied-ontology-vehicle-domain.md` III (Immutable Identity Ontology) and `trust-scoring-methodology.md` insist corrections add a higher-authority observation rather than replacing a value; current state is computed from the observation stack, not stored. [helland2015]
- **Provenance modeling — entities, activities, agents; every assertion carries source, method, time** → `applied-ontology-vehicle-domain.md` III.C maps Nuke's provenance chain (source → extraction → assertion) onto PROV-O's Entity–Activity–Agent triad; trust-scoring stores source_type / source_url / observed_at / extraction_method on every observation row. [lebo2013_provo]
- **Event-centric (not state-centric) modeling of object histories; continuant vs occurrent** → `applied-ontology-vehicle-domain.md` III.A frames the immutable-identity model as four-dimensionalist/perdurantist and VI.B maps vehicles → continuants and observations/events → occurrents onto BFO; an engine swap is an event with actor participation, not a state mutation. CIDOC-CRM is the named event-centric precedent for cultural-heritage objects. [spear_ceusters_smith2016_bfo] [iso21127_cidoccrm]
- **Testimony and social epistemology — data as attributed claims with credibility weights, not facts** → `trust-scoring-methodology.md`'s core insight is "descriptions are testimony, not data," and `applied-ontology-vehicle-domain.md` IV.B ties its four-layer certainty hierarchy (claims/consensus/inspection/test) to Goldman's social epistemology — reliability as a function of testifier competence, source independence, and physical evidence. [goldman1999]
- **Temporal interval/decay reasoning over competing observations** → `trust-scoring-methodology.md` defines exponential half-life decay per observation type and a trust-weighted contradiction-resolution scheme; `applied-ontology-vehicle-domain.md` III.C cites Allen's interval algebra as the precedent for resolving overlapping and competing observations temporally (while noting Nuke currently uses point timestamps). [allen1983]

### Bibliography

1. **[gruber1993]** Thomas R. Gruber (1993). *A Translation Approach to Portable Ontology Specifications*. Knowledge Acquisition 5(2), 199–220. https://doi.org/10.1006/knac.1993.1008
2. **[fellegi_sunter1969]** Ivan P. Fellegi, Alan B. Sunter (1969). *A Theory for Record Linkage*. Journal of the American Statistical Association 64(328), 1183–1210. https://doi.org/10.1080/01621459.1969.10501049
3. **[reason2000]** James Reason (2000). *Human error: models and management*. BMJ 320(7237), 768–770. https://doi.org/10.1136/bmj.320.7237.768
4. **[helland2015]** Pat Helland (2015). *Immutability Changes Everything*. CIDR 2015 / ACM Queue 13(9). https://queue.acm.org/detail.cfm?id=2884038
5. **[lebo2013_provo]** Timothy Lebo, Satya Sahoo, Deborah McGuinness (eds.) (2013). *PROV-O: The PROV Ontology*. W3C Recommendation, 30 April 2013. https://www.w3.org/TR/prov-o/
6. **[spear_ceusters_smith2016_bfo]** Andrew D. Spear, Werner Ceusters, Barry Smith (2016). *Functions in Basic Formal Ontology*. Applied Ontology 11(2), 103–128. https://doi.org/10.3233/AO-160164
7. **[goldman1999]** Alvin I. Goldman (1999). *Knowledge in a Social World*. Oxford University Press (Clarendon Press). https://doi.org/10.1093/0198238207.001.0001
8. **[allen1983]** James F. Allen (1983). *Maintaining knowledge about temporal intervals*. Communications of the ACM 26(11), 832–843. https://doi.org/10.1145/182.358434
9. **[iso21127_cidoccrm]** ISO/TC 46 (CIDOC CRM Special Interest Group, ICOM) (2023). *ISO 21127:2023 — Information and documentation — A reference ontology for the interchange of cultural heritage information (CIDOC CRM)*. International Organization for Standardization. https://www.iso.org/standard/85100.html

*Verification note: all 9 citations confirmed real against primary sources (ACM DL, Taylor & Francis, BMJ, ACM Queue/CIDR, W3C, IOS/SAGE, Oxford Academic, iso.org). No citations were excluded — every entry in the audited set returned is_real=true.*
