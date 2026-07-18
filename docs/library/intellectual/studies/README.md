# STUDIES

Empirical analyses of the Nuke platform's construction, evolution, and operations. These are not opinions — they are investigations based on measurable evidence: 13,758 prompts, 2,045 commits, 541 sessions, 965 hours of active work, and 141 days of continuous development. Each study presents its methodology, its data, its findings, and its conclusions.

---

## Contents

### [13,758 Prompts: An Empirical Analysis of AI-Assisted Platform Construction](13758-prompts-analysis.md)
Formal write-up of the complete prompt corpus analysis. 541 sessions, 13,758 prompts, 2,045 commits across 141 days. Session archetypes, focus metrics, frustration distribution, machine activation patterns, metaphor evolution, and desire clustering. The empirical study of how a provenance engine was built through human-AI collaboration.

### [Dead Features Autopsy: An Analysis of Abandoned Ideas](dead-features-autopsy.md)
Post-mortem analysis of nine features that were killed during the March 2026 platform triage. Betting, trading, vault, concierge, shipping, investor portal, and three others. Prompt-to-commit ratios as diagnostic indicators. Cost of conceptual dead weight. Warning signs for future zombie features. Lessons for vertical expansion.

### [Platform Triage: March 2026 Case Study](platform-triage-2026-03.md)
The March 2026 triage as a reproducible methodology for platform audits. 171 GB reduced to 156 GB. 464 edge functions reduced to 440. 131 cron jobs reduced to 112. Estimated $3,000/month burn reduction. What was cut, what was kept, why, and how to reproduce the process.

### [Vocabulary Evolution: How the Project's Language Changed Over 141 Days](vocabulary-evolution.md)
Analysis of how the project's technical vocabulary evolved across five months and 13,758 prompts. Replacement chains (scrape to extract to ingest to observe), formality arcs (7.1% profanity in October to 5.6% in March), the rise of structured prompting (0.9% to 39%), and the relationship between vocabulary sophistication and implementation quality.

---

*These studies are based on the analytical work produced in `/docs/writing/` during March 2026. They formalize and extend that work into citation-ready documents with methodology sections, finding discussions, and reproducibility notes.*

---

## Methodological Foundations

The quantitative methods used across these studies are the standard primitives of information retrieval, statistics, and representation learning — not ad hoc. Each citation below is web-verified.

- **Document-frequency / term-specificity (IDF)** — `vocabulary-evolution.md` counts terms by distinct prompts containing them and treats rarer terms as higher-signal: inverse document frequency. [sparckjones1972idf], applied to query scoring by [ramos2003tfidf]
- **Herfindahl-Hirschman Index as a focus/concentration metric** — `13758-prompts-analysis.md` computes per-session focus as HHI of the category distribution (1.0 = single category; <0.4 flagged "thrashing"). [hirschman1964paternity]
- **Chance-corrected agreement (Cohen's κ)** — classifier-vs-human validation (87% on 200 labeled prompts) and multi-model agreement should report against chance-corrected agreement, since raw percent overstates reliability under skewed priors. [cohen1960kappa]
- **Precision / recall / F-measure** — `description-extraction-quality.md` frames correct vs. malformed extractions in retrieval-evaluation terms. [vanrijsbergen1979ir]
- **CLIP image-text joint embeddings** — matching a photo to a listing description is the contrastive image-text alignment task. [radford2021clip]
- **Perceptual / DCT-based image hashing (pHash)** — near-duplicate detection over the 1M+ image corpus. [zauner2010phash]

### Bibliography

1. **[sparckjones1972idf]** Karen Spärck Jones (1972). *A Statistical Interpretation of Term Specificity and Its Application in Retrieval*. Journal of Documentation 28(1), 11-21. https://doi.org/10.1108/eb026526
2. **[hirschman1964paternity]** Albert O. Hirschman (1964). *The Paternity of an Index*. American Economic Review 54(5), 761-762. https://www.jstor.org/stable/1818582
3. **[cohen1960kappa]** Jacob Cohen (1960). *A Coefficient of Agreement for Nominal Scales*. Educational and Psychological Measurement 20(1), 37-46. https://doi.org/10.1177/001316446002000104
4. **[vanrijsbergen1979ir]** C. J. van Rijsbergen (1979). *Information Retrieval (2nd ed.)*. Butterworths, London.
5. **[radford2021clip]** Radford, Kim, Hallacy, Ramesh, Goh, et al. (2021). *Learning Transferable Visual Models From Natural Language Supervision*. ICML (PMLR 139), arXiv:2103.00020. https://arxiv.org/abs/2103.00020
6. **[zauner2010phash]** Christoph Zauner (2010). *Implementation and Benchmarking of Perceptual Image Hash Functions*. MSc thesis, Hagenberg. https://www.phash.org/docs/pubs/thesis_zauner.pdf
7. **[ramos2003tfidf]** Juan Ramos (2003). *Using TF-IDF to Determine Word Relevance in Document Queries*. First **Instructional** Conf. on Machine Learning (iCML — a Rutgers tutorial venue, **not** ICML).

*Verification note: all seven confirmed real. ⚠️ [ramos2003tfidf] is the* Instructional *Conference (iCML), NOT the International Conference on Machine Learning (ICML) — do not conflate.*
